import assert from "node:assert/strict";
import test from "node:test";

import {
  buildZhilianNormalizedPayload,
  extractZhilianJobId,
  isZhilianSecurityVerificationText,
  parseZhilianDetailPage,
  parseZhilianJobLinks,
  parseZhilianPcSearchHtml,
  parseZhilianSearchApi,
  runZhilianMode,
} from "../src/zhilian/feed.js";

test("extractZhilianJobId reads common detail URL and API ids", () => {
  assert.equal(
    extractZhilianJobId("https://www.zhaopin.com/jobdetail/CCL1337269640J40873577205.htm"),
    "CCL1337269640J40873577205",
  );
  assert.equal(
    extractZhilianJobId("https://fe-api.zhaopin.com/api/c/jobs/123456/info"),
    "123456",
  );
  assert.equal(extractZhilianJobId("jobId=abc-123_456"), "abc-123_456");
});

test("parseZhilianSearchApi normalizes old search API items", () => {
  const entries = parseZhilianSearchApi({
    data: {
      results: [
        {
          number: "CCL123J001",
          jobName: "Go 平台工程师",
          company: { name: "智联测试科技" },
          city: "北京",
          salary: "25-45K",
          workingExp: "3-5年",
          eduLevelName: "本科",
          positionURL: "https://www.zhaopin.com/jobdetail/CCL123J001.htm",
          welfare: ["五险一金", "远程"],
        },
      ],
    },
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.jobId, "CCL123J001");
  assert.equal(entries[0]?.title, "Go 平台工程师");
  assert.equal(entries[0]?.company, "智联测试科技");
  assert.deepEqual(entries[0]?.welfare, ["五险一金", "远程"]);
});

test("parseZhilianJobLinks extracts stable jobs from html links", () => {
  const html = `
    <div class="job-card">
      <a class="job-title" href="/jobdetail/CCL999J001.htm">SRE 工程师</a>
      <span class="company-name">可靠云</span>
      <span class="salary">30-50K</span>
    </div>
  `;
  const entries = parseZhilianJobLinks(html);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.jobId, "CCL999J001");
  assert.equal(entries[0]?.url, "https://www.zhaopin.com/jobdetail/CCL999J001.htm");
  assert.equal(entries[0]?.title, "SRE 工程师");
});

test("parseZhilianPcSearchHtml extracts list-level job evidence from PC search page", () => {
  const html = `
    <section class="job-card">
      <a class="job-title" href="https://www.zhaopin.com/jobdetail/CCL1405333700J40877845205.htm?refcode=4019">java 开发工程师</a>
      <button>下载智联APP和我聊聊吧</button>
      <button>收藏</button>
      <div>1.3-1.7万</div>
      <div>JavaScript</div>
      <div>Spring</div>
      <div>MySQL</div>
      <div>北京·顺义·双丰</div>
      <div>3-5年</div>
      <div>本科</div>
      <div>北京捷科智诚科技有限公司上海分公司</div>
      <div>民营</div>
      <div>1000-9999人</div>
      <div>软件/IT服务</div>
      <button>立即沟通</button>
    </section>
  `;
  const entries = parseZhilianPcSearchHtml(html);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.jobId, "CCL1405333700J40877845205");
  assert.equal(entries[0]?.title, "java 开发工程师");
  assert.equal(entries[0]?.salary, "1.3-1.7万");
  assert.equal(entries[0]?.city, "北京·顺义·双丰");
  assert.equal(entries[0]?.experience, "3-5年");
  assert.equal(entries[0]?.degree, "本科");
  assert.equal(entries[0]?.company, "北京捷科智诚科技有限公司上海分公司");
  assert.match(entries[0]?.description ?? "", /Spring/);
  assert.doesNotMatch(entries[0]?.description ?? "", /下载智联APP|收藏/);
});

test("parseZhilianPcSearchHtml keeps adjacent PC cards isolated", () => {
  const html = `
    <div class="job-card">
      <a class="job-title" href="https://www.zhaopin.com/jobdetail/CCL111J001.htm">Java 后端开发</a>
      <div>1.5-2.2万</div>
      <div>北京·朝阳</div>
      <div>3-5年</div>
      <div>本科</div>
      <div>第一科技有限公司</div>
      <div>民营</div>
      <div>100-299人</div>
      <div>软件/IT服务</div>
    </div>
    <div class="job-card">
      <a class="job-title" href="https://www.zhaopin.com/jobdetail/CCL222J002.htm">Python 数据工程师</a>
      <div>8千-1.2万</div>
      <div>上海·浦东</div>
      <div>1-3年</div>
      <div>大专</div>
      <div>第二智能有限公司</div>
      <div>上市公司</div>
      <div>1000-9999人</div>
      <div>人工智能</div>
    </div>
  `;
  const entries = parseZhilianPcSearchHtml(html);

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.title, "Java 后端开发");
  assert.equal(entries[0]?.company, "第一科技有限公司");
  assert.equal(entries[0]?.city, "北京·朝阳");
  assert.doesNotMatch(entries[0]?.description ?? "", /Python 数据工程师|第二智能有限公司/);
  assert.equal(entries[1]?.title, "Python 数据工程师");
  assert.equal(entries[1]?.company, "第二智能有限公司");
  assert.equal(entries[1]?.city, "上海·浦东");
});

test("parseZhilianDetailPage extracts description and detects blocked pages", () => {
  const entry = {
    jobId: "CCL123J001",
    title: "Go 平台工程师",
    url: "https://www.zhaopin.com/jobdetail/CCL123J001.htm",
  };
  const parsed = parseZhilianDetailPage(`
    <html><body>
      <h1>Go 平台工程师</h1>
      <div class="job-desc">负责 Go 服务治理、Kubernetes 平台建设和可观测性。</div>
    </body></html>
  `, entry);

  assert.equal(parsed.detailStatus, "ok");
  assert.match(parsed.description ?? "", /Kubernetes/);

  const blocked = parseZhilianDetailPage("<title>Security Verification</title><div>Protected by Tencent Cloud EdgeOne</div>", entry);
  assert.equal(blocked.detailStatus, "blocked");
});

test("buildZhilianNormalizedPayload produces unified job payload", () => {
  const payload = buildZhilianNormalizedPayload({
    jobId: "CCL123J001",
    title: "Go 平台工程师",
    url: "https://www.zhaopin.com/jobdetail/CCL123J001.htm",
    company: "智联测试科技",
    city: "北京",
    salary: "25-45K",
    experience: "3-5年",
    degree: "本科",
    description: "负责平台工程。",
    detailStatus: "ok",
  }, { keyword: "Go 远程", filters: { city: "530" } });

  assert.equal(payload.encrypt_job_id, "zhilian:CCL123J001");
  assert.equal(payload.source_platform, "zhilian");
  assert.equal(payload.dedup_key, "CCL123J001");
  assert.equal(payload.brand_name, "智联测试科技");
  assert.match(payload.jd_text ?? "", /负责平台工程/);
});

test("isZhilianSecurityVerificationText detects EdgeOne verification pages", () => {
  assert.equal(isZhilianSecurityVerificationText("Security Verification Protected by Tencent Cloud EdgeOne"), true);
  assert.equal(isZhilianSecurityVerificationText("普通岗位页面"), false);
});

test("runZhilianMode fails clearly when browser profile is missing", async () => {
  const events: Array<{ type: string; payload?: any }> = [];
  await runZhilianMode(
    {
      session: { cookies: [], local_storage: {} },
      task: {
        keywords: ["Java"],
        source_platform: "zhilian",
        filters: { city: "530" },
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
  assert.match(error?.payload?.message ?? "", /重新连接智联/);
  assert.equal(events.some((event) => event.type === "JOB_NORMALIZED_CAPTURED"), false);
});
