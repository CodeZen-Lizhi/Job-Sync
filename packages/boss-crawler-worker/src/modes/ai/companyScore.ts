import { callOpenAiJson } from "../../ai/client.js";
import { buildCompanyScoreBatchPrompts } from "../../ai/prompt.js";

import { normalizeAiCompanyScoreBatchResult } from "./normalizeCompanyScore.js";
import { asRecord } from "./normalizeShared.js";
import { AiCompanyScoreBatchResultSchema } from "./schemas.js";
import { envFlag, safeError } from "./shared.js";
import type { AiCompanyScoreBatchPayload, ModeContext } from "./types.js";

function companyKey(name: string): string {
  return name.trim().toLowerCase();
}

function missingCompanyNames(requested: AiCompanyScoreBatchPayload["companies"], returned: Array<{ company_name: string }>): string[] {
  const returnedNames = new Set(returned.map((item) => companyKey(item.company_name)).filter(Boolean));
  return requested.map((item) => item.company_name).filter((name) => !returnedNames.has(companyKey(name)));
}

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

export async function runAiCompanyScoreBatchMode(payload: AiCompanyScoreBatchPayload, ctx: ModeContext): Promise<void> {
  try {
    ctx.emit({ type: "LOG", payload: { level: "info", message: "开始 AI 公司评分批处理。" } });
    const { system, user } = buildCompanyScoreBatchPrompts(payload.companies);
    const debugEnabled = envFlag("JOB_SYNC_AI_DEBUG");
    const runId = `company-score-${Date.now().toString(36)}`;
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

    const normalized = normalizeAiCompanyScoreBatchResult(raw, payload.companies);
    const parsed = AiCompanyScoreBatchResultSchema.safeParse(normalized);
    if (!parsed.success) {
      const { keys, preview } = rawPreview(raw);
      ctx.emit({
        type: "ERROR",
        payload: {
          message: "AI 公司评分输出不符合 schema",
          stack: [`zod_error: ${parsed.error.toString()}`, keys ? `raw_keys: ${keys}` : "", `raw_preview: ${preview}`]
            .filter(Boolean)
            .join("\n"),
        },
      });
      return;
    }

    const missing = missingCompanyNames(payload.companies, parsed.data.companies);
    if (missing.length > 0) {
      const { keys, preview } = rawPreview(raw);
      ctx.emit({
        type: "ERROR",
        payload: {
          message: `AI 公司评分缺少 ${missing.length} 家公司结果：${missing.slice(0, 5).join("、")}`,
          stack: [keys ? `raw_keys: ${keys}` : "", `raw_preview: ${preview}`].filter(Boolean).join("\n"),
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
