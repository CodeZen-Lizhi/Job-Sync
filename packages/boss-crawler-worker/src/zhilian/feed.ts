import * as http from "node:http";
import * as https from "node:https";

import { ProxyAgent } from "proxy-agent";
import type { Page } from "puppeteer";

import { launchBrowser } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import type { EventOut } from "../protocol.js";
import { delayWithJitter } from "../utils/delay.js";
import type { CrawlAutoStartPayload, ModeContext } from "../modes/auto/types.js";

type ZhilianHttpResponse = {
  status: number;
  body: string;
  contentType: string;
};

type PageFetchResult = {
  status: number;
  json: unknown | null;
  text: string;
  contentType: string;
  error?: string;
};

type ZhilianRequestOptions = {
  label?: string;
  timeoutMs?: number;
  cookieHeader?: string;
  referer?: string;
  onRetry?: (attempt: number, error: Error) => void;
};

export type ZhilianJobEntry = {
  jobId: string;
  title: string;
  url: string;
  company?: string;
  city?: string;
  salary?: string;
  experience?: string;
  degree?: string;
  welfare?: string[];
  description?: string;
  sourcePage?: number;
  detailStatus?: "ok" | "missing" | "blocked";
  detailError?: string;
  raw?: unknown;
};

const DEFAULT_MAX_PAGES = 3;
const API_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_CHALLENGE_WAIT_MS = 180_000;
const zhilianProxyAgent = new ProxyAgent();

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, value: string) => String.fromCodePoint(Number.parseInt(value, 10)));
}

function htmlToText(html: string): string {
  return decodeEntities(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return undefined;
}

function readPath(raw: unknown, path: readonly string[]): unknown {
  let current = raw;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeZhilianUrl(value: string, baseUrl = "https://www.zhaopin.com"): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${baseUrl.replace(/\/$/, "")}${trimmed}`;
  return trimmed;
}

export function isZhilianSecurityVerificationText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("security verification") ||
    lower.includes("tencent cloud edgeone") ||
    lower.includes("eo-bot-captcha-token") ||
    lower.includes("teocaptchawidget") ||
    lower.includes("verify you are human") ||
    lower.includes("正在验证连接安全性")
  );
}

function looksLikeLoginText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("passport.zhaopin.com") || lower.includes("登录") && lower.includes("智联");
}

export function extractZhilianJobId(input: string): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  const patterns = [
    /jobdetail\/([^/?#]+?)(?:\.htm|\.html)?(?:[?#]|$)/i,
    /\/jobs\/([^/?#]+)\/info(?:[?#]|$)/i,
    /(?:^|[?&#])jobId=([^&#]+)/i,
    /(?:^|[?&#])number=([^&#]+)/i,
    /(?:^|[?&#])positionId=([^&#]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ? decodeURIComponent(match[1]).trim() : "";
    if (value) return value;
  }
  if (/^[A-Za-z0-9:_-]{8,}$/.test(text)) return text;
  return undefined;
}

function canonicalDetailUrl(jobId: string): string {
  return `https://www.zhaopin.com/jobdetail/${jobId}.htm`;
}

function arrayFromCandidate(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const path of [
    ["data", "results"],
    ["data", "list"],
    ["data", "items"],
    ["data", "data"],
    ["results"],
    ["list"],
    ["items"],
  ]) {
    const found = readPath(value, path);
    if (Array.isArray(found)) return found;
  }
  return [];
}

function normalizeJobFromApiItem(item: unknown): ZhilianJobEntry | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  const nestedJob = raw.jobInfo && typeof raw.jobInfo === "object" ? raw.jobInfo as Record<string, unknown> : {};
  const companyInfo = raw.company && typeof raw.company === "object"
    ? raw.company as Record<string, unknown>
    : raw.companyInfo && typeof raw.companyInfo === "object"
      ? raw.companyInfo as Record<string, unknown>
      : {};
  const title = firstString(raw.jobName, raw.positionName, raw.name, raw.title, nestedJob.jobName, nestedJob.name);
  const url = firstString(raw.positionURL, raw.positionUrl, raw.jobUrl, raw.url, raw.link, nestedJob.positionURL, nestedJob.url);
  const jobId = firstString(raw.number, raw.jobId, raw.positionId, raw.id, nestedJob.number, nestedJob.jobId)
    ?? (url ? extractZhilianJobId(url) : undefined);
  if (!jobId || !title) return null;
  const normalizedUrl = url ? normalizeZhilianUrl(url) : canonicalDetailUrl(jobId);
  const welfareRaw = raw.welfare || raw.welfareLabel || raw.jobWelfareTag || raw.tags || raw.jobLabels;
  const welfare = Array.isArray(welfareRaw)
    ? welfareRaw.map(asString).filter((value): value is string => !!value)
    : undefined;
  return {
    jobId,
    title,
    url: normalizedUrl,
    company: firstString(raw.companyName, raw.company, companyInfo.name, companyInfo.companyName),
    city: firstString(raw.city, raw.cityName, raw.workCity, raw.jobCity, nestedJob.cityName),
    salary: firstString(raw.salary, raw.salary60, raw.salaryDesc, raw.jobSalary),
    experience: firstString(raw.workingExp, raw.workExperience, raw.experience, raw.workingExpName),
    degree: firstString(raw.education, raw.degree, raw.eduLevel, raw.eduLevelName),
    welfare,
    description: firstString(raw.jobDesc, raw.description, raw.responsibility, nestedJob.description),
    detailStatus: "missing",
    raw,
  };
}

export function parseZhilianSearchApi(value: unknown): ZhilianJobEntry[] {
  const out: ZhilianJobEntry[] = [];
  const seen = new Set<string>();
  for (const item of arrayFromCandidate(value)) {
    const normalized = normalizeJobFromApiItem(item);
    if (!normalized || seen.has(normalized.jobId)) continue;
    seen.add(normalized.jobId);
    out.push(normalized);
  }
  return out;
}

export function parseZhilianJobLinks(html: string, baseUrl = "https://www.zhaopin.com"): ZhilianJobEntry[] {
  const out: ZhilianJobEntry[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\b[^>]*href=["']([^"']*(?:jobdetail|jobs\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const href = normalizeZhilianUrl(decodeEntities(match[1] ?? ""), baseUrl).split("#")[0] ?? "";
    const jobId = extractZhilianJobId(href);
    const title = htmlToText(match[2] ?? "");
    if (!jobId || !title || seen.has(jobId)) continue;
    seen.add(jobId);
    const context = html.slice(Math.max(0, match.index - 900), Math.min(html.length, linkRe.lastIndex + 1400));
    out.push({
      jobId,
      title,
      url: href || canonicalDetailUrl(jobId),
      company: htmlToText(context.match(/class=["'][^"']*(?:company|corp|brand)[^"']*["'][^>]*>([\s\S]{0,160}?)</i)?.[1] ?? ""),
      city: htmlToText(context.match(/class=["'][^"']*(?:city|area|location)[^"']*["'][^>]*>([\s\S]{0,120}?)</i)?.[1] ?? ""),
      salary: htmlToText(context.match(/class=["'][^"']*(?:salary|money)[^"']*["'][^>]*>([\s\S]{0,120}?)</i)?.[1] ?? ""),
      detailStatus: "missing",
    });
  }
  return out;
}

export function parseZhilianDetailPage(html: string, fallback: ZhilianJobEntry): ZhilianJobEntry {
  if (isZhilianSecurityVerificationText(html) || looksLikeLoginText(html)) {
    return { ...fallback, detailStatus: "blocked", detailError: "登录或安全验证拦截" };
  }
  const title = htmlToText(
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?? fallback.title,
  ).replace(/[-_].*智联招聘.*$/u, "").trim() || fallback.title;
  const description = htmlToText(
    html.match(/class=["'][^"']*(?:job(?:-|\s*)desc|description|pos(?:ition)?-?desc)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|article)>/i)?.[1]
      ?? html.match(/岗位职责[:：]?([\s\S]{80,5000}?)(?:任职资格|职位要求|公司信息|工作地址|<\/body>)/i)?.[1]
      ?? "",
  );
  const company = fallback.company || htmlToText(
    html.match(/class=["'][^"']*(?:company|corp|brand)[^"']*["'][^>]*>([\s\S]{0,200}?)</i)?.[1] ?? "",
  );
  return {
    ...fallback,
    title,
    company: company || fallback.company,
    description: description || fallback.description,
    detailStatus: description ? "ok" : "missing",
    detailError: description ? undefined : "详情正文缺失",
  };
}

function normalizePositiveInteger(fallback: number, ...values: unknown[]): number {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function buildCookieHeader(cookies: unknown, hostname: string): string | undefined {
  if (!Array.isArray(cookies)) return undefined;
  const pairs = cookies
    .filter((cookie): cookie is { name: string; value: string; domain?: string } => {
      return !!cookie && typeof cookie === "object"
        && typeof (cookie as { name?: unknown }).name === "string"
        && typeof (cookie as { value?: unknown }).value === "string";
    })
    .filter((cookie) => {
      const domain = cookie.domain?.replace(/^\./, "").toLowerCase();
      return !domain || hostname.toLowerCase() === domain || hostname.toLowerCase().endsWith(`.${domain}`);
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  return pairs.length > 0 ? pairs.join("; ") : undefined;
}

function searchApiUrl(keyword: string, pageIndex: number, pageSize: number, city: string): string {
  const url = new URL("https://fe-api.zhaopin.com/c/i/sou");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("kw", keyword);
  url.searchParams.set("kt", "3");
  url.searchParams.set("start", String((pageIndex - 1) * pageSize));
  if (city) url.searchParams.set("cityId", city);
  return url.toString();
}

function mobileSearchUrl(keyword: string, pageIndex: number, city: string): string {
  const url = new URL("https://m.zhaopin.com/searchresult/");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("page", String(pageIndex));
  if (city) url.searchParams.set("city", city);
  return url.toString();
}

function responseToPageFetchResult(response: ZhilianHttpResponse): PageFetchResult {
  if (response.contentType.includes("application/json")) {
    try {
      return { ...response, json: JSON.parse(response.body), text: response.body };
    } catch {
      return { ...response, json: null, text: response.body, error: "JSON parse failed" };
    }
  }
  const trimmed = response.body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return { ...response, json: JSON.parse(trimmed), text: response.body };
    } catch {
      // Fall through to text mode.
    }
  }
  return { ...response, json: null, text: response.body };
}

function fetchZhilianUrl(url: string, signal: AbortSignal, options: ZhilianRequestOptions = {}): Promise<ZhilianHttpResponse> {
  const retries = 1;
  const timeoutMs = options.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
  const label = options.label ?? "智联请求";
  const attempt = (attemptIndex: number): Promise<ZhilianHttpResponse> => new Promise<ZhilianHttpResponse>((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "http:" ? http : https;
    const req = client.request(parsed, {
      method: "GET",
      timeout: timeoutMs,
      agent: zhilianProxyAgent,
      headers: {
        "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 Job-Sync/0.1",
        ...(options.referer ? { "referer": options.referer } : {}),
        ...(options.cookieHeader ? { "cookie": options.cookieHeader } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          contentType: String(res.headers["content-type"] ?? ""),
        });
      });
    });
    const onAbort = () => {
      req.destroy(new Error("智联请求已取消"));
      reject(new Error("智联请求已取消"));
    };
    req.on("timeout", () => {
      req.destroy(new Error(`${label} 请求超时：${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    signal.addEventListener("abort", onAbort, { once: true });
    req.end();
  }).catch(async (err) => {
    if (attemptIndex >= retries || signal.aborted) throw err;
    const error = err instanceof Error ? err : new Error(String(err));
    options.onRetry?.(attemptIndex + 1, error);
    await delayWithJitter(800, signal, 400);
    return attempt(attemptIndex + 1);
  });
  return attempt(0);
}

async function fetchFromBrowserPage(page: Page, url: string): Promise<PageFetchResult> {
  return await page.evaluate(async (requestUrl) => {
    try {
      const res = await fetch(requestUrl, {
        credentials: "include",
        headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      });
      const text = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      let json: unknown | null = null;
      if (contentType.includes("application/json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: res.status, json, text, contentType };
    } catch (err) {
      return { status: 0, json: null, text: "", contentType: "", error: err instanceof Error ? err.message : String(err) };
    }
  }, url);
}

async function pageLooksLikeBlocked(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    const text = await page.evaluate(() => document.documentElement.innerText.slice(0, 4000));
    const html = await page.evaluate(() => document.documentElement.innerHTML.slice(0, 8000));
    return isZhilianSecurityVerificationText(`${title}\n${text}\n${html}`) || looksLikeLoginText(`${title}\n${text}\n${html}`);
  } catch {
    return false;
  }
}

async function waitForBrowserReady(page: Page, ctx: ModeContext): Promise<void> {
  const started = Date.now();
  let logged = false;
  while (!ctx.signal.aborted) {
    if (!await pageLooksLikeBlocked(page)) return;
    if (!logged) {
      logged = true;
      ctx.emit({
        type: "LOGIN_STATUS",
        payload: {
          status: "captcha",
          message: "智联招聘需要登录或安全验证。请在打开的浏览器窗口完成验证，完成后会继续采集。",
        },
      });
    }
    if (Date.now() - started > DEFAULT_CHALLENGE_WAIT_MS) {
      throw new Error("智联浏览器验证超时：请确认浏览器窗口内已完成登录或安全验证。");
    }
    await delayWithJitter(2000, ctx.signal, 1000);
  }
}

async function emitZhilianBrowserSession(page: Page, ctx: ModeContext): Promise<void> {
  const cookies = await page.cookies().catch(() => []);
  const local_storage = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key) out[key] = window.localStorage.getItem(key) ?? "";
    }
    return out;
  }).catch(() => ({}));
  ctx.emit({ type: "COOKIE_COLLECTED", payload: { source_platform: "zhilian", cookies, local_storage } });
}

async function openZhilianBrowserClient(
  payload: CrawlAutoStartPayload,
  ctx: ModeContext,
  keyword: string,
  city: string,
): Promise<{ browser: Awaited<ReturnType<typeof launchBrowser>>["browser"]; page: Page }> {
  if (!payload.user_data_dir) {
    throw new Error("智联公开采集路径被安全验证拦截，且没有可复用的智联浏览器资料目录。");
  }
  ctx.emit({
    type: "LOG",
    payload: { level: "warn", message: "智联公开请求被拦截或返回空结果，改用本机智联浏览器资料在页面上下文请求。" },
  });
  const { browser, page } = await launchBrowser({
    headless: false,
    user_data_dir: payload.user_data_dir,
    stealth: false,
    preserve_on_disconnect: true,
  });
  await blockNavigation(page, { allow_domain_suffixes: ["zhaopin.com", "zhaopin.cn"] });
  await page.goto(mobileSearchUrl(keyword, 1, city), { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await waitForBrowserReady(page, ctx);
  await emitZhilianBrowserSession(page, ctx);
  return { browser, page };
}

async function fetchSearchEntriesDirect(
  keyword: string,
  pageIndex: number,
  pageSize: number,
  city: string,
  signal: AbortSignal,
  options: ZhilianRequestOptions,
): Promise<{ entries: ZhilianJobEntry[]; blocked: boolean; status: number }> {
  const apiResult = responseToPageFetchResult(await fetchZhilianUrl(searchApiUrl(keyword, pageIndex, pageSize, city), signal, {
    ...options,
    label: `智联第 ${pageIndex} 页搜索 API`,
  }));
  if (apiResult.json) {
    const entries = parseZhilianSearchApi(apiResult.json);
    if (entries.length > 0) return { entries, blocked: false, status: apiResult.status };
    if (!isZhilianSecurityVerificationText(apiResult.text) && apiResult.status >= 200 && apiResult.status < 300) {
      return { entries: [], blocked: false, status: apiResult.status };
    }
  }
  if (isZhilianSecurityVerificationText(apiResult.text) || looksLikeLoginText(apiResult.text) || apiResult.status === 401 || apiResult.status === 403) {
    return { entries: [], blocked: true, status: apiResult.status };
  }
  const htmlResult = responseToPageFetchResult(await fetchZhilianUrl(mobileSearchUrl(keyword, pageIndex, city), signal, {
    ...options,
    label: `智联第 ${pageIndex} 页移动搜索`,
  }));
  if (isZhilianSecurityVerificationText(htmlResult.text) || looksLikeLoginText(htmlResult.text) || htmlResult.status === 401 || htmlResult.status === 403) {
    return { entries: [], blocked: true, status: htmlResult.status };
  }
  return { entries: parseZhilianJobLinks(htmlResult.text, "https://m.zhaopin.com"), blocked: false, status: htmlResult.status };
}

async function fetchSearchEntriesFromBrowser(
  page: Page,
  keyword: string,
  pageIndex: number,
  pageSize: number,
  city: string,
): Promise<{ entries: ZhilianJobEntry[]; blocked: boolean; status: number }> {
  const apiResult = await fetchFromBrowserPage(page, searchApiUrl(keyword, pageIndex, pageSize, city));
  if (apiResult.json) {
    const entries = parseZhilianSearchApi(apiResult.json);
    if (entries.length > 0) return { entries, blocked: false, status: apiResult.status };
  }
  if (isZhilianSecurityVerificationText(apiResult.text) || looksLikeLoginText(apiResult.text) || apiResult.status === 401 || apiResult.status === 403) {
    return { entries: [], blocked: true, status: apiResult.status };
  }
  const htmlResult = await fetchFromBrowserPage(page, mobileSearchUrl(keyword, pageIndex, city));
  if (isZhilianSecurityVerificationText(htmlResult.text) || looksLikeLoginText(htmlResult.text) || htmlResult.status === 401 || htmlResult.status === 403) {
    return { entries: [], blocked: true, status: htmlResult.status };
  }
  return { entries: parseZhilianJobLinks(htmlResult.text, "https://m.zhaopin.com"), blocked: false, status: htmlResult.status };
}

async function fetchDetailDirect(
  entry: ZhilianJobEntry,
  signal: AbortSignal,
  options: ZhilianRequestOptions,
): Promise<ZhilianJobEntry> {
  const result = responseToPageFetchResult(await fetchZhilianUrl(entry.url, signal, {
    ...options,
    label: "智联详情",
    referer: options.referer ?? entry.url,
  }));
  if (isZhilianSecurityVerificationText(result.text) || looksLikeLoginText(result.text) || result.status === 401 || result.status === 403) {
    return { ...entry, detailStatus: "blocked", detailError: `HTTP ${result.status || 0}` };
  }
  return parseZhilianDetailPage(result.text, entry);
}

async function fetchDetailFromBrowser(page: Page, entry: ZhilianJobEntry): Promise<ZhilianJobEntry> {
  const result = await fetchFromBrowserPage(page, entry.url);
  if (isZhilianSecurityVerificationText(result.text) || looksLikeLoginText(result.text) || result.status === 401 || result.status === 403) {
    return { ...entry, detailStatus: "blocked", detailError: `HTTP ${result.status || 0}` };
  }
  return parseZhilianDetailPage(result.text, entry);
}

function dedupeEntries(entries: readonly ZhilianJobEntry[]): ZhilianJobEntry[] {
  const out: ZhilianJobEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.jobId)) continue;
    seen.add(entry.jobId);
    out.push(entry);
  }
  return out;
}

function buildJdText(entry: ZhilianJobEntry): string {
  const parts = [
    entry.title,
    entry.company,
    entry.city,
    entry.salary,
    entry.experience,
    entry.degree,
    entry.welfare?.join(" "),
    entry.description || "详情暂未抓取，需打开原岗位确认。",
  ];
  return parts.map((part) => part?.trim()).filter(Boolean).join("\n\n");
}

export function buildZhilianNormalizedPayload(
  entry: ZhilianJobEntry,
  options: { keyword?: string; filters?: unknown } = {},
): Extract<EventOut, { type: "JOB_NORMALIZED_CAPTURED" }>["payload"] {
  return {
    encrypt_job_id: `zhilian:${entry.jobId}`,
    source_platform: "zhilian",
    source_url: entry.url || canonicalDetailUrl(entry.jobId),
    dedup_key: entry.jobId,
    position_name: entry.title,
    brand_name: entry.company,
    city_name: entry.city,
    salary_desc: entry.salary,
    experience_name: entry.experience,
    degree_name: entry.degree,
    jd_text: buildJdText(entry),
    raw_payload: {
      ...entry,
      detail_status: entry.detailStatus ?? "missing",
      detail_error: entry.detailError,
    },
    keyword: options.keyword,
    filters: options.filters,
  };
}

export async function runZhilianMode(payload: CrawlAutoStartPayload, ctx: ModeContext): Promise<void> {
  const task = payload.task ?? {};
  const filters = task.filters && typeof task.filters === "object" ? task.filters as Record<string, unknown> : {};
  const limits = task.limits && typeof task.limits === "object" ? task.limits as Record<string, unknown> : {};
  const keywords = Array.isArray(task.keywords) ? task.keywords.map((item) => item.trim()).filter(Boolean) : [];
  const maxPages = normalizePositiveInteger(DEFAULT_MAX_PAGES, limits.maxPages, limits.max_pages);
  const delayMs = normalizePositiveInteger(0, limits.delayMs, limits.delay_ms);
  const pageSize = normalizePositiveInteger(30, limits.pageSize, limits.page_size);
  const city = firstString(filters.city, filters.cityId, filters.city_id, filters.cityText) ?? "";
  const cookieHeader = buildCookieHeader(payload.session?.cookies, "zhaopin.com");
  const logKeyword = keywords[0] ?? "智联招聘";

  if (keywords.length === 0) {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: "智联未提供搜索关键词，跳过采集。" } });
    return;
  }

  let browserClient: { browser: Awaited<ReturnType<typeof launchBrowser>>["browser"]; page: Page } | null = null;
  let useBrowser = false;
  const ensureBrowserClient = async (keyword: string) => {
    if (!browserClient) browserClient = await openZhilianBrowserClient(payload, ctx, keyword, city);
    useBrowser = true;
    return browserClient;
  };

  try {
    const collected: ZhilianJobEntry[] = [];
    const seen = new Set<string>();
    for (const keyword of keywords) {
      if (ctx.signal.aborted) break;
      ctx.emit({
        type: "LOG",
        payload: { level: "info", message: `开始智联招聘采集：${keyword}，最多 ${maxPages} 页。` },
      });
      for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
        if (ctx.signal.aborted) break;
        ctx.emit({ type: "PROGRESS", payload: { keyword, current_page: pageIndex } });
        let result: { entries: ZhilianJobEntry[]; blocked: boolean; status: number };
        if (useBrowser) {
          result = await fetchSearchEntriesFromBrowser((await ensureBrowserClient(keyword)).page, keyword, pageIndex, pageSize, city);
        } else {
          result = await fetchSearchEntriesDirect(keyword, pageIndex, pageSize, city, ctx.signal, {
            cookieHeader,
            referer: "https://www.zhaopin.com/",
            onRetry: (attempt, error) => {
              ctx.emit({
                type: "LOG",
                payload: { level: "warn", message: `智联第 ${pageIndex} 页请求失败，准备重试第 ${attempt} 次：${error.message}` },
              });
            },
          });
        }
        if ((result.blocked || result.entries.length === 0 && collected.length === 0) && !useBrowser && payload.user_data_dir) {
          if (result.blocked) {
            ctx.emit({
              type: "LOG",
              payload: { level: "warn", message: `智联公开请求被登录/安全验证拦截（HTTP ${result.status || 0}），尝试可见浏览器资料。` },
            });
          }
          result = await fetchSearchEntriesFromBrowser((await ensureBrowserClient(keyword)).page, keyword, pageIndex, pageSize, city);
        }
        if (result.blocked) {
          if (collected.length === 0) throw new Error("智联招聘需要登录或安全验证，未抓到可入库岗位。");
          ctx.emit({
            type: "LOG",
            payload: { level: "warn", message: `智联第 ${pageIndex} 页被登录/安全验证拦截，停止后续分页。` },
          });
          break;
        }
        const fresh = result.entries
          .map((entry) => ({ ...entry, sourcePage: pageIndex }))
          .filter((entry) => {
            if (seen.has(entry.jobId)) return false;
            seen.add(entry.jobId);
            return true;
          });
        ctx.emit({
          type: "LOG",
          payload: { level: "info", message: `智联第 ${pageIndex} 页解析：${fresh.length} 条。` },
        });
        if (fresh.length === 0) break;
        collected.push(...fresh);
        ctx.emit({ type: "PROGRESS", payload: { keyword, current_page: pageIndex, captured_job_list: collected.length } });
        await delayWithJitter(delayMs, ctx.signal, 300);
      }
    }

    const entries = dedupeEntries(collected);
    if (entries.length === 0) {
      ctx.emit({ type: "ERROR", payload: { message: "智联本轮没有解析到任何岗位；可能需要登录/安全验证，或当前关键词没有公开结果。" } });
      return;
    }

    let submitted = 0;
    for (const entry of entries) {
      if (ctx.signal.aborted) break;
      let detailedEntry = useBrowser
        ? await fetchDetailFromBrowser((await ensureBrowserClient(logKeyword)).page, entry)
        : await fetchDetailDirect(entry, ctx.signal, { cookieHeader, referer: entry.url });
      if (detailedEntry.detailStatus === "blocked" && !useBrowser && payload.user_data_dir) {
        detailedEntry = await fetchDetailFromBrowser((await ensureBrowserClient(logKeyword)).page, entry);
      }
      if (detailedEntry.detailStatus !== "ok") {
        ctx.emit({
          type: "LOG",
          payload: { level: "warn", message: `智联详情未完整抓取，按列表级信息入库：${detailedEntry.title}（${detailedEntry.detailStatus ?? "missing"}）` },
        });
      }
      submitted += 1;
      ctx.emit({
        type: "JOB_NORMALIZED_CAPTURED",
        payload: buildZhilianNormalizedPayload(detailedEntry, { keyword: logKeyword, filters }),
      });
      ctx.emit({ type: "PROGRESS", payload: { keyword: logKeyword, captured_job_detail: submitted } });
      await delayWithJitter(delayMs, ctx.signal, 300);
    }

    ctx.emit({
      type: "LOG",
      payload: { level: "info", message: `智联采集完成：提交 ${submitted} 条待入库岗位；实际新增数以采集记录为准。` },
    });
  } finally {
    const client = browserClient as { browser: Awaited<ReturnType<typeof launchBrowser>>["browser"]; page: Page } | null;
    await client?.browser.disconnect().catch(() => undefined);
  }
}
