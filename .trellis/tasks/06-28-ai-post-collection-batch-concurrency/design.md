# AI Post-Collection Batch Concurrency Design

## Problem

AI post-collection judgement is latency-bound. The current implementation does one job at a time and starts a fresh worker process for each AI call, so total runtime grows roughly as the sum of all job latencies plus repeated process startup overhead.

## Architecture

Keep Rust as the owner of job loading, hard-rule skipping, result merging, database writes, count aggregation, and Telegram notification. Move only the network-bound AI calls into a single worker batch command with bounded concurrency.

```text
Frontend recompute action
  -> Tauri command recompute_ai_post_collection_judgement
  -> Rust loads jobs and skips hard-blocked jobs
  -> Rust starts one worker batch command
  -> Worker runs bounded concurrent AI calls
  -> Worker returns per-job success/failure records
  -> Rust serially merges and writes job_filter_result
  -> Rust emits counts and Telegram summary
```

## Contracts

### New Worker Command

Add a command variant similar to:

```ts
{
  type: "AI_POST_COLLECTION_JUDGE_BATCH",
  payload: {
    profile?: unknown,
    jobs: Array<{
      encrypt_job_id: string,
      job: unknown,
      filter_reason?: unknown
    }>,
    concurrency?: number
  }
}
```

Rust and TypeScript protocol definitions must remain aligned.

### Worker Result

Return one `AI_RESULT` containing:

```ts
{
  results: Array<
    | {
        encrypt_job_id: string;
        ok: true;
        result: {
          bucket: string;
          confidence: number;
          summary: string;
          evidence: string[];
          risks?: string[];
        };
      }
    | {
        encrypt_job_id: string;
        ok: false;
        error: string;
      }
  >
}
```

The Rust layer must apply results by `encrypt_job_id`, not result order.

## Concurrency

- Default remote API concurrency: `3`.
- Default local Ollama concurrency: `1`.
- Hard cap: `8`.
- Requested or computed concurrency is clamped to `1..=8`.
- Each job gets its own try/catch result so partial failure does not abort the whole batch.
- The worker passes the shared `AbortSignal` to each `callOpenAiJson` call.

## Compatibility

- Keep `AI_POST_COLLECTION_JUDGE` and `runAiPostCollectionJudgeMode` intact.
- Keep `WorkerPostCollectionJudgeResult` merge semantics intact.
- Keep `AiPostCollectionJudgeResult` frontend result shape intact.
- No database schema changes.
- No frontend UI changes required for the first version.

## Error Handling

- Batch worker schema failure for one job returns an `ok: false` record for that job.
- Rust persists `pending_confirmation` failed fallback for failed records.
- Missing result for a non-hard-blocked job is treated as a failed fallback.
- If starting the batch worker fails entirely, Rust persists failed fallback for each AI-targeted job.

## Rollback

The old single-job command remains available. If batch behavior regresses, the Rust command can be switched back to the existing per-job loop without schema migration or frontend changes.
