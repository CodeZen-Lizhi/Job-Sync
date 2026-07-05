<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";

import CrawlActionBar from "../components/crawl/CrawlActionBar.vue";
import CrawlRuntimePanel from "../components/crawl/CrawlRuntimePanel.vue";
import { runAfterInitialPaint } from "../lib/defer";
import { useCrawlPage } from "../lib/useCrawlPage";

const runtimePanelReady = ref(false);
let cancelRuntimePanelReady: (() => void) | null = null;

onMounted(() => {
  cancelRuntimePanelReady = runAfterInitialPaint(() => {
    runtimePanelReady.value = true;
  });
});

onUnmounted(() => {
  cancelRuntimePanelReady?.();
  cancelRuntimePanelReady = null;
});

const {
  tauri,
  runtime,
  clearLogs,
  actionBusy,
  error,
  sidecarRunning,
  selectedCollectionSources,
  delayMs,
  latestCollectionRun,
  start,
  stop,
} = useCrawlPage({ initialize: "runtime" });
</script>

<template>
  <section class="flex min-h-[calc(100vh-5.25rem)] flex-col gap-4">
    <header class="shrink-0 space-y-2">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h1 class="text-xl font-semibold text-content-primary">岗位采集</h1>
          <p class="text-xs text-content-muted [overflow-wrap:anywhere]">只写入职位库，后续判断另算。</p>
        </div>
        <RouterLink class="ui-btn-secondary px-3 py-1.5 text-xs" to="/crawl-config">采集配置</RouterLink>
      </div>
    </header>

    <div v-if="!tauri" class="ui-status-warning shrink-0 p-4 text-sm">
      当前是浏览器模式（非 Tauri）。采集命令不可用。
    </div>

    <div class="ui-crawl-panel shrink-0 space-y-4 p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="text-xs font-semibold uppercase tracking-[0.18em] text-content-muted">自动采集</div>
          <div class="text-sm font-medium text-content-primary">运行控制</div>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="space-y-1.5">
          <div class="text-xs font-medium text-content-muted">延迟 (ms)</div>
          <input v-model.number="delayMs" type="number" min="0" class="ui-input w-full" />
        </label>
      </div>

      <div v-if="selectedCollectionSources.length === 0" class="ui-status-warning p-3 text-xs">
        当前没有可执行的自动采集来源。请到设置页启用 Boss、猎聘、智联、V2EX、LinuxDo 或脉脉，并在采集配置里选择本次采集来源。
      </div>

      <CrawlActionBar
        :tauri="tauri"
        :action-busy="actionBusy"
        :sidecar-running="sidecarRunning"
        @start="start"
        @stop="stop"
      />
    </div>

    <CrawlRuntimePanel
      v-if="runtimePanelReady"
      :run="latestCollectionRun"
      :logs="runtime.logs"
      :sidecar-running="sidecarRunning"
      :error="error"
      @clear-logs="clearLogs"
    />
    <div v-else class="ui-log-panel min-h-40 shrink-0" />
  </section>
</template>
