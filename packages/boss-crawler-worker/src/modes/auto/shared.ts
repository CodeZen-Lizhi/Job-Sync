import type { Browser, HTTPResponse, Page } from "puppeteer";

import { API_PATH } from "../../boss/selectors.js";
import { delayWithJitter } from "../../utils/delay.js";

import type { ModeContext } from "./types.js";

export type ApiFilters = {
  city: string;
  multiSubway: string;
  multiBusinessDistrict: string;
  position: string;
  jobType: string;
  salary: string;
  experience: string;
  degree: string;
  industry: string;
  scale: string;
  stage: string;
};

const PAYLOAD_FILTER_MATCH_KEYS: Array<Exclude<keyof ApiFilters, "city">> = [
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

export type BossJobListCaptureSource = "natural" | "dom_fallback" | "api_fallback";

export type PageFetchJsonResult = {
  status: number;
  json: any | null;
  error?: string;
  response_url?: string;
  content_type?: string;
  text?: string;
  capture_source?: BossJobListCaptureSource;
};

export type BossRiskRecoveryOptions = {
  recover?: boolean;
  onRisk?: (status: string, message: string) => void;
};

export type HumanVerificationTracker = {
  ctx: ModeContext;
  isWaitingForHuman: () => boolean;
};

export function safeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

export function createHumanVerificationTracker(ctx: ModeContext): HumanVerificationTracker {
  let waitingForHuman = false;
  return {
    ctx: {
      signal: ctx.signal,
      emit: (event) => {
        if (event.type === "LOGIN_STATUS") {
          const status = event.payload.status;
          if (status === "invalid" || status === "captcha" || status === "denied") {
            waitingForHuman = true;
          } else if (status === "valid" || status === "ok") {
            waitingForHuman = false;
          }
        }
        ctx.emit(event);
      },
    },
    isWaitingForHuman: () => waitingForHuman,
  };
}

export async function closeBrowserRespectingHumanVerification(
  browser: Browser,
  ctx: ModeContext,
  tracker: HumanVerificationTracker,
  label = "Boss",
): Promise<void> {
  if (tracker.isWaitingForHuman()) {
    ctx.emit({
      type: "LOG",
      payload: {
        level: "warn",
        message: `${label} 正在等待人工登录/验证，本次停止不会关闭浏览器窗口；完成后可重新开始采集复用同一 profile。`,
      },
    });
    browser.disconnect();
    return;
  }
  await browser.close().catch(() => undefined);
}

export function detectRiskUrl(url: string): "captcha" | "denied" | null {
  const u = url.toLowerCase();
  if (u.includes("403")) return "denied";
  if (u.includes("security-check")) return "captcha";
  if (u.includes("verify-slider")) return "captcha";
  return null;
}

export function readApiCode(raw: any): number | null {
  const code = raw?.code;
  if (typeof code === "number" && Number.isFinite(code)) return code;
  if (typeof code === "string") {
    const trimmed = code.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function readApiMessage(raw: any): string {
  const msg = raw?.message;
  return typeof msg === "string" ? msg : "";
}

export function isAbnormalAccess(raw: any): boolean {
  const code = readApiCode(raw);
  if (code === 36) return true;
  if (code === 37) return true;
  const msg = readApiMessage(raw);
  if (msg.includes("访问行为异常")) return true;
  if (msg.includes("账户存在异常行为")) return true;
  return false;
}

export function isLoginExpired(raw: any): boolean {
  const code = readApiCode(raw);
  if (code === 7) return true;
  const msg = readApiMessage(raw) || (typeof raw?.msg === "string" ? raw.msg : "");
  if (msg.includes("登录状态")) return true;
  if (msg.includes("请登录")) return true;
  if (msg.toLowerCase().includes("login")) return true;
  return false;
}

export function isBossRiskResponse(res: PageFetchJsonResult): boolean {
  if (res.status === 401) return true;
  if (res.status === 403) return true;
  const raw = res.json;
  if (raw && typeof raw === "object" && readApiCode(raw) !== 0 && (isAbnormalAccess(raw) || isLoginExpired(raw))) {
    return true;
  }

  const responseUrl = (res.response_url ?? "").toLowerCase();
  if (detectRiskUrl(responseUrl)) return true;
  if (responseUrl.includes("/web/user") || responseUrl.includes("/login")) return true;

  const contentType = (res.content_type ?? "").toLowerCase();
  if (!contentType.includes("text/html")) return false;
  const text = (res.text ?? "").toLowerCase();
  return (
    text.includes("登录") ||
    text.includes("请登录") ||
    text.includes("登录状态") ||
    text.includes("验证码") ||
    text.includes("安全验证") ||
    text.includes("人机验证") ||
    text.includes("geetest") ||
    text.includes("captcha") ||
    text.includes("verify")
  );
}

export async function readHttpResponseAsPageFetchJsonResult(response: HTTPResponse): Promise<PageFetchJsonResult> {
  const status = response.status();
  const responseUrl = response.url();
  const contentType = response.headers()["content-type"];
  let text: string | null = null;
  let json: any = null;
  let error: string | undefined;

  try {
    text = await response.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  } catch (err) {
    error = String(err);
  }

  return {
    status,
    json,
    error,
    response_url: responseUrl,
    content_type: contentType,
    text: json ? undefined : text?.slice(0, 4000),
  };
}

function emitBossRiskStatus(
  ctx: ModeContext,
  label: string,
  res: PageFetchJsonResult,
  lastStatus: string | null,
): { status: string; message: string } {
  const raw = res.json;
  const responseUrl = res.response_url ?? "";
  const urlRisk = detectRiskUrl(responseUrl);
  let status: "captcha" | "denied" | "invalid" = urlRisk ?? "captcha";
  let message = `${label} 返回登录/安全验证页面。请在浏览器窗口完成验证后自动重试。`;

  if (res.status === 401 || (raw && typeof raw === "object" && isLoginExpired(raw))) {
    status = "invalid";
    const msg = raw && typeof raw === "object"
      ? readApiMessage(raw) || (typeof raw?.msg === "string" ? raw.msg : "")
      : "";
    message = `${label} 登录状态已失效：${msg || `接口返回 ${res.status || "登录页"}`}。请在浏览器窗口完成登录后自动重试。`;
  } else if (res.status === 403 || status === "denied") {
    status = "denied";
    message = `${label} 接口返回 403（可能触发风控）。`;
  } else if (raw && typeof raw === "object" && isAbnormalAccess(raw)) {
    status = "captcha";
    const msg = readApiMessage(raw);
    message = `${label} 接口返回访问异常：${msg || "code=37"}。请在浏览器窗口完成人机验证后自动重试。`;
  } else if ((res.content_type ?? "").toLowerCase().includes("text/html")) {
    const text = (res.text ?? "").toLowerCase();
    if (text.includes("登录") || text.includes("请登录") || text.includes("login")) {
      status = "invalid";
      message = `${label} 返回登录页面。请在浏览器窗口完成登录后自动重试。`;
    } else {
      status = "captcha";
      message = `${label} 返回安全验证页面。请在浏览器窗口完成人机验证后自动重试。`;
    }
  } else if (urlRisk) {
    message = `检测到风控页面：${responseUrl}`;
  }

  if (lastStatus !== status) {
    ctx.emit({ type: "LOGIN_STATUS", payload: { status, message } });
  }
  return { status, message };
}

export async function requestBossJsonWithRiskRecovery(
  page: Page,
  ctx: ModeContext,
  label: string,
  request: () => Promise<PageFetchJsonResult | null>,
  options: BossRiskRecoveryOptions = {},
): Promise<PageFetchJsonResult | null> {
  const recover = options.recover !== false;
  const pageClear = await waitUntilNoRiskUrl(page, ctx, {
    recover,
    onRisk: options.onRisk,
  });
  if (ctx.signal.aborted || !pageClear) return null;

  const res = await request();
  if (ctx.signal.aborted) return null;
  if (!res) return null;
  if (!isBossRiskResponse(res)) return res;

  const initialRisk = emitBossRiskStatus(ctx, label, res, null);
  options.onRisk?.(initialRisk.status, initialRisk.message);
  if (!recover) {
    ctx.emit({
      type: "LOG",
      payload: {
        level: "warn",
        message: `${label} 触发风控或登录验证，低风控模式已停止本轮 Boss 采集。`,
      },
    });
    return null;
  }
  return await waitUntilApiOk(page, ctx, label, async () => {
    await waitUntilNoRiskUrl(page, ctx);
    if (ctx.signal.aborted) return { status: 0, json: null, error: "aborted" };
    return await request() ?? { status: 0, json: null, error: "request returned no result" };
  }, initialRisk.status);
}

export async function setLocalStorage(page: Page, localStorage: Record<string, string>): Promise<void> {
  await page.evaluate((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      window.localStorage.setItem(k, v);
    }
  }, localStorage);
}

function pickScalarPath(raw: unknown, path: string[]): string | undefined {
  let current = raw;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return pickFirstScalar(current);
}

function pickFirstPathScalar(raw: unknown, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = pickScalarPath(raw, path);
    if (value) return value;
  }
  return undefined;
}

function jobListPayloadFilterPaths(key: keyof ApiFilters): string[][] {
  return [
    [key],
    ["zpData", key],
    ["zpData", "params", key],
    ["zpData", "searchParam", key],
    ["zpData", "condition", key],
    ["zpData", "queryInfo", key],
  ];
}

function pickFirstScalar(v: unknown): string | undefined {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  if (Array.isArray(v)) {
    return pickFirstScalar(v[0]);
  }
  return undefined;
}

export function matchesExpectedJobListPayload(
  raw: unknown,
  keyword: string,
  pageIndex: number,
  filters: ApiFilters,
): boolean {
  const matchesIfPresent = (actual: string | undefined, expected: string): boolean => {
    if (!actual) return true;
    return actual === expected;
  };
  const query = pickFirstPathScalar(raw, [
    ["query"],
    ["keyword"],
    ["zpData", "query"],
    ["zpData", "keyword"],
    ["zpData", "params", "query"],
    ["zpData", "searchParam", "query"],
    ["zpData", "condition", "query"],
    ["zpData", "queryInfo", "query"],
  ]);
  const page = pickFirstPathScalar(raw, [
    ["page"],
    ["pageNo"],
    ["pageNum"],
    ["pageIndex"],
    ["zpData", "page"],
    ["zpData", "pageNo"],
    ["zpData", "pageNum"],
    ["zpData", "pageIndex"],
    ["zpData", "params", "page"],
    ["zpData", "searchParam", "page"],
    ["zpData", "condition", "page"],
    ["zpData", "pageInfo", "page"],
  ]);
  const city = pickFirstPathScalar(raw, [
    ["city"],
    ["cityCode"],
    ["city_code"],
    ["zpData", "city"],
    ["zpData", "cityCode"],
    ["zpData", "city_code"],
    ["zpData", "params", "city"],
    ["zpData", "searchParam", "city"],
    ["zpData", "condition", "city"],
    ["zpData", "queryInfo", "city"],
  ]);

  if (!matchesIfPresent(query, keyword)) return false;
  if (!matchesIfPresent(page, String(pageIndex))) return false;
  if (filters.city && !matchesIfPresent(city, filters.city)) return false;
  for (const key of PAYLOAD_FILTER_MATCH_KEYS) {
    const expected = filters[key];
    if (!expected) continue;
    const actual = pickFirstPathScalar(raw, jobListPayloadFilterPaths(key));
    if (!matchesIfPresent(actual, expected)) return false;
  }
  return true;
}

function pickScalarList(v: unknown): string[] {
  if (typeof v === "string" || typeof v === "number") {
    const first = pickFirstScalar(v);
    return first ? [first] : [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const value = pickFirstScalar(item);
    if (value) out.push(value);
  }
  return Array.from(new Set(out));
}

function pickCodeOrEmpty(raw: unknown, key: string, warn: (msg: string) => void): string {
  const v = pickFirstScalar(raw);
  if (!v) return "";
  if (!/^\d+$/.test(v)) {
    warn(`筛选项 ${key}=${v} 不是数字 code，将被忽略。`);
    return "";
  }
  if (v === "0") return "";
  return v;
}

function pickCodes(raw: unknown, key: string, warn: (msg: string) => void): string[] {
  const out: string[] = [];
  for (const value of pickScalarList(raw)) {
    if (!/^\d+$/.test(value)) {
      warn(`筛选项 ${key}=${value} 不是数字 code，将被忽略。`);
      continue;
    }
    if (value !== "0") out.push(value);
  }
  return Array.from(new Set(out));
}

function pickCodesCsv(raw: unknown, key: string, warn: (msg: string) => void): string {
  return pickCodes(raw, key, warn).join(",");
}

export function normalizeFilters(raw: unknown, warn: (msg: string) => void): ApiFilters {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    city: pickCodeOrEmpty(obj.city, "city", warn),
    multiSubway: pickCodesCsv(obj.multiSubway, "multiSubway", warn),
    multiBusinessDistrict: pickCodesCsv(obj.multiBusinessDistrict, "multiBusinessDistrict", warn),
    position: pickCodeOrEmpty(obj.position, "position", warn),
    jobType: pickCodeOrEmpty(obj.jobType, "jobType", warn),
    salary: pickCodeOrEmpty(obj.salary, "salary", warn),
    experience: pickCodeOrEmpty(obj.experience, "experience", warn),
    degree: pickCodeOrEmpty(obj.degree, "degree", warn),
    industry: pickCodeOrEmpty(obj.industry, "industry", warn),
    scale: pickCodeOrEmpty(obj.scale, "scale", warn),
    stage: pickCodeOrEmpty(obj.stage, "stage", warn),
  };
}

export function normalizeFilterVariants(raw: unknown, warn: (msg: string) => void): ApiFilters[] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const base = normalizeFilters(raw, warn);
  const cities = pickCodes(obj.city, "city", warn);
  if (cities.length === 0) return [base];
  return cities.map((city) => ({ ...base, city }));
}

export function buildJobListBody(keyword: string, page: number, pageSize: number, filters: ApiFilters): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("city", filters.city);
  params.set("expectInfo", "");
  params.set("query", keyword);
  params.set("multiSubway", filters.multiSubway);
  params.set("multiBusinessDistrict", filters.multiBusinessDistrict);
  params.set("position", filters.position);
  params.set("jobType", filters.jobType);
  params.set("salary", filters.salary);
  params.set("experience", filters.experience);
  params.set("degree", filters.degree);
  params.set("industry", filters.industry);
  params.set("scale", filters.scale);
  params.set("stage", filters.stage);
  params.set("scene", "1");
  params.set("encryptExpectId", "");
  return params.toString();
}

export function buildJobDetailUrl(securityId: string, lid?: string): string {
  const u = new URL(`https://www.zhipin.com${API_PATH.JOB_DETAIL}`);
  u.searchParams.set("securityId", securityId);
  if (lid) u.searchParams.set("lid", lid);
  u.searchParams.set("scene", "1");
  return u.toString();
}

export function buildJobDetailBody(securityId: string, lid?: string): string {
  const params = new URLSearchParams();
  params.set("securityId", securityId);
  if (lid) params.set("lid", lid);
  params.set("scene", "1");
  return params.toString();
}

export async function fetchJsonFromPage(
  page: Page,
  url: string,
  options: { method: "GET" | "POST"; body?: string; timeoutMs?: number },
): Promise<PageFetchJsonResult> {
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 30_000;
  const body = typeof options.body === "string" ? options.body : null;

  return await page.evaluate(
    async (u, method, bodyText, timeout, requestContentType) => {
      const controller = new AbortController();
      const t = window.setTimeout(() => controller.abort(), timeout);
      try {
        const headers: Record<string, string> = {
          "x-requested-with": "XMLHttpRequest",
        };
        if (requestContentType) headers["content-type"] = requestContentType;

        const res = await fetch(u, {
          method,
          credentials: "include",
          headers,
          body: bodyText ?? undefined,
          signal: controller.signal,
        });

        const responseContentType = res.headers.get("content-type") ?? "";
        const responseUrl = res.url;
        const text = await res.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        return {
          status: res.status,
          json,
          response_url: responseUrl,
          content_type: responseContentType,
          text: json ? undefined : text.slice(0, 4000),
        } as PageFetchJsonResult;
      } catch (err) {
        return { status: 0, json: null, error: String(err) } as PageFetchJsonResult;
      } finally {
        window.clearTimeout(t);
      }
    },
    url,
    options.method,
    body,
    timeoutMs,
    options.method === "POST" ? "application/x-www-form-urlencoded; charset=UTF-8" : null,
  );
}

async function readPageLocalStorage(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      out[key] = window.localStorage.getItem(key) ?? "";
    }
    return out;
  });
}

async function requestBossUserInfo(page: Page): Promise<PageFetchJsonResult> {
  return await fetchJsonFromPage(page, `https://www.zhipin.com${API_PATH.USER_INFO}?_=${Date.now()}`, {
    method: "GET",
    timeoutMs: 30_000,
  });
}

async function emitBossSessionSnapshot(page: Page, ctx: ModeContext): Promise<void> {
  const cookies = await page.cookies().catch(() => []);
  const local_storage = await readPageLocalStorage(page).catch(() => ({}));
  ctx.emit({ type: "COOKIE_COLLECTED", payload: { source_platform: "boss", cookies, local_storage } });
}

export async function waitUntilBossLoginReady(
  page: Page,
  ctx: ModeContext,
  readyMessage = "Boss 登录态已就绪，开始采集。",
  options: BossRiskRecoveryOptions = {},
): Promise<boolean> {
  let lastStatus: string | null = null;
  while (!ctx.signal.aborted) {
    const res = await requestBossJsonWithRiskRecovery(page, ctx, "user/info", () => requestBossUserInfo(page), options);
    if (ctx.signal.aborted) return false;
    if (!res && options.recover === false) return false;
    const raw = res?.json;
    if (raw && typeof raw === "object" && readApiCode(raw) === 0) {
      ctx.emit({ type: "LOGIN_STATUS", payload: { status: "valid", message: readyMessage } });
      await emitBossSessionSnapshot(page, ctx);
      return true;
    }

    const msg = raw && typeof raw === "object" ? readApiMessage(raw) : "";
    if (lastStatus !== "invalid") {
      ctx.emit({
        type: "LOGIN_STATUS",
        payload: {
          status: "invalid",
          message: msg
            ? `请在打开的浏览器窗口完成 Boss 登录后继续采集：${msg}`
            : "请在打开的浏览器窗口完成 Boss 登录，程序会自动继续采集。",
        },
      });
      lastStatus = "invalid";
    }
    await delayWithJitter(1500, ctx.signal, 1000);
  }
  return false;
}

export async function waitUntilApiOk(
  page: Page,
  ctx: ModeContext,
  label: string,
  request: () => Promise<PageFetchJsonResult>,
  initialStatus: string | null = null,
): Promise<PageFetchJsonResult | null> {
  ctx.emit({
    type: "LOG",
    payload: {
      level: "warn",
      message: `${label} 触发风控或访问异常，已暂停自动采集；请在浏览器窗口完成人机验证/登录，程序会自动重试。`,
    },
  });

  let lastStatus: string | null = initialStatus;
  while (!ctx.signal.aborted) {
    const risk = detectRiskUrl(page.url());
    if (risk && lastStatus !== risk) {
      ctx.emit({ type: "LOGIN_STATUS", payload: { status: risk, message: `检测到风控页面：${page.url()}` } });
      lastStatus = risk;
    }

    await delayWithJitter(5000, ctx.signal, 5000);
    if (ctx.signal.aborted) return null;

    const res = await request();
    if (ctx.signal.aborted) return null;

    const raw = res.json;
    if (raw && typeof raw === "object" && readApiCode(raw) === 0) {
      if (lastStatus) ctx.emit({ type: "LOGIN_STATUS", payload: { status: "ok" } });
      return res;
    }

    if (isBossRiskResponse(res)) {
      const risk = emitBossRiskStatus(ctx, label, res, lastStatus);
      lastStatus = risk.status;
      continue;
    }

    return res;
  }

  return null;
}

export async function waitUntilNoRiskUrl(
  page: Page,
  ctx: ModeContext,
  options: BossRiskRecoveryOptions = {},
): Promise<boolean> {
  const recover = options.recover !== false;
  let lastRisk: string | null = null;
  while (!ctx.signal.aborted) {
    const url = page.url();
    const risk = detectRiskUrl(url);
    if (risk) {
      if (lastRisk !== risk) {
        const message = `检测到风控页面：${url}`;
        ctx.emit({ type: "LOGIN_STATUS", payload: { status: risk, message } });
        options.onRisk?.(risk, message);
        lastRisk = risk;
      }
      if (!recover) return false;
      await delayWithJitter(1500, ctx.signal, 1000);
      continue;
    }
    if (lastRisk) ctx.emit({ type: "LOGIN_STATUS", payload: { status: "ok" } });
    return true;
  }
  return false;
}

export function extractJobList(raw: any): { jobs: any[]; hasMore: boolean } {
  const zpData = raw?.zpData;
  const jobs = Array.isArray(zpData?.jobList) ? zpData.jobList : [];
  const hasMore = zpData?.hasMore === true;
  return { jobs, hasMore };
}
