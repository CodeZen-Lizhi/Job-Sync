import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import puppeteer from "puppeteer";

const DEFAULT_PORT = 1431;
const DEFAULT_ITERATIONS = 9;
const START_ROUTE = "/settings";
const TARGETS = [
  { route: "/crawl", label: "采集", heading: "岗位采集" },
  { route: "/crawl-config", label: "采集配置", heading: "采集配置" },
];

const port = Number(process.env.PORT || DEFAULT_PORT);
const iterations = Number(process.env.ITERATIONS || DEFAULT_ITERATIONS);
const serverMode = process.argv.includes("--preview") || process.env.PERF_SERVER === "preview" ? "preview" : "dev";
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await wait(250);
  }
  throw new Error(`Vite ${serverMode} server did not become ready at ${url}`);
}

function startVite() {
  const script = serverMode === "preview" ? "preview" : "dev";
  const child = spawn(
    "npm",
    ["run", script, "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: process.cwd(),
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

function resolveBrowserExecutablePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    );
  }
  if (process.platform === "win32") {
    const programFiles = process.env.PROGRAMFILES;
    const programFilesX86 = process.env["PROGRAMFILES(X86)"];
    const localAppData = process.env.LOCALAPPDATA;
    if (programFiles) candidates.push(join(programFiles, "Google", "Chrome", "Application", "chrome.exe"));
    if (programFilesX86) candidates.push(join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"));
    if (localAppData) candidates.push(join(localAppData, "Google", "Chrome", "Application", "chrome.exe"));
    if (programFiles) candidates.push(join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"));
    if (programFilesX86) candidates.push(join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"));
  }

  return candidates.find((candidate) => existsSync(candidate));
}

async function closeProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(2_000).then(() => child.kill("SIGKILL")),
  ]);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function summarize(values) {
  return {
    samples: values.length,
    min: Math.min(...values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: Math.max(...values),
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

async function clickNavAndMeasure(page, target) {
  await page.evaluate((label) => {
    const links = Array.from(document.querySelectorAll("a"));
    const link = links.find((item) => item.textContent?.trim() === label);
    if (!link) throw new Error(`Missing nav link: ${label}`);
    performance.mark("route-click-start");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  }, target.label);

  await page.waitForFunction(
    (heading, route) => {
      const hasHeading = Array.from(document.querySelectorAll("h1")).some((item) => item.textContent?.trim() === heading);
      return window.location.hash.endsWith(route) && hasHeading;
    },
    { timeout: 10_000 },
    target.heading,
    target.route,
  );

  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    performance.mark("route-click-ready");
    performance.measure("route-click", "route-click-start", "route-click-ready");
    const entries = performance.getEntriesByName("route-click");
    const latest = entries[entries.length - 1];
    performance.clearMarks("route-click-start");
    performance.clearMarks("route-click-ready");
    performance.clearMeasures("route-click");
    return latest.duration;
  });
}

async function measureTarget(page, target) {
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    await page.goto(`${baseUrl}/#${START_ROUTE}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("nav a", { timeout: 10_000 });
    values.push(await clickNavAndMeasure(page, target));
  }
  return values;
}

async function main() {
  const vite = startVite();
  let browser;
  try {
    await waitForServer(baseUrl);
    browser = await puppeteer.launch({
      headless: "new",
      executablePath: resolveBrowserExecutablePath(),
      defaultViewport: { width: 1280, height: 900 },
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        process.stderr.write(`[browser:${message.type()}] ${message.text()}\n`);
      }
    });

    const results = [];
    for (const target of TARGETS) {
      const values = await measureTarget(page, target);
      const summary = summarize(values);
      results.push({
        route: target.route,
        samples: summary.samples,
        minMs: round(summary.min),
        p50Ms: round(summary.p50),
        p95Ms: round(summary.p95),
        maxMs: round(summary.max),
      });
    }

    console.table(results);
    console.log(JSON.stringify({ baseUrl, iterations, serverMode, results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await closeProcess(vite);
  }
}

main().catch(async (cause) => {
  console.error(cause);
  process.exitCode = 1;
});
