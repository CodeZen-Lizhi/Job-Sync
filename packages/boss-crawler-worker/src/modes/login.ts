import type { ChildProcess } from "node:child_process";
import type { Page } from "puppeteer";
import type { z } from "zod";

import { launchBrowser, launchManualBrowserWindow } from "../browser/launch.js";
import { blockNavigation } from "../browser/navigationLock.js";
import type { LoginStartPayloadSchema, EventOut } from "../protocol.js";
import { URLS, API_PATH } from "../boss/selectors.js";
import { collectBossMetaByListening } from "../boss/meta.js";
import { delay } from "../utils/delay.js";
import {
  checkLinuxDoBrowserApiReadiness,
  isLinuxDoCloudflareChallengeText,
} from "../linuxdo/feed.js";
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

async function waitForManualBrowserExit(child: ChildProcess, signal: AbortSignal): Promise<"closed" | "aborted"> {
  if (signal.aborted) return "aborted";
  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("exit", onExit);
      child.off("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onExit = () => {
      cleanup();
      resolve("closed");
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onAbort = () => {
      cleanup();
      resolve("aborted");
    };
    child.once("exit", onExit);
    child.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
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
  payload: LoginStartPayload,
  ctx: ModeContext,
): Promise<void> {
  const loginUrl = "https://linux.do/";
  const readinessCategoryUrl = "https://linux.do/c/job/27";
  if (!payload.user_data_dir) {
    throw new Error("LinuxDo 登录需要可复用的浏览器资料目录。");
  }

  let lastStatus: string | null = null;
  while (!ctx.signal.aborted) {
    const manualBrowser = launchManualBrowserWindow({
      executable_path: payload.executable_path,
      user_data_dir: payload.user_data_dir,
      url: loginUrl,
    });
    ctx.emit({
      type: "LOGIN_STATUS",
      payload: {
        status: "captcha",
        message: "已打开普通 Chrome/Edge 窗口。请在该窗口完成 LinuxDo Cloudflare 验证和账号登录，完成后退出该浏览器进程（macOS 可按 Cmd+Q），应用会继续检查是否可采集。",
      },
    });
    lastStatus = "captcha";

    const exitState = await waitForManualBrowserExit(manualBrowser, ctx.signal);
    if (exitState === "aborted" || ctx.signal.aborted) return;

    const { browser, page } = await launchBrowser({
      headless: false,
      executable_path: payload.executable_path,
      user_data_dir: payload.user_data_dir,
      stealth: false,
      preserve_on_disconnect: true,
    });

    try {
      await blockNavigation(page, { allow_domain_suffixes: ["linux.do"] });
      await page.goto(readinessCategoryUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      const url = page.url();
      const onLinuxDo = /(^https?:\/\/)?([^/]+\.)?linux\.do(?=\/|$)/i.test(url);
      if (onLinuxDo && await pageLooksLikeLinuxDoChallenge(page)) {
        if (lastStatus !== "captcha") {
          ctx.emit({
            type: "LOGIN_STATUS",
            payload: {
              status: "captcha",
              message: "LinuxDo 仍在 Cloudflare / 登录验证页；请重新完成验证和登录后关闭窗口。",
            },
          });
          lastStatus = "captcha";
        }
        await delay(1500, ctx.signal);
        continue;
      }

      const cookies = await getCookiesForUrl(page, loginUrl).catch(() => []);
      const hasLoginCookie = cookies.some((cookie) => cookie.name === "_t" && cookie.value.trim().length > 0);
      const readiness = await checkLinuxDoBrowserApiReadiness(page, readinessCategoryUrl).catch((err) => ({
        ready: false,
        blocked: false,
        status: 0,
        message: `LinuxDo 浏览器资料探测失败：${err instanceof Error ? err.message : String(err)}`,
      }));

      if (readiness.ready && hasLoginCookie) {
        const refreshedCookies = await page.cookies().catch(() => []);
        const local_storage = await readLocalStorage(page).catch(() => ({}));
        ctx.emit({
          type: "LOGIN_STATUS",
          payload: { status: "valid", message: "LinuxDo 已登录且 Discourse API 可读取，后续采集会复用这个浏览器资料。" },
        });
        ctx.emit({
          type: "COOKIE_COLLECTED",
          payload: { source_platform: "linuxdo", cookies: refreshedCookies, local_storage },
        });
        return;
      }

      const status = readiness.blocked ? "captcha" : "invalid";
      if (lastStatus !== status) {
        ctx.emit({
          type: "LOGIN_STATUS",
          payload: {
            status,
            message: readiness.ready
              ? "LinuxDo 已通过浏览器验证，但还没有检测到登录账号；请重新打开窗口完成账号登录。"
              : readiness.message,
          },
        });
        lastStatus = status;
      }
    } finally {
      await browser.close().catch(() => undefined);
    }

    await delay(1500, ctx.signal);
  }
}

async function runZhilianLoginMode(
  payload: LoginStartPayload,
  ctx: ModeContext,
): Promise<void> {
  const loginUrl = "https://www.zhaopin.com/";
  if (!payload.user_data_dir) {
    throw new Error("智联登录需要可复用的浏览器资料目录。");
  }

  const { browser, page } = await launchBrowser({
    headless: false,
    executable_path: payload.executable_path,
    user_data_dir: payload.user_data_dir,
    stealth: false,
    preserve_on_disconnect: true,
  });

  try {
    await blockNavigation(page, { allow_domain_suffixes: ["zhaopin.com", "zhaopin.cn"] });
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    ctx.emit({
      type: "LOGIN_STATUS",
      payload: {
        status: "captcha",
        message: "已打开智联招聘窗口。请完成登录或安全验证；完成后保持窗口打开，应用会保存浏览器资料用于后续采集。",
      },
    });
    await delay(8000, ctx.signal).catch(() => undefined);
    const cookies = await page.cookies().catch(() => []);
    const local_storage = await readLocalStorage(page).catch(() => ({}));
    ctx.emit({
      type: "COOKIE_COLLECTED",
      payload: { source_platform: "zhilian", cookies, local_storage },
    });
    ctx.emit({
      type: "LOGIN_STATUS",
      payload: {
        status: cookies.length > 0 ? "valid" : "invalid",
        message: cookies.length > 0
          ? "已保存智联浏览器资料；若采集仍遇到验证，请在打开的窗口内完成后重试。"
          : "暂未检测到智联 Cookie；如果页面仍在验证，请完成后重试。",
      },
    });
  } finally {
    await browser.disconnect().catch(() => undefined);
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
        : sourcePlatform === "zhilian"
          ? "启动浏览器，等待用户完成智联登录或安全验证。后续采集会复用同一浏览器资料。"
        : "启动浏览器，等待用户登录 Boss。",
    },
  });

  if (sourcePlatform === "linuxdo") {
    try {
      await runLinuxDoLoginMode(payload, ctx);
    } finally {
      ctx.emit({ type: "FINISHED" });
    }
    return;
  }

  if (sourcePlatform === "zhilian") {
    try {
      await runZhilianLoginMode(payload, ctx);
    } finally {
      ctx.emit({ type: "FINISHED" });
    }
    return;
  }

  const { browser, page } = await launchBrowser({
    headless: false,
    executable_path: payload.executable_path,
    user_data_dir: payload.user_data_dir,
    stealth: false,
    preserve_on_disconnect: sourcePlatform === "boss",
  });

  try {
    await runBossLoginMode(payload, ctx, page);
  } finally {
    await closeBrowserRespectingHumanVerification(
      browser,
      ctx,
      verificationTracker,
      "Boss 登录",
    );
    ctx.emit({ type: "FINISHED" });
  }
}
