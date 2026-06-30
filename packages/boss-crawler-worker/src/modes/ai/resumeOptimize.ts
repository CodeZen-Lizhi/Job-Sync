import { callOpenAiJson } from "../../ai/client.js";
import { buildResumeOptimizePrompts } from "../../ai/prompt.js";

import { asRecord } from "./normalizeShared.js";
import { AiOptimizeResumeForJobResultSchema } from "./schemas.js";
import { envFlag, safeError } from "./shared.js";
import type { AiOptimizeResumeForJobPayload, ModeContext } from "./types.js";

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

export async function runAiOptimizeResumeForJobMode(payload: AiOptimizeResumeForJobPayload, ctx: ModeContext): Promise<void> {
  try {
    ctx.emit({ type: "LOG", payload: { level: "info", message: "开始生成岗位版简历。" } });
    const { system, user } = buildResumeOptimizePrompts({
      resumeText: payload.resume_text,
      jobDetail: payload.job_detail,
      contextText: payload.context_text,
      filterReason: payload.filter_reason,
      scoreReason: payload.score_reason,
      sourceContext: payload.source_context,
      reviewContext: payload.review_context,
    });
    const debugEnabled = envFlag("JOB_SYNC_AI_DEBUG");
    const runId = `resume-optimize-${Date.now().toString(36)}`;
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

    const parsed = AiOptimizeResumeForJobResultSchema.safeParse(raw);
    if (!parsed.success) {
      const { keys, preview } = rawPreview(raw);
      ctx.emit({
        type: "ERROR",
        payload: {
          message: "岗位版简历输出不符合 schema",
          stack: [`zod_error: ${parsed.error.toString()}`, keys ? `raw_keys: ${keys}` : "", `raw_preview: ${preview}`]
            .filter(Boolean)
            .join("\n"),
        },
      });
      return;
    }

    ctx.emit({ type: "AI_RESULT", payload: { result: parsed.data } });
  } catch (err) {
    ctx.emit({ type: "ERROR", payload: safeError(err) });
  } finally {
    ctx.emit({ type: "FINISHED" });
  }
}
