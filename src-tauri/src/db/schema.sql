PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS job (
  encrypt_job_id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL DEFAULT 'boss',
  source_url TEXT,
  dedup_key TEXT,
  position_name TEXT,
  boss_name TEXT,
  brand_name TEXT,
  city_name TEXT,
  salary_desc TEXT,
  experience_name TEXT,
  degree_name TEXT,
  jd_text TEXT,
  raw_payload_json TEXT,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS job_sources (
  platform TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  adapter_kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_detail_raw (
  encrypt_job_id TEXT PRIMARY KEY,
  zp_data_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_source_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_job_id TEXT NOT NULL,
  keyword TEXT,
  filters_json TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filter_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_filter_result (
  encrypt_job_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  eligible INTEGER NOT NULL,
  reason_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_review_state (
  encrypt_job_id TEXT PRIMARY KEY,
  review_status TEXT NOT NULL DEFAULT 'pending',
  communication_status TEXT NOT NULL DEFAULT 'not_contacted',
  last_greeted_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_review_state (
  company_name TEXT PRIMARY KEY,
  review_status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_blacklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_score (
  company_name TEXT PRIMARY KEY,
  company_score REAL NOT NULL,
  risk_flags_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.72,
  source_text_len INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crawl_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT,
  message TEXT,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_job_id TEXT NOT NULL,
  resume_hash TEXT NOT NULL,
  job_hash TEXT NOT NULL,
  kind TEXT,
  title TEXT,
  match_score REAL,
  jobs_count INTEGER,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(encrypt_job_id, resume_hash, job_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_report_job_id
  ON ai_report(encrypt_job_id);

CREATE INDEX IF NOT EXISTS idx_job_source_link_encrypt_job_id
  ON job_source_link(encrypt_job_id);

CREATE INDEX IF NOT EXISTS idx_job_filter_result_profile_id
  ON job_filter_result(profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_blacklist_kind_value
  ON job_blacklist(kind, value);

CREATE INDEX IF NOT EXISTS idx_job_review_state_review_status
  ON job_review_state(review_status);

CREATE INDEX IF NOT EXISTS idx_company_review_state_review_status
  ON company_review_state(review_status);
