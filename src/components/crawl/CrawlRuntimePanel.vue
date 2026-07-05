<script setup lang="ts">
import { computed } from "vue";

import type { CollectionRun } from "../../lib/crawl";
import type { LogLine } from "../../lib/runtime";

const props = defineProps<{
  run?: CollectionRun | null;
  logs: LogLine[];
  sidecarRunning: boolean;
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

function buildRunStats(run: CollectionRun | null | undefined): {
  total: number | null;
  skipped: number | null;
  inserted: number | null;
  passed: number | null;
} {
  if (!run) return { total: null, skipped: null, inserted: null, passed: null };
  return {
    total: run.captured,
    skipped: run.filtered,
    inserted: run.inserted + run.updated + run.duplicate,
    passed: run.recommended,
  };
}

const runStats = computed(() => buildRunStats(props.run));
const visibleLogs = computed(() => props.logs.slice(-VISIBLE_LOG_LIMIT));
</script>

<template>
  <div class="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div class="ui-crawl-stat p-4">
      <div class="text-xs font-medium text-content-muted">总搜到</div>
      <div class="mt-1 text-2xl font-semibold text-accent">{{ formatStat(runStats.total) }}</div>
      <div class="mt-2 text-xs text-content-muted">原始条目数</div>
    </div>
    <div class="ui-crawl-stat p-4">
      <div class="text-xs font-medium text-content-muted">跳过</div>
      <div class="mt-1 text-2xl font-semibold text-rose-700">{{ formatStat(runStats.skipped) }}</div>
      <div class="mt-2 text-xs text-content-muted">被规则跳过</div>
    </div>
    <div class="ui-crawl-stat p-4">
      <div class="text-xs font-medium text-content-muted">入库</div>
      <div class="mt-1 text-2xl font-semibold text-emerald-500">{{ formatStat(runStats.inserted) }}</div>
      <div class="mt-2 text-xs text-content-muted">写入本地库</div>
    </div>
    <div class="ui-crawl-stat p-4">
      <div class="text-xs font-medium text-content-muted">通过</div>
      <div class="mt-1 text-2xl font-semibold text-amber-500">{{ formatStat(runStats.passed) }}</div>
      <div class="mt-2 text-xs text-content-muted">通过采后判断</div>
    </div>
  </div>

  <div class="ui-log-panel mt-3">
    <div class="ui-log-panel-header">
      <div class="space-y-1">
        <div class="text-sm font-semibold text-content-primary">运行日志</div>
        <div class="text-xs text-content-muted">最近 {{ visibleLogs.length }} / {{ logs.length }} 条</div>
      </div>
      <div class="flex items-center gap-2">
        <span class="ui-badge" :class="sidecarRunning ? 'bg-emerald-400/10 text-emerald-700 ring-emerald-400/20' : ''">
          <span class="inline-block h-1.5 w-1.5 rounded-full" :class="sidecarRunning ? 'bg-emerald-500' : 'bg-content-muted/60'" />
          {{ sidecarRunning ? '运行中' : '空闲' }}
        </span>
        <button class="ui-btn-secondary px-3 py-1.5 text-xs" @click="$emit('clear-logs')">清空日志</button>
      </div>
    </div>
    <div class="ui-log-surface">
      <div v-for="(line, index) in visibleLogs" :key="`${line.ts}-${index}`" class="ui-log-row">
        <span class="ui-log-time" :title="line.ts">{{ formatLogTime(line.ts) }}</span>
        <span class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" :class="line.level === 'error' ? 'bg-rose-500' : 'bg-sky-500/80'" />
        <span class="ui-log-message">{{ line.message }}</span>
      </div>
    </div>
  </div>

  <div v-if="error" class="ui-status-danger shrink-0 p-4 text-sm">{{ error }}</div>
</template>
