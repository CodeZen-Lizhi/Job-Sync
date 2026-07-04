PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS job (
  encrypt_job_id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL DEFAULT 'boss',
  source_url TEXT,
  dedup_key TEXT,
  position_name TEXT,
  boss_name TEXT,
  boss_active_status TEXT,
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

CREATE TABLE IF NOT EXISTS job_source_payload (
  encrypt_job_id TEXT PRIMARY KEY,
  raw_payload_json TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_detail_projection (
  encrypt_job_id TEXT PRIMARY KEY,
  detail_status TEXT,
  description_text TEXT,
  skills_text TEXT,
  benefits_text TEXT,
  company_scale TEXT,
  financing_stage TEXT,
  industry TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_search_projection (
  encrypt_job_id TEXT PRIMARY KEY,
  title_text TEXT NOT NULL DEFAULT '',
  company_text TEXT NOT NULL DEFAULT '',
  location_text TEXT NOT NULL DEFAULT '',
  requirement_text TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  job_hash TEXT NOT NULL,
  detail_hash TEXT,
  source_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_list_summary_projection (
  encrypt_job_id TEXT PRIMARY KEY,
  ai_audit_status TEXT NOT NULL DEFAULT 'not_judged',
  ai_audit_summary TEXT NOT NULL DEFAULT '待 AI 判断',
  filter_summary TEXT NOT NULL DEFAULT '暂无筛选规则结果',
  resume_match_score REAL,
  resume_match_summary TEXT,
  preference_score REAL NOT NULL DEFAULT 0,
  company_score REAL NOT NULL DEFAULT 80,
  company_risk_summary TEXT,
  score_reason_json TEXT NOT NULL DEFAULT '{}',
  source_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_source_link (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encrypt_job_id TEXT NOT NULL,
  keyword TEXT,
  filters_json TEXT,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_run (
  id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  filters_json TEXT,
  limits_json TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT,
  captured INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  duplicate INTEGER NOT NULL DEFAULT 0,
  recommended INTEGER NOT NULL DEFAULT 0,
  pending INTEGER NOT NULL DEFAULT 0,
  filtered INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  all_jobs INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_run_job (
  run_id TEXT NOT NULL,
  encrypt_job_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (run_id, encrypt_job_id, outcome)
);

CREATE TABLE IF NOT EXISTS collection_failure (
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

CREATE INDEX IF NOT EXISTS idx_ai_report_latest_resume
  ON ai_report(encrypt_job_id, kind, match_score, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_job_last_seen_id
  ON job(last_seen_at DESC, encrypt_job_id ASC);

CREATE INDEX IF NOT EXISTS idx_job_brand_name_id
  ON job(brand_name, encrypt_job_id);

CREATE INDEX IF NOT EXISTS idx_job_source_link_encrypt_job_id
  ON job_source_link(encrypt_job_id);

CREATE INDEX IF NOT EXISTS idx_job_source_link_keyword_job
  ON job_source_link(keyword, encrypt_job_id);

CREATE INDEX IF NOT EXISTS idx_job_detail_projection_hash
  ON job_detail_projection(source_hash);

CREATE INDEX IF NOT EXISTS idx_job_source_payload_hash
  ON job_source_payload(source_hash);

CREATE INDEX IF NOT EXISTS idx_job_search_projection_hash
  ON job_search_projection(job_hash, detail_hash, source_hash);

CREATE INDEX IF NOT EXISTS idx_job_list_summary_projection_hash
  ON job_list_summary_projection(source_hash);

CREATE INDEX IF NOT EXISTS idx_collection_run_started_at
  ON collection_run(started_at);

CREATE INDEX IF NOT EXISTS idx_collection_failure_run_id
  ON collection_failure(run_id);

CREATE INDEX IF NOT EXISTS idx_collection_failure_created_at
  ON collection_failure(created_at);

CREATE INDEX IF NOT EXISTS idx_job_filter_result_profile_id
  ON job_filter_result(profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_blacklist_kind_value
  ON job_blacklist(kind, value);

CREATE INDEX IF NOT EXISTS idx_job_review_state_review_status
  ON job_review_state(review_status);

CREATE INDEX IF NOT EXISTS idx_company_review_state_review_status
  ON company_review_state(review_status);
