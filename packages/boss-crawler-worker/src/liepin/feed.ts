import type { Page } from "puppeteer";

import { launchBrowser } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import type { EventOut } from "../protocol.js";
import { delayWithJitter } from "../utils/delay.js";
import type { CrawlAutoStartPayload, ModeContext } from "../modes/auto/types.js";

type LiepinSearchFilters = Record<string, unknown>;

export type LiepinJobEntry = {
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
const LIEPIN_RECONNECT_MESSAGE = "猎聘登录/验证状态不可用，请到设置页点击“打开”重新连接猎聘后再采集。";
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

function normalizeLiepinUrl(value: string, baseUrl = "https://www.liepin.com"): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${baseUrl.replace(/\/$/, "")}${trimmed}`;
  return trimmed;
}

export function extractLiepinJobId(input: string): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  const patterns = [
    /\/job\/([^/?#]+?)(?:\.shtml|\.html)?(?:[?#]|$)/i,
    /\/a\/([^/?#]+?)(?:\.shtml|\.html)?(?:[?#]|$)/i,
    /(?:^|[?&#])jobId=([^&#]+)/i,
    /(?:^|[?&#])job_id=([^&#]+)/i,
    /(?:^|[?&#])positionId=([^&#]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1] ? decodeURIComponent(match[1]).trim() : "";
    if (value) return value;
  }
  if (/^[A-Za-z0-9:_-]{6,}$/.test(text)) return text;
  return undefined;
}

function canonicalDetailUrl(jobId: string): string {
  return `https://www.liepin.com/job/${jobId}.shtml`;
}

export function isLiepinSecurityVerificationText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /安全验证|人机验证|滑块验证|访问过于频繁|请完成验证|验证码/u.test(text) ||
    lower.includes("captcha") ||
    lower.includes("acw_sc__v2") ||
    lower.includes("verify you are human")
  );
}

function looksLikeLoginText(text: string): boolean {
  const hasJobEvidence = /\/job\/|职位详情|岗位职责|任职资格|薪资|经验/u.test(text);
  if (hasJobEvidence) return false;
  return /登录\/注册|请登录|passport\.liepin\.com|lpt\.liepin\.com\/user\/login/u.test(text);
}

function lineList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && !/登录\/注册|猎聘APP|收藏|分享|立即沟通|投递|反馈|首页|校园|海归/u.test(line));
}

function pickLine(lines: readonly string[], predicate: (line: string) => boolean): string | undefined {
  return lines.find(predicate);
}

function parseLiepinCardText(text: string, title?: string): Partial<LiepinJobEntry> {
  const lines = lineList(text).filter((line) => line !== title);
  const salary = pickLine(lines, (line) => /(\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[万千kK]|元|薪|面议)/u.test(line));
  const city = pickLine(lines, (line) => /^(北京|上海|广州|深圳|杭州|成都|武汉|南京|苏州|天津|重庆|西安|长沙|郑州|青岛|厦门|合肥|福州|济南|长春|沈阳|大连|全国|远程)(?:[·\s].*)?$/u.test(line));
  const experience = pickLine(lines, (line) => /^(经验不限|应届|1年以下|\d+-\d+年|\d+年以上|\d+年经验)$/u.test(line));
  const degree = pickLine(lines, (line) => /^(学历不限|中专|高中|大专|本科|硕士|博士)$/u.test(line));
  const company = lines.find((line) => {
    if ([salary, city, experience, degree].includes(line)) return false;
    return /(公司|有限|科技|集团|银行|软件|信息|网络|智能|股份|中心|研究院|实验室|事务所)/u.test(line);
  });
  const welfare = lines.filter((line) => {
    if ([salary, city, experience, degree, company].includes(line)) return false;
    if (/猎头|HR|招聘|公司|有限|集团|人以上|融资|上市|民营|外企/u.test(line)) return false;
    return /^[A-Za-z0-9+#.\-/\u4e00-\u9fa5（）()、]{1,24}$/u.test(line);
  }).slice(0, 12);
  return { company, city, salary, experience, degree, welfare: welfare.length > 0 ? welfare : undefined };
}

function extractLiepinCardHtml(html: string, matchStart: number, matchEnd: number): string {
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
    const tailHtml = html.slice(containerStart, Math.min(html.length, matchEnd + 1800));
    const closeRe = new RegExp(`</${tagName}>`, "i");
    const close = closeRe.exec(html.slice(matchEnd));
    if (close) {
      const cardHtml = html.slice(containerStart, matchEnd + close.index + close[0].length);
      if ((cardHtml.match(/\/job\//gi) ?? []).length <= 2 && htmlToText(cardHtml).length < 1800) return cardHtml;
    }
    if ((tailHtml.match(/\/job\//gi) ?? []).length <= 2 && htmlToText(tailHtml).length < 1800) return tailHtml;
  }
  return html.slice(Math.max(0, matchStart - 900), Math.min(html.length, matchEnd + 1100));
}

export function parseLiepinSearchHtml(html: string, baseUrl = "https://www.liepin.com"): LiepinJobEntry[] {
  const out: LiepinJobEntry[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\b[^>]*href=["']([^"']*(?:\/job\/|\/a\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const href = normalizeLiepinUrl(decodeEntities(match[1] ?? ""), baseUrl).split("#")[0] ?? "";
    const jobId = extractLiepinJobId(href);
    const title = htmlToText(match[2] ?? "").replace(/\s+-\s+猎聘.*$/u, "").trim();
    if (!jobId || !title || seen.has(jobId)) continue;
    seen.add(jobId);
    const context = extractLiepinCardHtml(html, match.index, linkRe.lastIndex);
    const contextText = htmlToText(context);
    const cleanedDescription = [title, ...lineList(contextText).filter((line) => line !== title)].join("\n");
    out.push({
      jobId,
      title,
      url: href || canonicalDetailUrl(jobId),
      ...parseLiepinCardText(contextText, title),
      description: cleanedDescription.slice(0, 1200),
      detailStatus: "missing",
      raw: { source: "search_html", context_text: cleanedDescription.slice(0, 2000) },
    });
  }
  return out;
}

export function parseLiepinDetailPage(html: string, fallback: LiepinJobEntry): LiepinJobEntry {
  if (isLiepinSecurityVerificationText(html) || looksLikeLoginText(html)) {
    return { ...fallback, detailStatus: "blocked", detailError: "登录或安全验证拦截" };
  }
  const title = htmlToText(
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
      fallback.title,
  ).replace(/[-_].*猎聘.*$/u, "").trim() || fallback.title;
  const description = htmlToText(
    html.match(/class=["'][^"']*(?:job(?:-|\s*)desc|description|position-?desc|paragraph)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|article)>/i)?.[1] ??
      html.match(/岗位职责[:：]?([\s\S]{80,5000}?)(?:任职资格|职位要求|公司介绍|工作地址|<\/body>)/i)?.[1] ??
      "",
  );
  const company = fallback.company || htmlToText(
    html.match(/class=["'][^"']*(?:company|comp|corp|brand)[^"']*["'][^>]*>([\s\S]{0,220}?)</i)?.[1] ?? "",
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

function filterString(filters: LiepinSearchFilters, ...keys: string[]): string | undefined {
  return firstString(...keys.map((key) => filters[key]));
}

export function normalizeLiepinSearchCities(filters: LiepinSearchFilters): string[] {
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
  let normalized = value.trim();
  try {
    normalized = new URL(normalized).search;
  } catch {
    normalized = normalized
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

function applyLiepinSearchFilters(url: URL, filters: LiepinSearchFilters): URL {
  const mappedParams: Array<[string, string | undefined]> = [
    ["salary", filterString(filters, "salary", "salaryId", "salary_id", "salaryText")],
    ["workYear", filterString(filters, "experience", "workYear", "work_year", "experienceId", "experience_id")],
    ["eduLevel", filterString(filters, "degree", "education", "eduLevel", "edu_level", "degreeId", "degree_id")],
    ["industry", filterString(filters, "industry", "industryId", "industry_id")],
    ["compKind", filterString(filters, "company_type", "companyType", "companyKind", "company_kind")],
    ["compScale", filterString(filters, "company_scale", "companyScale", "companySize", "scale")],
    ["jobKind", filterString(filters, "job_type", "jobType", "positionType", "position_type")],
    ["pubTime", filterString(filters, "publish_date", "publishDate", "date", "dateRange", "date_range")],
    ["sortFlag", filterString(filters, "sort_by", "sortBy", "sortType", "sort_type")],
  ];
  for (const [key, value] of mappedParams) {
    if (value) url.searchParams.set(key, value);
  }
  applyRawSearchParams(url, filterString(filters, "raw_params", "rawParams", "query_params", "queryParams"));
  return url;
}

export function buildLiepinSearchUrl(
  keyword: string,
  pageIndex: number,
  city: string,
  filters: LiepinSearchFilters = {},
): string {
  const url = new URL("https://www.liepin.com/zhaopin/");
  url.searchParams.set("key", keyword);
  url.searchParams.set("currentPage", String(Math.max(0, pageIndex - 1)));
  if (city) url.searchParams.set("city", city);
  return applyLiepinSearchFilters(url, filters).toString();
}

async function fetchSearchEntriesFromBrowser(
  page: Page,
  signal: AbortSignal,
  keyword: string,
  pageIndex: number,
  city: string,
  filters: LiepinSearchFilters,
): Promise<{ entries: LiepinJobEntry[]; blocked: boolean; status: number }> {
  const url = buildLiepinSearchUrl(keyword, pageIndex, city, filters);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  for (let attempt = 0; attempt < 8 && !signal.aborted; attempt += 1) {
    const state = await page.evaluate(() => {
      const text = document.documentElement.innerText;
      const html = document.documentElement.innerHTML;
      return {
        hasJobLinks: document.querySelectorAll('a[href*="/job/"], a[href*="/a/"]').length > 0,
        blocked: /安全验证|人机验证|滑块验证|访问过于频繁|请完成验证|captcha|acw_sc__v2/i.test(`${text}\n${html}`),
      };
    }).catch(() => ({ hasJobLinks: false, blocked: false }));
    if (state.hasJobLinks || state.blocked) break;
    await delayWithJitter(1000, signal, 250).catch(() => undefined);
  }
  const html = await page.evaluate(() => document.documentElement.innerHTML).catch(() => "");
  const text = await page.evaluate(() => `${document.title}\n${document.documentElement.innerText}`).catch(() => "");
  if (isLiepinSecurityVerificationText(`${text}\n${html}`) || looksLikeLoginText(`${text}\n${html}`)) {
    return { entries: [], blocked: true, status: 403 };
  }
  const entries = parseLiepinSearchHtml(html).map((entry) => ({
    ...entry,
    raw: { ...(entry.raw && typeof entry.raw === "object" ? entry.raw as Record<string, unknown> : {}), page_url: page.url() },
  }));
  return { entries, blocked: false, status: 200 };
}

async function fetchDetailFromBrowser(page: Page, entry: LiepinJobEntry): Promise<LiepinJobEntry> {
  const result = await page.evaluate(async (requestUrl) => {
    try {
      const res = await fetch(requestUrl, {
        credentials: "include",
        headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      });
      return { status: res.status, text: await res.text() };
    } catch (err) {
      return { status: 0, text: err instanceof Error ? err.message : String(err) };
    }
  }, entry.url);
  if (result.status === 401 || result.status === 403 || isLiepinSecurityVerificationText(result.text) || looksLikeLoginText(result.text)) {
    return { ...entry, detailStatus: "blocked", detailError: `HTTP ${result.status || 0}` };
  }
  return parseLiepinDetailPage(result.text, entry);
}

function dedupeEntries(entries: readonly LiepinJobEntry[]): LiepinJobEntry[] {
  const out: LiepinJobEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.jobId)) continue;
    seen.add(entry.jobId);
    out.push(entry);
  }
  return out;
}

function normalizePositiveInteger(fallback: number, ...values: unknown[]): number {
  for (const value of values) {
    const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function buildJdText(entry: LiepinJobEntry): string {
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

export function buildLiepinNormalizedPayload(
  entry: LiepinJobEntry,
  options: { keyword?: string; filters?: unknown } = {},
): Extract<EventOut, { type: "JOB_NORMALIZED_CAPTURED" }>["payload"] {
  return {
    encrypt_job_id: `liepin:${entry.jobId}`,
    source_platform: "liepin",
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

export async function runLiepinMode(payload: CrawlAutoStartPayload, ctx: ModeContext): Promise<void> {
  const task = payload.task ?? {};
  const filters = task.filters && typeof task.filters === "object" ? task.filters as Record<string, unknown> : {};
  const limits = task.limits && typeof task.limits === "object" ? task.limits as Record<string, unknown> : {};
  const keywords = Array.isArray(task.keywords) ? task.keywords.map((item) => item.trim()).filter(Boolean) : [];
  const maxPages = normalizePositiveInteger(DEFAULT_MAX_PAGES, limits.maxPages, limits.max_pages);
  const delayMs = normalizePositiveInteger(0, limits.delayMs, limits.delay_ms);
  const cities = normalizeLiepinSearchCities(filters);
  const logKeyword = keywords[0] ?? "猎聘";

  if (keywords.length === 0) {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: "猎聘未提供搜索关键词，跳过采集。" } });
    return;
  }
  if (!payload.user_data_dir) {
    ctx.emit({ type: "ERROR", payload: { message: `${LIEPIN_RECONNECT_MESSAGE}（缺少 liepin-browser-profile）` } });
    return;
  }

  const { browser, page } = await launchBrowser({
    headless: true,
    user_data_dir: payload.user_data_dir,
    stealth: true,
    preserve_on_disconnect: true,
  });
  try {
    await blockNavigation(page, { allow_domain_suffixes: ["liepin.com", "liepin.cn"] });
    const collected: LiepinJobEntry[] = [];
    const seen = new Set<string>();
    for (const keyword of keywords) {
      if (ctx.signal.aborted) break;
      for (const city of cities) {
        if (ctx.signal.aborted) break;
        const cityLabel = city || "默认范围";
        const progressKeyword = city ? `${keyword} / ${city}` : keyword;
        ctx.emit({
          type: "LOG",
          payload: { level: "info", message: `开始猎聘采集：${keyword}，城市/地区：${cityLabel}，最多 ${maxPages} 页。` },
        });
        for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
          if (ctx.signal.aborted) break;
          ctx.emit({ type: "PROGRESS", payload: { keyword: progressKeyword, current_page: pageIndex } });
          const result = await fetchSearchEntriesFromBrowser(page, ctx.signal, keyword, pageIndex, city, filters);
          if (result.blocked) {
            if (collected.length === 0) throw new Error(LIEPIN_RECONNECT_MESSAGE);
            ctx.emit({
              type: "LOG",
              payload: { level: "warn", message: `猎聘第 ${pageIndex} 页被登录/安全验证拦截，停止后续分页；请到设置页重新连接猎聘。` },
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
            payload: { level: "info", message: `猎聘 ${cityLabel} 第 ${pageIndex} 页解析：${fresh.length} 条。` },
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
      ctx.emit({ type: "ERROR", payload: { message: `猎聘本轮没有解析到任何岗位；如果设置页未连接猎聘，请先连接。若已连接，可能是关键词无结果或 ${LIEPIN_RECONNECT_MESSAGE}` } });
      return;
    }

    let submitted = 0;
    for (const entry of entries) {
      if (ctx.signal.aborted) break;
      const detailedEntry = await fetchDetailFromBrowser(page, entry);
      if (detailedEntry.detailStatus !== "ok") {
        ctx.emit({
          type: "LOG",
          payload: { level: "warn", message: `猎聘详情未完整抓取，按列表级信息入库：${detailedEntry.title}（${detailedEntry.detailStatus ?? "missing"}）` },
        });
      }
      submitted += 1;
      ctx.emit({
        type: "JOB_NORMALIZED_CAPTURED",
        payload: buildLiepinNormalizedPayload(detailedEntry, { keyword: logKeyword, filters }),
      });
      ctx.emit({ type: "PROGRESS", payload: { keyword: logKeyword, captured_job_detail: submitted } });
      await delayWithJitter(delayMs, ctx.signal, 300);
    }

    ctx.emit({
      type: "LOG",
      payload: { level: "info", message: `猎聘采集完成：提交 ${submitted} 条待入库岗位；实际新增数以采集记录为准。` },
    });
  } finally {
    await browser.disconnect().catch(() => undefined);
  }
}
