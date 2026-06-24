import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const canaryScript = path.join(repoRoot, "scripts", "boss-db-canary.mjs");
const sqliteAvailable = spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function createFixtureDb({
  detailStatus = "list_only",
  filterUpdatedAt = "2026-06-23T00:03:00Z",
} = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-db-canary-test-"));
  const dbPath = path.join(tmpDir, "app.db");
  const detailJson = JSON.stringify({
    detailStatus,
    jobInfo: {
      postDescription: "List evidence description",
    },
  });
  const reasonJson = JSON.stringify({ bucket: "recommended" });
  const rawPayloadJson = JSON.stringify({ jobName: "Go Remote", brandName: "Canary Co" });
  const filtersJson = JSON.stringify({ city: "101020100" });
  const sql = `
    CREATE TABLE collection_run (
      id TEXT PRIMARY KEY,
      source_platform TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      filters_json TEXT,
      limits_json TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      error_message TEXT,
      captured INTEGER,
      inserted INTEGER,
      updated INTEGER,
      duplicate INTEGER,
      recommended INTEGER,
      pending INTEGER,
      filtered INTEGER,
      failed INTEGER,
      processed INTEGER,
      all_jobs INTEGER
    );
    CREATE TABLE collection_failure (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      source_platform TEXT,
      event_type TEXT NOT NULL,
      keyword TEXT,
      encrypt_job_id TEXT,
      reason TEXT NOT NULL,
      raw_payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE job (
      encrypt_job_id TEXT PRIMARY KEY,
      source_platform TEXT NOT NULL,
      source_url TEXT,
      dedup_key TEXT,
      position_name TEXT,
      brand_name TEXT,
      city_name TEXT,
      raw_payload_json TEXT
    );
    CREATE TABLE job_source_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      encrypt_job_id TEXT NOT NULL,
      keyword TEXT,
      filters_json TEXT,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE job_detail_raw (
      encrypt_job_id TEXT PRIMARY KEY,
      zp_data_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE job_filter_result (
      encrypt_job_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      eligible INTEGER NOT NULL,
      reason_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    INSERT INTO collection_run (
      id, source_platform, keywords_json, filters_json, limits_json,
      status, started_at, finished_at, error_message,
      captured, inserted, updated, duplicate,
      recommended, pending, filtered, failed, processed, all_jobs
    ) VALUES (
      'run_canary_fixture', 'boss', '["Go Remote"]', ${sqlString(filtersJson)}, '{}',
      'finished', '2026-06-23T00:00:00Z', '2026-06-23T00:05:00Z', NULL,
      1, 1, 0, 0,
      1, 0, 0, 0, 1, 1
    );
    INSERT INTO job (
      encrypt_job_id, source_platform, source_url, dedup_key,
      position_name, brand_name, city_name, raw_payload_json
    ) VALUES (
      'sec-1', 'boss', 'https://www.zhipin.com/job_detail/sec-1.html', 'sec-1',
      'Go Remote Engineer', 'Canary Co', 'Shanghai', ${sqlString(rawPayloadJson)}
    );
    INSERT INTO job_source_link (encrypt_job_id, keyword, filters_json, captured_at)
    VALUES ('sec-1', 'Go Remote', ${sqlString(filtersJson)}, '2026-06-23T00:02:00Z');
    INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
    VALUES ('sec-1', ${sqlString(detailJson)}, '2026-06-23T00:01:00Z');
    INSERT INTO job_filter_result (encrypt_job_id, profile_id, eligible, reason_json, updated_at)
    VALUES ('sec-1', 'default', 1, ${sqlString(reasonJson)}, ${sqlString(filterUpdatedAt)});
  `;

  execFileSync("sqlite3", [dbPath], { input: sql, encoding: "utf8" });
  return dbPath;
}

function runCanary(dbPath) {
  return spawnSync(
    process.execPath,
    [
      canaryScript,
      "--db-path",
      dbPath,
      "--run-id",
      "run_canary_fixture",
      "--keyword",
      "Go Remote",
      "--city",
      "101020100",
      "--since-minutes",
      "0",
      "--require-insert",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

test("Boss DB canary accepts fresh list-only sidecar evidence", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[OK\] Boss DB canary passed/);
  assert.match(result.stdout, /"detailStatus": "list_only"/);
});

test("Boss DB canary rejects non-list-only detail payloads by default", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({ detailStatus: "detail_payload" }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\] Boss DB canary failed/);
  assert.match(result.stderr, /"detail_status":"detail_payload"/);
});

test("Boss DB canary rejects stale filter results from before the source link", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({ filterUpdatedAt: "2026-06-23T00:01:00Z" }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\] Boss DB canary failed/);
  assert.match(result.stderr, /"filter_updated_after_link":0/);
});
