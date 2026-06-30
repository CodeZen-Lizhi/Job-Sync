import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const appIdentifier = "com.administrator.jobpilot";
const defaultSinceMinutes = 180;
const fatalEventTypes = ["ERROR", "WORKER_EXIT", "CRAWL_AUTO_START"];

function usage() {
  return [
    "Usage:",
    "  npm run zhilian:db-canary -- --keyword Java --city 530",
    "  npm run zhilian:db-canary -- --run-id run_123 --since-minutes 0",
    "",
    "Options:",
    "  --db-path <path>          SQLite app.db path. Default: macOS JobPilot app data app.db",
    "  --data-dir <path>         App data directory containing app.db",
    "  --run-id <id>             Check one collection_run id instead of latest Zhilian run",
    "  --keyword <text>          Require the run/source link keyword to match",
    "  --city <code>             Require filters_json city to match",
    "  --since-minutes <n>       Only consider recent runs. Default: 180; 0 disables",
    "  --require-insert          Require inserted > 0 instead of inserted+updated+duplicate > 0",
    "",
    "Success criteria:",
    "  latest Zhilian run is finished without errors, has real DB activity, and has",
    "  matching job, job_source_link, and job_detail_raw rows with list-level evidence.",
  ].join("\n");
}

function defaultAppDataDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appIdentifier);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), appIdentifier);
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), appIdentifier);
}

function parseArgs(argv) {
  const options = {
    dbPath: process.env.JOB_SYNC_DB_PATH || "",
    dataDir: process.env.JOB_SYNC_DATA_DIR || "",
    runId: "",
    keyword: "",
    city: "",
    sinceMinutes: Number.parseInt(process.env.JOB_SYNC_ZHILIAN_DB_CANARY_SINCE_MINUTES || String(defaultSinceMinutes), 10),
    requireInsert: false,
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
    } else if (arg === "--require-insert") {
      options.requireInsert = true;
    } else if (arg === "--db-path" || arg.startsWith("--db-path=")) {
      options.dbPath = readValue("--db-path");
    } else if (arg === "--data-dir" || arg.startsWith("--data-dir=")) {
      options.dataDir = readValue("--data-dir");
    } else if (arg === "--run-id" || arg.startsWith("--run-id=")) {
      options.runId = readValue("--run-id");
    } else if (arg === "--keyword" || arg.startsWith("--keyword=")) {
      options.keyword = readValue("--keyword");
    } else if (arg === "--city" || arg.startsWith("--city=")) {
      options.city = readValue("--city");
    } else if (arg === "--since-minutes" || arg.startsWith("--since-minutes=")) {
      options.sinceMinutes = parseNonNegativeInt(readValue("--since-minutes"), "since-minutes");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.sinceMinutes) || options.sinceMinutes < 0) {
    throw new Error("--since-minutes must be a non-negative integer");
  }

  const dataDir = options.dataDir ? path.resolve(options.dataDir) : defaultAppDataDir();
  options.dbPath = path.resolve(options.dbPath || path.join(dataDir, "app.db"));
  options.keyword = options.keyword.trim();
  options.city = options.city.trim();
  options.runId = options.runId.trim();
  return options;
}

function parseNonNegativeInt(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${label} must be a non-negative integer`);
  }
  return parsed;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlLike(value) {
  return sqlString(`%${String(value).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
}

function sqliteReadOnlyUri(dbPath) {
  return `file:${path.resolve(dbPath)}?mode=ro&cache=shared`;
}

function runSql(dbPath, sql) {
  return runSqlite(["-json", "-cmd", ".timeout 5000", sqliteReadOnlyUri(dbPath), sql]).catch((err) => {
    if (!String(err instanceof Error ? err.message : err).includes("unable to open database file")) {
      throw err;
    }
    return runSqlite(["-readonly", "-json", "-cmd", ".timeout 5000", path.resolve(dbPath), sql]);
  });
}

function runSqlite(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", args, {
      cwd: path.resolve(new URL("..", import.meta.url).pathname),
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`sqlite3 exited with code ${code ?? 1}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch (err) {
        reject(new Error(`failed to parse sqlite3 JSON output: ${err instanceof Error ? err.message : String(err)}`));
      }
    });
  });
}

function keywordPredicate(keyword, column = "keywords_json") {
  if (!keyword) return "1 = 1";
  const value = sqlString(keyword);
  return `(
    (json_valid(${column}) AND EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ${value}))
    OR ${column} LIKE ${sqlLike(keyword)} ESCAPE '\\'
  )`;
}

function filtersCityPredicate(city, column = "filters_json") {
  if (!city) return "1 = 1";
  const value = sqlString(city);
  return `(
    json_valid(${column})
    AND (
      json_extract(${column}, '$.city') = ${value}
      OR EXISTS (SELECT 1 FROM json_each(json_extract(${column}, '$.city')) WHERE value = ${value})
      OR EXISTS (SELECT 1 FROM json_each(json_extract(${column}, '$.cities')) WHERE value = ${value})
    )
  )`;
}

function recentPredicate(options) {
  if (options.runId || options.sinceMinutes === 0) return "1 = 1";
  const cutoff = new Date(Date.now() - options.sinceMinutes * 60_000).toISOString();
  return `started_at >= ${sqlString(cutoff)}`;
}

async function findRun(options) {
  const where = options.runId
    ? `id = ${sqlString(options.runId)}`
    : [
        "source_platform = 'zhilian'",
        recentPredicate(options),
        keywordPredicate(options.keyword),
        filtersCityPredicate(options.city),
      ].join(" AND ");

  const rows = await runSql(
    options.dbPath,
    `
      SELECT id, source_platform, keywords_json, filters_json, limits_json,
             status, started_at, finished_at, error_message,
             captured, inserted, updated, duplicate,
             recommended, pending, filtered, failed, processed, all_jobs
      FROM collection_run
      WHERE ${where}
      ORDER BY started_at DESC
      LIMIT 1;
    `,
  );
  return rows[0] ?? null;
}

async function findFatalFailures(options, runId) {
  return await runSql(
    options.dbPath,
    `
      SELECT event_type, keyword, encrypt_job_id, reason, created_at
      FROM collection_failure
      WHERE run_id = ${sqlString(runId)}
        AND (
          event_type IN (${fatalEventTypes.map(sqlString).join(", ")})
          OR reason LIKE 'db upsert%'
          OR reason LIKE 'filter recompute failed%'
          OR reason LIKE 'source link insert failed%'
        )
      ORDER BY created_at ASC;
    `,
  );
}

async function findEvidenceRows(options, run) {
  return await runSql(
    options.dbPath,
    `
      SELECT
        j.encrypt_job_id,
        j.source_platform,
        j.source_url,
        j.dedup_key,
        j.position_name,
        j.brand_name,
        j.city_name,
        j.salary_desc,
        j.experience_name,
        j.degree_name,
        j.raw_payload_json,
        CASE WHEN json_valid(j.raw_payload_json) THEN 1 ELSE 0 END AS raw_payload_json_valid,
        s.keyword,
        s.filters_json,
        s.captured_at,
        CASE WHEN s.filters_json IS NOT NULL AND json_valid(s.filters_json) THEN 1 ELSE 0 END AS filters_json_valid,
        CASE WHEN d.zp_data_json IS NOT NULL AND json_valid(d.zp_data_json) THEN 1 ELSE 0 END AS detail_json_valid,
        CASE WHEN d.zp_data_json IS NOT NULL AND json_valid(d.zp_data_json)
          THEN COALESCE(
            json_extract(d.zp_data_json, '$.detailStatus'),
            json_extract(d.zp_data_json, '$.rawPayload.detail_status'),
            json_extract(d.zp_data_json, '$.rawPayload.detailStatus')
          )
        END AS detail_status,
        CASE WHEN d.zp_data_json IS NOT NULL AND json_valid(d.zp_data_json) THEN json_extract(d.zp_data_json, '$.jobInfo.postDescription') END AS post_description,
        d.fetched_at AS detail_fetched_at
      FROM job_source_link s
      INNER JOIN job j ON j.encrypt_job_id = s.encrypt_job_id
      LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
      WHERE j.source_platform = 'zhilian'
        AND s.captured_at >= ${sqlString(run.started_at)}
        AND (${run.finished_at ? `s.captured_at <= ${sqlString(run.finished_at)}` : "1 = 1"})
        AND (${options.keyword ? `s.keyword = ${sqlString(options.keyword)}` : "1 = 1"})
        AND ${filtersCityPredicate(options.city, "s.filters_json")}
      ORDER BY s.captured_at DESC
      LIMIT 20;
    `,
  );
}

function parseJsonObject(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function filtersMatchCity(filtersJson, city) {
  if (!city) return true;
  const filters = parseJsonObject(filtersJson);
  const values = [filters?.city, filters?.cities].flat().filter(Boolean).map(String);
  return values.includes(city);
}

function isZhilianJobDetailUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "www.zhaopin.com" || url.hostname.endsWith(".zhaopin.com")) &&
      url.pathname.startsWith("/jobdetail/")
    );
  } catch {
    return false;
  }
}

function summarizeEvidenceRow(row) {
  return {
    encrypt_job_id: row.encrypt_job_id,
    source_platform: row.source_platform,
    source_url: row.source_url,
    dedup_key: row.dedup_key,
    position_name: row.position_name,
    brand_name: row.brand_name,
    city_name: row.city_name,
    salary_desc: row.salary_desc,
    experience_name: row.experience_name,
    degree_name: row.degree_name,
    raw_payload_json_valid: row.raw_payload_json_valid,
    filters_json_valid: row.filters_json_valid,
    detail_json_valid: row.detail_json_valid,
    detail_status: row.detail_status,
    detail_fetched_at: row.detail_fetched_at,
    has_post_description: Boolean(String(row.post_description || "").trim()),
  };
}

function validateRun(run, options) {
  const issues = [];
  const activity = Number(run.inserted ?? 0) + Number(run.updated ?? 0) + Number(run.duplicate ?? 0);
  const captured = Number(run.captured ?? 0);
  const failed = Number(run.failed ?? 0);

  if (run.source_platform !== "zhilian") issues.push(`run ${run.id} is not a Zhilian run`);
  if (run.status !== "finished") issues.push(`run ${run.id} status is ${run.status}, expected finished`);
  if (!run.finished_at) issues.push(`run ${run.id} has no finished_at`);
  if (run.error_message) issues.push(`run ${run.id} has error_message: ${run.error_message}`);
  if (captured <= 0) issues.push(`run ${run.id} captured=${captured}, expected > 0`);
  if (failed > 0) issues.push(`run ${run.id} failed=${failed}, expected 0`);
  if (options.requireInsert && Number(run.inserted ?? 0) <= 0) {
    issues.push(`run ${run.id} inserted=${run.inserted}, expected > 0 because --require-insert was set`);
  } else if (!options.requireInsert && activity <= 0) {
    issues.push(`run ${run.id} inserted+updated+duplicate=${activity}, expected > 0`);
  }

  const filters = parseJsonObject(run.filters_json);
  if (options.city && !filtersMatchCity(run.filters_json, options.city)) {
    issues.push(`run ${run.id} filters_json does not contain city ${options.city}: ${run.filters_json}`);
  }
  if (!filters) issues.push(`run ${run.id} filters_json is not valid JSON`);
  return issues;
}

function validateEvidence(rows, options) {
  const issues = [];
  if (rows.length === 0) {
    issues.push("no Zhilian job evidence rows found in the selected run time window");
    return { issues, usable: null };
  }

  const usable = rows.find((row) => {
    return (
      String(row.encrypt_job_id || "").startsWith("zhilian:") &&
      String(row.source_platform || "") === "zhilian" &&
      isZhilianJobDetailUrl(row.source_url) &&
      String(row.dedup_key || "").trim() &&
      String(row.position_name || "").trim() &&
      String(row.brand_name || "").trim() &&
      String(row.city_name || "").trim() &&
      String(row.salary_desc || "").trim() &&
      Number(row.raw_payload_json_valid) === 1 &&
      Number(row.filters_json_valid) === 1 &&
      Number(row.detail_json_valid) === 1 &&
      ["missing", "blocked", "detail"].includes(String(row.detail_status || "")) &&
      String(row.post_description || "").trim() &&
      (!options.city || filtersMatchCity(row.filters_json, options.city))
    );
  });

  if (!usable) {
    const sample = rows[0] ?? {};
    issues.push(`no complete Zhilian DB evidence row found; sample=${JSON.stringify(summarizeEvidenceRow(sample))}`);
    return { issues, usable: null };
  }

  if (options.keyword && usable.keyword !== options.keyword) {
    issues.push(`evidence keyword=${usable.keyword}, expected ${options.keyword}`);
  }
  return { issues, usable: issues.length === 0 ? usable : null };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  try {
    await fs.access(options.dbPath);
  } catch {
    throw new Error(`app.db not found: ${options.dbPath}. Pass --db-path or --data-dir after running the Tauri Zhilian collection.`);
  }

  const run = await findRun(options);
  if (!run) {
    const windowText = options.runId
      ? `run_id=${options.runId}`
      : `latest Zhilian run within ${options.sinceMinutes === 0 ? "any" : `${options.sinceMinutes} minute`} window`;
    throw new Error(`No ${windowText} matched db=${options.dbPath}`);
  }

  const fatalFailures = await findFatalFailures(options, run.id);
  const evidenceRows = await findEvidenceRows(options, run);
  const evidenceValidation = validateEvidence(evidenceRows, options);
  const issues = [
    ...validateRun(run, options),
    ...fatalFailures.map((failure) => `fatal collection_failure ${failure.event_type}: ${failure.reason}`),
    ...evidenceValidation.issues,
  ];

  const summary = {
    dbPath: options.dbPath,
    runId: run.id,
    status: run.status,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    captured: run.captured,
    inserted: run.inserted,
    updated: run.updated,
    duplicate: run.duplicate,
    evidenceRows: evidenceRows.length,
  };

  if (issues.length > 0) {
    console.error("[FAIL] Zhilian DB canary failed");
    console.error(JSON.stringify(summary, null, 2));
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  const first = evidenceValidation.usable ?? evidenceRows[0];
  console.log("[OK] Zhilian DB canary passed");
  console.log(JSON.stringify({
    ...summary,
    sampleJob: {
      encryptJobId: first.encrypt_job_id,
      positionName: first.position_name,
      brandName: first.brand_name,
      cityName: first.city_name,
      salaryDesc: first.salary_desc,
      keyword: first.keyword,
      detailStatus: first.detail_status,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(`[FAIL] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
