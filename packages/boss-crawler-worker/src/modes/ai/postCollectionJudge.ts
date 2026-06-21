import { callOpenAiJson } from "../../ai/client.js";
import { buildPostCollectionJudgePrompts } from "../../ai/prompt.js";

import { asRecord } from "./normalizeShared.js";
import { AiPostCollectionJudgeResultSchema } from "./schemas.js";
import { envFlag, safeError } from "./shared.js";
import type { AiPostCollectionJudgePayload, ModeContext } from "./types.js";

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

export async function runAiPostCollectionJudgeMode(payload: AiPostCollectionJudgePayload, ctx: ModeContext): Promise<void> {
  try {
    ctx.emit({ type: "LOG", payload: { level: "info", message: "开始 AI 采后判断。" } });
    const { system, user } = buildPostCollectionJudgePrompts({
      profile: payload.profile,
      job: payload.job,
      filterReason: payload.filter_reason,
    });
    const debugEnabled = envFlag("JOB_SYNC_AI_DEBUG");
    const runId = `post-collection-judge-${Date.now().toString(36)}`;
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
      const { keys, preview } = rawPreview(raw);
      ctx.emit({
        type: "ERROR",
        payload: {
          message: "AI 采后判断输出不符合 schema",
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
