import type { Page } from "puppeteer";
import type { z } from "zod";

import { launchBrowser } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import type { LoginStartPayloadSchema, EventOut } from "../protocol.js";
import { URLS, API_PATH } from "../boss/selectors.js";
import { collectBossMetaByListening } from "../boss/meta.js";
import { delay } from "../utils/delay.js";
import { isLinuxDoCloudflareChallengeText } from "../linuxdo/feed.js";
import { closeBrowserRespectingHumanVerification, createHumanVerificationTracker } from "./auto/shared.js";

export type LoginStartPayload = z.infer<typeof LoginStartPayloadSchema>;

export type ModeContext = {
  emit: (event: EventOut) => void;
  signal: AbortSignal;
};

function detectRiskUrl(url: string): "captcha" | "denied" | null {
  const u = url.toLowerCase();
  if (u.includes("403")) return "denied";
  if (u.includes("security-check")) return "captcha";
  if (u.includes("verify-slider")) return "captcha";
  return null;
}

async function checkLoginOnce(page: Page): Promise<unknown | null> {
  try {
    return await page.evaluate(async (path) => {
      const res = await fetch(`https://www.zhipin.com${path}`, { credentials: "include" });
      try {
        return await res.json();
      } catch {
        return null;
      }
    }, API_PATH.USER_INFO);
  } catch {
    return null;
  }
}

async function readLocalStorage(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      out[key] = window.localStorage.getItem(key) ?? "";
    }
    return out;
  });
}

async function getCookiesForUrl(page: Page, url: string): Promise<Array<{ name: string; value: string }>> {
  const client = await page.target().createCDPSession();
  try {
    await client.send("Network.enable");
    const response = await client.send("Network.getCookies", { urls: [url] });
    const cookies = Array.isArray(response.cookies) ? response.cookies : [];
    return cookies
      .filter((cookie: unknown): cookie is { name: string; value: string } => {
        return !!cookie && typeof cookie === "object"
          && typeof (cookie as { name?: unknown }).name === "string"
          && typeof (cookie as { value?: unknown }).value === "string";
      });
  } finally {
    await client.detach().catch(() => undefined);
  }
}

async function pageLooksLikeLinuxDoChallenge(page: Page): Promise<boolean> {
  try {
    const title = await page.title();
    const text = await page.evaluate(() => document.documentElement.innerText.slice(0, 4000));
    const html = await page.evaluate(() => document.documentElement.innerHTML.slice(0, 8000));
    return isLinuxDoCloudflareChallengeText(`${title}\n${text}\n${html}`);
  } catch {
    return false;
  }
}

async function runBossLoginMode(
  payload: LoginStartPayload,
  ctx: ModeContext,
  page: Page,
): Promise<void> {
  await blockNavigation(page, { allow_domain_suffixes: ["zhipin.com"] });
  await page.goto(URLS.USER, { waitUntil: "domcontentloaded" });

  let lastStatus: string | null = null;
  while (!ctx.signal.aborted) {
    const risk = detectRiskUrl(page.url());
    if (risk) {
      if (lastStatus !== risk) {
        ctx.emit({
          type: "LOGIN_STATUS",
          payload: { status: risk, message: `检测到风控页面：${page.url()}` },
        });
        lastStatus = risk;
      }
      await delay(1500, ctx.signal);
      continue;
    }

    const userInfo = await checkLoginOnce(page);
    const code = typeof userInfo === "object" && userInfo !== null ? (userInfo as any).code : null;
    if (code === 0) {
      ctx.emit({ type: "LOGIN_STATUS", payload: { status: "valid" } });
      const cookies = await page.cookies();
      const local_storage = await readLocalStorage(page);
      ctx.emit({ type: "COOKIE_COLLECTED", payload: { source_platform: "boss", cookies, local_storage } });
      const meta = await collectBossMetaByListening(page, ctx.signal).catch(() => null);
      if (meta && (meta.city_group || meta.filter_conditions || meta.industry_filter_exemption)) {
        ctx.emit({ type: "BOSS_META_SYNCED", payload: meta });
      }
      return;
    }

    if (lastStatus !== "invalid") {
      ctx.emit({ type: "LOGIN_STATUS", payload: { status: "invalid" } });
      lastStatus = "invalid";
    }
    await delay(1500, ctx.signal);
  }
}

async function runLinuxDoLoginMode(
  ctx: ModeContext,
  page: Page,
): Promise<void> {
  const loginUrl = "https://linux.do/";
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

  let lastStatus: string | null = null;
  while (!ctx.signal.aborted) {
    const url = page.url();
    const onLinuxDo = /(^https?:\/\/)?([^/]+\.)?linux\.do(?=\/|$)/i.test(url);
    if (onLinuxDo && await pageLooksLikeLinuxDoChallenge(page)) {
      if (lastStatus !== "captcha") {
        ctx.emit({
          type: "LOGIN_STATUS",
          payload: {
            status: "captcha",
            message: "LinuxDo 正在进行 Cloudflare / 登录验证，请在打开的浏览器窗口完成验证。",
          },
        });
        lastStatus = "captcha";
      }
      await delay(1500, ctx.signal);
      continue;
    }

    const cookies = await getCookiesForUrl(page, loginUrl).catch(() => []);
    const hasLoginCookie = cookies.some((cookie) => cookie.name === "_t" && cookie.value.trim().length > 0);
    if (hasLoginCookie) {
      await page.goto(loginUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      const refreshedCookies = await page.cookies().catch(() => []);
      const local_storage = await readLocalStorage(page).catch(() => ({}));
      ctx.emit({
        type: "LOGIN_STATUS",
        payload: { status: "valid", message: "LinuxDo 登录成功，后续采集会复用这个浏览器资料。" },
      });
      ctx.emit({
        type: "COOKIE_COLLECTED",
        payload: { source_platform: "linuxdo", cookies: refreshedCookies, local_storage },
      });
      return;
    }

    if (lastStatus !== "invalid") {
      ctx.emit({
        type: "LOGIN_STATUS",
        payload: { status: "invalid", message: "请在打开的浏览器窗口完成 LinuxDo 登录，采集会复用这个 profile。" },
      });
      lastStatus = "invalid";
    }

    await delay(1500, ctx.signal);
  }
}

export async function runLoginMode(payload: LoginStartPayload, baseCtx: ModeContext): Promise<void> {
  const sourcePlatform = payload.source_platform?.trim().toLowerCase() || "boss";
  const verificationTracker = createHumanVerificationTracker(baseCtx);
  const ctx = verificationTracker.ctx;
  ctx.emit({
    type: "LOG",
    payload: {
      level: "info",
      message: sourcePlatform === "linuxdo"
        ? "启动浏览器，等待用户完成 LinuxDo 登录。后续采集会复用同一浏览器资料。"
        : "启动浏览器，等待用户登录 Boss。",
    },
  });

  const { browser, page } = await launchBrowser({
    headless: false,
    executable_path: payload.executable_path,
    user_data_dir: payload.user_data_dir,
    stealth: sourcePlatform !== "boss",
    preserve_on_disconnect: sourcePlatform === "boss",
  });

  try {
    if (sourcePlatform === "linuxdo") {
      await runLinuxDoLoginMode(ctx, page);
    } else {
      await runBossLoginMode(payload, ctx, page);
    }
  } finally {
    await closeBrowserRespectingHumanVerification(
      browser,
      ctx,
      verificationTracker,
      sourcePlatform === "linuxdo" ? "LinuxDo 登录" : "Boss 登录",
    );
    ctx.emit({ type: "FINISHED" });
  }
}
