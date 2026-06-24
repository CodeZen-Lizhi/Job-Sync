import * as http from "node:http";
import * as https from "node:https";

import { ProxyAgent } from "proxy-agent";
import type { Browser, Page } from "puppeteer";

import { launchBrowser } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import type { EventOut } from "../protocol.js";
import { delayWithJitter } from "../utils/delay.js";
import type { CrawlAutoStartPayload, ModeContext } from "../modes/auto/types.js";

type Classification = {
  isJobPosting: boolean;
  hasHiringSignal: boolean;
  matched: string[];
};

export type LinuxDoTopicEntry = {
  topicId: string;
  title: string;
  url: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  excerptHtml?: string;
  excerptText?: string;
  contentHtml?: string;
  contentText?: string;
  sourcePage?: number;
  detailStatus?: "ok" | "missing" | "blocked";
  detailError?: string;
};

type LinuxDoSortBy = "latest" | "created";

type PageFetchResult = {
  status: number;
  json: unknown | null;
  text: string;
  contentType: string;
  error?: string;
};

type LinuxDoHttpResponse = {
  status: number;
  body: string;
  contentType: string;
};

type LinuxDoRequestOptions = {
  label?: string;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  cookieHeader?: string;
  referer?: string;
  onRetry?: (attempt: number, error: Error) => void;
};

const DEFAULT_CATEGORY_URL = "https://linux.do/c/job/27";
const DEFAULT_MAX_PAGES = 3;
const API_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_CHALLENGE_WAIT_MS = 180_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const linuxDoProxyAgent = new ProxyAgent();
const STRONG_HIRING_TERMS = [
  "招聘",
  "招人",
  "内推",
  "远程",
  "全职",
  "兼职",
  "实习",
  "外包",
  "接单",
  "hiring",
];
const SUPPORTING_HIRING_TERMS = [
  "岗位",
  "职位",
  "jd",
  "简历",
  "投递",
  "薪资",
  "邮箱",
  "base",
  "hc",
  "wechat",
  "微信",
  "remote",
  "offer",
];

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

export function linuxDoHtmlToText(html: string): string {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attrValue(html: string, attr: string): string {
  const match = html.match(new RegExp(`\\b${attr}=["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1].trim()) : "";
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

function normalizeLinuxDoUrl(value: string, baseUrl = "https://linux.do"): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${baseUrl.replace(/\/$/, "")}${trimmed}`;
  return trimmed;
}

function canonicalTopicUrl(topicId: string): string {
  return `https://linux.do/t/${topicId}`;
}

function topicIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/t\/(?:[^/\s?#]+\/)?(\d+)(?:[/?#]|$)/);
  return match?.[1];
}

function normalizeTimestamp(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  return text.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, "$1T$2");
}

export function isLinuxDoCloudflareChallengeText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("verify you are human") ||
    lower.includes("_cf_chl_opt") ||
    lower.includes("cf-mitigated") ||
    lower.includes("cloudflare")
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(text: string, terms: readonly string[]): string[] {
  const haystack = normalizeText(text);
  return terms.filter((term) => haystack.includes(normalizeText(term)));
}

export function classifyLinuxDoTopic(entry: LinuxDoTopicEntry, keywords: readonly string[] = []): Classification {
  const text = `${entry.title}\n${entry.excerptText ?? ""}\n${entry.contentText ?? ""}`;
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

export function parseLinuxDoCategoryJson(value: unknown, baseUrl = "https://linux.do"): LinuxDoTopicEntry[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  const usersById = new Map<number, string>();
  const users = Array.isArray(raw.users) ? raw.users : [];
  for (const user of users) {
    if (!user || typeof user !== "object") continue;
    const id = asNumber((user as Record<string, unknown>).id);
    const username = asString((user as Record<string, unknown>).username) ?? asString((user as Record<string, unknown>).name);
    if (id !== undefined && username) usersById.set(id, username);
  }

  const topics = Array.isArray((raw.topic_list as Record<string, unknown> | undefined)?.topics)
    ? ((raw.topic_list as Record<string, unknown>).topics as unknown[])
    : [];
  const out: LinuxDoTopicEntry[] = [];
  const seen = new Set<string>();
  for (const topic of topics) {
    if (!topic || typeof topic !== "object") continue;
    const item = topic as Record<string, unknown>;
    const id = asNumber(item.id);
    const title = asString(item.title) ?? asString(item.fancy_title);
    if (id === undefined || !title) continue;
    const topicId = String(id);
    if (seen.has(topicId)) continue;
    seen.add(topicId);
    const poster = Array.isArray(item.posters) ? item.posters[0] : undefined;
    const userId = poster && typeof poster === "object" ? asNumber((poster as Record<string, unknown>).user_id) : undefined;
    const slug = asString(item.slug);
    out.push({
      topicId,
      title: linuxDoHtmlToText(title),
      url: slug ? normalizeLinuxDoUrl(`/t/${slug}/${topicId}`, baseUrl) : canonicalTopicUrl(topicId),
      author: userId === undefined ? undefined : usersById.get(userId),
      createdAt: normalizeTimestamp(item.created_at),
      updatedAt: normalizeTimestamp(item.bumped_at ?? item.last_posted_at),
      excerptHtml: asString(item.excerpt),
      excerptText: linuxDoHtmlToText(asString(item.excerpt) ?? ""),
      detailStatus: "missing",
    });
  }
  return out;
}

export function parseLinuxDoCategoryPage(html: string, baseUrl = "https://linux.do"): LinuxDoTopicEntry[] {
  const out: LinuxDoTopicEntry[] = [];
  const seen = new Set<string>();
  const linkRe = /<a\b[^>]*href=["']([^"']*\/t\/[^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html))) {
    const tag = match[0];
    const href = match[1] ?? "";
    const normalizedUrl = normalizeLinuxDoUrl(href, baseUrl).split("#")[0] ?? "";
    const topicId = topicIdFromUrl(normalizedUrl);
    if (!topicId || seen.has(topicId)) continue;
    const titleStart = match.index + tag.length;
    const titleEnd = html.indexOf("</a>", titleStart);
    if (titleEnd < 0) continue;
    const title = linuxDoHtmlToText(html.slice(titleStart, titleEnd));
    if (!title) continue;
    seen.add(topicId);
    const context = html.slice(Math.max(0, match.index - 500), Math.min(html.length, titleEnd + 900));
    const author = context.match(/data-user-card=["']([^"']+)["']/i)?.[1]
      ?? context.match(/\/u\/([^"'/]+)["']/i)?.[1];
    const time = attrValue(context, "datetime") || attrValue(context, "title");
    out.push({
      topicId,
      title,
      url: canonicalTopicUrl(topicId),
      author,
      createdAt: normalizeTimestamp(time),
      updatedAt: normalizeTimestamp(time),
      detailStatus: "missing",
    });
  }
  return out;
}

export function parseLinuxDoTopicJson(value: unknown, fallback?: LinuxDoTopicEntry): LinuxDoTopicEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = asNumber(raw.id) ?? (fallback ? Number(fallback.topicId) : undefined);
  const title = asString(raw.title) ?? fallback?.title;
  if (id === undefined || !title) return null;
  const posts = Array.isArray((raw.post_stream as Record<string, unknown> | undefined)?.posts)
    ? ((raw.post_stream as Record<string, unknown>).posts as unknown[])
    : [];
  const firstPost = posts.find((post) => post && typeof post === "object") as Record<string, unknown> | undefined;
  const contentHtml = asString(firstPost?.cooked) ?? "";
  const topicId = String(id);
  return {
    ...fallback,
    topicId,
    title: linuxDoHtmlToText(title),
    url: fallback?.url ?? canonicalTopicUrl(topicId),
    author: asString(firstPost?.username) ?? fallback?.author,
    createdAt: normalizeTimestamp(firstPost?.created_at) ?? normalizeTimestamp(raw.created_at) ?? fallback?.createdAt,
    updatedAt: normalizeTimestamp(raw.bumped_at ?? raw.last_posted_at) ?? fallback?.updatedAt,
    contentHtml,
    contentText: linuxDoHtmlToText(contentHtml),
    detailStatus: "ok",
    detailError: undefined,
  };
}

function extractBalancedArticle(html: string, startIndex: number): string {
  const tagRe = /<\/?article\b[^>]*>/gi;
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

export function parseLinuxDoTopicPage(html: string, fallback: LinuxDoTopicEntry): LinuxDoTopicEntry {
  const articleStart = html.search(/<article\b[^>]*>/i);
  const articleHtml = articleStart >= 0 ? extractBalancedArticle(html, articleStart) : "";
  const cookedStart = html.search(/<div\b[^>]*class=["'][^"']*\bcooked\b[^"']*["'][^>]*>/i);
  const contentHtml = cookedStart >= 0
    ? html.slice(cookedStart, html.indexOf("</article>", cookedStart) > cookedStart ? html.indexOf("</article>", cookedStart) : undefined)
    : articleHtml;
  const author = articleHtml.match(/data-user-card=["']([^"']+)["']/i)?.[1] ?? fallback.author;
  const time = attrValue(articleHtml, "datetime") || attrValue(articleHtml, "title");
  return {
    ...fallback,
    author,
    createdAt: normalizeTimestamp(time) ?? fallback.createdAt,
    contentHtml,
    contentText: linuxDoHtmlToText(contentHtml),
    detailStatus: contentHtml ? "ok" : "missing",
  };
}

function pickNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePositiveInteger(fallback: number, ...values: unknown[]): number {
  for (const value of values) {
    const parsed = pickNumber(value);
    if (parsed !== null && parsed > 0) return Math.floor(parsed);
  }
  return fallback;
}

function normalizeOptionalPositiveInteger(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = pickNumber(value);
    if (parsed !== null && parsed > 0) return Math.floor(parsed);
  }
  return null;
}

function normalizeSortBy(value: unknown): LinuxDoSortBy {
  return value === "created" || value === "created_desc" ? "created" : "latest";
}

function normalizeCategoryUrl(value: unknown): string {
  const text = asString(value);
  if (!text) return DEFAULT_CATEGORY_URL;
  try {
    const url = new URL(text);
    if (url.hostname !== "linux.do" && !url.hostname.endsWith(".linux.do")) return DEFAULT_CATEGORY_URL;
    return url.toString();
  } catch {
    return DEFAULT_CATEGORY_URL;
  }
}

function buildCookieHeader(cookies: unknown, hostname = "linux.do"): string {
  if (!Array.isArray(cookies)) return "";
  const pairs: string[] = [];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== "object") continue;
    const item = cookie as Record<string, unknown>;
    const name = asString(item.name);
    const value = typeof item.value === "string" ? item.value : undefined;
    if (!name || value === undefined) continue;
    const domain = asString(item.domain)?.replace(/^\./, "");
    if (domain && hostname !== domain && !hostname.endsWith(`.${domain}`)) continue;
    pairs.push(`${name}=${value}`);
  }
  return pairs.join("; ");
}

function categoryJsonUrl(categoryUrl: string, page: number): string {
  const url = new URL(categoryUrl);
  url.hash = "";
  const cleanPath = url.pathname.replace(/\/$/, "");
  const jsonPath = cleanPath.endsWith(".json") ? cleanPath : `${cleanPath}.json`;
  url.pathname = jsonPath;
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function categoryPageUrl(categoryUrl: string, page: number): string {
  const url = new URL(categoryUrl);
  url.hash = "";
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function topicJsonUrl(entry: LinuxDoTopicEntry): string {
  let origin = "https://linux.do";
  try {
    origin = new URL(entry.url).origin;
  } catch {
    // Keep the production default for malformed title-level fallback URLs.
  }
  return `${origin}/t/${entry.topicId}.json`;
}

function timestampMs(entry: LinuxDoTopicEntry, sortBy: LinuxDoSortBy): number {
  const value = sortBy === "created" ? entry.createdAt : entry.updatedAt ?? entry.createdAt;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function prepareEntries(entries: readonly LinuxDoTopicEntry[], options: { sortBy: LinuxDoSortBy; recentDays: number | null }): LinuxDoTopicEntry[] {
  const sorted = [...entries].sort((left, right) => {
    const primary = timestampMs(right, options.sortBy) - timestampMs(left, options.sortBy);
    if (primary !== 0) return primary;
    return right.topicId.localeCompare(left.topicId);
  });
  if (options.recentDays === null) return sorted;
  const cutoff = Date.now() - options.recentDays * DAY_MS;
  return sorted.filter((entry) => timestampMs(entry, options.sortBy) >= cutoff);
}

function dedupeEntries(entries: readonly LinuxDoTopicEntry[]): LinuxDoTopicEntry[] {
  const byTopicId = new Map<string, LinuxDoTopicEntry>();
  for (const entry of entries) {
    const existing = byTopicId.get(entry.topicId);
    const score = (entry.contentText?.length ?? 0) + (entry.excerptText?.length ?? 0) + (entry.author ? 20 : 0);
    const existingScore = existing
      ? (existing.contentText?.length ?? 0) + (existing.excerptText?.length ?? 0) + (existing.author ? 20 : 0)
      : -1;
    if (!existing || score > existingScore) byTopicId.set(entry.topicId, entry);
  }
  return [...byTopicId.values()];
}

function readNestedError(err: Error): string {
  const cause = (err as Error & { cause?: unknown }).cause;
  if (!cause) return "";
  if (cause instanceof Error) {
    const maybeCode = (cause as Error & { code?: unknown }).code;
    const code = typeof maybeCode === "string" ? ` ${maybeCode}` : "";
    return `${cause.name}${code}: ${cause.message}`;
  }
  return String(cause);
}

function formatLinuxDoRequestError(err: unknown, label = "LinuxDo API"): Error {
  if (err instanceof Error) {
    const nested = readNestedError(err);
    const detail = nested ? `${err.message}；${nested}` : err.message;
    return new Error(`${label} 请求失败：${detail}`);
  }
  return new Error(`${label} 请求失败：${String(err)}`);
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
      reject(new Error("LinuxDo API 请求已取消"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchLinuxDoUrlOnce(urlText: string, signal: AbortSignal, options: LinuxDoRequestOptions = {}): Promise<LinuxDoHttpResponse> {
  const url = new URL(urlText);
  const client = url.protocol === "https:" ? https : http;
  const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : API_REQUEST_TIMEOUT_MS;

  return await new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("LinuxDo API 请求已取消"));
      return;
    }

    const headers: Record<string, string> = {
      accept: "application/json, text/html;q=0.9, */*;q=0.8",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      "user-agent": "Job-Sync/0.1 LinuxDo Discourse API collector",
      "x-requested-with": "XMLHttpRequest",
    };
    if (options.cookieHeader) headers.cookie = options.cookieHeader;
    if (options.referer) headers.referer = options.referer;

    const req = client.request(
      url,
      {
        agent: linuxDoProxyAgent,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        res.setEncoding("utf8");
        let body = "";
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          cleanup();
          resolve({
            status: res.statusCode ?? 0,
            body,
            contentType: Array.isArray(res.headers["content-type"])
              ? res.headers["content-type"].join(";")
              : res.headers["content-type"] ?? "",
          });
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
      req.destroy(new Error("LinuxDo API 请求已取消"));
      reject(new Error("LinuxDo API 请求已取消"));
    };
    const onTimeout = (): void => {
      cleanup();
      req.destroy(new Error(`LinuxDo API 请求超时：${timeoutMs}ms`));
      reject(new Error(`LinuxDo API 请求超时：${timeoutMs}ms`));
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(formatLinuxDoRequestError(err, options.label));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", onTimeout);
    req.on("error", onError);
    req.end();
  });
}

async function fetchLinuxDoUrl(url: string, signal: AbortSignal, options: LinuxDoRequestOptions = {}): Promise<LinuxDoHttpResponse> {
  const label = options.label ?? "LinuxDo API";
  const retries =
    typeof options.retries === "number" && Number.isFinite(options.retries) && options.retries >= 0
      ? Math.floor(options.retries)
      : 2;
  const retryDelayMs =
    typeof options.retryDelayMs === "number" && Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0
      ? Math.floor(options.retryDelayMs)
      : 800;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal.aborted) throw new Error(`${label} 请求已取消`);
    try {
      return await fetchLinuxDoUrlOnce(url, signal, options);
    } catch (err) {
      const error = formatLinuxDoRequestError(err, label);
      lastError = error;
      if (signal.aborted || attempt >= retries) throw error;
      options.onRetry?.(attempt + 1, error);
      await sleep(retryDelayMs * (attempt + 1), signal);
    }
  }
  throw lastError ?? new Error(`${label} 请求失败`);
}

function responseToPageFetchResult(response: LinuxDoHttpResponse): PageFetchResult {
  let json: unknown | null = null;
  try {
    json = JSON.parse(response.body);
  } catch {
    json = null;
  }
  return {
    status: response.status,
    json,
    text: response.body,
    contentType: response.contentType,
  };
}

async function fetchFromBrowserPage(page: Page, url: string, timeoutMs = API_REQUEST_TIMEOUT_MS): Promise<PageFetchResult> {
  return await page.evaluate(
    async (u, timeout) => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(u, {
          credentials: "include",
          headers: {
            accept: "application/json, text/html;q=0.9, */*;q=0.8",
            "x-requested-with": "XMLHttpRequest",
          },
          signal: controller.signal,
        });
        const contentType = res.headers.get("content-type") ?? "";
        const text = await res.text();
        let json: unknown | null = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        return { status: res.status, json, text, contentType } as PageFetchResult;
      } catch (err) {
        return { status: 0, json: null, text: "", contentType: "", error: String(err) } as PageFetchResult;
      } finally {
        window.clearTimeout(timer);
      }
    },
    url,
    timeoutMs,
  );
}

async function pageLooksLikeChallenge(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    const text = await page.evaluate(() => document.documentElement.innerText.slice(0, 4000));
    const html = await page.evaluate(() => document.documentElement.innerHTML.slice(0, 8000));
    return isLinuxDoCloudflareChallengeText(`${title}\n${text}\n${html}`);
  } catch {
    return false;
  }
}

async function waitForChallengeToClear(page: Page, ctx: ModeContext): Promise<void> {
  const started = Date.now();
  let logged = false;
  while (!ctx.signal.aborted) {
    if (!await pageLooksLikeChallenge(page)) return;
    if (!logged) {
      logged = true;
      ctx.emit({
        type: "LOG",
        payload: {
          level: "warn",
          message: "LinuxDo 浏览器资料仍在 Cloudflare / 登录验证页，请在打开的浏览器窗口完成验证，完成后会继续采集。",
        },
      });
    }
    if (Date.now() - started > DEFAULT_CHALLENGE_WAIT_MS) {
      throw new Error("LinuxDo 浏览器验证超时：请确认浏览器窗口内已完成 Cloudflare/登录验证。");
    }
    await delayWithJitter(2000, ctx.signal, 1000);
  }
}

async function waitForBrowserApiReady(page: Page, categoryUrl: string, ctx: ModeContext): Promise<void> {
  const started = Date.now();
  let logged = false;
  while (!ctx.signal.aborted) {
    const result = await fetchFromBrowserPage(page, categoryJsonUrl(categoryUrl, 1), 15_000);
    if (result.json) return;
    const blocked = result.status === 403 || result.status === 429 || isLinuxDoCloudflareChallengeText(result.text);
    if (!logged) {
      logged = true;
      ctx.emit({
        type: "LOG",
        payload: {
          level: "warn",
          message: blocked
            ? `LinuxDo 浏览器资料还不能读取 Discourse JSON（HTTP ${result.status || 0}），请在打开的浏览器窗口完成验证。`
            : `LinuxDo 浏览器资料返回的 Discourse JSON 不可解析（HTTP ${result.status || 0}），等待页面会话恢复。`,
        },
      });
    }
    if (Date.now() - started > DEFAULT_CHALLENGE_WAIT_MS) {
      throw new Error("LinuxDo 浏览器资料验证超时：浏览器页面仍不能读取 Discourse JSON。");
    }
    await delayWithJitter(2000, ctx.signal, 1000);
  }
}

async function emitLinuxDoBrowserSession(page: Page, ctx: ModeContext): Promise<void> {
  const cookies = await page.cookies().catch(() => []);
  const local_storage = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key) out[key] = window.localStorage.getItem(key) ?? "";
    }
    return out;
  }).catch(() => ({}));
  ctx.emit({ type: "COOKIE_COLLECTED", payload: { source_platform: "linuxdo", cookies, local_storage } });
}

async function openLinuxDoBrowserApiClient(
  payload: CrawlAutoStartPayload,
  ctx: ModeContext,
  categoryUrl: string,
): Promise<{ browser: Browser; page: Page }> {
  if (!payload.user_data_dir) {
    throw new Error("LinuxDo API 被 Cloudflare/限流拦截，且没有可复用的 LinuxDo 浏览器资料目录。请先在设置里打开 LinuxDo 完成验证。");
  }
  ctx.emit({
    type: "LOG",
    payload: { level: "warn", message: "LinuxDo 直连 Discourse API 被拦截，改用本机 LinuxDo 浏览器资料在页面上下文请求 API。" },
  });
  const { browser, page } = await launchBrowser({
    headless: false,
    user_data_dir: payload.user_data_dir,
    stealth: false,
    preserve_on_disconnect: true,
  });
  await blockNavigation(page, { allow_domain_suffixes: ["linux.do"] });
  await page.goto(categoryPageUrl(categoryUrl, 1), { waitUntil: "domcontentloaded" });
  await waitForChallengeToClear(page, ctx);
  await waitForBrowserApiReady(page, categoryUrl, ctx);
  await emitLinuxDoBrowserSession(page, ctx);
  return { browser, page };
}

async function fetchLinuxDoCategoryEntriesFromBrowser(
  page: Page,
  categoryUrl: string,
  pageIndex: number,
): Promise<{ entries: LinuxDoTopicEntry[]; blocked: boolean; status: number }> {
  const jsonResult = await fetchFromBrowserPage(page, categoryJsonUrl(categoryUrl, pageIndex));
  if (jsonResult.json) {
    return { entries: parseLinuxDoCategoryJson(jsonResult.json, new URL(categoryUrl).origin), blocked: false, status: jsonResult.status };
  }
  if (isLinuxDoCloudflareChallengeText(jsonResult.text) || jsonResult.status === 403 || jsonResult.status === 429) {
    return { entries: [], blocked: true, status: jsonResult.status };
  }
  const htmlResult = await fetchFromBrowserPage(page, categoryPageUrl(categoryUrl, pageIndex));
  if (htmlResult.text && !isLinuxDoCloudflareChallengeText(htmlResult.text)) {
    return { entries: parseLinuxDoCategoryPage(htmlResult.text, new URL(categoryUrl).origin), blocked: false, status: htmlResult.status };
  }
  return { entries: [], blocked: htmlResult.status === 403 || htmlResult.status === 429 || isLinuxDoCloudflareChallengeText(htmlResult.text), status: htmlResult.status };
}

async function fetchLinuxDoTopicDetailFromBrowser(page: Page, entry: LinuxDoTopicEntry): Promise<LinuxDoTopicEntry> {
  const jsonResult = await fetchFromBrowserPage(page, topicJsonUrl(entry));
  if (jsonResult.json) {
    const parsed = parseLinuxDoTopicJson(jsonResult.json, entry);
    if (parsed) return parsed;
  }
  if (isLinuxDoCloudflareChallengeText(jsonResult.text) || jsonResult.status === 403 || jsonResult.status === 429) {
    return { ...entry, detailStatus: "blocked", detailError: `HTTP ${jsonResult.status || 0}` };
  }
  const htmlResult = await fetchFromBrowserPage(page, entry.url);
  if (htmlResult.text && !isLinuxDoCloudflareChallengeText(htmlResult.text)) {
    const parsed = parseLinuxDoTopicPage(htmlResult.text, entry);
    return parsed.detailStatus === "ok" ? parsed : { ...parsed, detailError: "详情正文缺失" };
  }
  return { ...entry, detailStatus: "blocked", detailError: htmlResult.error ?? `HTTP ${htmlResult.status || 0}` };
}

export async function fetchLinuxDoCategoryEntries(
  categoryUrl: string,
  pageIndex: number,
  signal: AbortSignal,
  options: LinuxDoRequestOptions = {},
): Promise<{ entries: LinuxDoTopicEntry[]; blocked: boolean; status: number }> {
  const jsonUrl = categoryJsonUrl(categoryUrl, pageIndex);
  const jsonResult = responseToPageFetchResult(await fetchLinuxDoUrl(jsonUrl, signal, {
    ...options,
    label: options.label ?? `LinuxDo 第 ${pageIndex} 页 API`,
    referer: options.referer ?? categoryUrl,
  }));
  if (jsonResult.json) {
    return { entries: parseLinuxDoCategoryJson(jsonResult.json, new URL(categoryUrl).origin), blocked: false, status: jsonResult.status };
  }
  if (isLinuxDoCloudflareChallengeText(jsonResult.text) || jsonResult.status === 403 || jsonResult.status === 429) {
    return { entries: [], blocked: true, status: jsonResult.status };
  }
  const listUrl = categoryPageUrl(categoryUrl, pageIndex);
  const htmlResult = responseToPageFetchResult(await fetchLinuxDoUrl(listUrl, signal, {
    ...options,
    label: options.label ?? `LinuxDo 第 ${pageIndex} 页 HTML`,
    referer: options.referer ?? categoryUrl,
  }));
  if (htmlResult.text && !isLinuxDoCloudflareChallengeText(htmlResult.text)) {
    return { entries: parseLinuxDoCategoryPage(htmlResult.text, new URL(categoryUrl).origin), blocked: false, status: htmlResult.status };
  }
  return { entries: [], blocked: htmlResult.status === 403 || htmlResult.status === 429 || isLinuxDoCloudflareChallengeText(htmlResult.text), status: htmlResult.status };
}

export async function fetchLinuxDoTopicDetail(
  entry: LinuxDoTopicEntry,
  signal: AbortSignal,
  options: LinuxDoRequestOptions = {},
): Promise<LinuxDoTopicEntry> {
  const jsonResult = responseToPageFetchResult(await fetchLinuxDoUrl(topicJsonUrl(entry), signal, {
    ...options,
    label: options.label ?? "LinuxDo 详情 API",
    referer: options.referer ?? entry.url,
  }));
  if (jsonResult.json) {
    const parsed = parseLinuxDoTopicJson(jsonResult.json, entry);
    if (parsed) return parsed;
  }
  if (isLinuxDoCloudflareChallengeText(jsonResult.text) || jsonResult.status === 403 || jsonResult.status === 429) {
    return { ...entry, detailStatus: "blocked", detailError: `HTTP ${jsonResult.status || 0}` };
  }
  const htmlResult = responseToPageFetchResult(await fetchLinuxDoUrl(entry.url, signal, {
    ...options,
    label: options.label ?? "LinuxDo 详情 HTML",
    referer: options.referer ?? entry.url,
  }));
  if (htmlResult.text && !isLinuxDoCloudflareChallengeText(htmlResult.text)) {
    const parsed = parseLinuxDoTopicPage(htmlResult.text, entry);
    return parsed.detailStatus === "ok" ? parsed : { ...parsed, detailError: "详情正文缺失" };
  }
  return { ...entry, detailStatus: "blocked", detailError: htmlResult.error ?? `HTTP ${htmlResult.status || 0}` };
}

function inferPositionName(title: string): string {
  return title
    .replace(/^\s*[\[【][^\]】]+[\]】]\s*/u, "")
    .replace(/\s+/g, " ")
    .trim() || title;
}

function buildSkipReason(classification: Classification): string {
  if (!classification.hasHiringSignal) return "缺少招聘信号词";
  return "未满足 LinuxDo 岗位帖判定";
}

export function buildLinuxDoNormalizedPayload(
  entry: LinuxDoTopicEntry,
  options: { keywords?: readonly string[]; filters?: unknown; classification?: Classification } = {},
): Extract<EventOut, { type: "JOB_NORMALIZED_CAPTURED" }>["payload"] {
  const classification = options.classification ?? classifyLinuxDoTopic(entry, options.keywords ?? []);
  const detailStatus = entry.detailStatus ?? "missing";
  const detailText = (entry.contentText ?? entry.excerptText ?? "").trim();
  const jdText = detailText
    ? `${entry.title}\n\n${detailText}`.trim()
    : `${entry.title}\n\n详情暂未抓取，需打开原帖确认。`;
  return {
    encrypt_job_id: `linuxdo:${entry.topicId}`,
    source_platform: "linuxdo",
    source_url: entry.url || canonicalTopicUrl(entry.topicId),
    dedup_key: entry.topicId,
    position_name: inferPositionName(entry.title),
    boss_name: entry.author,
    brand_name: "LinuxDo",
    jd_text: jdText,
    raw_payload: {
      ...entry,
      detail_status: detailStatus,
      detail_error: entry.detailError,
      classification,
    },
    keyword: options.keywords?.[0],
    filters: options.filters,
  };
}

export async function runLinuxDoMode(payload: CrawlAutoStartPayload, ctx: ModeContext): Promise<void> {
  const task = payload.task ?? {};
  const filters = task.filters && typeof task.filters === "object" ? task.filters as Record<string, unknown> : {};
  const limits = task.limits && typeof task.limits === "object" ? task.limits as Record<string, unknown> : {};
  const keywords = Array.isArray(task.keywords) ? task.keywords.map((item) => item.trim()).filter(Boolean) : [];
  const categoryUrl = normalizeCategoryUrl(filters.category_url ?? filters.categoryUrl);
  const maxPages = normalizePositiveInteger(DEFAULT_MAX_PAGES, limits.maxPages, limits.max_pages);
  const maxJobs = normalizeOptionalPositiveInteger(limits.maxJobs, limits.max_jobs) ?? Number.POSITIVE_INFINITY;
  const delayMs = normalizePositiveInteger(0, limits.delayMs, limits.delay_ms);
  const sortBy = normalizeSortBy(filters.sort_by ?? filters.sortBy);
  const recentDays = normalizeOptionalPositiveInteger(filters.recent_days, filters.recentDays);
  const logKeyword = keywords[0] ?? "LinuxDo";
  const cookieHeader = buildCookieHeader(payload.session?.cookies, new URL(categoryUrl).hostname);

  ctx.emit({
    type: "LOG",
    payload: { level: "info", message: `开始 LinuxDo Discourse API 采集：${categoryUrl}，最多 ${maxPages} 页。` },
  });
  if (cookieHeader) {
    ctx.emit({ type: "LOG", payload: { level: "info", message: "LinuxDo API 请求将携带已保存的 LinuxDo 登录 Cookie。" } });
  }

  let browserClient: { browser: Browser; page: Page } | null = null;
  let useBrowserApi = false;
  const ensureBrowserClient = async (): Promise<{ browser: Browser; page: Page }> => {
    if (!browserClient) browserClient = await openLinuxDoBrowserApiClient(payload, ctx, categoryUrl);
    useBrowserApi = true;
    return browserClient;
  };

  try {
    const collected: LinuxDoTopicEntry[] = [];
    const seen = new Set<string>();
    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      if (ctx.signal.aborted) break;
      ctx.emit({
        type: "PROGRESS",
        payload: { keyword: logKeyword, current_page: pageIndex, captured_job_list: pageIndex - 1, captured_job_detail: 0, filtered_job: 0 },
      });
      let result: { entries: LinuxDoTopicEntry[]; blocked: boolean; status: number };
      if (useBrowserApi) {
        result = await fetchLinuxDoCategoryEntriesFromBrowser((await ensureBrowserClient()).page, categoryUrl, pageIndex);
      } else {
        try {
          result = await fetchLinuxDoCategoryEntries(categoryUrl, pageIndex, ctx.signal, {
            cookieHeader,
            referer: categoryUrl,
            onRetry: (attempt, error) => {
              ctx.emit({
                type: "LOG",
                payload: {
                  level: "warn",
                  message: `LinuxDo 第 ${pageIndex} 页 API 请求失败，准备重试第 ${attempt} 次：${error.message}`,
                },
              });
            },
          });
        } catch (err) {
          if (collected.length === 0 && payload.user_data_dir) {
            ctx.emit({
              type: "LOG",
              payload: { level: "warn", message: `LinuxDo 第 ${pageIndex} 页直连 API 请求失败，尝试浏览器资料 fallback：${err instanceof Error ? err.message : String(err)}` },
            });
            result = await fetchLinuxDoCategoryEntriesFromBrowser((await ensureBrowserClient()).page, categoryUrl, pageIndex);
          } else {
            throw err;
          }
        }
      }
      if (result.blocked && collected.length === 0 && !useBrowserApi && payload.user_data_dir) {
        ctx.emit({
          type: "LOG",
          payload: { level: "warn", message: `LinuxDo 第 ${pageIndex} 页直连 API 被拦截（HTTP ${result.status || 0}），尝试浏览器资料 fallback。` },
        });
        result = await fetchLinuxDoCategoryEntriesFromBrowser((await ensureBrowserClient()).page, categoryUrl, pageIndex);
      }
      if (result.blocked) {
        ctx.emit({
          type: "LOG",
          payload: { level: "warn", message: `LinuxDo 第 ${pageIndex} 页 Discourse API 被 Cloudflare/限流拦截（HTTP ${result.status || 0}）。` },
        });
        if (collected.length === 0) throw new Error("LinuxDo Discourse API 被 Cloudflare 或限流拦截，未抓到可入库话题。");
        break;
      }
      const fresh = result.entries
        .map((entry) => ({ ...entry, sourcePage: pageIndex }))
        .filter((entry) => {
          if (seen.has(entry.topicId)) return false;
          seen.add(entry.topicId);
          return true;
        });
      ctx.emit({
        type: "LOG",
        payload: { level: "info", message: `LinuxDo 第 ${pageIndex} 页解析：${fresh.length} 条。` },
      });
      if (fresh.length === 0) break;
      collected.push(...fresh);
      ctx.emit({
        type: "PROGRESS",
        payload: { keyword: logKeyword, current_page: pageIndex, captured_job_list: pageIndex, captured_job_detail: 0, filtered_job: 0 },
      });
      await delayWithJitter(delayMs, ctx.signal, 300);
    }

    const preparedEntries = prepareEntries(dedupeEntries(collected), { sortBy, recentDays });
    ctx.emit({
      type: "LOG",
      payload: {
        level: "info",
        message: `LinuxDo 列表解析完成：源 ${collected.length} 条，候选 ${preparedEntries.length} 条${
          recentDays === null ? "" : `，最近 ${recentDays} 天`
        }，目标入库 ${Number.isFinite(maxJobs) ? maxJobs : "不限"} 条。`,
      },
    });

    let captured = 0;
    let filtered = 0;
    for (const entry of preparedEntries) {
      if (ctx.signal.aborted || captured >= maxJobs) break;
      let detailedEntry = useBrowserApi
        ? await fetchLinuxDoTopicDetailFromBrowser((await ensureBrowserClient()).page, entry)
        : await fetchLinuxDoTopicDetail(entry, ctx.signal, {
          cookieHeader,
          referer: entry.url,
          onRetry: (attempt, error) => {
            ctx.emit({
              type: "LOG",
              payload: {
                level: "warn",
                message: `LinuxDo 详情 API 请求失败，准备重试第 ${attempt} 次：${entry.title}：${error.message}`,
              },
            });
          },
        });
      if (detailedEntry.detailStatus === "blocked" && !useBrowserApi && payload.user_data_dir) {
        ctx.emit({
          type: "LOG",
          payload: { level: "warn", message: `LinuxDo 详情直连 API 被拦截，尝试浏览器资料 fallback：${entry.title}` },
        });
        detailedEntry = await fetchLinuxDoTopicDetailFromBrowser((await ensureBrowserClient()).page, entry);
      }
      if (detailedEntry.detailStatus !== "ok") {
        ctx.emit({
          type: "LOG",
          payload: {
            level: "warn",
            message: `LinuxDo 详情未完整抓取，按标题级入库判断：${detailedEntry.title}（${detailedEntry.detailStatus ?? "missing"}）`,
          },
        });
      }
      const classification = classifyLinuxDoTopic(detailedEntry, keywords);
      if (!classification.isJobPosting) {
        filtered += 1;
        const reason = buildSkipReason(classification);
        ctx.emit({
          type: "JOB_FILTERED",
          payload: {
            encrypt_job_id: `linuxdo:${detailedEntry.topicId}`,
            keyword: logKeyword,
            filters,
            reason: {
              eligible: false,
              blocked_by: [
                {
                  rule_type: "linuxdo_topic_classification",
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
        ctx.emit({ type: "LOG", payload: { level: "info", message: `跳过 LinuxDo：${detailedEntry.title}（${reason}）` } });
        continue;
      }
      captured += 1;
      ctx.emit({
        type: "JOB_NORMALIZED_CAPTURED",
        payload: buildLinuxDoNormalizedPayload(detailedEntry, { keywords, filters, classification }),
      });
      ctx.emit({
        type: "PROGRESS",
        payload: { keyword: logKeyword, captured_job_detail: captured, filtered_job: filtered },
      });
      await delayWithJitter(delayMs, ctx.signal, 300);
    }

    ctx.emit({ type: "LOG", payload: { level: "info", message: `LinuxDo 采集完成：入库 ${captured} 条，跳过 ${filtered} 条。` } });
  } finally {
    const client = browserClient as { browser: Browser; page: Page } | null;
    await client?.browser.disconnect().catch(() => undefined);
  }
}
