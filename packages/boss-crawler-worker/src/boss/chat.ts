import type { HTTPResponse, Page } from "puppeteer";

import { URLS } from "./selectors.js";

export type BossChatCommunicationStatus = "greeted_unread" | "read_no_reply" | "replied" | "rejected";

export type BossChatStatusItem = {
  encrypt_job_id: string;
  communication_status: BossChatCommunicationStatus;
  boss_name?: string;
  brand_name?: string;
  position_name?: string;
  message_status?: string;
  message_preview?: string;
  raw_payload?: unknown;
};

type ChatCandidate = {
  encrypt_job_id?: string;
  boss_name?: string;
  brand_name?: string;
  position_name?: string;
  message_status?: string;
  message_preview?: string;
  text?: string;
  has_reply?: boolean;
  raw_payload?: unknown;
};

const REJECT_PATTERNS = [
  "不合适",
  "不匹配",
  "暂不考虑",
  "不考虑",
  "不符合",
  "已招满",
  "不招",
  "不需要",
  "不太合适",
  "不适合",
  "谢谢关注",
];

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function firstBoolean(values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeBossStatus(label?: string): BossChatCommunicationStatus | undefined {
  const status = label?.trim();
  if (!status) return undefined;
  if (status.includes("已读")) return "read_no_reply";
  if (status.includes("未读") || status.includes("送达") || status.includes("已送达")) return "greeted_unread";
  return undefined;
}

function hasRejectedText(text?: string): boolean {
  if (!text) return false;
  return REJECT_PATTERNS.some((pattern) => text.includes(pattern));
}

function normalizeChatCandidate(candidate: ChatCandidate): BossChatStatusItem | null {
  const encrypt_job_id = candidate.encrypt_job_id?.trim();
  if (!encrypt_job_id) return null;
  if (!candidate.message_status && !candidate.message_preview && !candidate.text && candidate.has_reply === undefined) {
    return null;
  }

  const messageText = [candidate.message_preview, candidate.text].filter(Boolean).join(" ");
  let communication_status = normalizeBossStatus(candidate.message_status) ?? "greeted_unread";
  if (candidate.has_reply) communication_status = "replied";
  if (hasRejectedText(messageText)) communication_status = "rejected";

  return {
    encrypt_job_id,
    communication_status,
    boss_name: candidate.boss_name,
    brand_name: candidate.brand_name,
    position_name: candidate.position_name,
    message_status: candidate.message_status,
    message_preview: candidate.message_preview,
    raw_payload: candidate.raw_payload,
  };
}

function pickJobId(value: unknown): string | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  const job = asRecord(obj.job) ?? asRecord(obj.jobInfo) ?? asRecord(obj.position) ?? asRecord(obj.positionInfo);
  return firstString([
    obj.encryptJobId,
    obj.encrypt_job_id,
    obj.securityId,
    obj.security_id,
    obj.jobId,
    obj.job_id,
    obj.jobid,
    job?.encryptJobId,
    job?.encrypt_job_id,
    job?.securityId,
    job?.security_id,
    job?.jobId,
    job?.job_id,
  ]);
}

function candidateFromRecord(record: Record<string, unknown>): ChatCandidate {
  const boss = asRecord(record.boss) ?? asRecord(record.bossInfo) ?? asRecord(record.friendInfo) ?? asRecord(record.userInfo);
  const company = asRecord(record.company) ?? asRecord(record.companyInfo) ?? asRecord(record.brand) ?? asRecord(record.brandInfo);
  const job = asRecord(record.job) ?? asRecord(record.jobInfo) ?? asRecord(record.position) ?? asRecord(record.positionInfo);
  const message = asRecord(record.message) ?? asRecord(record.lastMessage) ?? asRecord(record.latestMessage) ?? asRecord(record.msgInfo);

  const message_status = firstString([
    record.messageStatusText,
    record.message_status_text,
    record.statusText,
    record.status_text,
    record.readStatusText,
    record.read_status_text,
    message?.statusText,
    message?.status_text,
    message?.readStatusText,
    message?.read_status_text,
  ]);
  const message_preview = firstString([
    record.messagePreview,
    record.message_preview,
    record.lastMsg,
    record.last_msg,
    record.lastMessageText,
    record.last_message_text,
    record.content,
    record.text,
    message?.content,
    message?.text,
    message?.msg,
  ]);
  const has_reply = firstBoolean([
    record.hasReply,
    record.has_reply,
    record.bossReplied,
    record.boss_replied,
    record.replied,
    message?.fromBoss,
    message?.from_boss,
  ]);

  return {
    encrypt_job_id: pickJobId(record),
    boss_name: firstString([record.bossName, record.boss_name, record.name, boss?.name, boss?.bossName, boss?.userName]),
    brand_name: firstString([record.brandName, record.brand_name, record.companyName, record.company_name, company?.brandName, company?.name]),
    position_name: firstString([record.positionName, record.position_name, record.jobName, record.job_name, job?.positionName, job?.jobName, job?.name]),
    message_status,
    message_preview,
    text: firstString([record.text, record.content, message_preview]),
    has_reply,
    raw_payload: record,
  };
}

function collectRecords(value: unknown, out: Record<string, unknown>[], seen: Set<unknown>): void {
  if (!value || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, out, seen);
    return;
  }
  const obj = asRecord(value);
  if (!obj) return;
  if (pickJobId(obj)) out.push(obj);
  for (const nested of Object.values(obj)) {
    if (Array.isArray(nested) || asRecord(nested)) collectRecords(nested, out, seen);
  }
}

export function parseBossChatStatusItems(raw: unknown): BossChatStatusItem[] {
  const records: Record<string, unknown>[] = [];
  collectRecords(raw, records, new Set());
  const byJobId = new Map<string, BossChatStatusItem>();
  for (const record of records) {
    const item = normalizeChatCandidate(candidateFromRecord(record));
    if (!item) continue;
    byJobId.set(item.encrypt_job_id, item);
  }
  return Array.from(byJobId.values());
}

function isLoginExpiredPayload(raw: unknown): boolean {
  const obj = asRecord(raw);
  if (!obj) return false;
  return obj.code === 7 || obj.code === "7" || String(obj.message ?? obj.msg ?? "").includes("登录状态");
}

async function safeJson(res: HTTPResponse): Promise<unknown | null> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function collectBossChatStatuses(
  page: Page,
  signal: AbortSignal,
  options?: { timeoutMs?: number },
): Promise<{ items: BossChatStatusItem[]; loginExpired: boolean }> {
  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 12000;
  const itemsByJobId = new Map<string, BossChatStatusItem>();
  let loginExpired = false;
  let responseCount = 0;

  const ingest = (raw: unknown): void => {
    if (isLoginExpiredPayload(raw)) {
      loginExpired = true;
      return;
    }
    for (const item of parseBossChatStatusItems(raw)) {
      itemsByJobId.set(item.encrypt_job_id, item);
    }
  };

  const onResponse = async (res: HTTPResponse): Promise<void> => {
    if (signal.aborted) return;
    const url = res.url();
    if (!url.includes("/wapi/zpchat/") && !url.includes("/wapi/zprelation/")) return;
    responseCount += 1;
    ingest(await safeJson(res));
  };

  page.on("response", onResponse);
  try {
    await page.goto(URLS.GEEK_CHAT, { waitUntil: "domcontentloaded" });
    await Promise.race([
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    ]);

    const domItems = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("a[href*='/job_detail/'], [href*='/job_detail/']"));
      return rows.map((el) => {
        const root = el.closest("li, .friend-item, .chat-item, .chat-user, [class*='friend'], [class*='chat']") ?? el.parentElement ?? el;
        const text = (root.textContent ?? "").replace(/\s+/g, " ").trim();
        const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || "";
        const match = href.match(/\/job_detail\/([^/?#]+)\.html/);
        return {
          encryptJobId: match?.[1],
          text,
          messageStatusText: text.match(/\[(已读|送达|已送达|未读)\]/)?.[1] ?? text.match(/(已读|送达|已送达|未读)/)?.[1],
        };
      });
    }).catch(() => []);
    ingest({ domItems });

    if (responseCount === 0 && itemsByJobId.size === 0) {
      ingest(await page.evaluate(async () => {
        const res = await fetch("https://www.zhipin.com/wapi/zpchat/group/groupInfoList", { credentials: "include" });
        return await res.json();
      }).catch(() => null));
    }
  } finally {
    page.off("response", onResponse);
  }

  return { items: Array.from(itemsByJobId.values()), loginExpired };
}
