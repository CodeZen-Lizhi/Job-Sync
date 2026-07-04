import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiepinNormalizedPayload,
  buildLiepinSearchUrl,
  extractLiepinJobId,
  isLiepinSecurityVerificationText,
  normalizeLiepinSearchCities,
  parseLiepinDetailPage,
  parseLiepinSearchHtml,
  runLiepinMode,
} from "../src/liepin/feed.js";

test("extractLiepinJobId reads common detail URL and query ids", () => {
  assert.equal(
    extractLiepinJobId("https://www.liepin.com/job/1961234567.shtml?imscid=abc"),
    "1961234567",
  );
  assert.equal(
    extractLiepinJobId("https://www.liepin.com/a/abc_123.shtml"),
    "abc_123",
  );
  assert.equal(extractLiepinJobId("jobId=liepin-123_456"), "liepin-123_456");
});

test("buildLiepinSearchUrl carries extended filters and raw params", () => {
  const url = new URL(buildLiepinSearchUrl("Go 远程", 2, "010", {
    salary: "30$50",
    experience: "3$5",
    degree: "040",
    industry: "040",
    company_type: "010",
    company_scale: "050",
    job_type: "backend",
    publish_date: "7",
    sort_by: "15",
    raw_params: "https://www.liepin.com/zhaopin/?salary=override&customFlag=1",
  }));

  assert.equal(url.searchParams.get("key"), "Go 远程");
  assert.equal(url.searchParams.get("city"), "010");
  assert.equal(url.searchParams.get("currentPage"), "1");
  assert.equal(url.searchParams.get("salary"), "override");
  assert.equal(url.searchParams.get("workYear"), "3$5");
  assert.equal(url.searchParams.get("eduLevel"), "040");
  assert.equal(url.searchParams.get("industry"), "040");
  assert.equal(url.searchParams.get("compKind"), "010");
  assert.equal(url.searchParams.get("compScale"), "050");
  assert.equal(url.searchParams.get("jobKind"), "backend");
  assert.equal(url.searchParams.get("pubTime"), "7");
  assert.equal(url.searchParams.get("sortFlag"), "15");
  assert.equal(url.searchParams.get("customFlag"), "1");
});

test("normalizeLiepinSearchCities splits multi-city text and arrays", () => {
  assert.deepEqual(
    normalizeLiepinSearchCities({
      city: ["北京、上海", "深圳"],
      cityId: "010，020",
      cityText: "广州\n成都",
    }),
    ["北京", "上海", "深圳", "010", "020", "广州", "成都"],
  );
  assert.deepEqual(normalizeLiepinSearchCities({ city: "" }), [""]);
});

test("parseLiepinSearchHtml extracts list-level job evidence", () => {
  const html = `
    <section class="job-card">
      <a class="job-title" href="https://www.liepin.com/job/1961234567.shtml?imscid=abc">Go 平台工程师</a>
      <button>收藏</button>
      <div>30-50K</div>
      <div>北京·朝阳</div>
      <div>3-5年</div>
      <div>本科</div>
      <div>可靠云科技有限公司</div>
      <div>Kubernetes</div>
      <div>Prometheus</div>
    </section>
  `;
  const entries = parseLiepinSearchHtml(html);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.jobId, "1961234567");
  assert.equal(entries[0]?.title, "Go 平台工程师");
  assert.equal(entries[0]?.salary, "30-50K");
  assert.equal(entries[0]?.city, "北京·朝阳");
  assert.equal(entries[0]?.experience, "3-5年");
  assert.equal(entries[0]?.degree, "本科");
  assert.equal(entries[0]?.company, "可靠云科技有限公司");
  assert.match(entries[0]?.description ?? "", /Kubernetes/);
  assert.doesNotMatch(entries[0]?.description ?? "", /收藏/);
});

test("parseLiepinDetailPage extracts description and detects blocked pages", () => {
  const entry = {
    jobId: "1961234567",
    title: "Go 平台工程师",
    url: "https://www.liepin.com/job/1961234567.shtml",
  };
  const parsed = parseLiepinDetailPage(`
    <html><body>
      <h1>Go 平台工程师</h1>
      <div class="job-desc">负责 Go 服务治理、Kubernetes 平台建设和可观测性。</div>
    </body></html>
  `, entry);

  assert.equal(parsed.detailStatus, "ok");
  assert.match(parsed.description ?? "", /Kubernetes/);

  const blocked = parseLiepinDetailPage("<title>安全验证</title><div>请完成验证</div>", entry);
  assert.equal(blocked.detailStatus, "blocked");
});

test("buildLiepinNormalizedPayload produces unified job payload", () => {
  const payload = buildLiepinNormalizedPayload({
    jobId: "1961234567",
    title: "Go 平台工程师",
    url: "https://www.liepin.com/job/1961234567.shtml",
    company: "猎聘测试科技",
    city: "北京",
    salary: "30-50K",
    experience: "3-5年",
    degree: "本科",
    description: "负责平台工程。",
    detailStatus: "ok",
  }, { keyword: "Go 远程", filters: { city: "010" } });

  assert.equal(payload.encrypt_job_id, "liepin:1961234567");
  assert.equal(payload.source_platform, "liepin");
  assert.equal(payload.dedup_key, "1961234567");
  assert.equal(payload.brand_name, "猎聘测试科技");
  assert.match(payload.jd_text ?? "", /负责平台工程/);
});

test("isLiepinSecurityVerificationText detects verification pages", () => {
  assert.equal(isLiepinSecurityVerificationText("安全验证 请完成验证"), true);
  assert.equal(isLiepinSecurityVerificationText("普通岗位页面"), false);
});

test("runLiepinMode fails clearly when browser profile is missing", async () => {
  const events: Array<{ type: string; payload?: any }> = [];
  await runLiepinMode(
    {
      session: { cookies: [], local_storage: {} },
      task: {
        keywords: ["Java"],
        source_platform: "liepin",
        filters: { city: "010" },
        limits: { maxPages: 1 },
        mode: "auto",
      },
    },
    {
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    },
  );

  const error = events.find((event) => event.type === "ERROR");
  assert.ok(error);
  assert.match(error?.payload?.message ?? "", /重新连接猎聘/);
  assert.equal(events.some((event) => event.type === "JOB_NORMALIZED_CAPTURED"), false);
});
