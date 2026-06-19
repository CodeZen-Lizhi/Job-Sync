import * as http from "node:http";
import * as https from "node:https";

import { ProxyAgent } from "proxy-agent";

import type { EventOut } from "../protocol.js";

type ModeContext = {
  emit: (event: EventOut) => void;
  signal: AbortSignal;
};

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

type Classification = {
  isJobPosting: boolean;
  hasHiringSignal: boolean;
  matched: string[];
};

type V2exFeedSortBy = "published_desc" | "updated_desc";

const DEFAULT_FEED_URL = "https://www.v2ex.com/feed/tab/jobs.xml";
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

export function htmlToText(html: string): string {
  return decodeEntities(stripCdata(html))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(text: string, terms: readonly string[]): string[] {
  const haystack = normalizeText(text);
  return terms.filter((term) => haystack.includes(normalizeText(term)));
}

export function classifyV2exJobEntry(entry: V2exFeedEntry, keywords: readonly string[], _excludedKeywords: readonly string[] = []): Classification {
  const text = `${entry.title}\n${entry.contentText}`;
  const strongHiring = includesAny(text, STRONG_HIRING_TERMS);
  const supportingHiring = includesAny(text, SUPPORTING_HIRING_TERMS);
  const keywordMatches = includesAny(text, keywords);
  const matched = [...strongHiring, ...supportingHiring, ...keywordMatches];
  const hasHiringSignal = strongHiring.length > 0 || supportingHiring.length >= 2;
  return {
    isJobPosting: hasHiringSignal,
    hasHiringSignal,
    matched,
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

function sortV2exEntries(entries: readonly V2exFeedEntry[], sortBy: V2exFeedSortBy): V2exFeedEntry[] {
  return [...entries].sort((left, right) => {
    const primary = entryTime(right, sortBy) - entryTime(left, sortBy);
    if (primary !== 0) return primary;
    const secondary = fallbackEntryTime(right, sortBy) - fallbackEntryTime(left, sortBy);
    if (secondary !== 0) return secondary;
    return right.topicId.localeCompare(left.topicId);
  });
}

function filterRecentV2exEntries(
  entries: readonly V2exFeedEntry[],
  sortBy: V2exFeedSortBy,
  recentDays: number | null,
  nowMs = Date.now(),
): V2exFeedEntry[] {
  if (recentDays === null) return [...entries];
  const cutoffMs = nowMs - recentDays * DAY_MS;
  return entries.filter((entry) => entryTime(entry, sortBy) >= cutoffMs);
}

export function prepareV2exFeedEntries(
  entries: readonly V2exFeedEntry[],
  options: { sortBy?: unknown; recentDays?: unknown; nowMs?: number } = {},
): V2exFeedEntry[] {
  const sortBy = normalizeSortBy(options.sortBy);
  const recentDays = normalizeRecentDays(options.recentDays);
  return filterRecentV2exEntries(sortV2exEntries(entries, sortBy), sortBy, recentDays, options.nowMs);
}

function sortByLabel(sortBy: V2exFeedSortBy): string {
  return sortBy === "updated_desc" ? "更新时间倒序" : "发布时间倒序";
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

function formatFeedRequestError(err: unknown): Error {
  if (err instanceof Error) {
    const nested = readNestedError(err);
    const detail = nested ? `${err.message}；${nested}` : err.message;
    return new Error(`V2EX feed 请求失败：${detail}`);
  }
  return new Error(`V2EX feed 请求失败：${String(err)}`);
}

export async function fetchV2exFeedXml(feedUrl: string, signal: AbortSignal): Promise<FeedHttpResponse> {
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

function inferPositionName(title: string): string {
  return title
    .replace(/^\s*[\[【][^\]】]+[\]】]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim() || title;
}

function buildSkipReason(_entry: V2exFeedEntry, classification: Classification): string {
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
  const feedUrl = typeof filters.feed_url === "string" && filters.feed_url.trim() ? filters.feed_url.trim() : DEFAULT_FEED_URL;
  const maxEntries = typeof limits.maxEntries === "number" ? limits.maxEntries : 40;
  const maxJobs = typeof limits.maxJobs === "number" ? limits.maxJobs : 50;
  const sortBy = normalizeSortBy(filters.sort_by ?? filters.sortBy);
  const recentDays = normalizeRecentDays(filters.recent_days, filters.recentDays, filters.max_job_age_days, filters.maxJobAgeDays);

  ctx.emit({ type: "LOG", payload: { level: "info", message: `开始 V2EX Feed 自动采集：${feedUrl}` } });
  ctx.emit({ type: "LOG", payload: { level: "info", message: "正在请求 V2EX Feed..." } });
  const response = await fetchV2exFeedXml(feedUrl, ctx.signal);
  ctx.emit({
    type: "LOG",
    payload: { level: "info", message: `V2EX Feed 响应：HTTP ${response.status}，${response.body.length} 字符。` },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`V2EX feed 返回异常：HTTP ${response.status}`);
  }
  const xml = response.body;
  const parsedEntries = parseV2exAtomFeed(xml);
  const sortedEntries = sortV2exEntries(parsedEntries, sortBy);
  const filteredEntries = filterRecentV2exEntries(sortedEntries, sortBy, recentDays);
  const entries = filteredEntries.slice(0, Math.max(1, maxEntries));
  ctx.emit({
    type: "PROGRESS",
    payload: { keyword: keywords[0] ?? "V2EX", captured_job_detail: 0, filtered_job: 0 },
  });
  ctx.emit({
    type: "LOG",
    payload: {
      level: "info",
      message: `V2EX Feed 解析完成：源 ${parsedEntries.length} 条，候选 ${entries.length} 条，排序 ${sortByLabel(sortBy)}${
        recentDays === null ? "" : `，最近 ${recentDays} 天`
      }，最多入库 ${maxJobs} 条。`,
    },
  });
  let captured = 0;
  let filtered = 0;

  for (const entry of entries) {
    if (ctx.signal.aborted || captured >= maxJobs) break;
    const classification = classifyV2exJobEntry(entry, keywords);
    if (!classification.isJobPosting) {
      filtered += 1;
      const reason = buildSkipReason(entry, classification);
      ctx.emit({
        type: "JOB_FILTERED",
        payload: {
          encrypt_job_id: `v2ex:${entry.topicId}`,
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
          message: `跳过 V2EX：${entry.title}（${reason}）`,
        },
      });
      continue;
    }
    captured += 1;
    const rawPayload = {
      ...entry,
      classification,
      feed_url: feedUrl,
    };
    ctx.emit({
      type: "JOB_NORMALIZED_CAPTURED",
      payload: {
        encrypt_job_id: `v2ex:${entry.topicId}`,
        source_platform: "v2ex",
        source_url: entry.url,
        dedup_key: entry.topicId,
        position_name: inferPositionName(entry.title),
        boss_name: entry.author,
        jd_text: `${entry.title}\n\n${entry.contentText}`.trim(),
        raw_payload: rawPayload,
        keyword: keywords[0],
        filters,
      },
    });
    ctx.emit({
      type: "PROGRESS",
      payload: {
        keyword: keywords[0] ?? "V2EX",
        captured_job_detail: captured,
        filtered_job: filtered,
      },
    });
  }

  ctx.emit({
    type: "LOG",
    payload: { level: "info", message: `V2EX Feed 采集完成：入库 ${captured} 条，跳过 ${filtered} 条。` },
  });
}
