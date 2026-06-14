<script setup lang="ts">
import { computed } from "vue";

import { isAiGroupReportComplete, type AiGroupReport } from "../../lib/aiReport.ts";
import AiScoreBadge from "./AiScoreBadge.vue";

const props = defineProps<{
  report: AiGroupReport;
  expectedJobIds?: string[];
}>();

const jobsCount = computed(() => props.report.jobRanking.length);
const bestJob = computed(() => props.report.jobRanking[0] ?? null);
const placeholderCount = computed(() => props.report.placeholderCount ?? 0);
const reportComplete = computed(() => isAiGroupReportComplete(props.report, props.expectedJobIds ?? []));
const averageScore = computed(() => {
  const items = props.report.jobRanking;
  if (!items.length) return 0;
  const sum = items.reduce((acc, it) => acc + (Number.isFinite(it.matchScore) ? it.matchScore : 0), 0);
  return Math.round((sum / items.length) * 10) / 10;
});
</script>

<template>
  <section id="ai-group-overview" class="scroll-mt-24 space-y-4">
    <div class="grid gap-3 sm:grid-cols-3">
      <div class="rounded-xl bg-card/60 p-4 ring-1 ring-white/[0.06]">
        <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">职位数</div>
        <div class="mt-1 text-2xl font-semibold text-content-primary tabular-nums">{{ jobsCount }}</div>
      </div>
      <div class="rounded-xl bg-card/60 p-4 ring-1 ring-white/[0.06]">
        <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">平均匹配度</div>
        <div class="mt-1">
          <AiScoreBadge :score="averageScore" label="均值" />
        </div>
      </div>
      <div class="rounded-xl bg-card/60 p-4 ring-1 ring-white/[0.06]">
        <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">优先推荐</div>
        <div v-if="bestJob" class="mt-1 space-y-1">
          <div class="truncate text-sm font-semibold text-content-primary">
            {{ bestJob.position_name ?? "-" }}
          </div>
          <div class="truncate text-xs text-content-muted">
            {{ bestJob.brand_name ?? "" }}
          </div>
          <div class="pt-1">
            <AiScoreBadge :score="bestJob.matchScore" />
          </div>
        </div>
        <div v-else class="mt-1 text-sm text-content-muted">（暂无）</div>
      </div>
      <div class="rounded-xl bg-card/60 p-4 ring-1 ring-white/[0.06]">
        <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">占位项</div>
        <div class="mt-1 text-2xl font-semibold text-content-primary tabular-nums">{{ placeholderCount }}</div>
      </div>
    </div>

    <div class="rounded-xl bg-card/60 p-4 ring-1 ring-white/[0.06]">
      <div class="flex items-center justify-between gap-2">
        <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">总结</div>
        <span v-if="!reportComplete" class="ui-badge bg-amber-400/10 text-amber-300 ring-amber-400/20">报告未覆盖全部职位</span>
      </div>
      <p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-content-secondary">{{ report.summary }}</p>
    </div>
  </section>
</template>
