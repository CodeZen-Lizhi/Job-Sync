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
  <section class="ui-page flex min-h-[calc(100vh-6rem)] flex-col !space-y-0 gap-4">
    <header class="ui-page-header shrink-0">
      <div class="ui-page-heading">
        <h1 class="ui-page-title">岗位采集</h1>
        <p class="ui-page-description">只写入职位库，后续判断另算；来源控制、批次结果和运行日志集中在同一工作台。</p>
      </div>
      <div class="ui-page-actions">
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
            <div class="text-xs font-medium text-content-muted">自动采集</div>
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
