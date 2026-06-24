import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const canaryScript = path.join(repoRoot, "scripts", "boss-canary.mjs");

function createFakeWorker() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-canary-test-"));
  const workerPath = path.join(tmpDir, "fake-worker.mjs");
  fs.writeFileSync(
    workerPath,
    `
      import { createInterface } from "node:readline";

      const events = JSON.parse(process.env.FAKE_EVENTS_JSON || "[]");
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      lines.once("line", () => {
        for (const event of events) {
          console.log(JSON.stringify(event));
        }
        setTimeout(() => process.exit(0), 10);
      });
    `,
    "utf8",
  );
  return { tmpDir, workerPath };
}

function runCanary(events, args = []) {
  const { tmpDir, workerPath } = createFakeWorker();
  const profileDir = path.join(tmpDir, "profile");
  return spawnSync(
    process.execPath,
    [
      canaryScript,
      "--no-build",
      "--profile-dir",
      profileDir,
      "--timeout-ms",
      "5000",
      ...args,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        JOB_SYNC_BOSS_CANARY_WORKER_ENTRY: workerPath,
        FAKE_EVENTS_JSON: JSON.stringify(events),
      },
    },
  );
}

function jobListEvent(captureSource, jobs = [{ jobName: "Go Remote Engineer", brandName: "Canary Co" }]) {
  return {
    type: "JOB_LIST_CAPTURED",
    payload: {
      keyword: "Go Remote",
      capture_source: captureSource,
      raw: { zpData: { jobList: jobs } },
    },
  };
}

test("Boss canary passes collect mode only when natural joblist jobs are captured by default", () => {
  const result = runCanary([jobListEvent("natural"), { type: "FINISHED" }]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /naturalJobs=1/);
});

test("Boss canary rejects fallback-only collection by default", () => {
  const result = runCanary([jobListEvent("api_fallback"), { type: "FINISHED" }]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /no capture_source=natural JOB_LIST_CAPTURED event with jobs was observed/);
});

test("Boss canary can allow fallback collection for diagnostics", () => {
  const result = runCanary([jobListEvent("api_fallback"), { type: "FINISHED" }], ["--allow-fallback-source"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /fallbackJobs=1/);
});

test("Boss canary rejects worker errors even with natural jobs", () => {
  const result = runCanary([
    jobListEvent("natural"),
    { type: "ERROR", payload: { message: "risk page" } },
    { type: "FINISHED" },
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /worker emitted 1 ERROR event/);
});

test("Boss canary rejects missing FINISHED", () => {
  const result = runCanary([jobListEvent("natural")]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /worker emitted 0 FINISHED event/);
});

test("Boss canary rejects terminal verification status", () => {
  const result = runCanary([
    { type: "LOGIN_STATUS", payload: { status: "captcha", message: "verify" } },
    jobListEvent("natural"),
    { type: "FINISHED" },
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /last login status is still captcha/);
});

test("Boss canary accepts login mode only after a valid captured Boss session", () => {
  const result = runCanary([
    { type: "LOGIN_STATUS", payload: { status: "valid" } },
    { type: "COOKIE_COLLECTED", payload: { source_platform: "boss", cookies: [{ name: "wt2", value: "x" }], local_storage: {} } },
    { type: "FINISHED" },
  ], ["--mode", "login"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /collected 1 cookies/);
});
