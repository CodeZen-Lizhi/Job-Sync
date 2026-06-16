<script setup lang="ts">
import { computed } from "vue";
import { ChevronLeft, ChevronRight, Database, Filter, MessageCircle, RefreshCw, X } from "lucide-vue-next";

import JobsConfirmDialog from "../components/jobs/JobsConfirmDialog.vue";
import JobsExportPanel from "../components/jobs/JobsExportPanel.vue";
import JobsJobItem from "../components/jobs/JobsJobItem.vue";
import { useJobsPage } from "../lib/useJobsPage";

const {
  tauri,
  error,
  linkedJob,
  linkedJobLoading,
  linkedJobError,
  jobCandidates,
  jobCandidatesTotal,
  jobCandidatesLoading,
  bossChatStatusSyncing,
  bossChatStatusSyncMessage,
  jobCandidatePage,
  jobCandidatePageSize,
  jobCandidateTimeRange,
  jobCandidateCustomStartDate,
  jobCandidateCustomEndDate,
  jobCandidateProcessedFilter,
  selectedJobStatusFilters,
  selectedSourcePlatformFilters,
  selectedCollectionMethodFilters,
  jobCandidateTotalPages,
  jobIntelligenceRangeLabel,
  currentPageProcessedCount,
  currentPageUnprocessedCount,
  expandedJobId,
  detailLoading,
  expandedDetail,
  greetingCache,
  greetingDrafts,
  greetingErrors,
  greetingLoading,
  resumeWorkspaceStatuses,
  confirmDialog,
  JOB_TIME_RANGE_OPTIONS,
  PROCESSED_FILTER_OPTIONS,
  JOB_STATUS_FILTER_OPTIONS,
  SOURCE_PLATFORM_FILTER_OPTIONS,
  COLLECTION_METHOD_FILTER_OPTIONS,
  loadJobCandidates,
  syncBossChatStatus,
  toggleJobStatusFilter,
  toggleSourcePlatformFilter,
  toggleCollectionMethodFilter,
  clearJobCandidateFilters,
  goJobCandidatePage,
  toggleDetail,
  goAi,
  goResumeWorkspace,
  copy,
  jobSourceUrl,
  openJobSourceUrl,
  deleteJob,
  updateReviewStatus,
  restoreReviewCandidate,
  updateCommunicationStatus,
  updateReviewNotes,
  updateCompanyReviewStatus,
  blacklistCompany,
  blacklistJob,
  blacklistKeyword,
  generateGreeting,
  updateGreetingDraft,
  copyGreeting,
  copyApplicationPacket,
  closeConfirm,
  executeConfirm,
} = useJobsPage();

const hasActiveFilters = computed(
  () =>
    jobCandidateProcessedFilter.value !== "all" ||
    selectedJobStatusFilters.value.length > 0 ||
    selectedSourcePlatformFilters.value.length > 0 ||
    selectedCollectionMethodFilters.value.length > 0 ||
    jobCandidateTimeRange.value !== "last7",
);

function refreshCandidates(): void {
  void loadJobCandidates({ keepPage: true });
}

function reloadCandidatesFromFirstPage(): void {
  void loadJobCandidates();
}
</script>

<template>
  <section class="space-y-5">
    <header class="flex flex-wrap items-start justify-between gap-4">
      <div class="space-y-1">
        <h1 class="text-xl font-semibold text-content-primary">岗位候选库</h1>
        <p class="text-sm text-content-secondary">统一查看所有采集岗位，用时间、状态、平台和采集方式筛选候选。</p>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-xs text-content-muted">
        <span class="ui-badge">范围 {{ jobIntelligenceRangeLabel }}</span>
        <span class="ui-badge">共 {{ jobCandidatesTotal }} 个岗位</span>
      </div>
    </header>

    <div v-if="!tauri" class="ui-status-warning p-4 text-sm">当前是浏览器模式（非 Tauri）。查询命令不可用。</div>
    <div v-if="error" class="ui-status-danger p-4 text-sm">{{ error }}</div>

    <section v-if="linkedJob || linkedJobLoading || linkedJobError" class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">定位岗位</h2>
          <p class="mt-1 text-xs text-content-muted">来自外部入口的岗位会在这里单独定位。</p>
        </div>
      </div>
      <div v-if="linkedJobLoading" class="px-4 py-5 text-sm text-content-muted">正在加载岗位…</div>
      <div v-else-if="linkedJobError" class="px-4 py-5 text-sm text-rose-300">{{ linkedJobError }}</div>
      <JobsJobItem
        v-else-if="linkedJob"
        :job="linkedJob"
        :expanded="expandedJobId === linkedJob.encrypt_job_id"
        :detail-loading="detailLoading === linkedJob.encrypt_job_id"
        :detail="expandedJobId === linkedJob.encrypt_job_id ? expandedDetail : null"
        :greeting="greetingCache.get(linkedJob.encrypt_job_id)"
        :greeting-draft="greetingDrafts.get(linkedJob.encrypt_job_id) ?? ''"
        :greeting-error="greetingErrors.get(linkedJob.encrypt_job_id)"
        :greeting-loading="greetingLoading === linkedJob.encrypt_job_id"
        :resume-workspace-status="resumeWorkspaceStatuses.get(linkedJob.encrypt_job_id)"
        @toggle-detail="(jobId) => toggleDetail(jobId)"
        @go-ai="(jobId) => goAi(jobId)"
        @go-resume-workspace="(jobId) => goResumeWorkspace(jobId)"
        @copy-link="(job) => copy(jobSourceUrl(job))"
        @open-source-url="(job) => openJobSourceUrl(job)"
        @update-review="(job, status) => updateReviewStatus(job, status)"
        @restore-review-candidate="(job) => restoreReviewCandidate(job)"
        @update-communication="(job, status) => updateCommunicationStatus(job, status)"
        @update-review-notes="(job) => updateReviewNotes(job)"
        @update-company-review="(job, status) => updateCompanyReviewStatus(job, status)"
        @blacklist-company="(job) => blacklistCompany(job)"
        @blacklist-job="(job) => blacklistJob(job)"
        @blacklist-keyword="(job) => blacklistKeyword(job)"
        @generate-greeting="(job) => generateGreeting(job)"
        @update-greeting-draft="(jobId, message) => updateGreetingDraft(jobId, message)"
        @copy-greeting="(job) => copyGreeting(job)"
        @copy-application-packet="(job) => copyApplicationPacket(job)"
      />
    </section>

    <section class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">岗位情报</h2>
          <p class="mt-1 text-xs text-content-muted">
            按当前时间范围统计候选岗位；操作入口都在下方岗位列表中。
            <span v-if="bossChatStatusSyncMessage" class="text-cyan-200">{{ bossChatStatusSyncMessage }}</span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!tauri || bossChatStatusSyncing" @click="syncBossChatStatus">
            <MessageCircle class="h-3.5 w-3.5" aria-hidden="true" />
            {{ bossChatStatusSyncing ? "同步中…" : "同步 Boss 沟通状态" }}
          </button>
          <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!tauri || jobCandidatesLoading" @click="refreshCandidates">
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            {{ jobCandidatesLoading ? "刷新中…" : "刷新" }}
          </button>
        </div>
      </div>

      <div class="grid gap-2 p-3 sm:grid-cols-3">
        <div class="rounded-md border border-border/10 bg-surface-secondary/45 px-3 py-3">
          <div class="text-xs text-content-muted">时间范围</div>
          <div class="mt-2 text-lg font-semibold text-content-primary">{{ jobIntelligenceRangeLabel }}</div>
        </div>
        <div class="rounded-md border border-border/10 bg-surface-secondary/45 px-3 py-3">
          <div class="text-xs text-content-muted">当前页未处理</div>
          <div class="mt-2 text-lg font-semibold text-content-primary">{{ currentPageUnprocessedCount }}</div>
        </div>
        <div class="rounded-md border border-border/10 bg-surface-secondary/45 px-3 py-3">
          <div class="text-xs text-content-muted">当前页已处理</div>
          <div class="mt-2 text-lg font-semibold text-content-primary">{{ currentPageProcessedCount }}</div>
        </div>
      </div>
    </section>

    <section class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div class="flex items-center gap-2">
          <Filter class="h-4 w-4 text-content-muted" aria-hidden="true" />
          <div>
            <h2 class="text-sm font-semibold text-content-primary">筛选条件</h2>
            <p class="mt-1 text-xs text-content-muted">多选状态会合并到同一个岗位列表中。</p>
          </div>
        </div>
        <button v-if="hasActiveFilters" class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" @click="clearJobCandidateFilters">
          <X class="h-3.5 w-3.5" aria-hidden="true" />
          清除筛选
        </button>
      </div>

      <div class="grid gap-4 p-4 xl:grid-cols-[1.1fr_1fr]">
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="space-y-1 text-xs text-content-muted">
            <span>时间范围</span>
            <select v-model="jobCandidateTimeRange" class="ui-input w-full" @change="reloadCandidatesFromFirstPage">
              <option v-for="option in JOB_TIME_RANGE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="space-y-1 text-xs text-content-muted">
            <span>处理状态</span>
            <select v-model="jobCandidateProcessedFilter" class="ui-input w-full" @change="reloadCandidatesFromFirstPage">
              <option v-for="option in PROCESSED_FILTER_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label class="space-y-1 text-xs text-content-muted">
            <span>每页数量</span>
            <select v-model.number="jobCandidatePageSize" class="ui-input w-full" @change="reloadCandidatesFromFirstPage">
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
        </div>

        <div v-if="jobCandidateTimeRange === 'custom'" class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-xs text-content-muted">
            <span>开始日期</span>
            <input v-model="jobCandidateCustomStartDate" type="date" class="ui-input w-full" @change="reloadCandidatesFromFirstPage" />
          </label>
          <label class="space-y-1 text-xs text-content-muted">
            <span>结束日期</span>
            <input v-model="jobCandidateCustomEndDate" type="date" class="ui-input w-full" @change="reloadCandidatesFromFirstPage" />
          </label>
        </div>
      </div>

      <div class="space-y-4 border-t border-border/10 p-4">
        <div class="space-y-2">
          <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">岗位状态</div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in JOB_STATUS_FILTER_OPTIONS"
              :key="option.value"
              type="button"
              class="ui-badge transition-colors"
              :class="selectedJobStatusFilters.includes(option.value) ? 'bg-accent/20 text-cyan-100 ring-accent/40' : 'hover:bg-card-hover/80'"
              @click="toggleJobStatusFilter(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="space-y-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">岗位平台</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="option in SOURCE_PLATFORM_FILTER_OPTIONS"
                :key="option.value"
                type="button"
                class="ui-badge transition-colors"
                :class="selectedSourcePlatformFilters.includes(option.value) ? 'bg-accent/20 text-cyan-100 ring-accent/40' : 'hover:bg-card-hover/80'"
                @click="toggleSourcePlatformFilter(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="space-y-2">
            <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">采集方式</div>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="option in COLLECTION_METHOD_FILTER_OPTIONS"
                :key="option.value"
                type="button"
                class="ui-badge transition-colors"
                :class="selectedCollectionMethodFilters.includes(option.value) ? 'bg-accent/20 text-cyan-100 ring-accent/40' : 'hover:bg-card-hover/80'"
                @click="toggleCollectionMethodFilter(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div class="flex items-center gap-2">
          <Database class="h-4 w-4 text-content-muted" aria-hidden="true" />
          <div>
            <h2 class="text-sm font-semibold text-content-primary">岗位列表</h2>
            <p class="mt-1 text-xs text-content-muted">所有手动和自动采集岗位都在这里统一处理。</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span class="ui-badge">第 {{ jobCandidatePage }} / {{ jobCandidateTotalPages }} 页</span>
          <span class="ui-badge">{{ jobCandidatesTotal }} 个岗位</span>
        </div>
      </div>

      <JobsExportPanel />

      <div v-if="jobCandidatesLoading" class="px-4 py-6 text-sm text-content-muted">正在加载岗位列表…</div>
      <div v-else-if="jobCandidates.length === 0" class="px-4 py-10 text-center text-sm text-content-muted">当前筛选条件下暂无岗位。</div>
      <div v-else class="divide-y divide-border/10">
        <JobsJobItem
          v-for="job in jobCandidates"
          :key="`candidate-${job.encrypt_job_id}`"
          :job="job"
          :expanded="expandedJobId === job.encrypt_job_id"
          :detail-loading="detailLoading === job.encrypt_job_id"
          :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
          :allow-delete="true"
          :greeting="greetingCache.get(job.encrypt_job_id)"
          :greeting-draft="greetingDrafts.get(job.encrypt_job_id) ?? ''"
          :greeting-error="greetingErrors.get(job.encrypt_job_id)"
          :greeting-loading="greetingLoading === job.encrypt_job_id"
          :resume-workspace-status="resumeWorkspaceStatuses.get(job.encrypt_job_id)"
          @toggle-detail="(jobId) => toggleDetail(jobId)"
          @go-ai="(jobId) => goAi(jobId)"
          @go-resume-workspace="(jobId) => goResumeWorkspace(jobId)"
          @copy-link="(job) => copy(jobSourceUrl(job))"
          @open-source-url="(job) => openJobSourceUrl(job)"
          @delete="(job) => deleteJob(job, '__all__')"
          @update-review="(job, status) => updateReviewStatus(job, status)"
          @restore-review-candidate="(job) => restoreReviewCandidate(job)"
          @update-communication="(job, status) => updateCommunicationStatus(job, status)"
          @update-review-notes="(job) => updateReviewNotes(job)"
          @update-company-review="(job, status) => updateCompanyReviewStatus(job, status)"
          @blacklist-company="(job) => blacklistCompany(job)"
          @blacklist-job="(job) => blacklistJob(job)"
          @blacklist-keyword="(job) => blacklistKeyword(job)"
          @generate-greeting="(job) => generateGreeting(job)"
          @update-greeting-draft="(jobId, message) => updateGreetingDraft(jobId, message)"
          @copy-greeting="(job) => copyGreeting(job)"
          @copy-application-packet="(job) => copyApplicationPacket(job)"
        />
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border/10 px-4 py-3">
        <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="jobCandidatePage <= 1 || jobCandidatesLoading" @click="goJobCandidatePage(jobCandidatePage - 1)">
          <ChevronLeft class="h-3.5 w-3.5" aria-hidden="true" />
          上一页
        </button>
        <div class="text-xs text-content-muted">第 {{ jobCandidatePage }} / {{ jobCandidateTotalPages }} 页</div>
        <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="jobCandidatePage >= jobCandidateTotalPages || jobCandidatesLoading" @click="goJobCandidatePage(jobCandidatePage + 1)">
          下一页
          <ChevronRight class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </section>

    <JobsConfirmDialog
      :visible="confirmDialog.visible"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :confirm-label="confirmDialog.confirmLabel"
      :loading="confirmDialog.loading"
      @cancel="closeConfirm"
      @confirm="executeConfirm"
    />
  </section>
</template>
