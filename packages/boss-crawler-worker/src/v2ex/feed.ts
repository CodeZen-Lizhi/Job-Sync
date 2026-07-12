import * as http from "node:http";
import * as https from "node:https";

import { ProxyAgent } from "proxy-agent";

import { htmlToText as sharedHtmlToText } from "../feed/html.js";
import { classifyJobPostingContent, type JobPostingClassification } from "../feed/jobPostingClassifier.js";
import { normalizePositiveInteger } from "../feed/numbers.js";
import type { ModeContext } from "../modes/auto/types.js";

export type V2exFeedEntry = {
  title: string;
  url: string;
  topicId: string;
  published?: string;
  updated?: string;
  author?: string;
  contentHtml: string;
  contentText: string;
};

type V2exCollectedEntry = V2exFeedEntry & {
  sourcePage?: number;
  sourceInputUrl?: string;
  sourceKind?: string;
};

type Classification = JobPostingClassification;

type V2exFeedSortBy = "published_desc" | "updated_desc";

const DEFAULT_MAX_PAGES = 5;
const FEED_REQUEST_TIMEOUT_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STRONG_HIRING_TERMS = [
  "招聘",
  "招人",
  "内推",
  "实习",
  "远程",
  "全职",
  "兼职",
  "急招",
  "hc",
  "hiring",
];
const SUPPORTING_HIRING_TERMS = [
  "岗位",
  "职位",
  "jd",
  "薪资",
  "简历",
  "投递",
  "base",
  "邮箱",
  "微信",
  "wechat",
  "remote",
  "offer",
];
const feedProxyAgent = new ProxyAgent();

type FeedHttpResponse = {
  status: number;
  body: string;
};

type V2exRequestOptions = {
  label?: string;
  retries?: number;
  retryDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
};

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

function stripCdata(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("<![CDATA[") && trimmed.endsWith("]]>")) {
    return trimmed.slice("<![CDATA[".length, -"]]>".length);
  }
  return trimmed;
}

function tagValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeEntities(stripCdata(match[1]).trim()) : "";
}

function linkHref(xml: string): string {
  const match = xml.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i)
    ?? xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return match ? decodeEntities(match[1].trim()) : "";
}

function attrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1].trim()) : "";
}

export function htmlToText(html: string): string {
  return sharedHtmlToText(html, { stripCdata: true });
}

function normalizeTopicUrl(url: string, topicId: string): string {
  const clean = url.split("#")[0]?.trim() || "";
  return clean || `https://www.v2ex.com/t/${topicId}`;
}

function extractTopicId(id: string, url: string): string {
  const fromUrl = url.match(/\/t\/(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  const fromId = id.match(/\/t\/(\d+)/)?.[1];
  return fromId ?? id.trim();
}

function normalizeV2exUrl(url: string, baseUrl = "https://www.v2ex.com"): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${baseUrl.replace(/\/$/, "")}${url}`;
  return url;
}

function normalizeV2exTimestamp(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, "$1T$2");
}

type StructuredTopicMetadata = {
  title?: string;
  url?: string;
  topicId: string;
  published?: string;
  author?: string;
};

function extractJsonLdScripts(html: string): string[] {
  const scripts: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html))) {
    const attrs = match[1] ?? "";
    const type = attrValue(attrs, "type").toLowerCase();
    if (type === "application/ld+json") {
      scripts.push((match[2] ?? "").trim());
    }
  }
  return scripts;
}

function structuredAuthorName(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (!value || typeof value !== "object") return undefined;
  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

function collectStructuredTopicMetadata(
  value: unknown,
  out: StructuredTopicMetadata[],
  baseUrl: string,
): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredTopicMetadata(item, out, baseUrl);
    return;
  }
  if (typeof value !== "object") return;

  const raw = value as Record<string, unknown>;
  const rawUrl = typeof raw.url === "string" ? raw.url : "";
  const url = rawUrl ? normalizeV2exUrl(rawUrl, baseUrl) : "";
  const topicId = url.match(/\/t\/(\d+)/)?.[1];
  if (topicId) {
    const title = typeof raw.headline === "string" ? raw.headline : typeof raw.name === "string" ? raw.name : undefined;
    const published = typeof raw.datePublished === "string" ? normalizeV2exTimestamp(raw.datePublished) : undefined;
    const author = structuredAuthorName(raw.author);
    if (title || published || author) {
      out.push({ title, url, topicId, published, author });
    }
  }

  for (const child of Object.values(raw)) {
    collectStructuredTopicMetadata(child, out, baseUrl);
  }
}

function extractStructuredTopicMetadata(html: string, baseUrl = "https://www.v2ex.com"): Map<string, StructuredTopicMetadata> {
  const metadata = new Map<string, StructuredTopicMetadata>();
  for (const script of extractJsonLdScripts(html)) {
    try {
      const parsed = JSON.parse(script) as unknown;
      const topics: StructuredTopicMetadata[] = [];
      collectStructuredTopicMetadata(parsed, topics, baseUrl);
      for (const topic of topics) {
        const existing = metadata.get(topic.topicId);
        metadata.set(topic.topicId, { ...existing, ...topic });
      }
    } catch {
      // Ignore malformed embedded structured data and keep parsing visible HTML.
    }
  }
  return metadata;
}

export function parseV2exAtomFeed(xml: string): V2exFeedEntry[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const out: V2exFeedEntry[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    const title = tagValue(raw, "title");
    const id = tagValue(raw, "id");
    const url = linkHref(raw);
    const topicId = extractTopicId(id, url);
    if (!title || !topicId || seen.has(topicId)) continue;
    seen.add(topicId);
    const contentHtml = stripCdata(tagValue(raw, "content"));
    out.push({
      title,
      url: normalizeTopicUrl(url, topicId),
      topicId,
      published: tagValue(raw, "published") || undefined,
      updated: tagValue(raw, "updated") || undefined,
      author: tagValue(raw, "name") || undefined,
      contentHtml,
      contentText: htmlToText(contentHtml),
    });
  }
  return out;
}

export function parseV2exJobsPage(html: string, baseUrl = "https://www.v2ex.com"): V2exFeedEntry[] {
  const structuredTopics = extractStructuredTopicMetadata(html, baseUrl);
  const topicLinkRe = /<a\b[^>]*class=["'][^"']*\btopic-link\b[^"']*["'][^>]*>/gi;
  const out: V2exFeedEntry[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = topicLinkRe.exec(html))) {
    const tag = match[0];
    const href = attrValue(tag, "href");
    const topicId = attrValue(tag, "id").match(/topic-link-(\d+)/)?.[1] ?? href.match(/\/t\/(\d+)/)?.[1];
    const titleStart = match.index + tag.length;
    const titleEnd = html.indexOf("</a>", titleStart);
    if (titleEnd < 0 || !topicId || seen.has(topicId)) continue;
    seen.add(topicId);
    const title = htmlToText(html.slice(titleStart, titleEnd));
    if (!title) continue;
    const context = html.slice(titleEnd, Math.min(html.length, titleEnd + 900));
    const author = context.match(/\/member\/[^"'>]+["'][^>]*>([^<]+)<\/a>/i)?.[1];
    const timeTitle = context.match(/<span\b[^>]*title=["']([^"']+)["'][^>]*>/i)?.[1];
    const timestamp = normalizeV2exTimestamp(timeTitle ?? "");
    const structured = structuredTopics.get(topicId);
    out.push({
      title,
      url: normalizeTopicUrl(normalizeV2exUrl(href, baseUrl), topicId),
      topicId,
      published: structured?.published ?? timestamp,
      updated: timestamp ?? structured?.published,
      author: author ? htmlToText(author) : structured?.author,
      contentHtml: "",
      contentText: "",
    });
  }
  return out;
}

export function classifyV2exJobEntry(entry: V2exFeedEntry, keywords: readonly string[], _excludedKeywords: readonly string[] = []): Classification {
  return classifyJobPostingContent({
    text: `${entry.title}\n${entry.contentText}`,
    keywords,
    strongHiringTerms: STRONG_HIRING_TERMS,
    supportingHiringTerms: SUPPORTING_HIRING_TERMS,
  });
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
    if (parsed === null || parsed <= 0) continue;
    return Math.floor(parsed);
  }
  return null;
}

function normalizeSortBy(value: unknown): V2exFeedSortBy {
  return value === "updated_desc" || value === "updated" ? "updated_desc" : "published_desc";
}

function timestampOf(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function entryTime(entry: V2exFeedEntry, sortBy: V2exFeedSortBy): number {
  return sortBy === "updated_desc" ? timestampOf(entry.updated) : timestampOf(entry.published);
}

function fallbackEntryTime(entry: V2exFeedEntry, sortBy: V2exFeedSortBy): number {
  return sortBy === "updated_desc" ? timestampOf(entry.published) : timestampOf(entry.updated);
}

function sortV2exEntries<T extends V2exFeedEntry>(entries: readonly T[], sortBy: V2exFeedSortBy): T[] {
  return [...entries].sort((left, right) => {
    const primary = entryTime(right, sortBy) - entryTime(left, sortBy);
    if (primary !== 0) return primary;
    const secondary = fallbackEntryTime(right, sortBy) - fallbackEntryTime(left, sortBy);
    if (secondary !== 0) return secondary;
    return right.topicId.localeCompare(left.topicId);
  });
}

function filterRecentV2exEntries<T extends V2exFeedEntry>(
  entries: readonly T[],
  sortBy: V2exFeedSortBy,
  recentDays: number | null,
  nowMs = Date.now(),
): T[] {
  if (recentDays === null) return [...entries];
  const cutoffMs = nowMs - recentDays * DAY_MS;
  return entries.filter((entry) => entryTime(entry, sortBy) >= cutoffMs);
}

export function prepareV2exFeedEntries<T extends V2exFeedEntry>(
  entries: readonly T[],
  options: { sortBy?: unknown; recentDays?: unknown; nowMs?: number } = {},
): T[] {
  const sortBy = normalizeSortBy(options.sortBy);
  const recentDays = normalizeRecentDays(options.recentDays);
  return filterRecentV2exEntries(sortV2exEntries(entries, sortBy), sortBy, recentDays, options.nowMs);
}

function sortByLabel(sortBy: V2exFeedSortBy): string {
  return sortBy === "updated_desc" ? "更新时间倒序" : "发布时间倒序";
}

function splitFeedUrls(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[\n,，、]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseV2exJsonFeed(jsonText: string): V2exFeedEntry[] {
  try {
    const parsed = JSON.parse(jsonText) as any;
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const out: V2exFeedEntry[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      const rawUrl = typeof item?.url === "string" ? item.url : typeof item?.id === "string" ? item.id : "";
      const url = rawUrl.trim();
      const topicId = extractTopicId(url, url);
      if (!title || !topicId || seen.has(topicId)) continue;
      seen.add(topicId);
      const contentHtml = typeof item?.content_html === "string" ? item.content_html : typeof item?.content_text === "string" ? item.content_text : "";
      const published = typeof item?.date_published === "string" ? normalizeV2exTimestamp(item.date_published) : undefined;
      const updated = typeof item?.date_modified === "string" ? normalizeV2exTimestamp(item.date_modified) : published;
      const author = typeof item?.author === "object" && item?.author ? structuredAuthorName(item.author) : typeof item?.author === "string" ? item.author.trim() : undefined;
      out.push({
        title,
        url: normalizeTopicUrl(url, topicId),
        topicId,
        published,
        updated,
        author,
        contentHtml,
        contentText: htmlToText(contentHtml),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function v2exFeedFormat(feedUrl: string): "json" | "xml" | null {
  try {
    const url = new URL(feedUrl);
    if (url.pathname.endsWith(".json")) return "json";
    if (url.pathname.endsWith(".xml")) return "xml";
    return null;
  } catch {
    return null;
  }
}

function shouldUseAtomFeed(feedUrl: string): boolean {
  return v2exFeedFormat(feedUrl) !== null;
}

function normalizeJobsListUrl(feedUrl: string): string {
  try {
    return new URL(feedUrl).toString();
  } catch {
    return "";
  }
}

function entryCompletenessScore(entry: V2exCollectedEntry): number {
  return entry.contentText.length + entry.contentHtml.length + (entry.author ? 20 : 0) + (entry.published ? 20 : 0);
}

function dedupeV2exEntries(entries: readonly V2exCollectedEntry[]): V2exCollectedEntry[] {
  const byTopicId = new Map<string, V2exCollectedEntry>();
  for (const entry of entries) {
    const existing = byTopicId.get(entry.topicId);
    if (!existing || entryCompletenessScore(entry) > entryCompletenessScore(existing)) {
      byTopicId.set(entry.topicId, entry);
    }
  }
  return [...byTopicId.values()];
}

function buildJobsPageUrl(listUrl: string, page: number): string {
  const url = new URL(listUrl);
  url.searchParams.set("p", String(page));
  return url.toString();
}

function extractBalancedDiv(html: string, startIndex: number): string {
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = startIndex;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) return html.slice(startIndex, tagRe.lastIndex);
    } else {
      depth += 1;
    }
  }
  return html.slice(startIndex);
}

export function parseV2exTopicDetailPage(html: string): { contentHtml: string; contentText: string; published?: string } {
  const structuredPublished = [...extractStructuredTopicMetadata(html).values()].find((topic) => topic.published)?.published;
  const contentStart = html.search(/<div\b[^>]*class=["'][^"']*\btopic_content\b[^"']*["'][^>]*>/i);
  const headerHtml = contentStart >= 0 ? html.slice(0, contentStart) : html;
  const headerTimes = [...headerHtml.matchAll(/<span\b[^>]*title=["']([^"']+)["'][^>]*>/gi)];
  const published = structuredPublished ?? normalizeV2exTimestamp(headerTimes.at(-1)?.[1] ?? "");
  if (contentStart < 0) return { contentHtml: "", contentText: "", published };
  const contentHtml = extractBalancedDiv(html, contentStart);
  return {
    contentHtml,
    contentText: htmlToText(contentHtml),
    published,
  };
}

function readNestedError(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const cause = (err as { cause?: unknown }).cause;
  if (!cause) return "";
  if (cause instanceof Error) {
    const maybeCode = (cause as Error & { code?: unknown }).code;
    const code = typeof maybeCode === "string" ? ` ${maybeCode}` : "";
    return `${cause.name}${code}: ${cause.message}`;
  }
  return String(cause);
}

function formatFeedRequestError(err: unknown, label = "V2EX feed"): Error {
  if (err instanceof Error) {
    const nested = readNestedError(err);
    const detail = nested ? `${err.message}；${nested}` : err.message;
    return new Error(`${label} 请求失败：${detail}`);
  }
  return new Error(`${label} 请求失败：${String(err)}`);
}

async function fetchV2exFeedXmlOnce(feedUrl: string, signal: AbortSignal): Promise<FeedHttpResponse> {
  const url = new URL(feedUrl);
  const client = url.protocol === "https:" ? https : http;

  return await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("V2EX feed 请求已取消"));
      return;
    }

    const req = client.request(
      url,
      {
        agent: feedProxyAgent,
        headers: {
          accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          "user-agent": "Job-Sync/0.1 V2EX feed collector",
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
          resolve({ status: res.statusCode ?? 0, body });
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
      req.destroy(new Error("V2EX feed 请求已取消"));
      reject(new Error("V2EX feed 请求已取消"));
    };
    const onTimeout = (): void => {
      cleanup();
      req.destroy(new Error(`V2EX feed 请求超时：${FEED_REQUEST_TIMEOUT_MS}ms`));
      reject(new Error(`V2EX feed 请求超时：${FEED_REQUEST_TIMEOUT_MS}ms`));
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(formatFeedRequestError(err));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", onTimeout);
    req.on("error", onError);
    req.end();
  });
}

export async function fetchV2exFeedXml(
  feedUrl: string,
  signal: AbortSignal,
  options: V2exRequestOptions = {},
): Promise<FeedHttpResponse> {
  const label = options.label ?? "V2EX feed";
  const retries =
    typeof options.retries === "number" && Number.isFinite(options.retries) && options.retries >= 0
      ? Math.floor(options.retries)
      : 2;
  const retryDelayMs =
    typeof options.retryDelayMs === "number" && Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0
      ? Math.floor(options.retryDelayMs)
      : 600;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal.aborted) throw new Error(`${label} 请求已取消`);
    try {
      return await fetchV2exFeedXmlOnce(feedUrl, signal);
    } catch (err) {
      const error = formatFeedRequestError(err, label);
      lastError = error;
      if (signal.aborted || attempt >= retries) {
        throw error;
      }
      options.onRetry?.(attempt + 1, error);
      await sleep(retryDelayMs * (attempt + 1), signal);
    }
  }

  throw lastError ?? new Error(`${label} 请求失败`);
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
      reject(new Error("V2EX feed 请求已取消"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchV2exJobsEntries(
  listUrl: string,
  options: { maxPages: number; delayMs: number; keyword: string; filters: unknown },
  ctx: ModeContext,
): Promise<{ entries: (V2exFeedEntry & { sourcePage?: number })[]; pagesFetched: number }> {
  const seen = new Set<string>();
  const entries: V2exCollectedEntry[] = [];
  let pagesFetched = 0;

  for (let page = 1; page <= options.maxPages; page += 1) {
    if (ctx.signal.aborted) break;
    const pageUrl = buildJobsPageUrl(listUrl, page);
    ctx.emit({
      type: "PROGRESS",
      payload: { keyword: options.keyword, current_page: page, captured_job_list: pagesFetched, captured_job_detail: 0, filtered_job: 0 },
    });
    const response = await fetchV2exFeedXml(pageUrl, ctx.signal, {
      label: `V2EX 第 ${page} 页`,
      onRetry: (attempt, error) => {
        ctx.emit({
          type: "LOG",
          payload: {
            level: "warn",
            message: `V2EX 第 ${page} 页请求失败，准备重试第 ${attempt} 次：${error.message}`,
          },
        });
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`V2EX 第 ${page} 页返回异常：HTTP ${response.status}`);
    }
    const pageEntries = parseV2exJobsPage(response.body, new URL(pageUrl).origin)
      .map((entry) => ({ ...entry, sourcePage: page }))
      .filter((entry) => {
      if (seen.has(entry.topicId)) return false;
      seen.add(entry.topicId);
      return true;
      });
    pagesFetched += 1;
    ctx.emit({
      type: "PROGRESS",
      payload: { keyword: options.keyword, current_page: page, captured_job_list: pagesFetched, captured_job_detail: 0, filtered_job: 0 },
    });
    ctx.emit({
      type: "LOG",
      payload: { level: "info", message: `V2EX 第 ${page} 页解析：${pageEntries.length} 条。` },
    });
    if (pageEntries.length === 0) break;
    entries.push(...pageEntries);
    await sleep(options.delayMs, ctx.signal);
  }

  return { entries, pagesFetched };
}

function inferPositionName(title: string): string {
  return title
    .replace(/^\s*[\[【][^\]】]+[\]】]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim() || title;
}

function buildSkipReason(_entry: V2exFeedEntry, classification: Classification): string {
  if (classification.nonHiringMatches.length > 0) {
    return `明确为非招聘内容：${classification.nonHiringMatches.join("、")}`;
  }
  if (!classification.hasHiringSignal) {
    return "缺少招聘信号词";
  }
  return "未满足 V2EX 招聘帖判定";
}

export async function runV2exFeedMode(payload: any, ctx: ModeContext): Promise<void> {
  const task = payload.task ?? {};
  const limits = task.limits ?? {};
  const filters = task.filters ?? {};
  const keywords = asStringList(task.keywords);
  const feedUrls = splitFeedUrls(filters.feed_urls ?? filters.feedUrl ?? filters.feed_url);
  const maxEntries =
    typeof limits.maxEntries === "number" && Number.isFinite(limits.maxEntries) && limits.maxEntries > 0
      ? Math.floor(limits.maxEntries)
      : Number.POSITIVE_INFINITY;
  const maxJobs = typeof limits.maxJobs === "number" && Number.isFinite(limits.maxJobs) ? limits.maxJobs : Number.POSITIVE_INFINITY;
  const maxPages = normalizePositiveInteger(DEFAULT_MAX_PAGES, limits.maxPages, limits.max_pages);
  const delayMs = normalizePositiveInteger(0, limits.delayMs, limits.delay_ms);
  const sortBy = normalizeSortBy(filters.sort_by ?? filters.sortBy);
  const recentDays = normalizeRecentDays(filters.recent_days, filters.recentDays, filters.max_job_age_days, filters.maxJobAgeDays);

  const collectedEntries: V2exCollectedEntry[] = [];
  let sourceLabel = "";
  if (feedUrls.length === 0) {
    ctx.emit({ type: "LOG", payload: { level: "warn", message: "V2EX 未提供任何 URL，跳过采集。" } });
    return;
  }

  for (const feedUrl of feedUrls) {
    if (ctx.signal.aborted) break;
    let parsedEntries: V2exCollectedEntry[] = [];
    const feedFormat = v2exFeedFormat(feedUrl);
    if (feedFormat) {
      sourceLabel = feedFormat === "json" ? "JSON Feed" : "Feed";
      ctx.emit({ type: "LOG", payload: { level: "info", message: `开始 V2EX ${sourceLabel} 自动采集：${feedUrl}` } });
      ctx.emit({ type: "LOG", payload: { level: "info", message: `正在请求 V2EX ${sourceLabel}...` } });
      const response = await fetchV2exFeedXml(feedUrl, ctx.signal);
      ctx.emit({
        type: "LOG",
        payload: { level: "info", message: `V2EX ${sourceLabel} 响应：HTTP ${response.status}，${response.body.length} 字符。` },
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`V2EX feed 返回异常：HTTP ${response.status}`);
      }
      parsedEntries = feedFormat === "json" ? parseV2exJsonFeed(response.body) : parseV2exAtomFeed(response.body);
    } else {
      sourceLabel = "网页分页";
      const listUrl = normalizeJobsListUrl(feedUrl);
      if (!listUrl) continue;
      ctx.emit({ type: "LOG", payload: { level: "info", message: `开始 V2EX 网页分页采集：${listUrl}，最多 ${maxPages} 页。` } });
      const result = await fetchV2exJobsEntries(
        listUrl,
        { maxPages, delayMs, keyword: keywords[0] ?? "V2EX", filters },
        ctx,
      );
      parsedEntries = result.entries;
      ctx.emit({
        type: "LOG",
        payload: { level: "info", message: `V2EX 网页分页请求完成：${result.pagesFetched} 页，源 ${parsedEntries.length} 条。` },
      });
    }
    collectedEntries.push(...parsedEntries.map((entry) => ({ ...entry, sourceInputUrl: feedUrl, sourceKind: sourceLabel })));
  }
  const uniqueEntries = dedupeV2exEntries(collectedEntries);
  const sortedEntries = sortV2exEntries(uniqueEntries, sortBy);
  const filteredEntries = filterRecentV2exEntries(sortedEntries, sortBy, recentDays);
  const entries = Number.isFinite(maxEntries) ? filteredEntries.slice(0, maxEntries) : filteredEntries;
  ctx.emit({
    type: "PROGRESS",
    payload: { keyword: keywords[0] ?? "V2EX", captured_job_detail: 0, filtered_job: 0 },
  });
  const parsedCount = uniqueEntries.length;
  const firstSourceLabel = feedUrls.length === 1 ? sourceLabel : "多源";
  ctx.emit({
    type: "LOG",
    payload: {
      level: "info",
      message: `V2EX ${firstSourceLabel}解析完成：源 ${parsedCount} 条，候选 ${entries.length} 条，排序 ${sortByLabel(sortBy)}${
        recentDays === null ? "" : `，最近 ${recentDays} 天`
      }${Number.isFinite(maxJobs) ? `，目标入库 ${maxJobs} 条` : ""}。`,
    },
  });
  let captured = 0;
  let filtered = 0;

  for (const entry of entries) {
    if (ctx.signal.aborted) break;
    const response = await fetchV2exFeedXml(entry.url, ctx.signal, {
      label: entry.sourcePage ? `V2EX 第 ${entry.sourcePage} 页详情` : "V2EX 详情",
      onRetry: (attempt, error) => {
        ctx.emit({
          type: "LOG",
          payload: {
            level: "warn",
            message: `${entry.sourcePage ? `V2EX 第 ${entry.sourcePage} 页` : "V2EX 详情"} 请求失败，准备重试第 ${attempt} 次：${error.message}`,
          },
        });
      },
    });
    if (response.status < 200 || response.status >= 300) {
      ctx.emit({
        type: "LOG",
        payload: {
          level: "warn",
          message: `${entry.sourcePage ? `V2EX 第 ${entry.sourcePage} 页` : "V2EX 详情"} 请求失败：${entry.title}（HTTP ${response.status}）`,
        },
      });
      continue;
    }
    const detail = parseV2exTopicDetailPage(response.body);
    const detailedEntry = {
      ...entry,
      published: detail.published ?? entry.published,
      updated: entry.updated ?? detail.published,
      contentHtml: detail.contentHtml,
      contentText: detail.contentText,
    };
    const classification = classifyV2exJobEntry(detailedEntry, keywords);
    if (!classification.isJobPosting) {
      filtered += 1;
      const reason = buildSkipReason(detailedEntry, classification);
      ctx.emit({
        type: "JOB_FILTERED",
        payload: {
          encrypt_job_id: `v2ex:${detailedEntry.topicId}`,
          keyword: keywords[0] ?? "V2EX",
          filters,
          reason: {
            eligible: false,
            blocked_by: [
              {
                rule_type: "v2ex_feed_classification",
                field: "positive_terms",
                value: "",
                reason,
              },
            ],
            matched_preferences: classification.matched,
            missing_preferences: [],
          },
        },
      });
      ctx.emit({
        type: "LOG",
        payload: {
          level: "info",
          message: `跳过 V2EX：${detailedEntry.title}（${reason}）`,
        },
      });
      continue;
    }
    captured += 1;
    const rawPayload = {
      ...detailedEntry,
      classification,
      feed_url: entry.sourceInputUrl,
      source_kind: entry.sourceKind,
    };
    ctx.emit({
      type: "JOB_NORMALIZED_CAPTURED",
      payload: {
        encrypt_job_id: `v2ex:${detailedEntry.topicId}`,
        source_platform: "v2ex",
        source_url: detailedEntry.url,
        dedup_key: detailedEntry.topicId,
        position_name: inferPositionName(detailedEntry.title),
        boss_name: detailedEntry.author,
        jd_text: `${detailedEntry.title}\n\n${detailedEntry.contentText}`.trim(),
        raw_payload: rawPayload,
        keyword: keywords[0],
        filters,
      },
    });
    if (ctx.signal.aborted) break;
    ctx.emit({
      type: "PROGRESS",
      payload: {
        keyword: keywords[0] ?? "V2EX",
        captured_job_detail: captured,
        filtered_job: filtered,
      },
    });
    await sleep(delayMs, ctx.signal);
  }

  ctx.emit({
    type: "LOG",
    payload: { level: "info", message: `V2EX 采集完成：采集候选 ${captured} 条，跳过 ${filtered} 条。` },
  });
}
