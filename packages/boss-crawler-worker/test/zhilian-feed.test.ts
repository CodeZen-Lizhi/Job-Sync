import assert from "node:assert/strict";
import test from "node:test";

import {
  buildZhilianNormalizedPayload,
  extractZhilianJobId,
  isZhilianSecurityVerificationText,
  parseZhilianDetailPage,
  parseZhilianJobLinks,
  parseZhilianSearchApi,
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
