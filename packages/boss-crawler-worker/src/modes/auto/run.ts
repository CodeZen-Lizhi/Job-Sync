import type { HTTPResponse, Page } from "puppeteer";

import { launchBrowser } from "../../browser/launch.js";
import { blockNavigation } from "../../browser/navigationLock.js";
import { collectBossMetaByListening } from "../../boss/meta.js";
import { pickBossJobIdFromListItem } from "../../boss/parser.js";
import {
  evaluateBossProfileFilter,
  hasBossProfileFilter,
  normalizeBossProfileFilter,
} from "../../boss/profileFilter.js";
import { API_PATH, JOB_CARD_SELECTORS, URLS } from "../../boss/selectors.js";
import { delayWithJitter } from "../../utils/delay.js";
import { SageTime } from "../../utils/sage-time.js";

import { buildJobDetailBody, buildJobDetailUrl, buildJobListBody, closeBrowserRespectingHumanVerification, createHumanVerificationTracker, detectRiskUrl, extractJobList, fetchJsonFromPage, isAbnormalAccess, matchesExpectedJobListPayload, normalizeFilterVariants, readApiCode, readApiMessage, readHttpResponseAsPageFetchJsonResult, requestBossJsonWithRiskRecovery, safeError, setLocalStorage, waitUntilBossLoginReady, waitUntilNoRiskUrl } from "./shared.js";
import type { ApiFilters, PageFetchJsonResult } from "./shared.js";
import type { CrawlAutoStartPayload, ModeContext } from "./types.js";
import { runV2exFeedMode } from "../../v2ex/feed.js";
import { runLinuxDoMode } from "../../linuxdo/feed.js";
import { runZhilianMode } from "../../zhilian/feed.js";
import type { BossRiskRecoveryOptions } from "./shared.js";

const NATURAL_JOB_LIST_TIMEOUT_MS = 20_000;
const DEFAULT_DETAIL_FETCH_LIMIT = 0;
const DEFAULT_BOSS_LOW_RISK_MODE = true;
const BOSS_LOW_RISK_MAX_PAGES_CAP = 2;
const BOSS_LOW_RISK_MAX_JOBS_CAP = 50;
const BOSS_LOW_RISK_DEFAULT_MAX_JOBS = 30;
const BOSS_LOW_RISK_MIN_DELAY_MS = 8_000;
const BOSS_LOW_RISK_MIN_JITTER_MS = 12_000;
const BOSS_LOW_RISK_COOLDOWN_MS = 30 * 60 * 1000;
let bossLowRiskCooldownUntil = 0;

export type BossEffectiveAutoLimits = {
  lowRiskMode: boolean;
  maxPages: number;
  maxJobs: number | null;
  detailFetchLimit: number;
  delayMs: number;
  jitterMs: number;
  pageSize: number;
};

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function optionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

export function resolveBossAutoLimits(limits: Record<string, unknown> = {}): BossEffectiveAutoLimits {
  const lowRiskMode = typeof limits.lowRiskMode === "boolean"
    ? limits.lowRiskMode
    : DEFAULT_BOSS_LOW_RISK_MODE;
  const rawMaxPages = positiveInteger(limits.maxPages, 3);
  const rawMaxJobs = optionalPositiveInteger(limits.maxJobs);
  const rawDetailFetchLimit =
    typeof limits.bossDetailFetchLimit === "number"
      ? limits.bossDetailFetchLimit
      : limits.detailFetchLimit;
  const requestedDetailFetchLimit = optionalPositiveInteger(rawDetailFetchLimit) ?? DEFAULT_DETAIL_FETCH_LIMIT;
  const rawDelayMs = positiveInteger(limits.delayMs, 800);
  const rawJitterMs = positiveInteger(limits.jitterMs, 1000);

  return {
    lowRiskMode,
    maxPages: lowRiskMode ? Math.min(rawMaxPages, BOSS_LOW_RISK_MAX_PAGES_CAP) : rawMaxPages,
    maxJobs: lowRiskMode
      ? Math.min(rawMaxJobs ?? BOSS_LOW_RISK_DEFAULT_MAX_JOBS, BOSS_LOW_RISK_MAX_JOBS_CAP)
      : rawMaxJobs,
    detailFetchLimit: lowRiskMode ? 0 : requestedDetailFetchLimit,
    delayMs: lowRiskMode ? Math.max(rawDelayMs, BOSS_LOW_RISK_MIN_DELAY_MS) : rawDelayMs,
    jitterMs: lowRiskMode ? Math.max(rawJitterMs, BOSS_LOW_RISK_MIN_JITTER_MS) : rawJitterMs,
    pageSize: positiveInteger(limits.pageSize, 15),
  };
}

export function getBossLowRiskCooldownRemainingMs(now = Date.now()): number {
  return Math.max(0, bossLowRiskCooldownUntil - now);
}

export function resetBossLowRiskCooldownForTests(): void {
  bossLowRiskCooldownUntil = 0;
}

export function setBossLowRiskCooldownUntilForTests(until: number): void {
  bossLowRiskCooldownUntil = until;
}

function formatCooldownRemaining(remainingMs: number): string {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `${minutes} 分钟`;
}

function setBossLowRiskCooldown(ctx: ModeContext, reason: string): void {
  const alreadyCoolingDown = getBossLowRiskCooldownRemainingMs() > 0;
  bossLowRiskCooldownUntil = Math.max(bossLowRiskCooldownUntil, Date.now() + BOSS_LOW_RISK_COOLDOWN_MS);
  if (alreadyCoolingDown) return;
  ctx.emit({
    type: "LOG",
    payload: {
      level: "warn",
      message: `Boss 低风控模式已进入 ${formatCooldownRemaining(BOSS_LOW_RISK_COOLDOWN_MS)} 冷却：${reason}`,
    },
  });
}

const FILTER_MATCH_KEYS: Array<keyof ApiFilters> = [
  "city",
  "multiSubway",
  "multiBusinessDistrict",
  "position",
  "jobType",
  "salary",
  "experience",
  "degree",
  "industry",
  "scale",
  "stage",
];

function setSearchParamIfPresent(params: URLSearchParams, key: keyof ApiFilters, value: string): void {
  if (value) params.set(key, value);
}

function buildBossSearchPageUrl(keyword: string, pageIndex: number, filters: ApiFilters): string {
  const url = new URL(URLS.GEEK_JOBS);
  url.searchParams.set("query", keyword);
  url.searchParams.set("page", String(pageIndex));
  setSearchParamIfPresent(url.searchParams, "city", filters.city);
  setSearchParamIfPresent(url.searchParams, "multiSubway", filters.multiSubway);
  setSearchParamIfPresent(url.searchParams, "multiBusinessDistrict", filters.multiBusinessDistrict);
  setSearchParamIfPresent(url.searchParams, "position", filters.position);
  setSearchParamIfPresent(url.searchParams, "jobType", filters.jobType);
  setSearchParamIfPresent(url.searchParams, "salary", filters.salary);
  setSearchParamIfPresent(url.searchParams, "experience", filters.experience);
  setSearchParamIfPresent(url.searchParams, "degree", filters.degree);
  setSearchParamIfPresent(url.searchParams, "industry", filters.industry);
  setSearchParamIfPresent(url.searchParams, "scale", filters.scale);
  setSearchParamIfPresent(url.searchParams, "stage", filters.stage);
  return url.toString();
}

function collectJobListResponseParams(response: HTTPResponse): URLSearchParams {
  const params = new URLSearchParams();
  const merge = (next: URLSearchParams): void => {
    for (const [key, value] of next.entries()) {
      if (!params.has(key)) params.set(key, value);
    }
  };

  try {
    merge(new URL(response.url()).searchParams);
  } catch {
    // Ignore malformed URLs from the browser layer.
  }

  const body = response.request().postData();
  if (body) {
    try {
      merge(new URLSearchParams(body));
    } catch {
      // Ignore non-form post bodies.
    }
  }

  return params;
}

function matchesExpectedJobListResponse(
  response: HTTPResponse,
  keyword: string,
  pageIndex: number,
  filters: ApiFilters,
): boolean {
  if (!response.url().includes(API_PATH.JOB_LIST)) return false;
  const params = collectJobListResponseParams(response);

  if (params.get("query") !== keyword) return false;
  if (params.get("page") !== String(pageIndex)) return false;
  if (filters.city && params.get("city") !== filters.city) return false;
  if (!matchesExpectedFilterParams(params, filters)) return false;
  return true;
}

function matchesExpectedFilterParams(params: URLSearchParams, filters: ApiFilters): boolean {
  for (const key of FILTER_MATCH_KEYS) {
    const expected = filters[key];
    if (!expected) continue;
    if (params.get(key) !== expected) return false;
  }
  return true;
}

function matchesBossSearchPageUrl(currentUrl: string, keyword: string, pageIndex: number, filters: ApiFilters): boolean {
  try {
    const parsed = new URL(currentUrl);
    if (!parsed.pathname.includes("/web/geek/jobs")) return false;
    if (parsed.searchParams.get("query") !== keyword) return false;
    if (parsed.searchParams.get("page") !== String(pageIndex)) return false;
    if (filters.city && parsed.searchParams.get("city") !== filters.city) return false;
    if (!matchesExpectedFilterParams(parsed.searchParams, filters)) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchJobListFromNaturalPage(
  page: Page,
  ctx: ModeContext,
  keyword: string,
  pageIndex: number,
  pageSize: number,
  filters: ApiFilters,
  warn: (msg: string) => void,
  riskRecoveryOptions: BossRiskRecoveryOptions = {},
): Promise<PageFetchJsonResult | null> {
  const searchUrl = buildBossSearchPageUrl(keyword, pageIndex, filters);
  const responsePromise = page
    .waitForResponse((response) => matchesExpectedJobListResponse(response, keyword, pageIndex, filters), {
      timeout: NATURAL_JOB_LIST_TIMEOUT_MS,
    })
    .catch(() => null);

  const gotoError = await page
    .goto(searchUrl, { waitUntil: "domcontentloaded" })
    .then(() => null)
    .catch((err) => String(err));

  const pageClear = await waitUntilNoRiskUrl(page, ctx, riskRecoveryOptions);
  if (ctx.signal.aborted) return null;
  if (!pageClear && riskRecoveryOptions.recover === false) {
    return {
      status: 403,
      json: null,
      response_url: page.url(),
      content_type: "text/html",
      text: detectRiskUrl(page.url()) ? "Boss low-risk mode detected risk page." : "Boss low-risk mode stopped on page risk.",
      capture_source: "natural",
    };
  }

  const response = await responsePromise;
  if (response) {
    const natural = await readHttpResponseAsPageFetchJsonResult(response);
    if (natural.json && typeof natural.json === "object" && readApiCode(natural.json) === 0) {
      if (!matchesExpectedJobListPayload(natural.json, keyword, pageIndex, filters)) {
        warn(`忽略不匹配的自然 joblist 响应：keyword=${keyword} page=${pageIndex}`);
      } else {
        ctx.emit({
          type: "LOG",
          payload: {
            level: "info",
            message: `已捕获搜索页自然 joblist 响应：keyword=${keyword} page=${pageIndex}`,
          },
        });
        return { ...natural, capture_source: "natural" };
      }
    } else {
      return { ...natural, capture_source: "natural" };
    }
  }

  if (gotoError) return { status: 0, json: null, error: gotoError };
  if (!matchesBossSearchPageUrl(page.url(), keyword, pageIndex, filters)) {
    warn(`当前搜索页 URL 与请求不匹配，跳过 DOM 列表恢复以避免错页入库：${page.url()}`);
    return null;
  }

  const domResult = await extractJobListFromDomPage(page, keyword, pageIndex, pageSize, filters);
  if (domResult) {
    warn(`未捕获自然 joblist 响应，已从搜索页 DOM 列表恢复 ${domResult.count} 个岗位。`);
    return { status: 200, json: domResult.raw, capture_source: "dom_fallback" };
  }

  warn(`未捕获自然 joblist 响应，且页面 DOM 未解析到岗位列表，回退到接口请求：${searchUrl}`);
  return null;
}

async function extractJobListFromDomPage(
  page: Page,
  keyword: string,
  pageIndex: number,
  pageSize: number,
  filters: ApiFilters,
): Promise<{ raw: any; count: number } | null> {
  const raw = await page.evaluate(
    (selectors, expectedPageSize, currentKeyword, currentPage, currentFilters) => {
      const textOf = (root: Element, candidates: string[]): string => {
        for (const selector of candidates) {
          const element = root.querySelector(selector);
          const text = element?.textContent?.replace(/\s+/g, " ").trim();
          if (text) return text;
        }
        return "";
      };

      const attrOf = (root: Element, candidates: string[], name: string): string => {
        for (const selector of candidates) {
          const element = root.querySelector(selector);
          const value = element?.getAttribute(name)?.trim();
          if (value) return value;
        }
        return "";
      };

      const directAttrOf = (root: Element, names: string[]): string => {
        for (const name of names) {
          const value = root.getAttribute(name)?.trim();
          if (value) return value;
          const child = root.querySelector(`[${name}]`);
          const childValue = child?.getAttribute(name)?.trim();
          if (childValue) return childValue;
        }
        return "";
      };

      const parseIdsFromHref = (href: string): { securityId: string; lid: string } => {
        if (!href) return { securityId: "", lid: "" };
        try {
          const parsed = new URL(href, window.location.href);
          const lid = parsed.searchParams.get("lid")?.trim() ?? "";
          const fromQuery =
            parsed.searchParams.get("securityId")?.trim() ||
            parsed.searchParams.get("security_id")?.trim() ||
            parsed.searchParams.get("encryptJobId")?.trim() ||
            parsed.searchParams.get("encrypt_job_id")?.trim() ||
            "";
          if (fromQuery) return { securityId: fromQuery, lid };
          const fromPath = parsed.pathname.match(/\/job_detail\/([^/.]+)(?:\.html)?/i)?.[1]?.trim() ?? "";
          return { securityId: fromPath, lid };
        } catch {
          return { securityId: "", lid: "" };
        }
      };

      const cards = Array.from(document.querySelectorAll(selectors.join(",")));
      const seen = new Set<string>();
      const jobList: Record<string, unknown>[] = [];

      for (const card of cards) {
        const href = attrOf(card, [
          'a[href*="job_detail"]',
          'a[href*="/web/geek/job"]',
          "a.job-name",
          "a",
        ], "href");
        const parsedIds = parseIdsFromHref(href);
        const securityId =
          directAttrOf(card, [
            "data-securityid",
            "data-security-id",
            "data-encrypt-job-id",
            "data-encryptjobid",
            "data-jobid",
            "data-jid",
            "data-id",
          ]) || parsedIds.securityId;
        if (!securityId || seen.has(securityId)) continue;

        const jobName = textOf(card, [
          ".job-name",
          ".job-title",
          ".job-card-left .title",
          "[class*='job-name']",
          "[class*='job-title']",
          'a[href*="job_detail"]',
        ]);
        if (!jobName) continue;

        seen.add(securityId);

        const tagTexts = Array.from(card.querySelectorAll(".tag-list li, .tag-item, .job-tags span, [class*='tag'] li"))
          .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean);
        const description = textOf(card, [
          ".info-desc",
          ".job-card-footer",
          ".job-desc",
          "[class*='desc']",
        ]);
        const brandName = textOf(card, [
          ".company-name",
          ".company-text .name",
          ".company-info .name",
          "[class*='company-name']",
          "[class*='brand-name']",
        ]);
        const bossName = textOf(card, [
          ".boss-name",
          ".info-publis .name",
          ".info-public .name",
          "[class*='boss-name']",
        ]);
        const locationName = textOf(card, [
          ".job-area",
          ".job-location",
          "[class*='job-area']",
          "[class*='location']",
        ]);
        const salaryDesc = textOf(card, [
          ".salary",
          ".job-salary",
          ".job-limit .red",
          ".red",
          "[class*='salary']",
        ]);
        const companyTags = Array.from(card.querySelectorAll(".company-tag-list li, .company-text p, [class*='company-tag'] li"))
          .map((element) => element.textContent?.replace(/\s+/g, " ").trim() ?? "")
          .filter(Boolean);

        jobList.push({
          securityId,
          encryptJobId: securityId,
          lid: directAttrOf(card, ["data-lid"]) || parsedIds.lid || undefined,
          jobName,
          positionName: jobName,
          salaryDesc,
          cityName: locationName.split(/[·\s]/).filter(Boolean)[0] ?? locationName,
          locationName,
          jobExperience: tagTexts[0] ?? "",
          experienceName: tagTexts[0] ?? "",
          jobDegree: tagTexts[1] ?? "",
          degreeName: tagTexts[1] ?? "",
          bossName,
          brandName,
          brandIndustry: companyTags[0] ?? "",
          brandStageName: companyTags[1] ?? "",
          brandScaleName: companyTags.find((item) => item.includes("人")) ?? "",
          jobLabels: tagTexts,
          skills: tagTexts,
          welfareList: description ? [description] : [],
          postDescription: description,
          sourceUrl: href,
          domFallback: true,
        });
      }

      if (jobList.length === 0) return null;

      const next = document.querySelector(
        ".options-pages a:last-child, .page a:last-child, a[ka*='page-next'], .pagination-next, .ui-pagination-next",
      );
      const nextText = next?.textContent?.trim() ?? "";
      const nextClass = next?.getAttribute("class") ?? "";
      const nextHref = next?.getAttribute("href") ?? "";
      const nextDisabled =
        !next ||
        nextClass.includes("disabled") ||
        nextClass.includes("disable") ||
        next.getAttribute("aria-disabled") === "true" ||
        nextHref === "javascript:;";
      const hasMore = (!nextDisabled && (nextText.includes("下一") || !!nextHref)) || jobList.length >= expectedPageSize;

      return {
        code: 0,
        message: "ok",
        zpData: {
          jobList,
          hasMore,
          source: "dom_fallback",
          keyword: currentKeyword,
          page: currentPage,
          filters: currentFilters,
        },
      };
    },
    JOB_CARD_SELECTORS,
    pageSize,
    keyword,
    pageIndex,
    filters,
  );

  if (!raw || typeof raw !== "object") return null;
  const count = Array.isArray((raw as any).zpData?.jobList) ? (raw as any).zpData.jobList.length : 0;
  return count > 0 ? { raw, count } : null;
}

async function requestJobList(
  page: Page,
  ctx: ModeContext,
  keyword: string,
  pageIndex: number,
  pageSize: number,
  filters: ApiFilters,
  warn: (msg: string) => void,
  riskRecoveryOptions: BossRiskRecoveryOptions = {},
  allowApiFallback = true,
): Promise<PageFetchJsonResult | null> {
  const natural = await fetchJobListFromNaturalPage(page, ctx, keyword, pageIndex, pageSize, filters, warn, riskRecoveryOptions);
  if (natural) return natural;
  if (!allowApiFallback) {
    warn("低风控模式未捕获搜索页自然 joblist 响应，已停止本页采集，不再回退到接口请求。");
    return null;
  }

  const jobListUrl = `https://www.zhipin.com${API_PATH.JOB_LIST}?_=${Date.now()}`;
  const jobListBody = buildJobListBody(keyword, pageIndex, pageSize, filters);
  const apiResult = await fetchJsonFromPage(page, jobListUrl, {
    method: "POST",
    body: jobListBody,
    timeoutMs: 60_000,
  });
  return { ...apiResult, capture_source: "api_fallback" };
}

export async function runAutoMode(payload: CrawlAutoStartPayload, baseCtx: ModeContext): Promise<void> {
  if (payload.task.source_platform === "zhilian") {
    try {
      await runZhilianMode(payload, baseCtx);
    } catch (err) {
      baseCtx.emit({ type: "ERROR", payload: safeError(err) });
    } finally {
      baseCtx.emit({ type: "FINISHED" });
    }
    return;
  }

  if (payload.task.source_platform === "linuxdo") {
    try {
      await runLinuxDoMode(payload, baseCtx);
    } catch (err) {
      baseCtx.emit({ type: "ERROR", payload: safeError(err) });
    } finally {
      baseCtx.emit({ type: "FINISHED" });
    }
    return;
  }

  if (payload.task.source_platform === "v2ex") {
    try {
      await runV2exFeedMode(payload, baseCtx);
    } catch (err) {
      baseCtx.emit({ type: "ERROR", payload: safeError(err) });
    } finally {
      baseCtx.emit({ type: "FINISHED" });
    }
    return;
  }

  const keywords = payload.task.keywords ?? [];
  const limits = (payload.task.limits ?? {}) as Record<string, unknown>;
  const bossLimits = resolveBossAutoLimits(limits);
  const { lowRiskMode, maxPages, maxJobs, detailFetchLimit, delayMs, jitterMs, pageSize } = bossLimits;
  const syncBossMeta: boolean = limits.syncBossMeta === true;
  if (lowRiskMode) {
    const cooldownRemainingMs = getBossLowRiskCooldownRemainingMs();
    if (cooldownRemainingMs > 0) {
      const message = `Boss 处于低风控冷却中，预计 ${formatCooldownRemaining(cooldownRemainingMs)} 后再试。`;
      baseCtx.emit({ type: "LOG", payload: { level: "warn", message } });
      baseCtx.emit({ type: "ERROR", payload: { message } });
      baseCtx.emit({ type: "FINISHED" });
      return;
    }
  }
  const sageTime = new SageTime({
    enabled: typeof limits.sageTimeEnabled === "boolean" ? limits.sageTimeEnabled : true,
    maxOps: typeof limits.sageTimeMaxOps === "number" ? limits.sageTimeMaxOps : 100,
    pauseMinutes: typeof limits.sageTimePauseMinutes === "number" ? limits.sageTimePauseMinutes : 15,
  });
  const verificationTracker = createHumanVerificationTracker(baseCtx);
  const ctx = verificationTracker.ctx;
  const log = (msg: string): void => {
    ctx.emit({ type: "LOG", payload: { level: "info", message: msg } });
  };
  const warn = (msg: string): void => {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: msg } });
  };
  const stopForLowRisk = (message: string): void => {
    setBossLowRiskCooldown(ctx, message);
    ctx.emit({ type: "ERROR", payload: { message: `Boss 低风控模式检测到登录/风控状态，已停止本轮采集：${message}` } });
  };
  const bossRiskRecoveryOptions: BossRiskRecoveryOptions = lowRiskMode
    ? {
        recover: false,
        onRisk: (_status: string, message: string) => setBossLowRiskCooldown(ctx, message),
      }
    : {};
  if (lowRiskMode) {
    log(`Boss 低风控模式已开启：最多 ${maxPages} 页，最多 ${maxJobs ?? "不限"} 个新岗位，延迟至少 ${Math.round(delayMs / 1000)} 秒，详情抓取关闭。`);
  }

  const filterVariants = normalizeFilterVariants(payload.task.filters, warn);
  const profileFilter = normalizeBossProfileFilter(payload.task.filters);
  const profileFilterEnabled = hasBossProfileFilter(profileFilter);

  let captured_job_list = 0;
  let captured_job_detail = 0;
  let attempted_job_detail = 0;
  let filtered_job = 0;
  let total_extracted_job_list_items = 0;
  let total_stable_job_ids = 0;
  let detailFetchSkippedLogged = false;

  const { browser, page } = await launchBrowser({
    headless: false,
    user_data_dir: payload.user_data_dir,
    stealth: false,
    preserve_on_disconnect: true,
  });
  try {
    await blockNavigation(page, { allow_domain_suffixes: ["zhipin.com"] });

    const cookies = payload.session.cookies;
    if (Array.isArray(cookies) && cookies.length > 0) {
      await page.setCookie(...(cookies as any[]));
    }

    await page.goto(URLS.DESKTOP, { waitUntil: "domcontentloaded" });
    const local_storage = payload.session.local_storage;
    if (local_storage && typeof local_storage === "object") {
      await setLocalStorage(page, local_storage as Record<string, string>);
    }

    await page.goto(URLS.USER, { waitUntil: "domcontentloaded" });
    if (!await waitUntilBossLoginReady(page, ctx, "Boss 登录态已就绪，开始采集。", bossRiskRecoveryOptions)) {
      if (lowRiskMode && !ctx.signal.aborted) {
        stopForLowRisk("登录态不可用或页面处于安全验证状态，请在 Boss 官方页面处理后稍后重试。");
      }
      return;
    }

    await page.goto(URLS.GEEK_JOBS, { waitUntil: "domcontentloaded" });

    const searchPageReady = await waitUntilNoRiskUrl(page, ctx, bossRiskRecoveryOptions);
    if (ctx.signal.aborted) return;
    if (!searchPageReady) {
      if (lowRiskMode) stopForLowRisk("Boss 搜索页处于安全验证状态，请在浏览器窗口完成验证后稍后重试。");
      return;
    }

    if (syncBossMeta) {
      const meta = await collectBossMetaByListening(page, ctx.signal).catch(() => null);
      if (meta && (meta.city_group || meta.filter_conditions || meta.industry_filter_exemption)) {
        ctx.emit({ type: "BOSS_META_SYNCED", payload: meta });
      }
    }

    const seenJobIds = new Set<string>();
    for (const keyword of keywords) {
      if (ctx.signal.aborted) break;

      log(`开始关键词：${keyword}`);

      for (const [variantIndex, apiFilters] of filterVariants.entries()) {
        if (ctx.signal.aborted) break;
        const variantLabel = apiFilters.city
          ? `城市 ${apiFilters.city}（${variantIndex + 1}/${filterVariants.length}）`
          : `默认筛选（${variantIndex + 1}/${filterVariants.length}）`;
        if (filterVariants.length > 1) log(`开始 ${variantLabel}`);
        let hasMore = true;

        for (let pageIndex = 1; pageIndex <= maxPages; pageIndex++) {
          if (ctx.signal.aborted) break;
          if (!hasMore) break;

          const pageRiskClear = await waitUntilNoRiskUrl(page, ctx, bossRiskRecoveryOptions);
          if (ctx.signal.aborted) break;
          if (!pageRiskClear) {
            if (lowRiskMode) stopForLowRisk("Boss 搜索页进入安全验证状态。");
            return;
          }

          ctx.emit({
            type: "PROGRESS",
            payload: { keyword, current_page: pageIndex, captured_job_list, captured_job_detail, filtered_job },
          });

          await sageTime.checkpoint(ctx.signal, log);
          let jobListRes = await requestBossJsonWithRiskRecovery(
            page,
            ctx,
            "joblist",
            () => requestJobList(page, ctx, keyword, pageIndex, pageSize, apiFilters, warn, bossRiskRecoveryOptions, !lowRiskMode),
            bossRiskRecoveryOptions,
          );

          if (ctx.signal.aborted) break;
          if (!jobListRes && lowRiskMode) {
            stopForLowRisk("未捕获搜索页自然 joblist 响应，低风控模式不再回退到接口请求。请确认浏览器中的 Boss 搜索页能正常显示岗位后稍后重试。");
            return;
          }
          if (!jobListRes) break;

          if (!jobListRes.json || typeof jobListRes.json !== "object") {
            ctx.emit({
              type: "ERROR",
              payload: { message: `joblist 接口未返回有效 JSON（status=${jobListRes.status}）` },
            });
            return;
          }

          let jobListRaw = jobListRes.json as any;
          if (readApiCode(jobListRaw) !== 0 && isAbnormalAccess(jobListRaw)) {
            const msg = readApiMessage(jobListRaw);
            warn(`joblist 接口仍返回访问异常：${msg || `code=${String(readApiCode(jobListRaw) ?? 37)}`}`);
            break;
          }

          if (readApiCode(jobListRaw) !== 0) {
            ctx.emit({
              type: "ERROR",
              payload: {
                message: `joblist 接口返回异常：code=${String(readApiCode(jobListRaw))} message=${String(
                  readApiMessage(jobListRaw),
                )}`,
              },
            });
            return;
          }

          if (!matchesExpectedJobListPayload(jobListRaw, keyword, pageIndex, apiFilters)) {
            warn(`joblist 响应参数与当前请求不匹配，已跳过以避免错页入库：keyword=${keyword} page=${pageIndex} source=${jobListRes.capture_source ?? "unknown"}`);
            hasMore = false;
            continue;
          }

          const extracted = extractJobList(jobListRaw);
          hasMore = extracted.hasMore;
          if (extracted.jobs.length === 0) {
            warn(`joblist 未返回岗位列表：keyword=${keyword} page=${pageIndex} source=${jobListRes.capture_source ?? "unknown"}`);
            hasMore = false;
            continue;
          }
          total_extracted_job_list_items += extracted.jobs.length;
          const stableJobIdCount = extracted.jobs.filter((job) => !!pickBossJobIdFromListItem(job)).length;
          total_stable_job_ids += stableJobIdCount;
          if (stableJobIdCount === 0) {
            warn(`joblist 返回了 ${extracted.jobs.length} 个岗位，但缺少稳定岗位 ID：keyword=${keyword} page=${pageIndex}`);
          }
          let jobsToCapture = extracted.jobs;

          if (profileFilterEnabled) {
            const eligibleJobs: any[] = [];
            for (const job of extracted.jobs) {
              const securityId = pickBossJobIdFromListItem(job) ?? undefined;
              const filterResult = evaluateBossProfileFilter(job, profileFilter);
              if (filterResult.eligible) {
                eligibleJobs.push(job);
                continue;
              }
              filtered_job += 1;
              ctx.emit({
                type: "JOB_FILTERED",
                payload: {
                  encrypt_job_id: securityId,
                  keyword,
                  filters: payload.task.filters,
                  reason: filterResult,
                  raw: job,
                },
              });
            }
            jobsToCapture = eligibleJobs;
          }

          captured_job_list += 1;
          ctx.emit({
            type: "JOB_LIST_CAPTURED",
            payload: {
              keyword,
              filters: payload.task.filters,
              capture_source: jobListRes.capture_source,
              raw: jobListRaw,
            },
          });
          ctx.emit({
            type: "PROGRESS",
            payload: { keyword, current_page: pageIndex, captured_job_list, captured_job_detail, filtered_job },
          });

          if (detailFetchLimit <= 0) {
            if (!detailFetchSkippedLogged) {
              log("Boss 本轮优先使用列表数据入库，不主动请求详情接口；需要完整 JD 时可稍后刷新岗位证据。");
              detailFetchSkippedLogged = true;
            }
            continue;
          }

          for (const job of jobsToCapture) {
            if (ctx.signal.aborted) break;
            if (attempted_job_detail >= detailFetchLimit) break;

            const securityId = pickBossJobIdFromListItem(job);
            if (!securityId) continue;
            if (seenJobIds.has(securityId)) continue;
            seenJobIds.add(securityId);
            attempted_job_detail += 1;

            const lid = typeof job?.lid === "string" ? job.lid : undefined;

            await sageTime.checkpoint(ctx.signal, log);
            const detailUrl = buildJobDetailUrl(securityId, lid);
            let detailResGet = await requestBossJsonWithRiskRecovery(
              page,
              ctx,
              "job/detail",
              () => fetchJsonFromPage(page, detailUrl, { method: "GET", timeoutMs: 60_000 }),
              bossRiskRecoveryOptions,
            );

            if (ctx.signal.aborted) break;
            if (!detailResGet) break;

            let detailRaw = detailResGet.json as any;
            if (detailRaw && typeof detailRaw === "object" && readApiCode(detailRaw) !== 0 && isAbnormalAccess(detailRaw)) {
              const msg = readApiMessage(detailRaw);
              warn(`job/detail 接口仍返回访问异常：${msg || `code=${String(readApiCode(detailRaw) ?? 37)}`}，securityId=${securityId}`);
              await delayWithJitter(delayMs, ctx.signal, jitterMs);
              continue;
            }
            if (!detailRaw || typeof detailRaw !== "object" || detailRaw.code !== 0) {
              const detailBody = buildJobDetailBody(securityId, lid);
              const detailResPost = await requestBossJsonWithRiskRecovery(
                page,
                ctx,
                "job/detail",
                () => fetchJsonFromPage(page, detailUrl, {
                  method: "POST",
                  body: detailBody,
                  timeoutMs: 60_000,
                }),
                bossRiskRecoveryOptions,
              );

              if (ctx.signal.aborted) break;
              if (!detailResPost) break;

              detailRaw = detailResPost.json as any;
              if (!detailRaw || typeof detailRaw !== "object") {
                warn(`job/detail 接口未返回有效 JSON（GET status=${detailResGet.status} / POST status=${detailResPost.status}，securityId=${securityId}）。`);
                await delayWithJitter(delayMs, ctx.signal, jitterMs);
                continue;
              }
              if (readApiCode(detailRaw) !== 0 && isAbnormalAccess(detailRaw)) {
                const msg = readApiMessage(detailRaw);
                warn(`job/detail 接口仍返回访问异常：${msg || `code=${String(readApiCode(detailRaw) ?? 37)}`}，securityId=${securityId}`);
                await delayWithJitter(delayMs, ctx.signal, jitterMs);
                continue;
              }
              if (detailRaw.code !== 0) {
                warn(`job/detail 接口返回异常：code=${String(detailRaw.code)} message=${String(detailRaw.message ?? "")}`);
                await delayWithJitter(delayMs, ctx.signal, jitterMs);
                continue;
              }
            }

            captured_job_detail += 1;
            const zp_data = detailRaw?.zpData ?? detailRaw;
            ctx.emit({ type: "JOB_DETAIL_CAPTURED", payload: { encrypt_job_id: securityId, zp_data } });

            if (attempted_job_detail >= detailFetchLimit) break;
            await delayWithJitter(delayMs, ctx.signal, jitterMs);
          }

          await delayWithJitter(delayMs, ctx.signal, jitterMs);
        }
      }
    }

    if (!ctx.signal.aborted && total_extracted_job_list_items === 0) {
      ctx.emit({
        type: "ERROR",
        payload: { message: "Boss 本轮没有采集到任何岗位列表数据；请确认关键词/城市条件，或在浏览器窗口完成登录/验证后重试。" },
      });
    } else if (!ctx.signal.aborted && total_stable_job_ids === 0) {
      ctx.emit({
        type: "ERROR",
        payload: { message: "Boss 本轮采集到岗位列表，但未解析到稳定岗位 ID，已停止本轮入库以避免假成功。" },
      });
    }
  } catch (err) {
    ctx.emit({ type: "ERROR", payload: safeError(err) });
  } finally {
    await closeBrowserRespectingHumanVerification(browser, ctx, verificationTracker, "Boss 自动采集");
    ctx.emit({ type: "FINISHED" });
  }
}
