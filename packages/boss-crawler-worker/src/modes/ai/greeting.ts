import { callOpenAiJson } from "../../ai/client.js";
import { buildGreetingPrompts } from "../../ai/prompt.js";

import { asRecord } from "./normalizeShared.js";
import { AiGreetingResultSchema } from "./schemas.js";
import { envFlag, safeError } from "./shared.js";
import type { AiGreetingPayload, ModeContext } from "./types.js";

export async function runAiGreetingMode(payload: AiGreetingPayload, ctx: ModeContext): Promise<void> {
  try {
    ctx.emit({ type: "LOG", payload: { level: "info", message: "开始生成打招呼文案。" } });
    const { system, user } = buildGreetingPrompts({
      resumeText: payload.resume_text,
      contextText: payload.context_text,
      resumeFiles: payload.resume_files,
      greetingPromptExtra: payload.greeting_prompt_extra,
      jobDetail: payload.job_detail,
      matchReport: payload.match_report,
      filterReason: payload.filter_reason,
      scoreReason: payload.score_reason,
      sourceContext: payload.source_context,
      reviewContext: payload.review_context,
    });
    const debugEnabled = envFlag("JOB_SYNC_AI_DEBUG");
    const runId = `greeting-${Date.now().toString(36)}`;
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

    const parsed = AiGreetingResultSchema.safeParse(raw);
    if (!parsed.success) {
      let preview = "";
      try {
        preview = JSON.stringify(raw);
      } catch {
        preview = String(raw);
      }
      const keys = asRecord(raw) ? Object.keys(raw as any).slice(0, 50).join(", ") : "";
      ctx.emit({
        type: "ERROR",
        payload: {
          message: "AI 打招呼文案输出不符合 schema",
          stack: [`zod_error: ${parsed.error.toString()}`, keys ? `raw_keys: ${keys}` : "", `raw_preview: ${preview.slice(0, 4000)}`]
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
