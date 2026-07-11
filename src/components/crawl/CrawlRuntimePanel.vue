<script setup lang="ts">
import { ScrollText, Trash2 } from "lucide-vue-next";
import { computed } from "vue";

import type { CollectionBatchSummary } from "../../lib/crawl";
import type { LogLine } from "../../lib/runtime";

const props = defineProps<{
  summary?: CollectionBatchSummary | null;
  logs: LogLine[];
  error?: string | null;
}>();

const VISIBLE_LOG_LIMIT = 80;

defineEmits<{
  (e: "clear-logs"): void;
}>();

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatStat(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "—";
}

function buildRunStats(summary: CollectionBatchSummary | null | undefined): {
  total: number | null;
  skipped: number | null;
  inserted: number | null;
  passed: number | null;
} {
  if (!summary) return { total: null, skipped: null, inserted: null, passed: null };
  return {
    total: summary.captured,
    skipped: summary.not_inserted,
    inserted: summary.inserted,
    passed: summary.passed,
  };
}

const runStats = computed(() => buildRunStats(props.summary));
const runMetrics = computed(() => [
  { key: "captured", label: "总搜到", value: runStats.value.total, hint: "原始条目", indicatorClass: "bg-blue-500" },
  { key: "existing", label: "未新增", value: runStats.value.skipped, hint: "更新或重复", indicatorClass: "bg-slate-400" },
  { key: "inserted", label: "新入库", value: runStats.value.inserted, hint: "本批次新增", indicatorClass: "bg-emerald-500" },
  { key: "passed", label: "通过", value: runStats.value.passed, hint: "采后判断通过", indicatorClass: "bg-amber-500" },
]);
const visibleLogs = computed(() => props.logs.slice(-VISIBLE_LOG_LIMIT));

function logIndicatorClass(level: string): string {
  if (level === "error") return "bg-rose-500";
  if (level === "warn" || level === "warning") return "bg-amber-500";
  return "bg-sky-500";
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="ui-crawl-metrics shrink-0">
      <div v-for="metric in runMetrics" :key="metric.key" class="ui-crawl-metric">
        <div class="flex items-center gap-2 text-xs font-medium text-content-muted">
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="metric.indicatorClass" aria-hidden="true" />
          {{ metric.label }}
        </div>
        <div class="mt-1 text-xl font-semibold tabular-nums text-content-primary">{{ formatStat(metric.value) }}</div>
        <div class="mt-1 truncate text-[11px] text-content-muted" :title="metric.hint">{{ metric.hint }}</div>
      </div>
    </div>

    <div v-if="error" class="ui-status-danger shrink-0 p-3 text-sm">{{ error }}</div>

    <div class="ui-log-panel">
      <div class="ui-log-panel-header">
        <div class="min-w-0">
          <div class="text-sm font-semibold text-white">运行日志</div>
          <div class="mt-0.5 text-xs text-slate-400">最近 {{ visibleLogs.length }} / {{ logs.length }} 条</div>
        </div>
        <button
          type="button"
          class="ui-icon-btn h-9 w-9 shrink-0"
          :disabled="logs.length === 0"
          aria-label="清空日志"
          title="清空日志"
          @click="$emit('clear-logs')"
        >
          <Trash2 class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div class="ui-log-surface" role="log" aria-label="运行日志内容">
        <div v-if="visibleLogs.length === 0" class="flex h-full min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
          <ScrollText class="h-5 w-5 text-slate-500" aria-hidden="true" />
          <div class="mt-2 text-xs font-medium text-slate-400">暂无运行日志</div>
        </div>
        <div v-for="(line, index) in visibleLogs" v-else :key="`${line.ts}-${index}`" class="ui-log-row">
          <span class="ui-log-time" :title="line.ts">{{ formatLogTime(line.ts) }}</span>
          <span class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" :class="logIndicatorClass(line.level)" aria-hidden="true" />
          <span class="ui-log-message">{{ line.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
