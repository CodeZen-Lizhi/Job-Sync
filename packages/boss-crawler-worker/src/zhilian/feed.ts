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

type ZhilianSearchFilters = Record<string, unknown>;

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
const zhilianProxyAgent = new ProxyAgent();
const ZHILIAN_RECONNECT_MESSAGE = "智联登录/验证状态不可用，请到设置页点击“打开”重新连接智联后再采集。";
const ZHILIAN_CARD_NOISE_RE = /下载智联APP|和我聊聊吧|收藏|分享|立即沟通|立即投递|职位类别|清空筛选|上一页|下一页|登录|注册/u;

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
  const hasSearchEvidence = /职位类别|公司行业|薪资要求|学历要求|工作经验/u.test(text);
  const hasJobEvidence = /jobdetail\/|立即沟通|立即投递|招聘信息/u.test(text);
  if (hasSearchEvidence) return false;
  if (hasJobEvidence) return false;
  if (lower.includes("passport.zhaopin.com")) return true;
  return /验证码登录\/注册|获取验证码|国家网络身份认证登录/u.test(text);
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

function pickLine(lines: readonly string[], predicate: (line: string) => boolean): string | undefined {
  return lines.find((line) => predicate(line));
}

function zhilianCardLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && !ZHILIAN_CARD_NOISE_RE.test(line));
}

function parseZhilianCardText(text: string, title?: string): Partial<ZhilianJobEntry> {
  const lines = text
    ? zhilianCardLines(text).filter((line) => line !== title)
    : [];
  const salary = pickLine(lines, (line) => (
    /(\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[万千kK]|元|薪|面议)/u.test(line)
  ));
  const city = pickLine(lines, (line) => (
    /^(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|天津|重庆|西安|长沙|郑州|青岛|厦门|合肥|福州|济南|长春|沈阳|大连|全国|远程)(?:[·\s].*)?$/u.test(line)
  ));
  const experience = pickLine(lines, (line) => /^(经验不限|在校|应届|1年以下|\d+-\d+年|\d+年以上|\d+年经验)$/u.test(line));
  const degree = pickLine(lines, (line) => /^(学历不限|中专|高中|大专|本科|硕士|博士)$/u.test(line));
  const companyIndex = lines.findIndex((line, index) => {
    if (index <= 0) return false;
    if (line === salary || line === city || line === experience || line === degree) return false;
    if (/立即沟通|立即投递|回复|招聘|职位类别|清空筛选|上一页|下一页/u.test(line)) return false;
    const next = lines.slice(index + 1, index + 5).join("\n");
    return /(民营|国企|外企|合资|上市公司|事业单位|人以上|人$|软件\/IT服务|互联网|人工智能|通信|金融|制造)/u.test(next);
  });
  const company = companyIndex >= 0 ? lines[companyIndex] : undefined;
  const welfare = lines.filter((line) => {
    if ([salary, city, experience, degree, company].includes(line)) return false;
    if (/回复|人事|经理|HR|招聘|民营|国企|外企|合资|上市公司|事业单位|人以上|人$|软件\/IT服务|互联网|人工智能|通信|金融|制造/u.test(line)) return false;
    return /^[A-Za-z0-9+#.\-/\u4e00-\u9fa5（）()、]{1,24}$/u.test(line);
  }).slice(0, 10);
  return { company, city, salary, experience, degree, welfare: welfare.length > 0 ? welfare : undefined };
}

function extractZhilianPcCardHtml(html: string, matchStart: number, matchEnd: number): string {
  const before = html.slice(0, matchStart);
  const containerRe = /<(section|article|li|div)\b[^>]*class=["'][^"']*(?:job|position|card|item)[^"']*["'][^>]*>/gi;
  let candidate: RegExpExecArray | null;
  let containerStart = -1;
  let tagName = "";
  while ((candidate = containerRe.exec(before))) {
    containerStart = candidate.index;
    tagName = candidate[1] ?? "";
  }
  if (containerStart >= 0 && tagName) {
    containerRe.lastIndex = matchEnd;
    const nextContainer = containerRe.exec(html);
    if (nextContainer) {
      const cardHtml = html.slice(containerStart, nextContainer.index);
      const jobLinkCount = (cardHtml.match(/jobdetail\//gi) ?? []).length;
      if (jobLinkCount === 1 && htmlToText(cardHtml).length < 1600) return cardHtml;
    }
    const tailHtml = html.slice(containerStart, Math.min(html.length, matchEnd + 1600));
    const tailJobLinkCount = (tailHtml.match(/jobdetail\//gi) ?? []).length;
    if (tailJobLinkCount === 1 && htmlToText(tailHtml).length < 1600) return tailHtml;
    const closeRe = new RegExp(`</${tagName}>`, "i");
    const close = closeRe.exec(html.slice(matchEnd));
    if (close) {
      const cardHtml = html.slice(containerStart, matchEnd + close.index + close[0].length);
      const jobLinkCount = (cardHtml.match(/jobdetail\//gi) ?? []).length;
      if (jobLinkCount === 1 && htmlToText(cardHtml).length < 1600) return cardHtml;
    }
  }
  return html.slice(Math.max(0, matchStart - 800), Math.min(html.length, matchEnd + 900));
}

export function parseZhilianPcSearchHtml(html: string, baseUrl = "https://www.zhaopin.com"): ZhilianJobEntry[] {
  const out: ZhilianJobEntry[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\b[^>]*href=["']([^"']*jobdetail\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const href = normalizeZhilianUrl(decodeEntities(match[1] ?? ""), baseUrl).split("#")[0] ?? "";
    const jobId = extractZhilianJobId(href);
    const title = htmlToText(match[2] ?? "");
    if (!jobId || !title || seen.has(jobId)) continue;
    seen.add(jobId);
    const context = extractZhilianPcCardHtml(html, match.index, linkRe.lastIndex);
    const contextText = htmlToText(context);
    const cleanedDescription = [title, ...zhilianCardLines(contextText).filter((line) => line !== title)].join("\n");
    const parsedText = parseZhilianCardText(contextText, title);
    out.push({
      jobId,
      title,
      url: href || canonicalDetailUrl(jobId),
      ...parsedText,
      description: cleanedDescription.slice(0, 1200),
      detailStatus: "missing",
      raw: { source: "pc_search_html", context_text: cleanedDescription.slice(0, 2000) },
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

function filterString(filters: ZhilianSearchFilters, ...keys: string[]): string | undefined {
  return firstString(...keys.map((key) => filters[key]));
}

export function normalizeZhilianSearchCities(filters: ZhilianSearchFilters): string[] {
  const values: string[] = [];
  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value !== "string" && typeof value !== "number") return;
    for (const part of String(value).split(/[\n,，、]+/g)) {
      const trimmed = part.trim();
      if (trimmed) values.push(trimmed);
    }
  };
  push(filters.city);
  push(filters.cityId);
  push(filters.city_id);
  push(filters.cityText);
  const seen = new Set<string>();
  const out = values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return out.length > 0 ? out : [""];
}

function applyRawSearchParams(url: URL, value: string | undefined): void {
  if (!value) return;
  const trimmedValue = value.trim();
  let normalized = trimmedValue;
  try {
    normalized = new URL(trimmedValue).search;
  } catch {
    normalized = trimmedValue
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("&");
  }
  if (!normalized) return;
  const params = new URLSearchParams(normalized.startsWith("?") ? normalized.slice(1) : normalized);
  for (const [key, paramValue] of params.entries()) {
    const cleanKey = key.trim();
    if (!cleanKey || !/^[A-Za-z0-9_.-]+$/.test(cleanKey)) continue;
    url.searchParams.set(cleanKey, paramValue.trim());
  }
}

function applyZhilianSearchFilters(url: URL, filters: ZhilianSearchFilters): URL {
  const mappedParams: Array<[string, string | undefined]> = [
    ["salary", filterString(filters, "salary", "salaryId", "salary_id", "salaryText")],
    ["workExperience", filterString(filters, "experience", "workExperience", "work_experience", "workingExp", "working_exp", "experienceId", "experience_id")],
    ["education", filterString(filters, "degree", "education", "eduLevel", "edu_level", "degreeId", "degree_id")],
    ["industry", filterString(filters, "industry", "industryId", "industry_id")],
    ["companyType", filterString(filters, "company_type", "companyType", "companyKind", "company_kind")],
    ["companySize", filterString(filters, "company_scale", "companyScale", "companySize", "company_size", "scale")],
    ["jobType", filterString(filters, "job_type", "jobType", "positionType", "position_type")],
    ["publishDate", filterString(filters, "publish_date", "publishDate", "date", "dateRange", "date_range")],
    ["sortType", filterString(filters, "sort_by", "sortBy", "sortType", "sort_type")],
  ];
  for (const [key, value] of mappedParams) {
    if (value) url.searchParams.set(key, value);
  }
  applyRawSearchParams(url, filterString(filters, "raw_params", "rawParams", "query_params", "queryParams"));
  return url;
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

function searchApiUrl(keyword: string, pageIndex: number, pageSize: number, city: string, filters: ZhilianSearchFilters = {}): string {
  const url = new URL("https://fe-api.zhaopin.com/c/i/sou");
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("kw", keyword);
  url.searchParams.set("kt", "3");
  url.searchParams.set("start", String((pageIndex - 1) * pageSize));
  if (city) url.searchParams.set("cityId", city);
  return applyZhilianSearchFilters(url, filters).toString();
}

function mobileSearchUrl(keyword: string, pageIndex: number, city: string, filters: ZhilianSearchFilters = {}): string {
  const url = new URL("https://m.zhaopin.com/searchresult/");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("page", String(pageIndex));
  if (city) url.searchParams.set("city", city);
  return applyZhilianSearchFilters(url, filters).toString();
}

function pcSearchUrl(keyword: string, pageIndex: number, city: string, filters: ZhilianSearchFilters = {}): string {
  const normalizedKeyword = keyword.trim();
  const normalizedCity = city.trim();
  const url = new URL("https://www.zhaopin.com/sou/");
  if (normalizedCity) url.searchParams.set("jl", normalizedCity);
  if (normalizedKeyword) url.searchParams.set("kw", normalizedKeyword);
  url.searchParams.set("p", String(pageIndex));
  url.searchParams.set("kt", "3");
  return applyZhilianSearchFilters(url, filters).toString();
}

export function buildZhilianSearchUrls(
  keyword: string,
  pageIndex: number,
  pageSize: number,
  city: string,
  filters: ZhilianSearchFilters = {},
): { api: string; mobile: string; pc: string } {
  return {
    api: searchApiUrl(keyword, pageIndex, pageSize, city, filters),
    mobile: mobileSearchUrl(keyword, pageIndex, city, filters),
    pc: pcSearchUrl(keyword, pageIndex, city, filters),
  };
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

async function zhilianPageSnapshot(page: Page): Promise<{ url: string; title: string; text: string; securityBlocked: boolean; loginBlocked: boolean }> {
  try {
    const url = page.url();
    const title = await page.title();
    const text = await page.evaluate(() => document.documentElement.innerText.slice(0, 1200)).catch(() => "");
    const html = await page.evaluate(() => document.documentElement.innerHTML.slice(0, 3000)).catch(() => "");
    return {
      url,
      title,
      text,
      securityBlocked: isZhilianSecurityVerificationText(`${title}\n${text}\n${html}`),
      loginBlocked: looksLikeLoginText(`${title}\n${text}\n${html}`),
    };
  } catch {
    return { url: "", title: "", text: "", securityBlocked: false, loginBlocked: false };
  }
}

async function waitForZhilianSearchSettled(page: Page, signal: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 8 && !signal.aborted; attempt += 1) {
    const settled = await page.evaluate(() => {
      const text = document.documentElement.innerText;
      const html = document.documentElement.innerHTML;
      return {
        hasJobLinks: document.querySelectorAll('a[href*="jobdetail/"]').length > 0,
        securityBlocked: /Security Verification|Tencent Cloud EdgeOne|eo-bot-captcha-token|TEOCaptchaWidget/i.test(`${text}\n${html}`),
        hasSearchFilters: /职位类别|公司行业|薪资要求|学历要求|工作经验/.test(text),
      };
    }).catch(() => ({ hasJobLinks: false, securityBlocked: false, hasSearchFilters: false }));
    if (settled.hasJobLinks || settled.securityBlocked) return;
    if (settled.hasSearchFilters && attempt >= 2) return;
    await delayWithJitter(1000, signal, 250).catch(() => undefined);
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
  filters: ZhilianSearchFilters,
): Promise<{ browser: Awaited<ReturnType<typeof launchBrowser>>["browser"]; page: Page }> {
  if (!payload.user_data_dir) {
    throw new Error(`${ZHILIAN_RECONNECT_MESSAGE}（缺少 zhilian-browser-profile）`);
  }
  ctx.emit({
    type: "LOG",
    payload: { level: "info", message: "智联公开请求不可用，改用已保存的智联浏览器资料后台读取 PC 搜索页。" },
  });
  const { browser, page } = await launchBrowser({
    headless: true,
    user_data_dir: payload.user_data_dir,
    stealth: true,
    preserve_on_disconnect: true,
  });
  await blockNavigation(page, { allow_domain_suffixes: ["zhaopin.com", "zhaopin.cn"] });
  await page.goto(pcSearchUrl(keyword, 1, city, filters), { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await waitForZhilianSearchSettled(page, ctx.signal);
  const snapshot = await zhilianPageSnapshot(page);
  if (snapshot.securityBlocked || snapshot.loginBlocked) {
    ctx.emit({
      type: "LOG",
      payload: {
        level: "warn",
        message: `智联 profile 健康检查失败：${snapshot.title || "无标题"} ${snapshot.url || ""} ${snapshot.text.slice(0, 80)}`,
      },
    });
    throw new Error(ZHILIAN_RECONNECT_MESSAGE);
  }
  await emitZhilianBrowserSession(page, ctx);
  return { browser, page };
}

async function fetchSearchEntriesDirect(
  keyword: string,
  pageIndex: number,
  pageSize: number,
  city: string,
  filters: ZhilianSearchFilters,
  signal: AbortSignal,
  options: ZhilianRequestOptions,
): Promise<{ entries: ZhilianJobEntry[]; blocked: boolean; status: number }> {
  const apiResult = responseToPageFetchResult(await fetchZhilianUrl(searchApiUrl(keyword, pageIndex, pageSize, city, filters), signal, {
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
  const htmlResult = responseToPageFetchResult(await fetchZhilianUrl(mobileSearchUrl(keyword, pageIndex, city, filters), signal, {
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
  signal: AbortSignal,
  keyword: string,
  pageIndex: number,
  pageSize: number,
  city: string,
  filters: ZhilianSearchFilters,
): Promise<{ entries: ZhilianJobEntry[]; blocked: boolean; status: number }> {
  await page.goto(pcSearchUrl(keyword, pageIndex, city, filters), { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 8 && !signal.aborted; attempt += 1) {
    if (await page.evaluate(() => document.querySelectorAll('a[href*="jobdetail/"]').length > 0).catch(() => false)) break;
    if (await page.evaluate(() => /Security Verification|Tencent Cloud EdgeOne|eo-bot-captcha-token|TEOCaptchaWidget/i.test(document.documentElement.innerText + document.documentElement.innerHTML)).catch(() => false)) {
      return { entries: [], blocked: true, status: 403 };
    }
    await delayWithJitter(1000, signal, 250).catch(() => undefined);
  }
  const pageResult = await page.evaluate(() => {
    const entries: Array<{
      jobId: string;
      title: string;
      url: string;
      text: string;
      company?: string;
      city?: string;
      salary?: string;
      experience?: string;
      degree?: string;
      welfare?: string[];
    }> = [];
    const seen = new Set<string>();
    const noiseRe = /下载智联APP|和我聊聊吧|收藏|分享|立即沟通|立即投递|职位类别|清空筛选|上一页|下一页|登录|注册/;
    const textOf = (element: Element | null | undefined) => {
      const raw = element instanceof HTMLElement ? element.innerText : element?.textContent ?? "";
      return raw.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    };
    const lineList = (text: string) => text.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, " ").trim()).filter((line) => line && !noiseRe.test(line));
    const pickLine = (lines: string[], predicate: (line: string) => boolean) => lines.find(predicate);
    for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="jobdetail/"]'))) {
      const href = anchor.href;
      const match = href.match(/jobdetail\/([^/?#]+?)(?:\.htm|\.html)?(?:[?#]|$)/i);
      const jobId = match?.[1] ? decodeURIComponent(match[1]).trim() : "";
      const title = textOf(anchor);
      if (!jobId || !title || seen.has(jobId)) continue;
      seen.add(jobId);
      let container: Element | null = anchor;
      for (let depth = 0; depth < 6 && container?.parentElement; depth += 1) {
        const parent: Element = container.parentElement;
        const parentText = textOf(parent);
        const nestedJobLinks = parent.querySelectorAll('a[href*="jobdetail/"]').length;
        if (nestedJobLinks > 1 || parentText.length > 1400) {
          break;
        }
        if (
          parentText.includes(title)
          && /立即沟通|立即投递|经验不限|\d+-\d+年|本科|大专|硕士|博士|元|万|薪/.test(parentText)
        ) {
          container = parent;
          continue;
        }
        if (parentText.length <= 260) container = parent;
      }
      const text = textOf(container);
      const lines = lineList(text).filter((line) => line !== title);
      const salary = pickLine(lines, (line) => /(\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[万千kK]|元|薪|面议)/.test(line));
      const city = pickLine(lines, (line) => /^(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|天津|重庆|西安|长沙|郑州|青岛|厦门|合肥|福州|济南|长春|沈阳|大连|全国|远程)(?:[·\s].*)?$/.test(line));
      const experience = pickLine(lines, (line) => /^(经验不限|在校|应届|1年以下|\d+-\d+年|\d+年以上|\d+年经验)$/.test(line));
      const degree = pickLine(lines, (line) => /^(学历不限|中专|高中|大专|本科|硕士|博士)$/.test(line));
      const company = lines.find((line, index) => index > 0
        && line !== title
        && line !== salary
        && line !== city
        && line !== experience
        && line !== degree
        && !/回复|招聘|上一页|下一页/.test(line)
        && /(公司|有限|科技|集团|银行|软件|信息|网络|智能|股份|中心|研究院|京北方|软通|外企德科)/.test(line));
      const welfare = lines.filter((line) => {
        if ([title, salary, city, experience, degree, company].includes(line)) return false;
        if (/回复|人事|经理|HR|招聘|民营|国企|外企|合资|上市公司|事业单位|人以上|人$|软件\/IT服务|互联网|人工智能|通信|金融|制造/.test(line)) return false;
        return /^[A-Za-z0-9+#.\-/\u4e00-\u9fa5（）()、]{1,24}$/.test(line);
      }).slice(0, 12);
      entries.push({ jobId, title, url: href, text, company, city, salary, experience, degree, welfare });
    }
    return {
      title: document.title,
      text: document.body?.innerText?.slice(0, 3000) ?? "",
      entries,
      url: location.href,
    };
  });
  const combinedPageText = `${pageResult.title}\n${pageResult.text}`;
  if (isZhilianSecurityVerificationText(combinedPageText) || looksLikeLoginText(combinedPageText) && pageResult.entries.length === 0) {
    return { entries: [], blocked: true, status: 403 };
  }
  if (pageResult.entries.length > 0) {
    return {
      entries: pageResult.entries.map((entry) => ({
        jobId: entry.jobId,
        title: entry.title,
        url: normalizeZhilianUrl(entry.url),
        company: entry.company,
        city: entry.city,
        salary: entry.salary,
        experience: entry.experience,
        degree: entry.degree,
        welfare: entry.welfare,
        description: entry.text,
        detailStatus: "missing",
        raw: { source: "pc_search_dom", page_url: pageResult.url, card_text: entry.text },
      })),
      blocked: false,
      status: 200,
    };
  }

  const apiResult = await fetchFromBrowserPage(page, searchApiUrl(keyword, pageIndex, pageSize, city, filters));
  if (apiResult.json) {
    const entries = parseZhilianSearchApi(apiResult.json);
    if (entries.length > 0) return { entries, blocked: false, status: apiResult.status };
  }
  if (isZhilianSecurityVerificationText(apiResult.text) || looksLikeLoginText(apiResult.text) || apiResult.status === 401 || apiResult.status === 403) {
    return { entries: [], blocked: true, status: apiResult.status };
  }
  const htmlResult = await fetchFromBrowserPage(page, mobileSearchUrl(keyword, pageIndex, city, filters));
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
  const cities = normalizeZhilianSearchCities(filters);
  const cookieHeader = buildCookieHeader(payload.session?.cookies, "zhaopin.com");
  const logKeyword = keywords[0] ?? "智联招聘";

  if (keywords.length === 0) {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: "智联未提供搜索关键词，跳过采集。" } });
    return;
  }
  if (!payload.user_data_dir) {
    ctx.emit({ type: "ERROR", payload: { message: `${ZHILIAN_RECONNECT_MESSAGE}（缺少 zhilian-browser-profile）` } });
    return;
  }

  let browserClient: { browser: Awaited<ReturnType<typeof launchBrowser>>["browser"]; page: Page } | null = null;
  let useBrowser = false;
  const ensureBrowserClient = async (keyword: string, city: string) => {
    if (!browserClient) browserClient = await openZhilianBrowserClient(payload, ctx, keyword, city, filters);
    useBrowser = true;
    return browserClient;
  };

  try {
    const collected: ZhilianJobEntry[] = [];
    const seen = new Set<string>();
    for (const keyword of keywords) {
      if (ctx.signal.aborted) break;
      for (const city of cities) {
        if (ctx.signal.aborted) break;
        const cityLabel = city || "默认范围";
        const progressKeyword = city ? `${keyword} / ${city}` : keyword;
        ctx.emit({
          type: "LOG",
          payload: { level: "info", message: `开始智联招聘采集：${keyword}，城市/地区：${cityLabel}，最多 ${maxPages} 页。` },
        });
        for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
          if (ctx.signal.aborted) break;
          ctx.emit({ type: "PROGRESS", payload: { keyword: progressKeyword, current_page: pageIndex } });
          let result: { entries: ZhilianJobEntry[]; blocked: boolean; status: number };
          if (useBrowser) {
            result = await fetchSearchEntriesFromBrowser((await ensureBrowserClient(keyword, city)).page, ctx.signal, keyword, pageIndex, pageSize, city, filters);
          } else {
            result = await fetchSearchEntriesDirect(keyword, pageIndex, pageSize, city, filters, ctx.signal, {
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
                payload: { level: "warn", message: `智联公开请求被登录/安全验证拦截（HTTP ${result.status || 0}），改用已连接的智联 profile 后台采集。` },
              });
            }
            result = await fetchSearchEntriesFromBrowser((await ensureBrowserClient(keyword, city)).page, ctx.signal, keyword, pageIndex, pageSize, city, filters);
          }
          if (result.blocked) {
            if (collected.length === 0) throw new Error(ZHILIAN_RECONNECT_MESSAGE);
            ctx.emit({
              type: "LOG",
              payload: { level: "warn", message: `智联第 ${pageIndex} 页被登录/安全验证拦截，停止后续分页；请到设置页重新连接智联。` },
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
            payload: { level: "info", message: `智联 ${cityLabel} 第 ${pageIndex} 页解析：${fresh.length} 条。` },
          });
          if (fresh.length === 0) break;
          collected.push(...fresh);
          ctx.emit({ type: "PROGRESS", payload: { keyword: progressKeyword, current_page: pageIndex, captured_job_list: collected.length } });
          await delayWithJitter(delayMs, ctx.signal, 300);
        }
      }
    }

    const entries = dedupeEntries(collected);
    if (entries.length === 0) {
      ctx.emit({ type: "ERROR", payload: { message: `智联本轮没有解析到任何岗位；如果设置页未连接智联，请先连接。若已连接，可能是关键词无结果或 ${ZHILIAN_RECONNECT_MESSAGE}` } });
      return;
    }

    let submitted = 0;
    for (const entry of entries) {
      if (ctx.signal.aborted) break;
      let detailedEntry = useBrowser
        ? await fetchDetailFromBrowser((await ensureBrowserClient(logKeyword, cities[0] ?? "")).page, entry)
        : await fetchDetailDirect(entry, ctx.signal, { cookieHeader, referer: entry.url });
      if (detailedEntry.detailStatus === "blocked" && !useBrowser && payload.user_data_dir) {
        detailedEntry = await fetchDetailFromBrowser((await ensureBrowserClient(logKeyword, cities[0] ?? "")).page, entry);
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
