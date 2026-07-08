import type { JobCandidatePage } from "./jobs";
import { invoke, isTauri } from "./tauri";

export interface AiPostCollectionJudgeResult {
  updated: number;
  ai_judged: number;
  hard_skipped: number;
  failed: number;
  telegram_sent?: boolean;
  telegram_error?: string | null;
}

type AiPostCollectionJudgeOptions = {
  notifyWhenEmpty?: boolean;
};

export function formatAiPostCollectionJudgeSummary(result: AiPostCollectionJudgeResult | null): string {
  if (!result) return "当前没有可进行 AI 采后判断的岗位";
  return `AI 采后判断 ${result.updated} 个职位，其中 ${result.ai_judged} 个由 AI 判断${result.hard_skipped > 0 ? `，${result.hard_skipped} 个保留硬规则结果` : ""}${result.failed > 0 ? `，${result.failed} 个审核失败` : ""}${result.telegram_sent ? "，已推送 Telegram" : ""}${result.telegram_error ? `，推送失败：${result.telegram_error}` : ""}`;
}

async function loadAllJobCandidateIds(): Promise<string[]> {
  if (!isTauri()) return [];

  const ids: string[] = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const page = await invoke<JobCandidatePage>("list_job_candidates", {
      bucket: null,
      query: null,
      startDate: null,
      endDate: null,
      processed: null,
      statusFilters: null,
      aiAuditFilters: null,
      sourcePlatforms: null,
      collectionMethods: null,
      limit: pageSize,
      offset,
    });
    ids.push(...page.jobs.map((job) => job.encrypt_job_id));
    if (page.jobs.length < pageSize || ids.length >= page.total) break;
    offset += pageSize;
  }

  return ids;
}

export async function recomputeAiPostCollectionJudgementForAllJobs(): Promise<AiPostCollectionJudgeResult | null> {
  if (!isTauri()) return null;

  const jobIds = await loadAllJobCandidateIds();
  return recomputeAiPostCollectionJudgementForJobIds(jobIds);
}

export async function recomputeAiPostCollectionJudgementForJobIds(
  jobIds: readonly string[],
  options: AiPostCollectionJudgeOptions = {},
): Promise<AiPostCollectionJudgeResult | null> {
  if (!isTauri()) return null;

  if (jobIds.length === 0 && !options.notifyWhenEmpty) return null;

  return invoke<AiPostCollectionJudgeResult>("recompute_ai_post_collection_judgement", {
    jobIds,
    limit: jobIds.length,
  });
}
