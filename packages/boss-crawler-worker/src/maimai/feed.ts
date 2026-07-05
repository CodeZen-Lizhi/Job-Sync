import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";

import { ProxyAgent } from "proxy-agent";

import type { EventOut } from "../protocol.js";
import { htmlToText as sharedHtmlToText } from "../feed/html.js";
import { normalizePositiveInteger } from "../feed/numbers.js";
import type { ModeContext } from "../modes/auto/types.js";

export type MaimaiArticle = {
  articleId: string;
  title: string;
  url: string;
  author?: string;
  company?: string;
  published?: string;
  updated?: string;
  contentHtml: string;
  contentText: string;
};

type MaimaiCollectedArticle = MaimaiArticle & {
  sourceInputUrl?: string;
  sourcePage?: number;
  detailStatus: "ok" | "missing" | "blocked";
};

type MaimaiClassification = {
  isJobPosting: boolean;
  hasHiringSignal: boolean;
  matched: string[];
  strongMatches: string[];
  supportingMatches: string[];
  keywordMatches: string[];
};

type MaimaiFeedSortBy = "published_desc" | "updated_desc";

type FeedHttpResponse = {
  status: number;
  body: string;
  finalUrl: string;
  redirected: boolean;
};

const DEFAULT_MAX_PAGES = 3;
const FEED_REQUEST_TIMEOUT_MS = 30_000;
const MAX_FEED_REDIRECTS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const STRONG_HIRING_TERMS = [
  "招聘",
  "招人",
  "内推",
  "急招",
  "hc",
  "社招",
  "校招",
  "实习",
  "hiring",
  "招募",
];
const SUPPORTING_HIRING_TERMS = [
  "岗位",
  "职位",
  "jd",
  "薪资",
  "简历",
  "投递",
  "邮箱",
  "base",
  "全职",
  "远程",
  "岗位职责",
  "任职要求",
  "面试",
  "offer",
];
const feedProxyAgent = new ProxyAgent();
const MAIMAI_FEED_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 Job-Sync/0.1";

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

export function htmlToText(html: string): string {
  return sharedHtmlToText(html, { stripScriptStyle: true, sectionBreaks: true });
}

function attrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1].trim()) : "";
}

function metaContent(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<meta\\b(?=[^>]*(?:name|property)=["']${escaped}["'])[^>]*>`, "i");
  const tag = html.match(re)?.[0] ?? "";
  return attrValue(tag, "content");
}

function firstTagText(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? htmlToText(match[1]) : "";
}

function cleanTitle(value: string): string {
  return decodeEntities(value)
    .replace(/\s*[-_｜|]\s*脉脉.*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(text: string, terms: readonly string[]): string[] {
  const haystack = normalizeText(text);
  return terms.filter((term) => haystack.includes(normalizeText(term)));
}

function isMaimaiHost(hostname: string): boolean {
  return hostname === "maimai.cn" || hostname.endsWith(".maimai.cn");
}

function normalizeMaimaiUrl(rawUrl: string, baseUrl = "https://maimai.cn"): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed, baseUrl);
    if (!isMaimaiHost(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function canonicalHash(url: URL): string {
  const canonical = new URL(url.toString());
  canonical.hash = "";
  canonical.searchParams.sort();
  return createHash("sha1").update(canonical.toString()).digest("hex").slice(0, 16);
}

export function extractMaimaiArticleId(rawUrl: string): string {
  const normalized = normalizeMaimaiUrl(rawUrl);
  if (!normalized) return "";
  const url = new URL(normalized);
  for (const key of ["fid", "efid", "id", "article_id", "articleId"]) {
    const value = url.searchParams.get(key)?.trim();
    if (value) return value;
  }
  const pathId = url.pathname.match(/\/article\/detail\/([^/?#]+)/i)?.[1];
  if (pathId) return decodeURIComponent(pathId);
  if (url.pathname.includes("/article/detail")) return `url:${canonicalHash(url)}`;
  return "";
}

function isArticleDetailUrl(rawUrl: string): boolean {
  const normalized = normalizeMaimaiUrl(rawUrl);
  if (!normalized) return false;
  const url = new URL(normalized);
  return url.pathname.includes("/article/detail") && Boolean(extractMaimaiArticleId(normalized));
}

export function splitMaimaiUrls(value: unknown): string[] {
  const raw = typeof value === "string"
    ? value.split(/[\n,，、]+/g)
    : Array.isArray(value)
      ? value
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const normalized = typeof item === "string" ? normalizeMaimaiUrl(item) : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function parseMaimaiArticleLinks(html: string, baseUrl = "https://maimai.cn"): string[] {
  const links = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html))) {
    const normalized = normalizeMaimaiUrl(decodeEntities(match[1]), baseUrl);
    if (normalized && isArticleDetailUrl(normalized)) links.add(normalized);
  }
  const rawDetailRe = /(?:https?:)?\/\/(?:www\.)?maimai\.cn\/article\/detail\?[^"'<>\\\s]+/gi;
  while ((match = rawDetailRe.exec(html))) {
    const normalized = normalizeMaimaiUrl(decodeEntities(match[0]), baseUrl);
    if (normalized && isArticleDetailUrl(normalized)) links.add(normalized);
  }
  return [...links];
}

function extractJsonLdValues(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html))) {
    const attrs = match[1] ?? "";
    if (attrValue(attrs, "type").toLowerCase() !== "application/ld+json") continue;
    try {
      const parsed = JSON.parse((match[2] ?? "").trim()) as unknown;
      collectJsonLdValues(parsed, out);
    } catch {
      // Ignore malformed embedded metadata and keep visible HTML parsing.
    }
  }
  return out;
}

function collectJsonLdValues(value: unknown, out: Record<string, string>): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdValues(item, out);
    return;
  }
  if (typeof value !== "object") return;
  const raw = value as Record<string, unknown>;
  const mappings: Array<[string, string]> = [
    ["headline", "title"],
    ["name", "title"],
    ["datePublished", "published"],
    ["dateModified", "updated"],
    ["articleBody", "body"],
  ];
  for (const [source, target] of mappings) {
    if (!out[target] && typeof raw[source] === "string" && raw[source].trim()) {
      out[target] = raw[source].trim();
    }
  }
  const author = raw.author;
  if (!out.author && typeof author === "object" && author && typeof (author as Record<string, unknown>).name === "string") {
    out.author = String((author as Record<string, unknown>).name).trim();
  } else if (!out.author && typeof author === "string") {
    out.author = author.trim();
  }
  for (const child of Object.values(raw)) collectJsonLdValues(child, out);
}

function extractMainContentHtml(html: string): string {
  const candidates = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:article|content|detail|main)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const re of candidates) {
    const match = html.match(re);
    if (match?.[1] && htmlToText(match[1]).length >= 20) return match[1];
  }
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return body;
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, "$1T$2");
}

function isBlockedPage(html: string): boolean {
  const text = htmlToText(html).toLowerCase();
  return [
    "登录后查看",
    "请登录",
    "安全验证",
    "访问受限",
    "验证码",
    "verify",
    "captcha",
  ].some((term) => text.includes(term.toLowerCase()));
}

function isBlockedStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 418 || status === 429;
}

function isBlockedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.toLowerCase();
    return path.includes("/platform/login") || path.includes("/login") || path.includes("/verify") || path.includes("/captcha");
  } catch {
    return false;
  }
}

function isBlockedResponse(response: FeedHttpResponse): boolean {
  return isBlockedStatus(response.status) || isBlockedUrl(response.finalUrl) || isBlockedPage(response.body);
}

export function parseMaimaiArticlePage(html: string, pageUrl: string): MaimaiArticle | null {
  const normalizedUrl = normalizeMaimaiUrl(pageUrl);
  const articleId = extractMaimaiArticleId(normalizedUrl);
  if (!normalizedUrl || !articleId || isBlockedPage(html)) return null;
  const jsonLd = extractJsonLdValues(html);
  const title = cleanTitle(
    metaContent(html, "og:title")
      || metaContent(html, "twitter:title")
      || jsonLd.title
      || firstTagText(html, "h1")
      || firstTagText(html, "title"),
  );
  const contentHtml = extractMainContentHtml(html);
  const contentText = htmlToText(jsonLd.body || contentHtml);
  if (!title || !contentText) return null;
  const author = metaContent(html, "author") || jsonLd.author || undefined;
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  return {
    articleId,
    title,
    url: normalizedUrl,
    author,
    published: normalizeTimestamp(metaContent(html, "article:published_time") || jsonLd.published),
    updated: normalizeTimestamp(metaContent(html, "article:modified_time") || jsonLd.updated),
    contentHtml,
    contentText: [description, contentText].filter(Boolean).join("\n\n").trim(),
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function pickNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRecentDays(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = pickNumber(value);
    if (parsed !== null && parsed > 0) return Math.floor(parsed);
  }
  return null;
}

function normalizeSortBy(value: unknown): MaimaiFeedSortBy {
  return value === "updated_desc" || value === "updated" ? "updated_desc" : "published_desc";
}

function timestampOf(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function articleTime(article: MaimaiArticle, sortBy: MaimaiFeedSortBy): number {
  return sortBy === "updated_desc" ? timestampOf(article.updated) : timestampOf(article.published);
}

function fallbackArticleTime(article: MaimaiArticle, sortBy: MaimaiFeedSortBy): number {
  return sortBy === "updated_desc" ? timestampOf(article.published) : timestampOf(article.updated);
}

function sortMaimaiArticles<T extends MaimaiArticle>(articles: readonly T[], sortBy: MaimaiFeedSortBy): T[] {
  return [...articles].sort((left, right) => {
    const primary = articleTime(right, sortBy) - articleTime(left, sortBy);
    if (primary !== 0) return primary;
    const secondary = fallbackArticleTime(right, sortBy) - fallbackArticleTime(left, sortBy);
    if (secondary !== 0) return secondary;
    return right.articleId.localeCompare(left.articleId);
  });
}

function filterRecentMaimaiArticles<T extends MaimaiArticle>(
  articles: readonly T[],
  sortBy: MaimaiFeedSortBy,
  recentDays: number | null,
  nowMs = Date.now(),
): T[] {
  if (recentDays === null) return [...articles];
  const cutoffMs = nowMs - recentDays * DAY_MS;
  return articles.filter((article) => articleTime(article, sortBy) >= cutoffMs);
}

function buildListPageUrl(listUrl: string, page: number): string {
  const url = new URL(listUrl);
  if (page > 1) {
    url.searchParams.set("page", String(page));
    url.searchParams.set("p", String(page));
  }
  return url.toString();
}

function dedupeMaimaiArticles<T extends MaimaiCollectedArticle>(articles: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const article of articles) {
    const existing = byId.get(article.articleId);
    if (!existing || article.contentText.length > existing.contentText.length) {
      byId.set(article.articleId, article);
    }
  }
  return [...byId.values()];
}

export function classifyMaimaiArticle(article: MaimaiArticle, keywords: readonly string[] = []): MaimaiClassification {
  const text = `${article.title}\n${article.author ?? ""}\n${article.company ?? ""}\n${article.contentText}`;
  const strongMatches = includesAny(text, STRONG_HIRING_TERMS);
  const supportingMatches = includesAny(text, SUPPORTING_HIRING_TERMS);
  const keywordMatches = includesAny(text, keywords);
  const hasHiringSignal = strongMatches.length > 0 || supportingMatches.length >= 2;
  return {
    isJobPosting: hasHiringSignal,
    hasHiringSignal,
    matched: [...strongMatches, ...supportingMatches, ...keywordMatches],
    strongMatches,
    supportingMatches,
    keywordMatches,
  };
}

function inferPositionName(title: string): string {
  return title
    .replace(/^\s*[\[【][^\]】]+[\]】]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim() || title;
}

function buildJdText(article: MaimaiArticle): string {
  return [
    article.title,
    article.author ? `作者：${article.author}` : "",
    article.published ? `发布时间：${article.published}` : "发布时间：未识别",
    article.contentText,
    "缺失字段说明：脉脉公开文章不一定提供标准公司、城市、薪资、经验、学历字段，需打开原文确认。",
  ].filter(Boolean).join("\n\n").trim();
}

export function buildMaimaiNormalizedPayload(
  article: MaimaiCollectedArticle,
  classification: MaimaiClassification,
  keyword: string | undefined,
  filters: unknown,
): Extract<EventOut, { type: "JOB_NORMALIZED_CAPTURED" }>["payload"] {
  return {
    encrypt_job_id: `maimai:article:${article.articleId}`,
    source_platform: "maimai",
    source_url: article.url,
    dedup_key: `article:${article.articleId}`,
    position_name: inferPositionName(article.title),
    boss_name: article.author,
    brand_name: article.company,
    jd_text: buildJdText(article),
    raw_payload: {
      ...article,
      detail_status: article.detailStatus,
      classification,
    },
    keyword,
    filters,
  };
}

function formatFeedRequestError(err: unknown, label = "脉脉页面"): Error {
  if (err instanceof Error) return new Error(`${label} 请求失败：${err.message}`);
  return new Error(`${label} 请求失败：${String(err)}`);
}

function resolveRedirectUrl(currentUrl: URL, location: string | string[] | undefined): URL | null {
  const rawLocation = Array.isArray(location) ? location[0] : location;
  if (!rawLocation?.trim()) return null;
  try {
    const nextUrl = new URL(rawLocation, currentUrl);
    if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") return null;
    if (isMaimaiHost(currentUrl.hostname) && !isMaimaiHost(nextUrl.hostname)) return null;
    if (!isMaimaiHost(currentUrl.hostname) && currentUrl.hostname !== nextUrl.hostname) return null;
    return nextUrl;
  } catch {
    return null;
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchMaimaiPage(pageUrl: string, signal: AbortSignal, label = "脉脉页面", redirectCount = 0): Promise<FeedHttpResponse> {
  const url = new URL(pageUrl);
  const client = url.protocol === "https:" ? https : http;
  return await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(`${label} 请求已取消`));
      return;
    }
    const req = client.request(
      url,
      {
        agent: feedProxyAgent,
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "user-agent": MAIMAI_FEED_USER_AGENT,
        },
        timeout: FEED_REQUEST_TIMEOUT_MS,
      },
      (res) => {
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          cleanup();
          const status = res.statusCode ?? 0;
          const redirectUrl = resolveRedirectUrl(url, res.headers.location);
          if (isRedirectStatus(status) && redirectUrl && redirectCount < MAX_FEED_REDIRECTS) {
            fetchMaimaiPage(redirectUrl.toString(), signal, label, redirectCount + 1).then(resolve, reject);
            return;
          }
          resolve({ status, body, finalUrl: url.toString(), redirected: redirectCount > 0 });
        });
      },
    );
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      req.removeListener("timeout", onTimeout);
      req.removeListener("error", onError);
    };
    const onAbort = (): void => {
      cleanup();
      req.destroy(new Error(`${label} 请求已取消`));
      reject(new Error(`${label} 请求已取消`));
    };
    const onTimeout = (): void => {
      cleanup();
      req.destroy(new Error(`${label} 请求超时：${FEED_REQUEST_TIMEOUT_MS}ms`));
      reject(new Error(`${label} 请求超时：${FEED_REQUEST_TIMEOUT_MS}ms`));
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(formatFeedRequestError(err, label));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", onTimeout);
    req.on("error", onError);
    req.end();
  });
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("脉脉采集已取消"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchArticle(articleUrl: string, sourceInputUrl: string, sourcePage: number | undefined, ctx: ModeContext): Promise<MaimaiCollectedArticle | null> {
  const response = await fetchMaimaiPage(articleUrl, ctx.signal, "脉脉文章详情");
  if (isBlockedResponse(response)) {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: `脉脉文章详情被登录或验证拦截：${articleUrl}` } });
    return null;
  }
  if (response.status < 200 || response.status >= 300) {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: `脉脉文章详情请求异常：HTTP ${response.status} ${articleUrl}` } });
    return null;
  }
  const article = parseMaimaiArticlePage(response.body, articleUrl);
  if (!article) {
    ctx.emit({ type: "LOG", payload: { level: "info", message: `跳过脉脉文章：未解析到稳定标题或正文 ${articleUrl}` } });
    return null;
  }
  return { ...article, sourceInputUrl, sourcePage, detailStatus: "ok" };
}

async function collectArticleUrlsFromList(listUrl: string, maxPages: number, delayMs: number, ctx: ModeContext): Promise<string[]> {
  const urls = new Set<string>();
  for (let page = 1; page <= maxPages; page += 1) {
    if (ctx.signal.aborted) break;
    const pageUrl = buildListPageUrl(listUrl, page);
    ctx.emit({ type: "PROGRESS", payload: { keyword: "脉脉", current_page: page, captured_job_list: urls.size, captured_job_detail: 0, filtered_job: 0 } });
    const response = await fetchMaimaiPage(pageUrl, ctx.signal, `脉脉第 ${page} 页`);
    if (isBlockedResponse(response)) {
      ctx.emit({ type: "LOG", payload: { level: "warn", message: `脉脉第 ${page} 页被登录或验证拦截。` } });
      break;
    }
    if (response.status < 200 || response.status >= 300) {
      ctx.emit({ type: "LOG", payload: { level: "warn", message: `脉脉第 ${page} 页请求异常：HTTP ${response.status}` } });
      break;
    }
    const pageLinks = parseMaimaiArticleLinks(response.body, pageUrl);
    ctx.emit({ type: "LOG", payload: { level: "info", message: `脉脉第 ${page} 页解析到 ${pageLinks.length} 个文章链接。` } });
    if (pageLinks.length === 0) break;
    for (const link of pageLinks) urls.add(link);
    await sleep(delayMs, ctx.signal);
  }
  return [...urls];
}

function buildSkipReason(_article: MaimaiArticle, classification: MaimaiClassification): string {
  if (!classification.hasHiringSignal) return "缺少招聘或内推信号词";
  return "未满足脉脉招聘文章判定";
}

export async function runMaimaiMode(payload: any, ctx: ModeContext): Promise<void> {
  const task = payload.task ?? {};
  const limits = task.limits ?? {};
  const filters = task.filters ?? {};
  const keywords = asStringList(task.keywords);
  const feedUrls = splitMaimaiUrls(filters.feed_urls ?? filters.article_urls ?? filters.feedUrl ?? filters.feed_url);
  const maxPages = normalizePositiveInteger(DEFAULT_MAX_PAGES, limits.maxPages, limits.max_pages);
  const delayMs = normalizePositiveInteger(0, limits.delayMs, limits.delay_ms);
  const sortBy = normalizeSortBy(filters.sort_by ?? filters.sortBy);
  const recentDays = normalizeRecentDays(filters.recent_days, filters.recentDays);

  if (feedUrls.length === 0) {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: "脉脉未提供任何公开文章或搜索 URL，跳过采集。" } });
    return;
  }

  const articleUrls = new Set<string>();
  const articles: MaimaiCollectedArticle[] = [];
  for (const inputUrl of feedUrls) {
    if (ctx.signal.aborted) break;
    ctx.emit({ type: "LOG", payload: { level: "info", message: `开始脉脉公开内容采集：${inputUrl}` } });
    if (isArticleDetailUrl(inputUrl)) {
      const article = await fetchArticle(inputUrl, inputUrl, undefined, ctx);
      if (article) articles.push(article);
      await sleep(delayMs, ctx.signal);
      continue;
    }
    const links = await collectArticleUrlsFromList(inputUrl, maxPages, delayMs, ctx);
    for (const link of links) articleUrls.add(link);
  }

  for (const articleUrl of articleUrls) {
    if (ctx.signal.aborted) break;
    const article = await fetchArticle(articleUrl, articleUrl, undefined, ctx);
    if (article) articles.push(article);
    await sleep(delayMs, ctx.signal);
  }

  const uniqueArticles = dedupeMaimaiArticles(articles);
  const sortedArticles = sortMaimaiArticles(uniqueArticles, sortBy);
  const candidates = filterRecentMaimaiArticles(sortedArticles, sortBy, recentDays);
  const parsedCount = uniqueArticles.length;
  if (parsedCount === 0) {
    ctx.emit({
      type: "ERROR",
      payload: { message: "脉脉本轮没有解析到任何公开文章；URL 可能需要登录、验证，或页面没有稳定文章详情链接。" },
    });
    return;
  }

  ctx.emit({
    type: "LOG",
    payload: {
      level: "info",
      message: `脉脉解析完成：源 ${parsedCount} 篇，候选 ${candidates.length} 篇${recentDays === null ? "" : `，最近 ${recentDays} 天`}。`,
    },
  });

  let captured = 0;
  let filtered = 0;
  for (const article of candidates) {
    if (ctx.signal.aborted) break;
    const classification = classifyMaimaiArticle(article, keywords);
    if (!classification.isJobPosting) {
      filtered += 1;
      const reason = buildSkipReason(article, classification);
      ctx.emit({
        type: "JOB_FILTERED",
        payload: {
          encrypt_job_id: `maimai:article:${article.articleId}`,
          keyword: keywords[0] ?? "脉脉",
          filters,
          reason: {
            eligible: false,
            blocked_by: [
              {
                rule_type: "maimai_feed_classification",
                field: "positive_terms",
                value: "",
                reason,
              },
            ],
            matched_preferences: classification.matched,
            missing_preferences: [],
          },
          raw: article,
        },
      });
      ctx.emit({ type: "LOG", payload: { level: "info", message: `跳过脉脉：${article.title}（${reason}）` } });
      continue;
    }
    captured += 1;
    ctx.emit({
      type: "JOB_NORMALIZED_CAPTURED",
      payload: buildMaimaiNormalizedPayload(article, classification, keywords[0], filters),
    });
    ctx.emit({
      type: "PROGRESS",
      payload: { keyword: keywords[0] ?? "脉脉", captured_job_detail: captured, filtered_job: filtered },
    });
  }

  ctx.emit({ type: "LOG", payload: { level: "info", message: `脉脉采集完成：入库候选 ${captured} 条，跳过 ${filtered} 条。` } });
}
