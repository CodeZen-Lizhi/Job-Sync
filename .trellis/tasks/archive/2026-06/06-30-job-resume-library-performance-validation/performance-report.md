# Jobs/Resume Library Performance Report

- Generated at: 2026-06-29T23:45:42.445068+00:00
- Commit: `2dce389`
- Python: `3.10.14`
- SQLite: `3.54.0`
- Machine: `macOS-27.0-arm64-arm-64bit`
- Real DB source: `/Users/zhenglizhi/Library/Application Support/com.administrator.jobpilot/app.db`
- Real DB mutation: none; measurements use a temporary copy.

## Summary

| Dataset | Query | Rows | p95 ms | Target | Result |
| --- | --- | ---: | ---: | ---: | --- |
| real_app_copy | hot_list_first_page | 50 | 0.053 | 100 | PASS |
| real_app_copy | like_search_projection | 50 | 0.263 | 100 | PASS |
| real_app_copy | fts_search_projection | 50 | 0.457 | 100 | PASS |
| real_app_copy | source_filter | 50 | 0.151 | 100 | PASS |
| real_app_copy | offset_page | 50 | 0.057 | 100 | PASS |
| real_app_copy | cursor_next_page | 50 | 0.056 | 100 | PASS |
| synthetic_5000 | hot_list_first_page | 50 | 0.049 | 200 | PASS |
| synthetic_5000 | like_search_projection | 50 | 0.080 | 200 | PASS |
| synthetic_5000 | fts_search_projection | 50 | 8.687 | 200 | PASS |
| synthetic_5000 | source_filter | 50 | 6.367 | 200 | PASS |
| synthetic_5000 | offset_page | 50 | 0.577 | 200 | PASS |
| synthetic_5000 | cursor_next_page | 50 | 0.180 | 200 | PASS |
| synthetic_10000 | hot_list_first_page | 50 | 0.072 | 350 | PASS |
| synthetic_10000 | like_search_projection | 50 | 0.079 | 350 | PASS |
| synthetic_10000 | fts_search_projection | 50 | 19.408 | 350 | PASS |
| synthetic_10000 | source_filter | 50 | 12.960 | 350 | PASS |
| synthetic_10000 | offset_page | 50 | 1.394 | 350 | PASS |
| synthetic_10000 | cursor_next_page | 50 | 0.360 | 350 | PASS |

## Dataset Snapshots

### real_app_copy

| Metric | Value |
| --- | ---: |
| `ai_report_max_bytes` | 0 |
| `ai_report_rows` | 0 |
| `company_evidence_max_bytes` | 44 |
| `company_score_rows` | 1 |
| `detail_raw_max_bytes` | 202258 |
| `job_detail_projection_rows` | 165 |
| `job_detail_raw_rows` | 165 |
| `job_filter_result_rows` | 274 |
| `job_fts_rows` | 165 |
| `job_list_summary_projection_rows` | 165 |
| `job_raw_payload_max_bytes` | 129732 |
| `job_rows` | 165 |
| `job_search_projection_rows` | 165 |
| `job_source_link_rows` | 165 |
| `job_source_payload_rows` | 165 |
| `source_payload_max_bytes` | 129732 |

Projection preparation on temp copy:

| Metric | Value |
| --- | ---: |
| `after_job_detail_projection` | 165 |
| `after_job_fts` | 165 |
| `after_job_list_summary_projection` | 165 |
| `after_job_search_projection` | 165 |
| `after_job_source_payload` | 165 |
| `before_job_detail_projection` | 165 |
| `before_job_fts` | 165 |
| `before_job_list_summary_projection` | 0 |
| `before_job_search_projection` | 0 |
| `before_job_source_payload` | 0 |

### synthetic_5000

| Metric | Value |
| --- | ---: |
| `ai_report_max_bytes` | 8042 |
| `ai_report_rows` | 500 |
| `company_evidence_max_bytes` | 8016 |
| `company_score_rows` | 100 |
| `detail_raw_max_bytes` | 200074 |
| `job_detail_projection_rows` | 5000 |
| `job_detail_raw_rows` | 5000 |
| `job_filter_result_rows` | 5000 |
| `job_fts_rows` | 5000 |
| `job_list_summary_projection_rows` | 5000 |
| `job_raw_payload_max_bytes` | 100084 |
| `job_rows` | 5000 |
| `job_search_projection_rows` | 5000 |
| `job_source_link_rows` | 5000 |
| `job_source_payload_rows` | 5000 |
| `source_payload_max_bytes` | 100084 |

### synthetic_10000

| Metric | Value |
| --- | ---: |
| `ai_report_max_bytes` | 8042 |
| `ai_report_rows` | 1000 |
| `company_evidence_max_bytes` | 8016 |
| `company_score_rows` | 100 |
| `detail_raw_max_bytes` | 200074 |
| `job_detail_projection_rows` | 10000 |
| `job_detail_raw_rows` | 10000 |
| `job_filter_result_rows` | 10000 |
| `job_fts_rows` | 10000 |
| `job_list_summary_projection_rows` | 10000 |
| `job_raw_payload_max_bytes` | 100084 |
| `job_rows` | 10000 |
| `job_search_projection_rows` | 10000 |
| `job_source_link_rows` | 10000 |
| `job_source_payload_rows` | 10000 |
| `source_payload_max_bytes` | 100084 |

## Timings

### real_app_copy

| Query | Rows | min ms | median ms | p95 ms | max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| hot_list_first_page | 50 | 0.047 | 0.048 | 0.053 | 0.101 |
| like_search_projection | 50 | 0.244 | 0.251 | 0.263 | 0.265 |
| fts_search_projection | 50 | 0.373 | 0.392 | 0.457 | 0.558 |
| source_filter | 50 | 0.137 | 0.146 | 0.151 | 0.155 |
| offset_page | 50 | 0.050 | 0.055 | 0.057 | 0.092 |
| heavy_old_shape_baseline | 50 | 0.431 | 0.435 | 0.530 | 0.559 |
| cursor_next_page | 50 | 0.049 | 0.054 | 0.056 | 0.056 |

### synthetic_5000

| Query | Rows | min ms | median ms | p95 ms | max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| hot_list_first_page | 50 | 0.044 | 0.048 | 0.049 | 0.049 |
| like_search_projection | 50 | 0.065 | 0.071 | 0.080 | 0.084 |
| fts_search_projection | 50 | 7.979 | 8.288 | 8.687 | 8.725 |
| source_filter | 50 | 5.732 | 6.112 | 6.367 | 6.755 |
| offset_page | 50 | 0.541 | 0.564 | 0.577 | 0.579 |
| heavy_old_shape_baseline | 50 | 0.222 | 0.238 | 0.282 | 0.376 |
| cursor_next_page | 50 | 0.172 | 0.176 | 0.180 | 0.186 |

### synthetic_10000

| Query | Rows | min ms | median ms | p95 ms | max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| hot_list_first_page | 50 | 0.044 | 0.050 | 0.072 | 0.096 |
| like_search_projection | 50 | 0.069 | 0.071 | 0.079 | 0.082 |
| fts_search_projection | 50 | 17.303 | 18.824 | 19.408 | 19.460 |
| source_filter | 50 | 12.219 | 12.681 | 12.960 | 13.342 |
| offset_page | 50 | 1.266 | 1.318 | 1.394 | 1.410 |
| heavy_old_shape_baseline | 50 | 0.230 | 0.245 | 0.322 | 0.327 |
| cursor_next_page | 50 | 0.343 | 0.348 | 0.360 | 0.361 |

## Query Plans

### real_app_copy

#### hot_list_first_page

```text
7 | 0 | 211 | SCAN j USING INDEX idx_job_last_seen_id
10 | 0 | 46 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### like_search_projection

```text
9 | 0 | 211 | SCAN j USING INDEX idx_job_last_seen_id
12 | 0 | 46 | SEARCH sp USING INDEX sqlite_autoindex_job_search_projection_1 (encrypt_job_id=?) LEFT-JOIN
23 | 0 | 46 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### fts_search_projection

```text
8 | 0 | 156 | SCAN job_fts VIRTUAL TABLE INDEX 0:M9
13 | 0 | 46 | SEARCH j USING INDEX sqlite_autoindex_job_1 (encrypt_job_id=?)
19 | 0 | 46 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
44 | 0 | 0 | USE TEMP B-TREE FOR ORDER BY
```

#### source_filter

```text
8 | 0 | 55 | SEARCH sl USING COVERING INDEX idx_job_source_link_keyword_job (keyword=?)
14 | 0 | 46 | SEARCH j USING INDEX sqlite_autoindex_job_1 (encrypt_job_id=?)
19 | 0 | 46 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
44 | 0 | 0 | USE TEMP B-TREE FOR ORDER BY
```

#### offset_page

```text
10 | 0 | 212 | SCAN j USING INDEX idx_job_last_seen_id
13 | 0 | 46 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### heavy_old_shape_baseline

```text
11 | 0 | 215 | SCAN j USING INDEX idx_job_last_seen_id
14 | 0 | 47 | SEARCH d USING INDEX sqlite_autoindex_job_detail_raw_1 (encrypt_job_id=?) LEFT-JOIN
22 | 0 | 46 | SEARCH cs USING INDEX sqlite_autoindex_company_score_1 (company_name=?) LEFT-JOIN
30 | 0 | 61 | SEARCH ar USING INDEX idx_ai_report_job_id (encrypt_job_id=?) LEFT-JOIN
```

#### cursor_next_page

```text
7 | 0 | 212 | SCAN j USING INDEX idx_job_last_seen_id
16 | 0 | 46 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

### synthetic_5000

#### hot_list_first_page

```text
7 | 0 | 133 | SCAN j USING INDEX idx_job_last_seen_id
10 | 0 | 41 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### like_search_projection

```text
9 | 0 | 133 | SCAN j USING INDEX idx_job_last_seen_id
12 | 0 | 41 | SEARCH sp USING INDEX sqlite_autoindex_job_search_projection_1 (encrypt_job_id=?) LEFT-JOIN
23 | 0 | 41 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### fts_search_projection

```text
8 | 0 | 156 | SCAN job_fts VIRTUAL TABLE INDEX 0:M9
13 | 0 | 41 | SEARCH j USING INDEX sqlite_autoindex_job_1 (encrypt_job_id=?)
19 | 0 | 41 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
44 | 0 | 0 | USE TEMP B-TREE FOR ORDER BY
```

#### source_filter

```text
8 | 0 | 126 | SEARCH sl USING COVERING INDEX idx_job_source_link_keyword_job (keyword=?)
14 | 0 | 41 | SEARCH j USING INDEX sqlite_autoindex_job_1 (encrypt_job_id=?)
19 | 0 | 41 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
44 | 0 | 0 | USE TEMP B-TREE FOR ORDER BY
```

#### offset_page

```text
10 | 0 | 134 | SCAN j USING INDEX idx_job_last_seen_id
13 | 0 | 41 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### heavy_old_shape_baseline

```text
11 | 0 | 137 | SCAN j USING INDEX idx_job_last_seen_id
14 | 0 | 42 | SEARCH d USING INDEX sqlite_autoindex_job_detail_raw_1 (encrypt_job_id=?) LEFT-JOIN
22 | 0 | 35 | SEARCH cs USING INDEX sqlite_autoindex_company_score_1 (company_name=?) LEFT-JOIN
30 | 0 | 38 | SEARCH ar USING INDEX idx_ai_report_latest_resume (encrypt_job_id=?) LEFT-JOIN
```

#### cursor_next_page

```text
7 | 0 | 134 | SCAN j USING INDEX idx_job_last_seen_id
16 | 0 | 41 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

### synthetic_10000

#### hot_list_first_page

```text
7 | 0 | 143 | SCAN j USING INDEX idx_job_last_seen_id
10 | 0 | 42 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### like_search_projection

```text
9 | 0 | 143 | SCAN j USING INDEX idx_job_last_seen_id
12 | 0 | 42 | SEARCH sp USING INDEX sqlite_autoindex_job_search_projection_1 (encrypt_job_id=?) LEFT-JOIN
23 | 0 | 42 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### fts_search_projection

```text
8 | 0 | 156 | SCAN job_fts VIRTUAL TABLE INDEX 0:M9
13 | 0 | 42 | SEARCH j USING INDEX sqlite_autoindex_job_1 (encrypt_job_id=?)
19 | 0 | 42 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
44 | 0 | 0 | USE TEMP B-TREE FOR ORDER BY
```

#### source_filter

```text
8 | 0 | 136 | SEARCH sl USING COVERING INDEX idx_job_source_link_keyword_job (keyword=?)
14 | 0 | 42 | SEARCH j USING INDEX sqlite_autoindex_job_1 (encrypt_job_id=?)
19 | 0 | 42 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
44 | 0 | 0 | USE TEMP B-TREE FOR ORDER BY
```

#### offset_page

```text
10 | 0 | 144 | SCAN j USING INDEX idx_job_last_seen_id
13 | 0 | 42 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

#### heavy_old_shape_baseline

```text
11 | 0 | 147 | SCAN j USING INDEX idx_job_last_seen_id
14 | 0 | 42 | SEARCH d USING INDEX sqlite_autoindex_job_detail_raw_1 (encrypt_job_id=?) LEFT-JOIN
22 | 0 | 35 | SEARCH cs USING INDEX sqlite_autoindex_company_score_1 (company_name=?) LEFT-JOIN
30 | 0 | 39 | SEARCH ar USING INDEX idx_ai_report_latest_resume (encrypt_job_id=?) LEFT-JOIN
```

#### cursor_next_page

```text
7 | 0 | 144 | SCAN j USING INDEX idx_job_last_seen_id
16 | 0 | 42 | SEARCH lsp USING INDEX sqlite_autoindex_job_list_summary_projection_1 (encrypt_job_id=?) LEFT-JOIN
```

## Interpretation

- PASS means the measured p95 for that dataset is within the agreed target.
- `heavy_old_shape_baseline` is included as a local contrast for raw/detail/evidence movement; it is not a target query.
- Browser smoke results are recorded separately because browser control is outside this script.

## Validation Conclusion

- The agreed backend performance targets passed on the real app DB temporary
  copy, 5k synthetic rows, and 10k synthetic rows.
- Real DB was not mutated. The benchmark copied
  `/Users/zhenglizhi/Library/Application Support/com.administrator.jobpilot/app.db`
  to a temporary file, then applied additive projection/index setup there.
- The real DB source currently had `job_detail_projection` and `job_fts`, but
  did not yet have `job_source_payload`, `job_search_projection`, or
  `job_list_summary_projection` before temporary-copy preparation. The updated
  app migration/projection pipeline is still required on next app startup.
- Cursor pagination measured faster than deep offset on synthetic 10k:
  `cursor_next_page p95 0.360ms` vs `offset_page p95 1.394ms`.
- The slowest target queries were FTS and source filter on synthetic 10k:
  `fts_search_projection p95 19.408ms`, `source_filter p95 12.960ms`. Both are
  well under target, but both query plans use a temp B-tree for ordering after
  filtering. If the library grows far beyond 10k rows, these are the next
  bottlenecks to revisit.

## Frontend Smoke

- Command: `npm run dev -- --host 127.0.0.1`
- Dev server started successfully on `http://127.0.0.1:1430/`.
- HTTP smoke:
  - `/`: `200`, 469 bytes, about `0.014s`
  - `/jobs`: `200`, 469 bytes, about `0.013s`
  - `/resume-library`: `200`, 469 bytes, about `0.013s`
- The returned app shell included `#app` and `/src/main.ts`.
- Full in-browser JavaScript execution and console inspection were not run in
  this session because the required in-app browser control runtime tool was not
  exposed. This is the only remaining smoke-test coverage gap.

## Follow-Up Recommendation

- No immediate backend performance fix is required for the agreed thresholds.
- For future larger datasets, optimize FTS/source-filter ordering only if real
  measurements show those temp B-tree sorts becoming visible.
