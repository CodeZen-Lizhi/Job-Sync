<script setup lang="ts">
import { RouterLink } from "vue-router";

import CrawlActionBar from "../components/crawl/CrawlActionBar.vue";
import CrawlRuntimePanel from "../components/crawl/CrawlRuntimePanel.vue";
import { useCrawlPage } from "../lib/useCrawlPage";

const {
  tauri,
  runtime,
  clearLogs,
  mode,
  selectedCollectionSources,
  selectedCollectionSourceLabel,
  v2exSelected,
  maxPages,
  maxJobs,
  delayMs,
  actionBusy,
  error,
  filterProfiles,
  activeFilterProfileId,
  activeFilterProfileName,
  activeFilterProfileIsDefault,
  sidecarRunning,
  selectFilterProfile,
  start,
  stop,
} = useCrawlPage();
</script>

<template>
  <section class="flex min-h-[calc(100vh-5.25rem)] flex-col gap-4">
    <header class="shrink-0 space-y-1">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-content-primary">岗位采集</h1>
          <p class="text-sm text-content-secondary">这里是采集执行台；采集意图、平台设置和筛选画像在采集配置里维护。</p>
          <p class="mt-1 text-xs text-content-muted">只采集和入库岗位，不执行投递或开聊。</p>
        </div>
        <RouterLink class="ui-btn-secondary px-3 py-1.5 text-xs" to="/crawl-config">采集配置</RouterLink>
      </div>
    </header>

    <div v-if="!tauri" class="ui-status-warning shrink-0 p-4 text-sm">
      当前是浏览器模式（非 Tauri）。采集命令不可用。
    </div>

    <div class="ui-crawl-panel shrink-0 space-y-4 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="inline-flex rounded-xl bg-card/80 p-1 ring-1 ring-border/10">
          <button
            class="rounded-md px-4 py-1.5 text-sm font-medium transition-all"
            :class="mode === 'manual' ? 'bg-accent/90 text-white shadow-sm' : 'text-content-secondary hover:bg-card-hover/60 hover:text-content-primary'"
            @click="mode = 'manual'"
          >
            手动采集
          </button>
          <button
            class="rounded-md px-4 py-1.5 text-sm font-medium transition-all"
            :class="mode === 'auto' ? 'bg-accent/90 text-white shadow-sm' : 'text-content-secondary hover:bg-card-hover/60 hover:text-content-primary'"
            @click="mode = 'auto'"
          >
            自动采集
          </button>
        </div>
        <div class="text-xs text-content-muted">
          自动来源：
          <span class="text-content-secondary">{{ selectedCollectionSourceLabel }}</span>
        </div>
      </div>

      <div v-if="mode === 'auto'" class="grid gap-3 lg:grid-cols-[minmax(14rem,1.1fr)_2fr]">
        <section class="space-y-2">
          <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">本次筛选画像</div>
          <select
            v-model="activeFilterProfileId"
            class="ui-input w-full"
            :disabled="!tauri || sidecarRunning"
            @change="selectFilterProfile(activeFilterProfileId)"
          >
            <option v-for="profile in filterProfiles" :key="profile.id" :value="profile.id">
              {{ profile.name }}{{ profile.is_default ? "（默认）" : "" }}
            </option>
          </select>
          <div class="text-xs text-content-muted">
            当前使用
            <span class="text-content-secondary">{{ activeFilterProfileName }}</span>
            <span v-if="activeFilterProfileIsDefault">，默认画像</span>
            ；只影响候选队列和排序，不阻止岗位入库。
          </div>
        </section>

        <section class="space-y-2">
          <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">采集规模</div>
          <div class="grid grid-cols-3 gap-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最大页数</div>
              <input v-model.number="maxPages" type="number" min="1" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最大职位数</div>
              <input v-model.number="maxJobs" type="number" min="1" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">延迟 (ms)</div>
              <input v-model.number="delayMs" type="number" min="0" class="ui-input w-full" />
            </label>
          </div>
        </section>
      </div>

      <div v-if="mode === 'auto' && selectedCollectionSources.length === 0" class="ui-status-warning p-3 text-xs">
        当前没有可执行的自动采集来源。请到设置页启用 Boss 或 V2EX，并在采集配置里选择本次采集来源。
      </div>
      <div v-else-if="mode === 'auto' && v2exSelected" class="ui-status-warning p-3 text-xs">
        多平台会按顺序采集。V2EX 使用公开 Feed，不需要 Boss 登录；只会入库识别为招聘帖的主题。
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
      :keyword="runtime.progress.keyword"
      :current-page="runtime.progress.current_page"
      :captured-job-list="runtime.progress.captured_job_list"
      :captured-job-detail="runtime.progress.captured_job_detail"
      :filtered-job="runtime.progress.filtered_job"
      :logs="runtime.logs"
      :sidecar-running="sidecarRunning"
      :error="error"
      @clear-logs="clearLogs"
    />
  </section>
</template>
