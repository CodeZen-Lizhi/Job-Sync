import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const canaryScript = path.join(repoRoot, "scripts", "zhilian-canary.mjs");

function createFakeWorker() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhilian-canary-test-"));
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
        JOB_SYNC_ZHILIAN_CANARY_WORKER_ENTRY: workerPath,
        FAKE_EVENTS_JSON: JSON.stringify(events),
      },
    },
  );
}

function zhilianJobEvent(id = "CCL1405333700J40877845205") {
  return {
    type: "JOB_NORMALIZED_CAPTURED",
    payload: {
      encrypt_job_id: `zhilian:${id}`,
      source_platform: "zhilian",
      position_name: "java 开发工程师",
      brand_name: "北京捷科智诚科技有限公司上海分公司",
      city_name: "北京·顺义·双丰",
      salary_desc: "1.3-1.7万",
      raw_payload: { detail_status: "missing" },
    },
  };
}

test("Zhilian canary passes collect mode when normalized jobs are captured", () => {
  const result = runCanary([
    { type: "PROGRESS", payload: { captured_job_list: 19 } },
    zhilianJobEvent(),
    { type: "FINISHED" },
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /normalizedJobs=1/);
  assert.match(result.stdout, /zhilian:CCL1405333700J40877845205/);
});

test("Zhilian canary rejects collect mode without normalized jobs", () => {
  const result = runCanary([{ type: "FINISHED" }]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /no JOB_NORMALIZED_CAPTURED event was emitted/);
});

test("Zhilian canary rejects worker errors even with normalized jobs", () => {
  const result = runCanary([
    zhilianJobEvent(),
    { type: "ERROR", payload: { message: "智联登录/验证状态不可用" } },
    { type: "FINISHED" },
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /worker emitted 1 ERROR event/);
});

test("Zhilian canary accepts login mode only after a valid captured session", () => {
  const result = runCanary([
    { type: "LOGIN_STATUS", payload: { status: "valid" } },
    { type: "COOKIE_COLLECTED", payload: { source_platform: "zhilian", cookies: [{ name: "x-zp-client-id", value: "x" }], local_storage: {} } },
    { type: "FINISHED" },
  ], ["--mode", "login"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /collected 1 cookies/);
});

test("Zhilian canary rejects login mode when the profile is still under verification", () => {
  const result = runCanary([
    { type: "LOGIN_STATUS", payload: { status: "captcha" } },
    { type: "FINISHED" },
  ], ["--mode", "login"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /last login status is captcha, expected valid/);
  assert.match(result.stderr, /Zhilian session cookies were not captured/);
});

test("Zhilian canary rejects non-Zhilian normalized ids", () => {
  const result = runCanary([
    {
      type: "JOB_NORMALIZED_CAPTURED",
      payload: {
        encrypt_job_id: "boss:123",
        position_name: "Wrong source",
      },
    },
    { type: "FINISHED" },
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing a zhilian:<id>/);
});
