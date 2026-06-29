#!/usr/bin/env python3
"""Validate Jobs/Resume library performance boundaries.

The script never writes to the user's real app database. Real-data validation
copies the DB into a temporary file, applies additive benchmark projections to
the copy, and measures representative hot-path queries there.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterable


TASK_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[4]
DEFAULT_REAL_DB = (
    Path.home()
    / "Library"
    / "Application Support"
    / "com.administrator.jobpilot"
    / "app.db"
)

FTS_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS job_fts USING fts5(
  encrypt_job_id UNINDEXED,
  position_name,
  boss_name,
  brand_name,
  city_name,
  salary_desc,
  experience_name,
  degree_name,
  detail_text,
  tokenize='trigram'
);
"""

HOT_LIST_SQL = """
SELECT
  j.encrypt_job_id,
  j.position_name,
  j.brand_name,
  j.city_name,
  j.salary_desc,
  j.last_seen_at,
  lsp.ai_audit_status,
  lsp.resume_match_score,
  lsp.company_score,
  lsp.score_reason_json
FROM job j
LEFT JOIN job_search_projection sp ON sp.encrypt_job_id = j.encrypt_job_id
LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id
ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
LIMIT ?
"""

LIKE_SEARCH_SQL = """
SELECT
  j.encrypt_job_id,
  j.position_name,
  j.brand_name,
  j.last_seen_at,
  lsp.score_reason_json
FROM job j
LEFT JOIN job_search_projection sp ON sp.encrypt_job_id = j.encrypt_job_id
LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id
WHERE sp.search_text LIKE ?
ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
LIMIT ?
"""

FTS_SEARCH_SQL = """
SELECT
  j.encrypt_job_id,
  j.position_name,
  j.brand_name,
  j.last_seen_at,
  lsp.score_reason_json
FROM job_fts
JOIN job j ON j.encrypt_job_id = job_fts.encrypt_job_id
LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id
WHERE job_fts MATCH ?
ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
LIMIT ?
"""

SOURCE_FILTER_SQL = """
SELECT
  j.encrypt_job_id,
  j.position_name,
  j.brand_name,
  j.last_seen_at,
  lsp.score_reason_json
FROM job j
JOIN job_source_link sl ON sl.encrypt_job_id = j.encrypt_job_id
LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id
WHERE sl.keyword = ?
ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
LIMIT ?
"""

CURSOR_SQL = """
SELECT
  j.encrypt_job_id,
  j.position_name,
  j.brand_name,
  j.last_seen_at,
  lsp.score_reason_json
FROM job j
LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id
WHERE (j.last_seen_at < ? OR (j.last_seen_at = ? AND j.encrypt_job_id > ?))
ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
LIMIT ?
"""

OFFSET_SQL = """
SELECT
  j.encrypt_job_id,
  j.position_name,
  j.brand_name,
  j.last_seen_at,
  lsp.score_reason_json
FROM job j
LEFT JOIN job_list_summary_projection lsp ON lsp.encrypt_job_id = j.encrypt_job_id
ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
LIMIT ? OFFSET ?
"""

HEAVY_BASELINE_SQL = """
SELECT
  j.encrypt_job_id,
  j.position_name,
  j.brand_name,
  j.last_seen_at,
  j.raw_payload_json,
  d.zp_data_json,
  cs.evidence_json,
  ar.result_json
FROM job j
LEFT JOIN job_detail_raw d ON d.encrypt_job_id = j.encrypt_job_id
LEFT JOIN company_score cs ON cs.company_name = j.brand_name
LEFT JOIN ai_report ar ON ar.encrypt_job_id = j.encrypt_job_id
ORDER BY j.last_seen_at DESC, j.encrypt_job_id ASC
LIMIT ?
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real-db", default=str(DEFAULT_REAL_DB))
    parser.add_argument("--output", default=str(TASK_DIR / "performance-report.md"))
    parser.add_argument("--synthetic-rows", nargs="+", type=int, default=[5000])
    parser.add_argument("--iterations", type=int, default=25)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--keep-temp", action="store_true")
    return parser.parse_args()


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def readonly_connect(path: Path) -> sqlite3.Connection:
    uri = f"file:{path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8", errors="ignore")).hexdigest()


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return (
        conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
            (table,),
        ).fetchone()[0]
        > 0
    )


def safe_scalar(conn: sqlite3.Connection, sql: str, default=0):
    try:
        return conn.execute(sql).fetchone()[0]
    except sqlite3.Error:
        return default


def apply_schema(conn: sqlite3.Connection) -> None:
    schema_path = REPO_ROOT / "src-tauri" / "src" / "db" / "schema.sql"
    conn.executescript(schema_path.read_text())
    conn.executescript(FTS_SQL)


def prepare_projection_copy(conn: sqlite3.Connection) -> dict[str, int]:
    """Create benchmark projections on a DB copy.

    This intentionally uses SQL-only approximations of the production projection
    builders. It validates query shape and row movement without mutating the real
    app DB or depending on app startup.
    """

    before = projection_counts(conn)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    conn.execute("BEGIN")
    conn.execute(
        """
        INSERT OR REPLACE INTO job_source_payload(
          encrypt_job_id, raw_payload_json, source_hash, updated_at
        )
        SELECT
          encrypt_job_id,
          COALESCE(raw_payload_json, '{}'),
          length(COALESCE(raw_payload_json, '')) || ':' || COALESCE(last_seen_at, ''),
          ?
        FROM job
        """,
        (now,),
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO job_detail_projection(
          encrypt_job_id, detail_status, description_text, skills_text,
          benefits_text, company_scale, financing_stage, industry, search_text,
          source_hash, updated_at
        )
        SELECT
          encrypt_job_id,
          'benchmark',
          substr(COALESCE(zp_data_json, ''), 1, 1000),
          '',
          '',
          '',
          '',
          '',
          substr(COALESCE(zp_data_json, ''), 1, 4000),
          length(COALESCE(zp_data_json, '')) || ':' || COALESCE(fetched_at, ''),
          ?
        FROM job_detail_raw
        """,
        (now,),
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO job_search_projection(
          encrypt_job_id, title_text, company_text, location_text,
          requirement_text, source_text, search_text, job_hash, detail_hash,
          source_hash, updated_at
        )
        SELECT
          j.encrypt_job_id,
          COALESCE(j.position_name, ''),
          COALESCE(j.brand_name, ''),
          COALESCE(j.city_name, ''),
          COALESCE(j.jd_text, ''),
          substr(COALESCE(src.raw_payload_json, j.raw_payload_json, ''), 1, 1000),
          COALESCE(j.source_platform, '') || ' ' ||
            COALESCE(j.source_url, '') || ' ' ||
            COALESCE(j.dedup_key, '') || ' ' ||
            COALESCE(j.position_name, '') || ' ' ||
            COALESCE(j.boss_name, '') || ' ' ||
            COALESCE(j.boss_active_status, '') || ' ' ||
            COALESCE(j.brand_name, '') || ' ' ||
            COALESCE(j.city_name, '') || ' ' ||
            COALESCE(j.salary_desc, '') || ' ' ||
            COALESCE(j.experience_name, '') || ' ' ||
            COALESCE(j.degree_name, '') || ' ' ||
            COALESCE(j.jd_text, '') || ' ' ||
            COALESCE(dp.search_text, '') || ' ' ||
            substr(COALESCE(src.raw_payload_json, j.raw_payload_json, ''), 1, 1000),
          length(COALESCE(j.position_name, '') || COALESCE(j.jd_text, '')),
          dp.source_hash,
          src.source_hash,
          ?
        FROM job j
        LEFT JOIN job_detail_projection dp ON dp.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN job_source_payload src ON src.encrypt_job_id = j.encrypt_job_id
        """,
        (now,),
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO job_list_summary_projection(
          encrypt_job_id, ai_audit_status, ai_audit_summary, filter_summary,
          resume_match_score, resume_match_summary, preference_score,
          company_score, company_risk_summary, score_reason_json, source_hash,
          updated_at
        )
        SELECT
          j.encrypt_job_id,
          'not_judged',
          '待 AI 判断',
          COALESCE(substr(r.reason_json, 1, 120), '暂无筛选规则结果'),
          (
            SELECT ar.match_score
            FROM ai_report ar
            WHERE ar.encrypt_job_id = j.encrypt_job_id
            ORDER BY ar.created_at DESC, ar.id DESC
            LIMIT 1
          ),
          'benchmark summary',
          0,
          COALESCE(cs.company_score, 80),
          COALESCE(substr(cs.risk_flags_json, 1, 120), ''),
          '{"summary":"benchmark"}',
          length(COALESCE(r.reason_json, '') || COALESCE(cs.risk_flags_json, '')) || ':' ||
            COALESCE(j.last_seen_at, ''),
          ?
        FROM job j
        LEFT JOIN job_filter_result r ON r.encrypt_job_id = j.encrypt_job_id
        LEFT JOIN company_score cs ON cs.company_name = j.brand_name
        """,
        (now,),
    )
    conn.execute("DELETE FROM job_fts")
    conn.execute(
        """
        INSERT INTO job_fts(
          encrypt_job_id, position_name, boss_name, brand_name, city_name,
          salary_desc, experience_name, degree_name, detail_text
        )
        SELECT
          j.encrypt_job_id,
          COALESCE(j.position_name, ''),
          COALESCE(j.boss_name, ''),
          COALESCE(j.brand_name, ''),
          COALESCE(j.city_name, ''),
          COALESCE(j.salary_desc, ''),
          COALESCE(j.experience_name, ''),
          COALESCE(j.degree_name, ''),
          COALESCE(sp.search_text, '')
        FROM job j
        LEFT JOIN job_search_projection sp ON sp.encrypt_job_id = j.encrypt_job_id
        """
    )
    conn.commit()
    after = projection_counts(conn)
    return {f"before_{k}": v for k, v in before.items()} | {
        f"after_{k}": v for k, v in after.items()
    }


def projection_counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        table: safe_scalar(conn, f"SELECT COUNT(*) FROM {table}")
        for table in [
            "job_source_payload",
            "job_detail_projection",
            "job_search_projection",
            "job_list_summary_projection",
            "job_fts",
        ]
        if table_exists(conn, table)
    }


def collect_snapshot(conn: sqlite3.Connection) -> dict[str, int]:
    tables = [
        "job",
        "job_detail_raw",
        "job_source_payload",
        "job_detail_projection",
        "job_search_projection",
        "job_list_summary_projection",
        "job_fts",
        "job_filter_result",
        "ai_report",
        "company_score",
        "job_source_link",
    ]
    snapshot = {f"{table}_rows": safe_scalar(conn, f"SELECT COUNT(*) FROM {table}") for table in tables}
    snapshot.update(
        {
            "job_raw_payload_max_bytes": safe_scalar(
                conn, "SELECT COALESCE(MAX(length(raw_payload_json)), 0) FROM job"
            ),
            "source_payload_max_bytes": safe_scalar(
                conn,
                "SELECT COALESCE(MAX(length(raw_payload_json)), 0) FROM job_source_payload",
            ),
            "detail_raw_max_bytes": safe_scalar(
                conn, "SELECT COALESCE(MAX(length(zp_data_json)), 0) FROM job_detail_raw"
            ),
            "ai_report_max_bytes": safe_scalar(
                conn, "SELECT COALESCE(MAX(length(result_json)), 0) FROM ai_report"
            ),
            "company_evidence_max_bytes": safe_scalar(
                conn, "SELECT COALESCE(MAX(length(evidence_json)), 0) FROM company_score"
            ),
        }
    )
    return snapshot


def explain(conn: sqlite3.Connection, sql: str, params: Iterable[object]) -> list[str]:
    rows = conn.execute(f"EXPLAIN QUERY PLAN {sql}", tuple(params)).fetchall()
    return [" | ".join(str(value) for value in row) for row in rows]


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[index]


def time_query(
    conn: sqlite3.Connection,
    sql: str,
    params: Iterable[object],
    iterations: int,
    warmup: int = 3,
) -> dict[str, float | int]:
    params_tuple = tuple(params)
    for _ in range(warmup):
        conn.execute(sql, params_tuple).fetchall()
    samples = []
    row_count = 0
    for _ in range(iterations):
        start = time.perf_counter()
        rows = conn.execute(sql, params_tuple).fetchall()
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        samples.append(elapsed_ms)
        row_count = len(rows)
    return {
        "rows": row_count,
        "min_ms": min(samples),
        "median_ms": statistics.median(samples),
        "p95_ms": percentile(samples, 95),
        "max_ms": max(samples),
    }


def cursor_key(conn: sqlite3.Connection, offset: int) -> tuple[str, str] | None:
    row = conn.execute(
        """
        SELECT last_seen_at, encrypt_job_id
        FROM job
        ORDER BY last_seen_at DESC, encrypt_job_id ASC
        LIMIT 1 OFFSET ?
        """,
        (offset,),
    ).fetchone()
    if not row:
        return None
    return row[0], row[1]


def first_source_keyword(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        """
        SELECT keyword
        FROM job_source_link
        WHERE keyword IS NOT NULL AND trim(keyword) != ''
        GROUP BY keyword
        ORDER BY COUNT(*) DESC, keyword ASC
        LIMIT 1
        """
    ).fetchone()
    return row[0] if row else "Go Remote"


def search_token(conn: sqlite3.Connection) -> str:
    keyword = first_source_keyword(conn)
    for token in keyword.replace("/", " ").replace("-", " ").split():
        if len(token) >= 3:
            return token
    row = conn.execute(
        """
        SELECT search_text
        FROM job_search_projection
        WHERE search_text IS NOT NULL AND trim(search_text) != ''
        LIMIT 20
        """
    ).fetchall()
    for candidate in row:
        for token in str(candidate[0]).replace("/", " ").replace("-", " ").split():
            if len(token) >= 3:
                return token
    return "Remote"


def run_measurements(
    conn: sqlite3.Connection,
    dataset: str,
    iterations: int,
    limit: int,
    deep_offset: int | None = None,
) -> dict:
    keyword = first_source_keyword(conn)
    token = search_token(conn)
    search_term = f"%{token}%"
    fts_term = token
    offset = deep_offset if deep_offset is not None else max(0, safe_scalar(conn, "SELECT COUNT(*) FROM job") // 2)
    cursor = cursor_key(conn, max(0, offset - 1))
    queries = {
        "hot_list_first_page": (HOT_LIST_SQL, (limit,)),
        "like_search_projection": (LIKE_SEARCH_SQL, (search_term, limit)),
        "fts_search_projection": (FTS_SEARCH_SQL, (fts_term, limit)),
        "source_filter": (SOURCE_FILTER_SQL, (keyword, limit)),
        "offset_page": (OFFSET_SQL, (limit, offset)),
        "heavy_old_shape_baseline": (HEAVY_BASELINE_SQL, (limit,)),
    }
    if cursor:
        last_seen_at, encrypt_job_id = cursor
        queries["cursor_next_page"] = (
            CURSOR_SQL,
            (last_seen_at, last_seen_at, encrypt_job_id, limit),
        )

    results = {}
    plans = {}
    errors = {}
    for name, (sql, params) in queries.items():
        try:
            plans[name] = explain(conn, sql, params)
            results[name] = time_query(conn, sql, params, iterations)
        except sqlite3.Error as exc:
            errors[name] = str(exc)
    return {
        "dataset": dataset,
        "iterations": iterations,
        "limit": limit,
        "source_keyword": keyword,
        "search_token": token,
        "offset": offset,
        "snapshot": collect_snapshot(conn),
        "plans": plans,
        "timings": results,
        "errors": errors,
    }


def create_synthetic_db(path: Path, rows: int) -> None:
    if path.exists():
        path.unlink()
    conn = connect(path)
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA temp_store = MEMORY")
    apply_schema(conn)
    conn.execute("BEGIN")
    base = dt.datetime(2026, 6, 30, 12, 0, 0, tzinfo=dt.timezone.utc)
    large_source = "S" * 100_000
    large_detail = "D" * 200_000
    small_source = "source"
    small_detail = "detail"
    companies = [f"Company {idx:03d}" for idx in range(100)]
    now = base.isoformat()

    job_rows = []
    detail_rows = []
    detail_projection_rows = []
    source_payload_rows = []
    search_rows = []
    summary_rows = []
    source_link_rows = []
    filter_rows = []
    ai_rows = []

    for i in range(rows):
        job_id = f"synthetic_{i:06d}"
        company = companies[i % len(companies)]
        last_seen = (base - dt.timedelta(seconds=i)).isoformat()
        keyword = "Go Remote" if i % 2 == 0 else "Rust Platform"
        source_blob = large_source if i % 20 == 0 else small_source
        detail_blob = large_detail if i % 20 == 0 else small_detail
        source_payload = json.dumps(
            {
                "id": job_id,
                "keyword": keyword,
                "company": company,
                "payload": source_blob,
            },
            separators=(",", ":"),
        )
        detail_payload = json.dumps(
            {
                "id": job_id,
                "description": f"{keyword} backend platform role {detail_blob}",
            },
            separators=(",", ":"),
        )
        position = f"{keyword} Engineer {i:06d}"
        jd_text = f"{keyword} backend distributed systems sqlite projection {i}"
        search_text = " ".join(
            [
                "boss",
                position,
                company,
                "Shanghai",
                jd_text,
                keyword,
                detail_payload[:400],
            ]
        )
        score_reason = json.dumps(
            {"summary": "synthetic", "matched_stack": ["Go", "SQLite"], "score": 80 + i % 20},
            separators=(",", ":"),
        )
        job_rows.append(
            (
                job_id,
                "boss",
                f"https://example.test/jobs/{job_id}",
                f"boss:{job_id}",
                position,
                f"Boss {i % 50}",
                "active",
                company,
                "Shanghai",
                "20-35K",
                "3-5 years",
                "Bachelor",
                jd_text,
                source_payload,
                last_seen,
            )
        )
        detail_rows.append((job_id, detail_payload, last_seen))
        detail_projection_rows.append(
            (
                job_id,
                "synthetic",
                detail_payload[:1000],
                keyword,
                "",
                "",
                "",
                "",
                detail_payload[:4000],
                sha(detail_payload),
                now,
            )
        )
        source_payload_rows.append((job_id, source_payload, sha(source_payload), now))
        search_rows.append(
            (
                job_id,
                position,
                company,
                "Shanghai",
                jd_text,
                source_payload[:1000],
                search_text,
                sha(position + jd_text),
                sha(detail_payload),
                sha(source_payload),
                now,
            )
        )
        summary_rows.append(
            (
                job_id,
                "not_judged",
                "待 AI 判断",
                "synthetic filter summary",
                float(70 + (i % 30)),
                "synthetic resume summary",
                float(i % 10),
                float(70 + (i % 25)),
                "synthetic risk summary" if i % 11 == 0 else "",
                score_reason,
                sha(score_reason),
                now,
            )
        )
        source_link_rows.append((job_id, keyword, json.dumps({"city": "Shanghai"}), last_seen))
        filter_rows.append(
            (
                job_id,
                "default",
                1 if i % 7 else 0,
                json.dumps({"summary": "synthetic filter", "eligible": i % 7 != 0}),
                last_seen,
            )
        )
        if i % 10 == 0:
            ai_rows.append(
                (
                    job_id,
                    "resume_hash",
                    "job_hash",
                    "resume",
                    "Synthetic Resume Match",
                    float(75 + i % 20),
                    None,
                    json.dumps({"evidence": ["E" * 8000], "summary": "synthetic"}),
                    last_seen,
                )
            )

    conn.executemany(
        """
        INSERT INTO job(
          encrypt_job_id, source_platform, source_url, dedup_key, position_name,
          boss_name, boss_active_status, brand_name, city_name, salary_desc,
          experience_name, degree_name, jd_text, raw_payload_json, last_seen_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        job_rows,
    )
    conn.executemany("INSERT INTO job_detail_raw VALUES(?, ?, ?)", detail_rows)
    conn.executemany(
        """
        INSERT INTO job_detail_projection(
          encrypt_job_id, detail_status, description_text, skills_text,
          benefits_text, company_scale, financing_stage, industry, search_text,
          source_hash, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        detail_projection_rows,
    )
    conn.executemany("INSERT INTO job_source_payload VALUES(?, ?, ?, ?)", source_payload_rows)
    conn.executemany(
        """
        INSERT INTO job_search_projection(
          encrypt_job_id, title_text, company_text, location_text,
          requirement_text, source_text, search_text, job_hash, detail_hash,
          source_hash, updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        search_rows,
    )
    conn.executemany(
        """
        INSERT INTO job_list_summary_projection(
          encrypt_job_id, ai_audit_status, ai_audit_summary, filter_summary,
          resume_match_score, resume_match_summary, preference_score,
          company_score, company_risk_summary, score_reason_json, source_hash,
          updated_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        summary_rows,
    )
    conn.executemany(
        """
        INSERT INTO job_source_link(encrypt_job_id, keyword, filters_json, captured_at)
        VALUES(?, ?, ?, ?)
        """,
        source_link_rows,
    )
    conn.executemany("INSERT INTO job_filter_result VALUES(?, ?, ?, ?, ?)", filter_rows)
    conn.executemany(
        """
        INSERT INTO ai_report(
          encrypt_job_id, resume_hash, job_hash, kind, title, match_score,
          jobs_count, result_json, created_at
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ai_rows,
    )
    company_rows = [
        (
            company,
            float(75 + idx % 20),
            json.dumps(["risk"] if idx % 8 == 0 else []),
            json.dumps({"evidence": "C" * 8000}),
            0.8,
            8000,
            now,
        )
        for idx, company in enumerate(companies)
    ]
    conn.executemany("INSERT INTO company_score VALUES(?, ?, ?, ?, ?, ?, ?)", company_rows)
    conn.execute(
        """
        INSERT INTO job_fts(
          encrypt_job_id, position_name, boss_name, brand_name, city_name,
          salary_desc, experience_name, degree_name, detail_text
        )
        SELECT
          j.encrypt_job_id, j.position_name, j.boss_name, j.brand_name,
          j.city_name, j.salary_desc, j.experience_name, j.degree_name,
          sp.search_text
        FROM job j
        JOIN job_search_projection sp ON sp.encrypt_job_id = j.encrypt_job_id
        """
    )
    conn.commit()
    conn.execute("ANALYZE")
    conn.close()


def git_commit() -> str:
    try:
        return (
            subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT)
            .decode()
            .strip()
        )
    except Exception:
        return "unknown"


def format_ms(value: float | int) -> str:
    return f"{float(value):.3f}"


def render_report(results: list[dict], temp_paths: list[str], real_db: Path) -> str:
    lines = [
        "# Jobs/Resume Library Performance Report",
        "",
        f"- Generated at: {dt.datetime.now(dt.timezone.utc).isoformat()}",
        f"- Commit: `{git_commit()}`",
        f"- Python: `{platform.python_version()}`",
        f"- SQLite: `{sqlite3.sqlite_version}`",
        f"- Machine: `{platform.platform()}`",
        f"- Real DB source: `{real_db}`",
        "- Real DB mutation: none; measurements use a temporary copy.",
        "",
        "## Summary",
        "",
        "| Dataset | Query | Rows | p95 ms | Target | Result |",
        "| --- | --- | ---: | ---: | ---: | --- |",
    ]
    for result in results:
        dataset = result["dataset"]
        target = 100.0 if dataset == "real_app_copy" else (350.0 if "10000" in dataset else 200.0)
        for name, timing in result["timings"].items():
            if name == "heavy_old_shape_baseline":
                continue
            passed = "PASS" if timing["p95_ms"] <= target else "MISS"
            lines.append(
                f"| {dataset} | {name} | {timing['rows']} | {format_ms(timing['p95_ms'])} | {target:.0f} | {passed} |"
            )
    lines.extend(["", "## Dataset Snapshots", ""])
    for result in results:
        lines.extend([f"### {result['dataset']}", "", "| Metric | Value |", "| --- | ---: |"])
        for key, value in sorted(result["snapshot"].items()):
            lines.append(f"| `{key}` | {value} |")
        lines.append("")
        if "projection_prepare" in result:
            lines.extend(["Projection preparation on temp copy:", "", "| Metric | Value |", "| --- | ---: |"])
            for key, value in sorted(result["projection_prepare"].items()):
                lines.append(f"| `{key}` | {value} |")
            lines.append("")
    lines.extend(["## Timings", ""])
    for result in results:
        lines.extend(
            [
                f"### {result['dataset']}",
                "",
                "| Query | Rows | min ms | median ms | p95 ms | max ms |",
                "| --- | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        for name, timing in result["timings"].items():
            lines.append(
                "| "
                + " | ".join(
                    [
                        name,
                        str(timing["rows"]),
                        format_ms(timing["min_ms"]),
                        format_ms(timing["median_ms"]),
                        format_ms(timing["p95_ms"]),
                        format_ms(timing["max_ms"]),
                    ]
                )
                + " |"
            )
        if result["errors"]:
            lines.extend(["", "Errors:", ""])
            for name, error in result["errors"].items():
                lines.append(f"- `{name}`: {error}")
        lines.append("")
    lines.extend(["## Query Plans", ""])
    for result in results:
        lines.extend([f"### {result['dataset']}", ""])
        for name, plan_lines in result["plans"].items():
            lines.extend([f"#### {name}", "", "```text"])
            lines.extend(plan_lines)
            lines.extend(["```", ""])
    if temp_paths:
        lines.extend(["## Temporary Artifacts", ""])
        for path in temp_paths:
            lines.append(f"- `{path}`")
        lines.append("")
    lines.extend(
        [
            "## Interpretation",
            "",
            "- PASS means the measured p95 for that dataset is within the agreed target.",
            "- `heavy_old_shape_baseline` is included as a local contrast for raw/detail/evidence movement; it is not a target query.",
            "- Browser smoke results are recorded separately because browser control is outside this script.",
            "",
        ]
    )
    return "\n".join(lines)


def main() -> int:
    args = parse_args()
    real_db = Path(args.real_db).expanduser()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_root = Path(tempfile.mkdtemp(prefix="job-sync-perf-"))
    temp_paths: list[str] = []
    results: list[dict] = []
    try:
        if real_db.exists():
            # Verify the source can be opened read-only before copying.
            readonly_connect(real_db).close()
            real_copy = temp_root / "real-app-copy.db"
            shutil.copy2(real_db, real_copy)
            temp_paths.append(str(real_copy))
            conn = connect(real_copy)
            apply_schema(conn)
            projection_prepare = prepare_projection_copy(conn)
            result = run_measurements(conn, "real_app_copy", args.iterations, args.limit)
            result["projection_prepare"] = projection_prepare
            results.append(result)
            conn.close()
        else:
            results.append(
                {
                    "dataset": "real_app_copy",
                    "iterations": args.iterations,
                    "limit": args.limit,
                    "snapshot": {},
                    "plans": {},
                    "timings": {},
                    "errors": {"real_db": f"missing: {real_db}"},
                }
            )
        for row_count in args.synthetic_rows:
            db_path = temp_root / f"synthetic-{row_count}.db"
            create_synthetic_db(db_path, row_count)
            temp_paths.append(str(db_path))
            conn = connect(db_path)
            deep_offset = min(max(0, row_count - args.limit), 9000 if row_count >= 10000 else 4000)
            results.append(
                run_measurements(
                    conn,
                    f"synthetic_{row_count}",
                    args.iterations,
                    args.limit,
                    deep_offset=deep_offset,
                )
            )
            conn.close()
        report = render_report(results, temp_paths if args.keep_temp else [], real_db)
        output.write_text(report)
        print(f"Wrote report: {output}")
        if args.keep_temp:
            print(f"Kept temp dir: {temp_root}")
        else:
            shutil.rmtree(temp_root, ignore_errors=True)
        return 0
    except Exception as exc:
        if not args.keep_temp:
            shutil.rmtree(temp_root, ignore_errors=True)
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
