<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { Settings2 } from "lucide-vue-next";

import CrawlActionBar from "../components/crawl/CrawlActionBar.vue";
import CrawlRuntimePanel from "../components/crawl/CrawlRuntimePanel.vue";
import { runAfterInitialPaint } from "../lib/defer";
import { useCrawlPage } from "../lib/useCrawlPage";

const runtimePanelReady = ref(false);
let cancelRuntimePanelReady: (() => void) | null = null;
let runtimePanelReadyTimer: number | null = null;

onMounted(() => {
  cancelRuntimePanelReady = runAfterInitialPaint(() => {
    runtimePanelReadyTimer = window.setTimeout(() => {
      runtimePanelReady.value = true;
      runtimePanelReadyTimer = null;
    }, 600);
  });
});

onUnmounted(() => {
  cancelRuntimePanelReady?.();
  cancelRuntimePanelReady = null;
  if (runtimePanelReadyTimer !== null) {
    window.clearTimeout(runtimePanelReadyTimer);
    runtimePanelReadyTimer = null;
  }
});

const {
  tauri,
  runtime,
  clearLogs,
  actionBusy,
  error,
  sidecarRunning,
  selectedCollectionSources,
  selectedCollectionSourceLabel,
  delayMs,
  collectionBatchSummary,
  start,
  stop,
} = useCrawlPage({ initialize: "runtime" });
</script>

<template>
  <section class="flex min-h-[calc(100vh-5.25rem)] flex-col gap-3">
    <header class="shrink-0 space-y-2">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 space-y-1">
          <h1 class="text-xl font-semibold text-content-primary">岗位采集</h1>
          <p class="text-xs text-content-muted [overflow-wrap:anywhere]">只写入职位库，后续判断另算。</p>
        </div>
        <RouterLink class="ui-btn-secondary px-3 py-1.5 text-xs" to="/crawl-config">
          <Settings2 class="h-4 w-4" aria-hidden="true" />
          采集配置
        </RouterLink>
      </div>
    </header>

    <div v-if="!tauri" class="ui-status-warning shrink-0 px-3 py-2.5 text-xs">
      当前是浏览器模式（非 Tauri）。采集命令不可用。
    </div>

    <div class="ui-crawl-panel shrink-0 p-4">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div class="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
          <div class="min-w-0">
            <div class="text-[11px] font-semibold text-content-muted">自动采集</div>
            <div class="mt-1 text-sm font-semibold text-content-primary">运行控制</div>
            <div class="mt-1 text-xs text-content-muted [overflow-wrap:anywhere]" :title="selectedCollectionSourceLabel">
              本轮来源：<span class="font-medium text-content-secondary">{{ selectedCollectionSourceLabel }}</span>
            </div>
          </div>

          <label class="block min-w-0">
            <span class="ui-field-label">延迟 (ms)</span>
            <input v-model.number="delayMs" type="number" min="0" class="ui-input mt-1.5 w-full" />
          </label>
        </div>

        <CrawlActionBar
          :tauri="tauri"
          :action-busy="actionBusy"
          :sidecar-running="sidecarRunning"
          @start="start"
          @stop="stop"
        />
      </div>

      <div v-if="selectedCollectionSources.length === 0" class="ui-status-warning mt-3 p-3 text-xs">
        当前没有可执行的自动采集来源。请到设置页启用 Boss、猎聘、智联、V2EX、LinuxDo 或脉脉，并在采集配置里选择本次采集来源。
      </div>
    </div>

    <CrawlRuntimePanel
      v-if="runtimePanelReady"
      :summary="collectionBatchSummary"
      :logs="runtime.logs"
      :error="error"
      @clear-logs="clearLogs"
    />
    <div v-else class="flex min-h-0 flex-1 flex-col gap-3" aria-hidden="true">
      <div class="ui-crawl-metrics">
        <div v-for="index in 4" :key="index" class="ui-crawl-metric h-[76px]" />
      </div>
      <div class="ui-log-panel" />
    </div>
  </section>
</template>
