# AI Post-Collection Judging Design

## Architecture

Existing deterministic post-collection filtering writes canonical bucket state into `job_filter_result`.
This task keeps that table as the canonical source for the Jobs page and collection summary.

The AI path will:

1. Load the default filter profile and job evidence.
2. Run the existing deterministic filter first.
3. If hard rules block the job, preserve the deterministic filtered result.
4. If only soft content matching is needed, call the AI worker.
5. Merge the AI result into `job_filter_result.reason_json` as `ai_judgement`.
6. Set `eligible` and `bucket` from the AI result when hard rules did not block the job.

## Boundaries

- Rust/Tauri owns DB reads, hard-rule precedence, persistence, and command registration.
- Worker owns model prompting and schema validation.
- Frontend owns trigger UI and readable display of AI judgement.
- `job_filter_result` remains the source of truth for job buckets.

## AI Contract

Worker command:

```json
{
  "type": "AI_POST_COLLECTION_JUDGE",
  "payload": {
    "profile": {},
    "job": {},
    "filter_reason": {}
  }
}
```

Worker result:

```json
{
  "bucket": "recommended | pending_confirmation | filtered",
  "confidence": 0.0,
  "summary": "short reason",
  "evidence": ["quoted or paraphrased evidence"],
  "risks": ["optional risks"]
}
```

Invalid or low-confidence outputs become `pending_confirmation`.

## Hard Rules

Hard rules remain deterministic:

- `company_blacklist`
- `job_blacklist`
- `keyword_blacklist`
- `review_status`
- `communication_status`
- `company_review_status`
- clear source/platform and manual state constraints

If any hard rule blocks, AI is skipped for that job.

## Rollback

Because AI output is embedded in `job_filter_result.reason_json`, rollback can rerun the existing deterministic recompute command to overwrite AI judgements.

