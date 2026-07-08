import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { Browser, HTTPResponse } from "puppeteer";

import {
  getBossLowRiskCooldownRemainingMs,
  resetBossLowRiskCooldownForTests,
  resolveBossAutoLimits,
  setBossLowRiskCooldownUntilForTests,
} from "../src/modes/auto/run.js";
import {
  buildJobListBody,
  buildJobListUrl,
  closeBrowserRespectingHumanVerification,
  createHumanVerificationTracker,
  isAbnormalAccess,
  isBossRiskResponse,
  isLoginExpired,
  matchesExpectedJobListPayload,
  normalizeFilterVariants,
  readHttpResponseAsPageFetchJsonResult,
} from "../src/modes/auto/shared.js";

const workerRoot = process.cwd();

function readWorkerFile(path: string): string {
  return readFileSync(resolve(workerRoot, path), "utf8");
}

function mockHttpResponse(args: {
  status: number;
  url: string;
  contentType: string;
  text: string;
}): HTTPResponse {
  return {
    status: () => args.status,
    url: () => args.url,
    headers: () => ({ "content-type": args.contentType }),
    text: async () => args.text,
  } as unknown as HTTPResponse;
}

function mockBrowser(): Browser & { actions: string[] } {
  const actions: string[] = [];
  return {
    actions,
    close: async () => {
      actions.push("close");
    },
    disconnect: () => {
      actions.push("disconnect");
    },
  } as unknown as Browser & { actions: string[] };
}

describe("Boss auto collection contract", () => {
  it("keeps JOB_LIST_CAPTURED as the full raw list even when profile filter gates detail capture", () => {
    const source = readWorkerFile("src/modes/auto/run.ts");

    assert.doesNotMatch(source, /withFilteredJobListRaw/);
    assert.match(source, /raw:\s*jobListRaw/);
    assert.match(source, /jobsToCapture\s*=\s*eligibleJobs/);
    assert.match(source, /type:\s*"JOB_FILTERED"/);
  });

  it("expands Boss multi-city filters into sequential job-list variants", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");
    const sharedSource = readWorkerFile("src/modes/auto/shared.ts");

    assert.match(sharedSource, /export function normalizeFilterVariants/);
    assert.match(sharedSource, /return cities\.map\(\(city\) => \(\{ \.\.\.base, city \}\)\)/);
    assert.match(runSource, /const filterVariants = normalizeFilterVariants/);
    assert.match(runSource, /for \(const \[variantIndex, apiFilters\] of filterVariants\.entries\(\)\)/);
    assert.match(runSource, /if \(filterVariants\.length > 1\) log\(`开始 \$\{variantLabel\}`\)/);
  });

  it("builds one Boss job-list request body per selected city code", () => {
    const warnings: string[] = [];
    const variants = normalizeFilterVariants(
      {
        city: ["101010100", "101020100"],
        salary: "405",
        experience: "104",
        degree: "203",
        jobType: "1901",
        stage: "801",
        position: "100101",
        multiSubway: ["1001", "1002"],
        multiBusinessDistrict: ["2001", "2002"],
      },
      (message) => warnings.push(message),
    );

    assert.deepEqual(
      variants.map((variant) => variant.city),
      ["101010100", "101020100"],
    );
    assert.equal(warnings.length, 0);

    const bodies = variants.map((variant) => new URLSearchParams(buildJobListBody("Go", 1, 15, variant)));
    assert.deepEqual(
      bodies.map((body) => body.get("city")),
      ["101010100", "101020100"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("query")),
      ["Go", "Go"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("salary")),
      ["405", "405"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("jobType")),
      ["1901", "1901"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("stage")),
      ["801", "801"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("position")),
      ["100101", "100101"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("multiSubway")),
      ["1001,1002", "1001,1002"],
    );
    assert.deepEqual(
      bodies.map((body) => body.get("multiBusinessDistrict")),
      ["2001,2002", "2001,2002"],
    );
  });

  it("builds a Boss page-context GET job-list URL without empty filter noise", () => {
    const url = new URL(buildJobListUrl("Go 远程", 2, 15, {
      city: "101020100",
      multiSubway: "",
      multiBusinessDistrict: "",
      position: "",
      jobType: "",
      salary: "406",
      experience: "",
      degree: "203",
      industry: "",
      scale: "",
      stage: "",
    }));

    assert.equal(url.origin, "https://www.zhipin.com");
    assert.equal(url.pathname, "/wapi/zpgeek/search/joblist.json");
    assert.equal(url.searchParams.get("scene"), "1");
    assert.equal(url.searchParams.get("query"), "Go 远程");
    assert.equal(url.searchParams.get("city"), "101020100");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(url.searchParams.get("pageSize"), "15");
    assert.equal(url.searchParams.get("salary"), "406");
    assert.equal(url.searchParams.get("degree"), "203");
    assert.equal(url.searchParams.has("experience"), false);
    assert.equal(url.searchParams.has("multiSubway"), false);
  });

  it("pauses and retries Boss risk-control responses instead of treating them as terminal failures", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");
    const sharedSource = readWorkerFile("src/modes/auto/shared.ts");

    assert.equal(isAbnormalAccess({ code: 36, message: "您的账户存在异常行为." }), true);
    assert.equal(isAbnormalAccess({ code: 37, message: "访问行为异常" }), true);
    assert.equal(isAbnormalAccess({ code: 0, message: "ok" }), false);
    assert.equal(isLoginExpired({ code: 7, message: "登录状态已失效" }), true);
    assert.equal(isBossRiskResponse({ status: 200, json: { code: 7, message: "登录状态已失效" } }), true);
    assert.equal(
      isBossRiskResponse({
        status: 200,
        json: null,
        response_url: "https://www.zhipin.com/web/user/",
        content_type: "text/html; charset=utf-8",
        text: "<html>请登录后继续</html>",
      }),
      true,
    );
    assert.equal(
      isBossRiskResponse({
        status: 200,
        json: null,
        response_url: "https://www.zhipin.com/security-check.html",
        content_type: "text/html; charset=utf-8",
        text: "<html>安全验证 geetest</html>",
      }),
      true,
    );
    assert.match(runSource, /requestBossJsonWithRiskRecovery/);
    assert.match(sharedSource, /export async function requestBossJsonWithRiskRecovery/);
    assert.match(sharedSource, /export async function waitUntilBossLoginReady/);
    assert.match(sharedSource, /waitUntilApiOk/);
    assert.match(sharedSource, /const initialRisk = emitBossRiskStatus\(ctx, label, res, null\)/);
    assert.match(sharedSource, /waitUntilApiOk\([\s\S]*initialRisk\.status\)/);
    assert.match(sharedSource, /waitUntilNoRiskUrl/);
    assert.match(sharedSource, /status:\s*"invalid"/);
    assert.match(sharedSource, /登录状态已失效/);
    assert.doesNotMatch(runSource, /Boss 风控已触发，已退出本次采集/);
    assert.doesNotMatch(runSource, /stopForBossRiskControl/);
  });

  it("applies conservative Boss low-risk limits by default", () => {
    assert.deepEqual(
      resolveBossAutoLimits({ maxPages: 10, maxJobs: 200, delayMs: 800, jitterMs: 1000, bossDetailFetchLimit: 5 }),
      {
        lowRiskMode: true,
        maxPages: 2,
        maxJobs: 50,
        detailFetchLimit: 0,
        delayMs: 8000,
        jitterMs: 12000,
        pageSize: 15,
      },
    );

    assert.deepEqual(
      resolveBossAutoLimits({ lowRiskMode: false, maxPages: 10, maxJobs: 200, delayMs: 800, jitterMs: 1000, bossDetailFetchLimit: 5 }),
      {
        lowRiskMode: false,
        maxPages: 10,
        maxJobs: 200,
        detailFetchLimit: 5,
        delayMs: 800,
        jitterMs: 1000,
        pageSize: 15,
      },
    );
  });

  it("keeps Boss low-risk cooldown state explicit and testable", () => {
    resetBossLowRiskCooldownForTests();
    assert.equal(getBossLowRiskCooldownRemainingMs(1_000), 0);

    setBossLowRiskCooldownUntilForTests(61_000);
    assert.equal(getBossLowRiskCooldownRemainingMs(1_000), 60_000);

    resetBossLowRiskCooldownForTests();
    assert.equal(getBossLowRiskCooldownRemainingMs(1_000), 0);
  });

  it("preserves natural Boss HTML responses so login and security pages are recoverable", async () => {
    const result = await readHttpResponseAsPageFetchJsonResult(mockHttpResponse({
      status: 200,
      url: "https://www.zhipin.com/wapi/zpgeek/search/joblist.json",
      contentType: "text/html; charset=utf-8",
      text: "<html><title>安全验证</title><body>请完成 geetest 人机验证后继续</body></html>",
    }));

    assert.equal(result.status, 200);
    assert.equal(result.json, null);
    assert.equal(result.content_type, "text/html; charset=utf-8");
    assert.match(result.text ?? "", /安全验证/);
    assert.equal(isBossRiskResponse(result), true);
  });

  it("rejects natural Boss job-list payloads that expose mismatched query, page, or city", () => {
    const filters = {
      city: "101010100",
      multiSubway: "",
      multiBusinessDistrict: "",
      position: "",
      jobType: "",
      salary: "",
      experience: "",
      degree: "",
      industry: "",
      scale: "",
      stage: "",
    };

    assert.equal(
      matchesExpectedJobListPayload(
        { code: 0, zpData: { query: "Go 远程", page: 1, city: "101010100", jobList: [] } },
        "Go 远程",
        1,
        filters,
      ),
      true,
    );
    assert.equal(
      matchesExpectedJobListPayload(
        { code: 0, zpData: { query: "Java", page: 1, city: "101010100", jobList: [] } },
        "Go 远程",
        1,
        filters,
      ),
      false,
    );
    assert.equal(
      matchesExpectedJobListPayload(
        { code: 0, zpData: { query: "Go 远程", page: 2, city: "101010100", jobList: [] } },
        "Go 远程",
        1,
        filters,
      ),
      false,
    );
    assert.equal(
      matchesExpectedJobListPayload(
        { code: 0, zpData: { query: "Go 远程", page: 1, city: "101020100", jobList: [] } },
        "Go 远程",
        1,
        filters,
      ),
      false,
    );
    assert.equal(
      matchesExpectedJobListPayload(
        {
          code: 0,
          zpData: {
            query: "Go 远程",
            page: 1,
            city: "101010100",
            searchParam: { salary: "406" },
            jobList: [],
          },
        },
        "Go 远程",
        1,
        { ...filters, salary: "405" },
      ),
      false,
    );
  });

  it("keeps the visible Boss browser open when a stop happens during human verification", async () => {
    const controller = new AbortController();
    const events: unknown[] = [];
    const tracker = createHumanVerificationTracker({
      signal: controller.signal,
      emit: (event) => events.push(event),
    });
    tracker.ctx.emit({ type: "LOGIN_STATUS", payload: { status: "invalid" } });
    controller.abort();

    const browser = mockBrowser();
    await closeBrowserRespectingHumanVerification(browser, tracker.ctx, tracker, "Boss 自动采集");

    assert.deepEqual(browser.actions, ["disconnect"]);
    assert.match(JSON.stringify(events), /不会关闭浏览器窗口/);
  });

  it("closes the Boss browser normally after human verification is recovered", async () => {
    const controller = new AbortController();
    const tracker = createHumanVerificationTracker({
      signal: controller.signal,
      emit: () => undefined,
    });
    tracker.ctx.emit({ type: "LOGIN_STATUS", payload: { status: "captcha" } });
    tracker.ctx.emit({ type: "LOGIN_STATUS", payload: { status: "valid" } });
    controller.abort();

    const browser = mockBrowser();
    await closeBrowserRespectingHumanVerification(browser, tracker.ctx, tracker, "Boss 自动采集");

    assert.deepEqual(browser.actions, ["close"]);
  });

  it("uses the persisted Boss browser profile and lower-risk list capture before POST API fallback", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");
    const launchSource = readWorkerFile("src/browser/launch.ts");
    const loginSource = readWorkerFile("src/modes/login.ts");
    const evidenceSource = readWorkerFile("src/modes/evidenceRefresh.ts");

    assert.match(runSource, /launchBrowser\(\{\s*headless:\s*false,\s*user_data_dir:\s*payload\.user_data_dir,\s*stealth:\s*false,\s*preserve_on_disconnect:\s*true,\s*\}\)/);
    assert.match(loginSource, /launchManualBrowserWindow/);
    assert.match(loginSource, /preserve_on_disconnect:\s*true/);
    assert.match(loginSource, /preserve_on_disconnect:\s*sourcePlatform === "boss"/);
    assert.match(evidenceSource, /launchBrowser\(\{\s*headless:\s*false,\s*user_data_dir:\s*payload\.user_data_dir,\s*stealth:\s*false,\s*preserve_on_disconnect:\s*true,\s*\}\)/);
    assert.match(evidenceSource, /waitUntilBossLoginReady\(page, ctx, "Boss 登录态已就绪，开始补充岗位证据。"\)/);
    assert.match(evidenceSource, /requestBossJsonWithRiskRecovery\(page, ctx, "job\/detail"/);
    assert.match(launchSource, /stealth\?:\s*boolean/);
    assert.match(launchSource, /preserve_on_disconnect\?:\s*boolean/);
    assert.match(launchSource, /const useStealth = options\.stealth !== false/);
    assert.match(launchSource, /if \(useStealth\) \{\s*args\.push\("--disable-blink-features=AutomationControlled"\)/);
    assert.match(launchSource, /function launchDetachedPersistentBrowser/);
    assert.match(launchSource, /readExistingBrowserWSEndpoint/);
    assert.match(launchSource, /DevToolsActivePort/);
    assert.match(launchSource, /JobSyncDevToolsActivePort/);
    assert.match(launchSource, /rmSync\(join\(userDataDir, "DevToolsActivePort"\), \{ force: true \}\)/);
    assert.match(launchSource, /--remote-debugging-address=127\.0\.0\.1/);
    assert.match(launchSource, /detached:\s*true/);
    assert.match(launchSource, /child\.unref\(\)/);
    assert.match(launchSource, /process\.kill\(process\.platform === "win32" \? child\.pid : -child\.pid, "SIGKILL"\)/);
    assert.match(launchSource, /writeFileSync\(join\(userDataDir, "JobSyncDevToolsActivePort"\)/);
    assert.match(launchSource, /browserDriver\.connect/);
    assert.match(runSource, /function buildBossSearchPageUrl/);
    assert.match(runSource, /fetchJobListFromNaturalPage/);
    assert.match(runSource, /function matchesExpectedJobListResponse/);
    assert.match(runSource, /\.waitForResponse/);
    assert.match(runSource, /matchesExpectedJobListResponse\(response, keyword, pageIndex, filters\)/);
    assert.match(runSource, /params\.get\("query"\) !== keyword/);
    assert.match(runSource, /params\.get\("page"\) !== String\(pageIndex\)/);
    assert.match(runSource, /filters\.city && params\.get\("city"\) !== filters\.city/);
    assert.match(runSource, /matchesExpectedJobListPayload\(natural\.json, keyword, pageIndex, filters\)/);
    assert.match(runSource, /if \(gotoError\) return \{ status: 0, json: null, error: gotoError \}/);
    assert.match(runSource, /matchesBossSearchPageUrl\(page\.url\(\), keyword, pageIndex, filters\)/);
    assert.match(runSource, /跳过 DOM 列表恢复以避免错页入库/);
    assert.match(runSource, /已捕获搜索页自然 joblist 响应/);
    assert.match(runSource, /capture_source:\s*"natural"/);
    assert.match(runSource, /extractJobListFromDomPage/);
    assert.match(runSource, /source:\s*"dom_fallback"/);
    assert.match(runSource, /capture_source:\s*"dom_fallback"/);
    assert.match(runSource, /已从搜索页 DOM 列表恢复/);
    assert.match(runSource, /页面内 GET/);
    assert.match(runSource, /capture_source:\s*"page_get_fallback"/);
    assert.match(runSource, /buildJobListUrl\(keyword, pageIndex, pageSize, filters\)/);
    assert.match(runSource, /method:\s*"GET"/);
    assert.match(runSource, /不再回退到 POST 接口请求/);
    assert.match(runSource, /回退到接口请求/);
    assert.match(runSource, /capture_source:\s*"api_fallback"/);
    assert.match(runSource, /allowApiFallback = true/);
    assert.match(runSource, /requestJobList\(page, ctx, keyword, pageIndex, pageSize, apiFilters, warn, bossRiskRecoveryOptions, !lowRiskMode\)/);
    assert.match(runSource, /低风控模式未捕获搜索页自然 joblist 响应，且页面内 GET 未返回有效 JSON/);
    assert.match(runSource, /不再回退到 POST 接口请求/);
    assert.match(runSource, /simulateBossSearchPageActivity/);
  });

  it("keeps Boss metadata sync out of the default auto-collection request path", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");

    assert.match(runSource, /const syncBossMeta:\s*boolean = limits\.syncBossMeta === true/);
    assert.match(runSource, /if \(syncBossMeta\) \{\s*const meta = await collectBossMetaByListening/);
  });

  it("stores Boss list results first and keeps detail endpoint fetches opt-in", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");

    assert.match(runSource, /const DEFAULT_DETAIL_FETCH_LIMIT = 0/);
    assert.match(runSource, /limits\.bossDetailFetchLimit/);
    assert.match(runSource, /limits\.detailFetchLimit/);
    assert.match(runSource, /if \(detailFetchLimit <= 0\) \{/);
    assert.match(runSource, /不主动请求详情接口/);
    assert.match(runSource, /let attempted_job_detail = 0/);
    assert.match(runSource, /if \(attempted_job_detail >= detailFetchLimit\) break/);
    assert.match(runSource, /seenJobIds\.add\(securityId\);\s*attempted_job_detail \+= 1/);
    assert.match(runSource, /type:\s*"JOB_LIST_CAPTURED"/);
    assert.doesNotMatch(runSource, /captured_job_detail >= maxJobs/);
    assert.doesNotMatch(runSource, /const maxJobs:/);
  });

  it("does not treat an empty Boss job-list run as successful collection", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");

    assert.match(runSource, /let total_extracted_job_list_items = 0/);
    assert.match(runSource, /let total_stable_job_ids = 0/);
    assert.match(runSource, /joblist 未返回岗位列表/);
    assert.match(runSource, /joblist 响应参数与当前请求不匹配/);
    assert.match(runSource, /total_extracted_job_list_items === 0/);
    assert.match(runSource, /没有采集到任何岗位列表数据/);
    assert.match(runSource, /total_stable_job_ids === 0/);
    assert.match(runSource, /未解析到稳定岗位 ID/);
  });

  it("waits for Boss login readiness in the visible profile before collecting", () => {
    const runSource = readWorkerFile("src/modes/auto/run.ts");
    const sharedSource = readWorkerFile("src/modes/auto/shared.ts");

    assert.match(sharedSource, /export async function waitUntilBossLoginReady/);
    assert.match(sharedSource, /API_PATH\.USER_INFO/);
    assert.match(sharedSource, /请在打开的浏览器窗口完成 Boss 登录/);
    assert.match(sharedSource, /type:\s*"COOKIE_COLLECTED"/);
    assert.match(runSource, /import \{[\s\S]*waitUntilBossLoginReady[\s\S]*\} from "\.\/shared\.js"/);
    assert.match(runSource, /waitUntilBossLoginReady\(page, ctx, "Boss 登录态已就绪，开始采集。", bossRiskRecoveryOptions\)/);
  });
});
