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
  matched: string[];
  blocked: string[];
};

const DEFAULT_FEED_URL = "https://www.v2ex.com/feed/tab/jobs.xml";
const FEED_REQUEST_TIMEOUT_MS = 30_000;
const POSITIVE_TERMS = [
  "招聘",
  "招人",
  "内推",
  "实习",
  "远程",
  "全职",
  "兼职",
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
  "hiring",
  "offer",
];
const NEGATIVE_TERMS = [
  "面试",
  "求职",
  "失业",
  "职业规划",
  "请教",
  "吐槽",
  "老板",
  "简历怎么",
  "有没有",
  "是不是",
  "怎么通俗",
  "想做",
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

export function classifyV2exJobEntry(entry: V2exFeedEntry, keywords: readonly string[], excludedKeywords: readonly string[]): Classification {
  const text = `${entry.title}\n${entry.contentText}`;
  const matched = includesAny(text, [...POSITIVE_TERMS, ...keywords]);
  const blocked = includesAny(text, [...NEGATIVE_TERMS, ...excludedKeywords]);
  return {
    isJobPosting: matched.length > 0 && blocked.length === 0,
    matched,
    blocked,
  };
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
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

export async function runV2exFeedMode(payload: any, ctx: ModeContext): Promise<void> {
  const task = payload.task ?? {};
  const limits = task.limits ?? {};
  const filters = task.filters ?? {};
  const keywords = asStringList(task.keywords);
  const profile = filters.profile && typeof filters.profile === "object" ? filters.profile : {};
  const excludedKeywords = asStringList([
    ...asStringList(filters.excluded_keywords),
    ...asStringList(profile.mustNotKeywords ?? profile.must_not_keywords),
  ]);
  const feedUrl = typeof filters.feed_url === "string" && filters.feed_url.trim() ? filters.feed_url.trim() : DEFAULT_FEED_URL;
  const maxEntries = typeof limits.maxEntries === "number" ? limits.maxEntries : 40;
  const maxJobs = typeof limits.maxJobs === "number" ? limits.maxJobs : 50;

  ctx.emit({ type: "LOG", payload: { level: "info", message: `开始 V2EX Feed 自动采集：${feedUrl}` } });
  const response = await fetchV2exFeedXml(feedUrl, ctx.signal);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`V2EX feed 返回异常：HTTP ${response.status}`);
  }
  const xml = response.body;
  const entries = parseV2exAtomFeed(xml).slice(0, Math.max(1, maxEntries));
  let captured = 0;
  let filtered = 0;

  for (const entry of entries) {
    if (ctx.signal.aborted || captured >= maxJobs) break;
    const classification = classifyV2exJobEntry(entry, keywords, excludedKeywords);
    if (!classification.isJobPosting) {
      filtered += 1;
      ctx.emit({
        type: "LOG",
        payload: {
          level: "info",
          message: `跳过 V2EX 非招聘帖：${entry.title}`,
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
