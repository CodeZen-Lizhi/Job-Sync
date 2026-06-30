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
const workerEntry = process.env.JOB_SYNC_ZHILIAN_CANARY_WORKER_ENTRY || path.join(workerDir, "dist", "main.js");
const defaultProfileDir = path.join(os.homedir(), ".jobpilot", "zhilian-canary", "zhilian-browser-profile");

function usage() {
  return [
    "Usage:",
    "  npm run zhilian:canary -- --mode login",
    "  npm run zhilian:canary -- --keyword Java --city 530 --max-pages 1 --max-jobs 20",
    "",
    "Options:",
    "  --mode <login|collect>     Open Zhilian connection page or run a collection canary. Default: collect",
    "  --keyword <text>           Zhilian search keyword. Default: Java",
    "  --city <code-or-text>      Optional Zhilian city/region, for example 530 for Beijing",
    "  --max-pages <n>            Page cap for collect mode. Default: 1",
    "  --max-jobs <n>             Low-volume cap for this smoke. Default: 20",
    "  --profile-dir <path>       Persistent browser profile. Default: ~/.jobpilot/zhilian-canary/zhilian-browser-profile",
    "  --timeout-ms <n>           Canary timeout. Default: 90000; 0 disables timeout",
    "  --no-build                 Skip worker build before launch",
    "",
    "Success criteria:",
    "  login mode exits 0 after the Zhilian search page is marked valid and cookies are captured.",
    "  collect mode exits 0 only after a finished run emits at least one JOB_NORMALIZED_CAPTURED event and no ERROR.",
    "  This direct worker smoke verifies capture events only; app-side insertion is handled by Tauri sidecar.",
  ].join("\n");
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

function parseArgs(argv) {
  const options = {
    mode: "collect",
    keyword: "Java",
    city: "530",
    maxPages: 1,
    maxJobs: 20,
    profileDir: process.env.JOB_SYNC_ZHILIAN_CANARY_PROFILE_DIR || defaultProfileDir,
    timeoutMs: Number.parseInt(process.env.JOB_SYNC_ZHILIAN_CANARY_TIMEOUT_MS || "90000", 10),
    build: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = (name) => {
      const inline = arg.match(new RegExp(`^${name}=(.*)$`));
      if (inline) return inline[1];
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error(`${name} requires a value`);
      index += 1;
      return next;
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--no-build") {
      options.build = false;
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
    } else if (arg === "--profile-dir" || arg.startsWith("--profile-dir=")) {
      options.profileDir = path.resolve(readValue("--profile-dir"));
    } else if (arg === "--timeout-ms" || arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parseNonNegativeInt(readValue("--timeout-ms"), "timeout-ms");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["login", "collect"].includes(options.mode)) throw new Error("--mode must be login or collect");
  if (!options.keyword.trim()) throw new Error("--keyword must not be empty");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0) throw new Error("--timeout-ms must be a non-negative integer");
  options.profileDir = path.resolve(options.profileDir);
  return options;
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
        source_platform: "zhilian",
        user_data_dir: options.profileDir,
      },
    };
  }

  const filters = {};
  if (options.city.trim()) filters.city = options.city.trim();
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
        source_platform: "zhilian",
        keywords: [options.keyword],
        filters,
        limits: {
          maxPages: options.maxPages,
          maxJobs: options.maxJobs,
          pageSize: Math.max(1, options.maxJobs),
          delayMs: 0,
        },
      },
    },
  };
}

function collectMissingSuccessCriteria(options, summary) {
  const missing = [];
  if (summary.errors > 0) missing.push(`worker emitted ${summary.errors} ERROR event(s)`);
  if (summary.finishedEvents !== 1) missing.push(`worker emitted ${summary.finishedEvents} FINISHED event(s), expected exactly 1`);

  if (options.mode === "login") {
    if (summary.lastLoginStatus !== "valid") {
      missing.push(`last login status is ${summary.lastLoginStatus || "unknown"}, expected valid`);
    }
    if (!summary.cookieCollected || summary.cookieCount <= 0) {
      missing.push("Zhilian session cookies were not captured");
    }
    return missing;
  }

  if (summary.normalizedJobs <= 0) missing.push("no JOB_NORMALIZED_CAPTURED event was emitted");
  if (!summary.firstJob?.encrypt_job_id?.startsWith("zhilian:")) {
    missing.push("first captured job is missing a zhilian:<id> encrypt_job_id");
  }
  return missing;
}

function printEvent(event, summary) {
  switch (event?.type) {
    case "LOG":
      console.log(`[log:${event.payload?.level ?? "info"}] ${event.payload?.message ?? ""}`);
      break;
    case "LOGIN_STATUS":
      summary.lastLoginStatus = event.payload?.status ?? "";
      console.log(`[login:${summary.lastLoginStatus}] ${event.payload?.message ?? ""}`);
      break;
    case "COOKIE_COLLECTED": {
      const cookieCount = Array.isArray(event.payload?.cookies) ? event.payload.cookies.length : 0;
      summary.cookieCollected = true;
      summary.cookieCount = cookieCount;
      console.log(`[session] collected ${cookieCount} cookies from ${event.payload?.source_platform ?? "zhilian"}`);
      break;
    }
    case "PROGRESS":
      if (typeof event.payload?.captured_job_list === "number") {
        summary.listJobs = Math.max(summary.listJobs, event.payload.captured_job_list);
      }
      console.log(`[progress] ${JSON.stringify(event.payload ?? {})}`);
      break;
    case "JOB_NORMALIZED_CAPTURED": {
      summary.normalizedJobs += 1;
      if (!summary.firstJob) summary.firstJob = event.payload;
      const payload = event.payload ?? {};
      console.log(`[job#${summary.normalizedJobs}] ${payload.position_name ?? payload.encrypt_job_id} @ ${payload.brand_name ?? ""} | ${payload.city_name ?? ""} | ${payload.salary_desc ?? ""}`);
      break;
    }
    case "ERROR":
      summary.errors += 1;
      console.error(`[error] ${event.payload?.message ?? "unknown error"}`);
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
    listJobs: 0,
    normalizedJobs: 0,
    firstJob: null,
    errors: 0,
    finishedEvents: 0,
  };

  console.log(`[canary] mode=${options.mode}`);
  console.log(`[canary] profile=${options.profileDir}`);
  if (options.mode === "collect") {
    console.log(`[canary] keyword="${options.keyword}" city=${options.city || "(default)"} maxPages=${options.maxPages} maxJobs=${options.maxJobs}`);
    console.log("[canary] This direct worker smoke verifies capture events only; app-side insertion is handled by Tauri sidecar.");
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
    console.log(
      `[summary] login=${summary.lastLoginStatus || "unknown"} listJobs=${summary.listJobs} normalizedJobs=${summary.normalizedJobs} errors=${summary.errors} finished=${summary.finishedEvents}`,
    );
    if (summary.firstJob) {
      console.log(`[first] ${JSON.stringify({
        encrypt_job_id: summary.firstJob.encrypt_job_id,
        position_name: summary.firstJob.position_name,
        brand_name: summary.firstJob.brand_name,
        city_name: summary.firstJob.city_name,
        salary_desc: summary.firstJob.salary_desc,
        detail_status: summary.firstJob.raw_payload?.detail_status,
      })}`);
    }
    if (stderr.trim()) console.error(`[stderr]\n${stderr.trim()}`);
    if (!success) {
      console.error("[failed] Canary did not meet success criteria:");
      for (const criterion of missingCriteria) console.error(`- ${criterion}`);
    }
    process.exitCode = typeof code === "number" && code !== 0
      ? code
      : success
        ? 0
        : 2;
  };

  function sendStop() {
    if (stopSent || child.killed) return;
    stopSent = true;
    child.stdin.write(`${JSON.stringify({ type: "STOP" })}\n`);
  }

  const timer = options.timeoutMs > 0
    ? setTimeout(() => {
        console.error(`[timeout] Canary timed out after ${options.timeoutMs} ms. Sending STOP.`);
        sendStop();
        setTimeout(() => finish(124), 1500);
      }, options.timeoutMs)
    : null;

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
    if (event?.type === "FINISHED") child.stdin.end();
  });

  child.on("error", (error) => {
    console.error(error);
    finish(1);
  });

  child.on("exit", (code, signal) => {
    if (signal && !settled) console.error(`[worker] exited by signal ${signal}`);
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
