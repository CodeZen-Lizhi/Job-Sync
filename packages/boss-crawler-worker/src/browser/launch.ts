import type { Browser, Page, Target } from "puppeteer";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import puppeteer from "puppeteer";
import puppeteerExtra from "puppeteer-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

import { injectStealthScript, applyStealthToAllPages } from "./stealth.js";
import { stripHeadlessUserAgent, stripUaForAllPages } from "./ua.js";

let pluginsInstalled = false;

async function installPlugins(puppeteer: any): Promise<void> {
  if (pluginsInstalled) return;
  puppeteer.use((stealthPlugin as any).default?.() ?? (stealthPlugin as any)());
  pluginsInstalled = true;
}

function pickFirstExistingFile(paths: string[]): string | undefined {
  for (const p of paths) {
    try {
      if (p && existsSync(p)) return p;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function resolveBundledBrowserExecutablePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const programFiles = process.env.PROGRAMFILES;
  const programFilesX86 = process.env["PROGRAMFILES(X86)"];
  const localAppData = process.env.LOCALAPPDATA;

  const candidates: string[] = [];

  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    );
  } else if (process.platform === "win32") {
    // Edge
    if (programFiles) candidates.push(join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
    if (programFilesX86) candidates.push(join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"));

    // Chrome
    if (programFiles) candidates.push(join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
    if (programFilesX86) candidates.push(join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"));
    if (localAppData) candidates.push(join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));
  }

  return pickFirstExistingFile(candidates);
}

export type LaunchBrowserOptions = {
  headless: boolean;
  executable_path?: string;
  user_data_dir?: string;
  stealth?: boolean;
  preserve_on_disconnect?: boolean;
};

export type LaunchManualBrowserOptions = {
  executable_path?: string;
  user_data_dir: string;
  url: string;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Unable to allocate a local Chrome debugging port"));
        }
      });
    });
  });
}

export function launchManualBrowserWindow(options: LaunchManualBrowserOptions): ChildProcess {
  const executablePath = options.executable_path ?? resolveBundledBrowserExecutablePath() ?? undefined;
  if (!executablePath) {
    throw new Error("未找到可用的 Chrome / Edge。请在设置里配置本机浏览器路径后再打开登录页。");
  }

  mkdirSync(options.user_data_dir, { recursive: true });
  const browserArgs = [
    `--user-data-dir=${options.user_data_dir}`,
    "--no-first-run",
    "--no-default-browser-check",
    options.url,
  ];

  return spawn(executablePath, browserArgs, {
    env: process.env,
    stdio: "ignore",
  });
}

function fetchJson(url: string, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
    req.on("error", reject);
  });
}

async function readBrowserWSEndpointFromPort(port: number): Promise<string | null> {
  if (!Number.isFinite(port) || port <= 0) return null;
  const version = await fetchJson(`http://127.0.0.1:${port}/json/version`, 1000);
  return typeof version?.webSocketDebuggerUrl === "string" ? version.webSocketDebuggerUrl : null;
}

async function readExistingBrowserWSEndpoint(userDataDir: string): Promise<string | null> {
  const jobSyncPortPath = join(userDataDir, "JobSyncDevToolsActivePort");
  const activePortPath = join(userDataDir, "DevToolsActivePort");
  const candidateFiles = [jobSyncPortPath, activePortPath];

  for (const filePath of candidateFiles) {
    if (!existsSync(filePath)) continue;
    try {
      const [portLine] = readFileSync(filePath, "utf8").split(/\r?\n/);
      const port = Number.parseInt(portLine ?? "", 10);
      const endpoint = await readBrowserWSEndpointFromPort(port);
      if (endpoint) return endpoint;
    } catch {
      // Try the next marker; stale debugging-port files are expected after a crash.
    }
  }

  return null;
}

async function waitForBrowserWSEndpoint(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`, 1000);
      if (typeof version?.webSocketDebuggerUrl === "string") {
        return version.webSocketDebuggerUrl;
      }
    } catch (err) {
      lastError = err;
    }
    await wait(200);
  }

  throw new Error(`Unable to connect to detached Chrome debugging port ${port}: ${String(lastError ?? "timeout")}`);
}

async function launchDetachedPersistentBrowser(
  browserDriver: any,
  executablePath: string,
  args: string[],
  userDataDir: string,
): Promise<Browser> {
  mkdirSync(userDataDir, { recursive: true });

  const existingEndpoint = await readExistingBrowserWSEndpoint(userDataDir);
  if (existingEndpoint) {
    return await browserDriver.connect({ browserWSEndpoint: existingEndpoint });
  }

  rmSync(join(userDataDir, "DevToolsActivePort"), { force: true });
  const port = await findFreePort();
  const browserArgs = [
    ...args,
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];

  const child = spawn(executablePath, browserArgs, {
    detached: true,
    env: process.env,
    stdio: "ignore",
  });
  child.unref();

  try {
    const browserWSEndpoint = await waitForBrowserWSEndpoint(port, 15_000);
    writeFileSync(join(userDataDir, "JobSyncDevToolsActivePort"), `${port}\n`, "utf8");
    return await browserDriver.connect({ browserWSEndpoint });
  } catch (err) {
    if (child.pid) {
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
      } catch {
        // Best-effort cleanup for a Chrome process that never opened DevTools.
      }
    }
    throw err;
  }
}

export async function launchBrowser(options: LaunchBrowserOptions): Promise<{
  browser: Browser;
  page: Page;
}> {
  const useStealth = options.stealth !== false;
  const browserDriver = useStealth ? (puppeteerExtra as any).default ?? puppeteerExtra : puppeteer;
  if (useStealth) {
    await installPlugins(browserDriver);
  }

  const executablePath =
    options.executable_path ?? resolveBundledBrowserExecutablePath() ?? undefined;

  if (!executablePath && process.env.PUPPETEER_SKIP_DOWNLOAD) {
    throw new Error(
      "未找到可用的 Chrome / Edge。你设置了 PUPPETEER_SKIP_DOWNLOAD，Puppeteer 不会自动下载 Chrome for Testing。请设置 PUPPETEER_EXECUTABLE_PATH 指向本机浏览器可执行文件（例如 Chrome 或 Edge）。",
    );
  }

  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
  ];
  if (useStealth) {
    args.push("--disable-blink-features=AutomationControlled");
  }

  const browser = options.preserve_on_disconnect && options.user_data_dir && executablePath
    ? await launchDetachedPersistentBrowser(browserDriver, executablePath, args, options.user_data_dir)
    : await browserDriver.launch({
        headless: options.headless,
        executablePath,
        userDataDir: options.user_data_dir,
        args,
      });

  if (useStealth) {
    await applyStealthToAllPages(browser);
    await stripUaForAllPages(browser);
  }

  browser.on("targetcreated", async (target: Target) => {
    if (target.type() === "page") {
      const newPage = await target.page();
      if (newPage && useStealth) {
        await injectStealthScript(newPage);
        await stripHeadlessUserAgent(browser, newPage);
      }
    }
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  return { browser, page };
}
