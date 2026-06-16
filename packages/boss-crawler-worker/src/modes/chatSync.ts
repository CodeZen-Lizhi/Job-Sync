import type { Page } from "puppeteer";
import type { z } from "zod";

import { launchBrowser } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import { collectBossChatStatuses } from "../boss/chat.js";
import { URLS } from "../boss/selectors.js";
import type { BossChatSyncPayloadSchema, EventOut } from "../protocol.js";

export type BossChatSyncPayload = z.infer<typeof BossChatSyncPayloadSchema>;

export type ModeContext = {
  emit: (event: EventOut) => void;
  signal: AbortSignal;
};

async function setLocalStorage(page: Page, localStorage: Record<string, string>): Promise<void> {
  await page.evaluate((entries) => {
    for (const [k, v] of Object.entries(entries)) {
      window.localStorage.setItem(k, v);
    }
  }, localStorage);
}

export async function runBossChatSyncMode(payload: BossChatSyncPayload, ctx: ModeContext): Promise<void> {
  ctx.emit({ type: "LOG", payload: { level: "info", message: "同步 Boss 聊天页沟通状态…" } });

  const { browser, page } = await launchBrowser({ headless: true });
  try {
    await blockNavigation(page, { allow_domain_suffixes: ["zhipin.com"] });

    const cookies = payload.session.cookies;
    if (Array.isArray(cookies) && cookies.length > 0) {
      await page.setCookie(...(cookies as any[]));
    }

    await page.goto(URLS.DESKTOP, { waitUntil: "domcontentloaded" });
    const local_storage = payload.session.local_storage;
    if (local_storage && typeof local_storage === "object") {
      await setLocalStorage(page, local_storage as Record<string, string>);
    }

    const { items, loginExpired } = await collectBossChatStatuses(page, ctx.signal);
    if (loginExpired) {
      ctx.emit({ type: "ERROR", payload: { message: "Boss 登录状态已失效，请先重新登录后再同步沟通状态。" } });
      return;
    }

    for (const item of items) {
      ctx.emit({ type: "BOSS_CHAT_STATUS_SYNCED", payload: item });
    }
    ctx.emit({ type: "LOG", payload: { level: "info", message: `Boss 聊天状态同步完成：${items.length} 个岗位。` } });
  } finally {
    await browser.close().catch(() => undefined);
    ctx.emit({ type: "FINISHED" });
  }
}
