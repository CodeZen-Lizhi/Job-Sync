import { callOpenAiJson } from "../../ai/client.js";
import { buildPostCollectionJudgePrompts } from "../../ai/prompt.js";

import { asRecord } from "./normalizeShared.js";
import { AiPostCollectionJudgeResultSchema } from "./schemas.js";
import { envFlag, safeError } from "./shared.js";
import type { AiPostCollectionJudgeBatchPayload, AiPostCollectionJudgePayload, ModeContext } from "./types.js";

const DEFAULT_BATCH_CONCURRENCY = 3;
const MAX_BATCH_CONCURRENCY = 8;

function rawPreview(raw: unknown): { keys: string; preview: string } {
  let preview = "";
  try {
    preview = JSON.stringify(raw);
  } catch {
    preview = String(raw);
  }
  const obj = asRecord(raw);
  const keys = obj ? Object.keys(obj).slice(0, 50).join(", ") : "";
  return { keys, preview: preview.slice(0, 4000) };
}

function schemaError(raw: unknown, zodError: string): Error {
  const { keys, preview } = rawPreview(raw);
  const error = new Error("AI 采后判断输出不符合 schema");
  error.stack = [zodError, keys ? `raw_keys: ${keys}` : "", `raw_preview: ${preview}`]
    .filter(Boolean)
    .join("\n");
  return error;
}

function resolveBatchConcurrency(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_BATCH_CONCURRENCY;
  return Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, Math.floor(value)));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(resolveBatchConcurrency(concurrency), items.length);

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function judgePostCollection(payload: AiPostCollectionJudgePayload, ctx: ModeContext, runId: string): Promise<unknown> {
  const { system, user } = buildPostCollectionJudgePrompts({
    profile: payload.profile,
    job: payload.job,
    filterReason: payload.filter_reason,
  });
  const debugEnabled = envFlag("JOB_SYNC_AI_DEBUG");
  const raw = await callOpenAiJson({
    systemPrompt: system,
    userPrompt: user,
    client: { signal: ctx.signal },
    debug: debugEnabled
      ? {
          enabled: true,
          runId,
          maxPreviewChars: 1600,
          includePromptPreview: true,
          log: (message) => ctx.emit({ type: "LOG", payload: { level: "info", message } }),
        }
      : undefined,
  });

  const parsed = AiPostCollectionJudgeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw schemaError(raw, `zod_error: ${parsed.error.toString()}`);
  }
  return parsed.data;
}

export async function runAiPostCollectionJudgeMode(payload: AiPostCollectionJudgePayload, ctx: ModeContext): Promise<void> {
  try {
    ctx.emit({ type: "LOG", payload: { level: "info", message: "开始 AI 采后判断。" } });
    const runId = `post-collection-judge-${Date.now().toString(36)}`;
    const result = await judgePostCollection(payload, ctx, runId);
    ctx.emit({ type: "AI_RESULT", payload: { result } });
  } catch (err) {
    ctx.emit({ type: "ERROR", payload: safeError(err) });
  } finally {
    ctx.emit({ type: "FINISHED" });
  }
}

export async function runAiPostCollectionJudgeBatchMode(payload: AiPostCollectionJudgeBatchPayload, ctx: ModeContext): Promise<void> {
  try {
    const concurrency = resolveBatchConcurrency(payload.concurrency);
    ctx.emit({
      type: "LOG",
      payload: { level: "info", message: `开始 AI 采后判断批处理：${payload.jobs.length} 个岗位，并发 ${concurrency}。` },
    });
    const batchRunId = `post-collection-judge-batch-${Date.now().toString(36)}`;
    const results = await mapWithConcurrency(payload.jobs, concurrency, async (job, index) => {
      try {
        const result = await judgePostCollection(
          {
            profile: payload.profile,
            job: job.job,
            filter_reason: job.filter_reason,
          },
          ctx,
          `${batchRunId}-${index}-${job.encrypt_job_id}`,
        );
        return { encrypt_job_id: job.encrypt_job_id, ok: true, result };
      } catch (err) {
        const error = safeError(err);
        return { encrypt_job_id: job.encrypt_job_id, ok: false, error: [error.message, error.stack].filter(Boolean).join("\n") };
      }
    });

    ctx.emit({ type: "AI_RESULT", payload: { result: { results } } });
  } catch (err) {
    ctx.emit({ type: "ERROR", payload: safeError(err) });
  } finally {
    ctx.emit({ type: "FINISHED" });
  }
}

export const __test__ = {
  mapWithConcurrency,
};
