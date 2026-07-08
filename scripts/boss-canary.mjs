import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const workerDir = path.join(projectRoot, "packages", "boss-crawler-worker");
const workerEntry = process.env.JOB_SYNC_BOSS_CANARY_WORKER_ENTRY || path.join(workerDir, "dist", "main.js");
const defaultProfileDir = path.join(os.homedir(), ".jobpilot", "boss-canary", "boss-browser-profile");

function usage() {
  return [
    "Usage:",
    "  npm run boss:canary -- --mode login",
    "  npm run boss:canary -- --keyword \"Go 远程\" --city 101020100 --max-pages 1 --max-jobs 1",
    "",
    "Options:",
    "  --mode <login|collect>     Open Boss login or run a low-volume collection canary. Default: collect",
    "  --keyword <text>           Boss search keyword. Default: Go 远程",
    "  --city <code>              Optional Boss city code, for example 101020100",
    "  --max-pages <n>            Page cap for collect mode. Default: 1",
    "  --max-jobs <n>             Low-volume cap for this smoke; direct worker page size is min(maxJobs, 15). Default: 1",
    "  --detail-limit <n>         Optional Boss detail fetch limit. Default: 0",
    "  --profile-dir <path>       Persistent browser profile. Default: ~/.jobpilot/boss-canary/boss-browser-profile",
    "  --timeout-ms <n>           Canary timeout. Default: 900000; 0 disables timeout",
    "  --allow-fallback-source    Allow DOM/API fallback capture to pass collect mode. Default requires capture_source=natural",
    "  --no-build                 Skip worker build before launch",
    "",
    "Success criteria:",
    "  login mode exits 0 after Boss login/session is captured.",
    "  collect mode exits 0 only after a finished run captures at least one Boss joblist job",
    "  from a natural search-page joblist response, unless --allow-fallback-source is set.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    mode: "collect",
    keyword: "Go 远程",
    city: "",
    maxPages: 1,
    maxJobs: 1,
    detailLimit: 0,
    profileDir: process.env.JOB_SYNC_BOSS_CANARY_PROFILE_DIR || defaultProfileDir,
    timeoutMs: Number.parseInt(process.env.JOB_SYNC_BOSS_CANARY_TIMEOUT_MS || "900000", 10),
    allowFallbackSource: process.env.JOB_SYNC_BOSS_CANARY_ALLOW_FALLBACK_SOURCE === "1",
    build: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = (name) => {
      const inline = arg.match(new RegExp(`^${name}=(.*)$`));
      if (inline) return inline[1];
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error(`${name} requires a value`);
      }
      index += 1;
      return next;
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--no-build") {
      options.build = false;
    } else if (arg === "--allow-fallback-source") {
      options.allowFallbackSource = true;
    } else if (arg === "--mode" || arg.startsWith("--mode=")) {
      options.mode = readValue("--mode");
    } else if (arg === "--keyword" || arg.startsWith("--keyword=")) {
      options.keyword = readValue("--keyword");
    } else if (arg === "--city" || arg.startsWith("--city=")) {
      options.city = readValue("--city");
    } else if (arg === "--max-pages" || arg.startsWith("--max-pages=")) {
      options.maxPages = parsePositiveInt(readValue("--max-pages"), "max-pages");
    } else if (arg === "--max-jobs" || arg.startsWith("--max-jobs=")) {
      options.maxJobs = parsePositiveInt(readValue("--max-jobs"), "max-jobs");
    } else if (arg === "--detail-limit" || arg.startsWith("--detail-limit=")) {
      options.detailLimit = parseNonNegativeInt(readValue("--detail-limit"), "detail-limit");
    } else if (arg === "--profile-dir" || arg.startsWith("--profile-dir=")) {
      options.profileDir = path.resolve(readValue("--profile-dir"));
    } else if (arg === "--timeout-ms" || arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parseNonNegativeInt(readValue("--timeout-ms"), "timeout-ms");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["login", "collect"].includes(options.mode)) {
    throw new Error("--mode must be login or collect");
  }
  if (!options.keyword.trim()) {
    throw new Error("--keyword must not be empty");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) {
    throw new Error("--timeout-ms must be a non-negative integer");
  }
  options.profileDir = path.resolve(options.profileDir);
  return options;
}

function collectMissingSuccessCriteria(options, summary) {
  const missing = [];
  if (summary.errors > 0) {
    missing.push(`worker emitted ${summary.errors} ERROR event(s)`);
  }
  if (summary.finishedEvents !== 1) {
    missing.push(`worker emitted ${summary.finishedEvents} FINISHED event(s), expected exactly 1`);
  }

  if (options.mode === "login") {
    if (summary.lastLoginStatus !== "valid") {
      missing.push(`last login status is ${summary.lastLoginStatus || "unknown"}, expected valid`);
    }
    if (!summary.cookieCollected || summary.cookieCount <= 0) {
      missing.push("Boss session cookies were not captured");
    }
    return missing;
  }

  const terminalRiskStatuses = new Set(["invalid", "captcha", "denied"]);
  if (terminalRiskStatuses.has(summary.lastLoginStatus)) {
    missing.push(`last login status is still ${summary.lastLoginStatus}; finish login/verification in the browser and rerun`);
  }
  if (summary.jobListEvents <= 0) {
    missing.push("no JOB_LIST_CAPTURED event was emitted");
  }
  if (summary.jobListJobs <= 0) {
    missing.push("JOB_LIST_CAPTURED did not contain any jobs");
  }
  if (!options.allowFallbackSource && summary.naturalJobListJobs <= 0) {
    missing.push("no capture_source=natural JOB_LIST_CAPTURED event with jobs was observed; use --allow-fallback-source only for fallback diagnostics");
  }

  return missing;
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${label} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${label} must be a non-negative integer`);
  }
  return parsed;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

function buildCommand(options) {
  if (options.mode === "login") {
    return {
      type: "LOGIN_START",
      payload: {
        source_platform: "boss",
        user_data_dir: options.profileDir,
      },
    };
  }

  const filters = {};
  if (options.city) filters.city = options.city;
  const pageSize = Math.max(1, Math.min(options.maxJobs, 15));
  return {
    type: "CRAWL_AUTO_START",
    payload: {
      user_data_dir: options.profileDir,
      session: {
        cookies: [],
        local_storage: {},
      },
      task: {
        mode: "auto",
        source_platform: "boss",
        keywords: [options.keyword],
        filters,
        limits: {
          maxPages: options.maxPages,
          maxJobs: options.maxJobs,
          pageSize,
          delayMs: 1200,
          jitterMs: 1200,
          bossDetailFetchLimit: options.detailLimit,
        },
      },
    },
  };
}

function countBossListJobs(raw) {
  const data = raw?.zpData;
  const list = data?.jobList ?? data?.list ?? data?.data ?? raw?.jobList ?? raw?.data;
  return Array.isArray(list) ? list.length : 0;
}

function sampleBossListJobs(raw) {
  const data = raw?.zpData;
  const list = data?.jobList ?? data?.list ?? data?.data ?? raw?.jobList ?? raw?.data;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 3).map((item) => {
    const job = item?.jobInfo && typeof item.jobInfo === "object" ? item.jobInfo : item;
    const name = job?.jobName ?? job?.positionName ?? job?.position_name ?? item?.jobName ?? item?.positionName;
    const brand = job?.brandName ?? item?.brandName ?? item?.brand_name;
    return [name, brand].filter(Boolean).join(" @ ");
  }).filter(Boolean);
}

function printEvent(event, summary) {
  switch (event?.type) {
    case "LOG":
      console.log(`[log:${event.payload?.level ?? "info"}] ${event.payload?.message ?? ""}`);
      if (event.payload?.message?.includes("已捕获搜索页自然 joblist 响应")) {
        summary.logSources.add("natural");
      }
      if (event.payload?.message?.includes("DOM 列表恢复")) {
        summary.logSources.add("dom_fallback");
      }
      if (event.payload?.message?.includes("页面内 GET")) {
        summary.logSources.add("page_get_fallback");
      }
      if (event.payload?.message?.includes("回退到接口请求")) {
        summary.logSources.add("api_fallback");
      }
      break;
    case "LOGIN_STATUS":
      summary.lastLoginStatus = event.payload?.status ?? "";
      console.log(`[login:${summary.lastLoginStatus}] ${event.payload?.message ?? ""}`);
      break;
    case "COOKIE_COLLECTED": {
      const cookieCount = Array.isArray(event.payload?.cookies) ? event.payload.cookies.length : 0;
      summary.cookieCollected = true;
      summary.cookieCount = cookieCount;
      console.log(`[session] collected ${cookieCount} cookies from ${event.payload?.source_platform ?? "boss"}`);
      break;
    }
    case "BOSS_META_SYNCED":
      console.log("[meta] Boss metadata captured");
      break;
    case "JOB_LIST_CAPTURED": {
      const source = event.payload?.capture_source ?? "unknown";
      summary.captureSources.add(source);
      const count = countBossListJobs(event.payload?.raw);
      summary.jobListEvents += 1;
      summary.jobListJobs += count;
      if (source === "natural") {
        summary.naturalJobListJobs += count;
      } else {
        summary.fallbackJobListJobs += count;
      }
      console.log(`[joblist] keyword=${event.payload?.keyword ?? ""} source=${source} jobs=${count}`);
      for (const line of sampleBossListJobs(event.payload?.raw)) {
        console.log(`  - ${line}`);
      }
      break;
    }
    case "JOB_DETAIL_CAPTURED":
      summary.detailEvents += 1;
      console.log(`[detail] ${event.payload?.encrypt_job_id ?? ""}`);
      break;
    case "JOB_FILTERED":
      summary.filteredEvents += 1;
      console.log(`[filtered] ${event.payload?.encrypt_job_id ?? "(no id)"} ${JSON.stringify(event.payload?.reason ?? {})}`);
      break;
    case "ERROR":
      summary.errors += 1;
      console.error(`[error] ${event.payload?.message ?? "unknown error"}`);
      if (event.payload?.stack) console.error(event.payload.stack);
      break;
    case "FINISHED":
      summary.finishedEvents += 1;
      console.log("[finished]");
      break;
    default:
      console.log(`[event:${event?.type ?? "unknown"}] ${JSON.stringify(event)}`);
      break;
  }
}

async function runWorkerCanary(options) {
  await fs.mkdir(options.profileDir, { recursive: true });
  if (options.build) {
    await runCommand("npm", ["-w", "@job-sync/boss-crawler-worker", "run", "build"]);
  }

  const command = buildCommand(options);
  const summary = {
    lastLoginStatus: "",
    cookieCollected: false,
    cookieCount: 0,
    jobListEvents: 0,
    jobListJobs: 0,
    detailEvents: 0,
    filteredEvents: 0,
    errors: 0,
    finishedEvents: 0,
    captureSources: new Set(),
    logSources: new Set(),
    naturalJobListJobs: 0,
    fallbackJobListJobs: 0,
  };

  console.log(`[canary] mode=${options.mode}`);
  console.log(`[canary] profile=${options.profileDir}`);
  console.log("[canary] If Boss asks for login or verification, complete it in the opened browser window; the worker will retry.");
  if (options.mode === "collect") {
    console.log(`[canary] keyword="${options.keyword}" city=${options.city || "(default)"} maxPages=${options.maxPages} maxJobs=${options.maxJobs} detailLimit=${options.detailLimit}`);
    console.log(`[canary] required source=${options.allowFallbackSource ? "any" : "natural"}`);
    console.log("[canary] This direct worker smoke verifies capture events only; it does not write DB rows. App-side insertion is handled by Tauri sidecar.");
  }

  const child = spawn(process.execPath, [workerEntry], {
    cwd: workerDir,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

  let settled = false;
  let stopSent = false;
  let stderr = "";

  const finish = (code) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    child.stdin.end();
    child.kill();
    const missingCriteria = collectMissingSuccessCriteria(options, summary);
    const success = missingCriteria.length === 0;
    const sources = Array.from(summary.captureSources).join(",") || "unknown";
    const logSources = Array.from(summary.logSources).join(",") || "none";
    console.log(
      `[summary] login=${summary.lastLoginStatus || "unknown"} sources=${sources} logSources=${logSources} jobListEvents=${summary.jobListEvents} jobListJobs=${summary.jobListJobs} naturalJobs=${summary.naturalJobListJobs} fallbackJobs=${summary.fallbackJobListJobs} details=${summary.detailEvents} filtered=${summary.filteredEvents} errors=${summary.errors} finished=${summary.finishedEvents}`,
    );
    if (stderr.trim()) console.error(`[stderr]\n${stderr.trim()}`);
    if (!success) {
      console.error("[failed] Canary did not meet success criteria:");
      for (const criterion of missingCriteria) {
        console.error(`- ${criterion}`);
      }
    }
    process.exitCode = typeof code === "number" && code !== 0
      ? code
      : success
        ? 0
        : 2;
  };

  const timer = options.timeoutMs > 0
    ? setTimeout(() => {
        console.error(`[timeout] Canary timed out after ${options.timeoutMs} ms. Sending STOP.`);
        sendStop();
        setTimeout(() => finish(124), 1500);
      }, options.timeoutMs)
    : null;

  function sendStop() {
    if (stopSent || child.killed) return;
    stopSent = true;
    child.stdin.write(`${JSON.stringify({ type: "STOP" })}\n`);
  }

  process.once("SIGINT", () => {
    console.log("\n[canary] SIGINT received, stopping worker...");
    sendStop();
    setTimeout(() => finish(130), 1500);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      console.log(`[stdout] ${line}`);
      return;
    }
    printEvent(event, summary);
    if (event?.type === "FINISHED") {
      child.stdin.end();
    }
  });

  child.on("error", (error) => {
    console.error(error);
    finish(1);
  });

  child.on("exit", (code, signal) => {
    if (signal && !settled) {
      console.error(`[worker] exited by signal ${signal}`);
    }
    finish(code ?? 1);
  });

  child.stdin.write(`${JSON.stringify(command)}\n`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    await runWorkerCanary(options);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(usage());
  process.exitCode = 1;
}
