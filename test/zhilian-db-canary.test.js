import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const canaryScript = path.join(repoRoot, "scripts", "zhilian-db-canary.mjs");
const sqliteAvailable = spawnSync("sqlite3", ["--version"], { encoding: "utf8" }).status === 0;

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function createFixtureDb({
  detailStatus = "missing",
  omitTopLevelDetailStatus = false,
  sourcePlatform = "zhilian",
  sourceUrl = "https://www.zhaopin.com/jobdetail/CCL1405333700J40877845205.htm",
  directoryPrefix = "zhilian-db-canary-test-",
} = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), directoryPrefix));
  const dbPath = path.join(tmpDir, "app.db");
  const detailJson = JSON.stringify({
    ...(!omitTopLevelDetailStatus ? { detailStatus } : {}),
    jobInfo: {
      postDescription: "列表页证据：java 开发工程师 / 北京捷科智诚科技有限公司上海分公司 / 北京·顺义·双丰 / 1.3-1.7万。详情暂未抓取，需打开原岗位确认。",
    },
    rawPayload: {
      detail_status: detailStatus,
    },
  });
  const rawPayloadJson = JSON.stringify({
    source_platform: "zhilian",
    detail_status: detailStatus,
    tags: ["Java", "本科"],
  });
  const filtersJson = JSON.stringify({ city: "530" });
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
      salary_desc TEXT,
      experience_name TEXT,
      degree_name TEXT,
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

    INSERT INTO collection_run (
      id, source_platform, keywords_json, filters_json, limits_json,
      status, started_at, finished_at, error_message,
      captured, inserted, updated, duplicate,
      recommended, pending, filtered, failed, processed, all_jobs
    ) VALUES (
      'run_zhilian_fixture', 'zhilian', '["Java"]', ${sqlString(filtersJson)}, '{}',
      'finished', '2026-06-30T00:00:00Z', '2026-06-30T00:05:00Z', NULL,
      1, 1, 0, 0,
      0, 1, 0, 0, 1, 1
    );
    INSERT INTO job (
      encrypt_job_id, source_platform, source_url, dedup_key,
      position_name, brand_name, city_name, salary_desc,
      experience_name, degree_name, raw_payload_json
    ) VALUES (
      'zhilian:CCL1405333700J40877845205', ${sqlString(sourcePlatform)}, ${sqlString(sourceUrl)}, 'CCL1405333700J40877845205',
      'java 开发工程师', '北京捷科智诚科技有限公司上海分公司', '北京·顺义·双丰', '1.3-1.7万',
      '3-5年', '本科', ${sqlString(rawPayloadJson)}
    );
    INSERT INTO job_source_link (encrypt_job_id, keyword, filters_json, captured_at)
    VALUES ('zhilian:CCL1405333700J40877845205', 'Java', ${sqlString(filtersJson)}, '2026-06-30T00:02:00Z');
    INSERT INTO job_detail_raw (encrypt_job_id, zp_data_json, fetched_at)
    VALUES ('zhilian:CCL1405333700J40877845205', ${sqlString(detailJson)}, '2026-06-30T00:01:00Z');
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
      "run_zhilian_fixture",
      "--keyword",
      "Java",
      "--city",
      "530",
      "--since-minutes",
      "0",
      "--require-insert",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
}

test("Zhilian DB canary accepts list-level sidecar evidence", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[OK\] Zhilian DB canary passed/);
  assert.match(result.stdout, /"detailStatus": "missing"/);
});

test("Zhilian DB canary reads app DB paths containing spaces", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({ directoryPrefix: "zhilian db canary test-" }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[OK\] Zhilian DB canary passed/);
});

test("Zhilian DB canary accepts blocked detail evidence", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({ detailStatus: "blocked" }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"detailStatus": "blocked"/);
});

test("Zhilian DB canary accepts http Zhilian detail URLs from real search pages", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({
    sourceUrl: "http://www.zhaopin.com/jobdetail/CCL1405333700J40877845205.htm?refcode=4019",
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[OK\] Zhilian DB canary passed/);
});

test("Zhilian DB canary reads detail status from normalized raw payload fallback", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({ detailStatus: "missing", omitTopLevelDetailStatus: true }));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"detailStatus": "missing"/);
});

test("Zhilian DB canary rejects non-Zhilian source rows", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({ sourcePlatform: "boss" }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\] Zhilian DB canary failed/);
  assert.match(result.stderr, /no Zhilian job evidence rows found/);
});

test("Zhilian DB canary rejects non-Zhilian detail URLs", { skip: !sqliteAvailable && "sqlite3 is not available" }, () => {
  const result = runCanary(createFixtureDb({ sourceUrl: "https://example.com/job" }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[FAIL\] Zhilian DB canary failed/);
  assert.match(result.stderr, /no complete Zhilian DB evidence row found/);
});
