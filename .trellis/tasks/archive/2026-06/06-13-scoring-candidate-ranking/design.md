# Design

## Scope

This task adds a scoring projection to job queries. It does not create a new persisted score table yet; scores are computed from existing local data so the review queue can immediately sort and explain candidates.

## Score Sources

- `resume_match_score`: latest `ai_report.match_score` for the same `encrypt_job_id` and `kind = 'resume'`.
- `preference_score`: derived from `job_filter_result.reason_json`.
- `company_score`: derived from local job fields and detail JSON risk keywords.
- `final_score`: default weighted score from the requirements document.

## Score Formula

```text
final_score = 0.6 * COALESCE(resume_match_score, 0)
            + 0.25 * preference_score
            + 0.15 * company_score
```

Preference score:

- no preferences available: `50`
- otherwise: `100 * matched / (matched + missing)`

Company score:

- base: `80`
- subtract `25` for outsourcing/training risk terms
- subtract `15` for onsite/sales-like risk terms
- clamp to `0..100`

## Query Shape

Use a helper score projection around `JobRow` mapping. This keeps the SQL column order explicit and avoids duplicating frontend score math.

`score_reason_json` shape:

```json
{
  "weights": { "resume": 0.6, "preference": 0.25, "company": 0.15 },
  "preference": {
    "matched": ["Go"],
    "missing": ["AI Infra"]
  },
  "company": {
    "risk_flags": ["outsourcing_risk"],
    "evidence": ["JD 中出现外包"]
  }
}
```

## Compatibility

- Existing jobs without AI reports remain listable.
- Existing frontend consumers get additive fields only.
- Ordinary search/source lists include scores but do not filter by them.
- Candidate query filters first, then sorts by `final_score`.

## Rollback

Revert query/model/UI changes. No persisted data migration is required for this task.
