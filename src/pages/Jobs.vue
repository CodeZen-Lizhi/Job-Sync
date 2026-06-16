<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, Database, Filter, RefreshCw, Search, X } from "lucide-vue-next";

import JobsConfirmDialog from "../components/jobs/JobsConfirmDialog.vue";
import JobsExportPanel from "../components/jobs/JobsExportPanel.vue";
import JobsJobItem from "../components/jobs/JobsJobItem.vue";
import UiSelect from "../components/ui/UiSelect.vue";
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
  jobCandidateSearch,
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
  reviewCandidates,
  filteredJobs,
  applicationReadyJobsLoading,
  filteredJobsLoading,
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
  loadReviewCandidates,
  loadApplicationReadyJobs,
  loadFilteredJobs,
  toggleJobStatusFilter,
  toggleSourcePlatformFilter,
  toggleCollectionMethodFilter,
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

type JobLibraryBucket = "recommended" | "confirm" | "filtered" | "processed" | "all";

const activeJobLibraryBucket = ref<JobLibraryBucket>("recommended");

const bucketOptions: Array<{
  value: JobLibraryBucket;
  label: string;
  description: string;
}> = [
  {
    value: "recommended",
    label: "推荐查看",
    description: "通过采后规则且尚未处理的候选岗位。",
  },
  {
    value: "confirm",
    label: "待确认",
    description: "信息不足或需要人工补证据的岗位；后端 bucket 将在下一步补齐。",
  },
  {
    value: "filtered",
    label: "已过滤",
    description: "未进入候选队列，但仍保留在职位库中并可查看原因。",
  },
  {
    value: "processed",
    label: "已处理",
    description: "收藏、准备投递、已投递、忽略或有沟通记录的岗位。",
  },
  {
    value: "all",
    label: "全部入库",
    description: "按时间查看完整职位库视图。",
  },
];

const hasActiveFilters = computed(
  () =>
    !!jobCandidateSearch.value.trim() ||
    jobCandidateProcessedFilter.value !== defaultProcessedFilterForBucket(activeJobLibraryBucket.value) ||
    selectedJobStatusFilters.value.length > 0 ||
    selectedSourcePlatformFilters.value.length > 0 ||
    selectedCollectionMethodFilters.value.length > 0 ||
    jobCandidateTimeRange.value !== "last7",
);

const activeBucket = computed(() => bucketOptions.find((bucket) => bucket.value === activeJobLibraryBucket.value) ?? bucketOptions[0]);

const displayedJobs = computed(() => (activeJobLibraryBucket.value === "filtered" ? filteredJobs.value : jobCandidates.value));

const displayedJobsLoading = computed(() => {
  if (activeJobLibraryBucket.value === "filtered") return filteredJobsLoading.value;
  if (activeJobLibraryBucket.value === "processed") return jobCandidatesLoading.value || applicationReadyJobsLoading.value;
  return jobCandidatesLoading.value;
});

const displayedJobsTotal = computed(() => {
  if (activeJobLibraryBucket.value === "filtered") return filteredJobs.value.length;
  if (activeJobLibraryBucket.value === "confirm") return 0;
  return jobCandidatesTotal.value;
});

const showPagination = computed(() => activeJobLibraryBucket.value !== "filtered" && activeJobLibraryBucket.value !== "confirm");

const bucketSummaryCards = computed(() => [
  {
    label: "推荐查看",
    value: reviewCandidates.value.length || currentPageUnprocessedCount.value,
    hint: "当前规则下优先处理",
  },
  {
    label: "已过滤",
    value: filteredJobs.value.length,
    hint: "保留原因，可复盘",
  },
  {
    label: "已处理",
    value: currentPageProcessedCount.value,
    hint: "当前页已产生动作",
  },
]);

function applyBucket(bucket: JobLibraryBucket): void {
  activeJobLibraryBucket.value = bucket;
  if (bucket === "recommended") {
    jobCandidateProcessedFilter.value = "unprocessed";
    selectedJobStatusFilters.value = [];
    void loadReviewCandidates();
    void loadJobCandidates();
    return;
  }
  if (bucket === "processed") {
    jobCandidateProcessedFilter.value = "processed";
    selectedJobStatusFilters.value = [];
    void loadApplicationReadyJobs();
    void loadJobCandidates();
    return;
  }
  if (bucket === "filtered") {
    void loadFilteredJobs();
    return;
  }
  if (bucket === "all") {
    jobCandidateProcessedFilter.value = "all";
    selectedJobStatusFilters.value = [];
    void loadJobCandidates();
    return;
  }
  jobCandidateProcessedFilter.value = "all";
  selectedJobStatusFilters.value = [];
  void loadJobCandidates();
}

function defaultProcessedFilterForBucket(bucket: JobLibraryBucket): typeof jobCandidateProcessedFilter.value {
  if (bucket === "recommended") return "unprocessed";
  if (bucket === "processed") return "processed";
  return "all";
}

const jobCandidateTimeRangeModel = computed<string>({
  get: () => jobCandidateTimeRange.value,
  set: (value) => {
    if (jobCandidateTimeRange.value === value) return;
    jobCandidateTimeRange.value = value as typeof jobCandidateTimeRange.value;
    reloadCandidatesFromFirstPage();
  },
});

const jobCandidateProcessedFilterModel = computed<string>({
  get: () => jobCandidateProcessedFilter.value,
  set: (value) => {
    if (jobCandidateProcessedFilter.value === value) return;
    jobCandidateProcessedFilter.value = value as typeof jobCandidateProcessedFilter.value;
    reloadCandidatesFromFirstPage();
  },
});

const jobCandidatePageSizeModel = computed<string>({
  get: () => String(jobCandidatePageSize.value),
  set: (value) => {
    const next = Number(value);
    if (!Number.isFinite(next) || jobCandidatePageSize.value === next) return;
    jobCandidatePageSize.value = next;
    reloadCandidatesFromFirstPage();
  },
});

function refreshCandidates(): void {
  if (activeJobLibraryBucket.value === "filtered") {
    void loadFilteredJobs();
    return;
  }
  if (activeJobLibraryBucket.value === "processed") {
    void loadApplicationReadyJobs();
  }
  if (activeJobLibraryBucket.value === "recommended") {
    void loadReviewCandidates();
  }
  void loadJobCandidates({ keepPage: true });
}

function reloadCandidatesFromFirstPage(): void {
  void loadJobCandidates();
}

function clearCurrentViewFilters(): void {
  jobCandidateSearch.value = "";
  jobCandidateTimeRange.value = "last7";
  selectedJobStatusFilters.value = [];
  selectedSourcePlatformFilters.value = [];
  selectedCollectionMethodFilters.value = [];
  jobCandidateProcessedFilter.value = defaultProcessedFilterForBucket(activeJobLibraryBucket.value);
  refreshCandidates();
}

onMounted(() => {
  applyBucket("recommended");
  void loadFilteredJobs();
});
</script>

<template>
  <section class="space-y-5">
    <header class="space-y-2">
      <div class="ui-section-kicker">Job Library</div>
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-content-primary">职位库工作台</h1>
          <p class="mt-1 max-w-3xl text-sm leading-6 text-content-secondary">
            自动采集先保留岗位事实，再由采后判断规则生成推荐、待确认和已过滤视图；默认只处理可行动结果。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <JobsExportPanel />
          <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!tauri || displayedJobsLoading" @click="refreshCandidates">
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            {{ displayedJobsLoading ? "刷新中…" : "刷新" }}
          </button>
        </div>
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
      <div class="ui-section-header">
        <div>
          <div class="ui-section-kicker">Result Buckets</div>
          <h2 class="ui-section-title mt-1">采后结果分区</h2>
          <p class="ui-section-copy">切换的是职位库的行动视图，不会删除底层岗位记录。</p>
        </div>
        <div class="ui-segmented">
          <button
            v-for="bucket in bucketOptions"
            :key="bucket.value"
            type="button"
            class="ui-segmented-button"
            :class="activeJobLibraryBucket === bucket.value ? 'ui-segmented-button-active' : ''"
            :title="bucket.description"
            @click="applyBucket(bucket.value)"
          >
            {{ bucket.label }}
          </button>
        </div>
      </div>

      <div class="grid gap-3 p-4 md:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
        <div class="ui-card-soft p-4">
          <div class="flex items-start gap-3">
            <div class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-border-glow/10 text-cyan-200 ring-1 ring-border-glow/15" aria-hidden="true">
              <Activity class="h-4 w-4" />
            </div>
            <div>
              <div class="text-sm font-semibold text-content-primary">{{ activeBucket.label }}</div>
              <p class="mt-1 text-xs leading-5 text-content-muted">{{ activeBucket.description }}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <span class="ui-badge">{{ jobIntelligenceRangeLabel }}</span>
                <span class="ui-badge">{{ displayedJobsTotal }} 个岗位</span>
              </div>
            </div>
          </div>
        </div>
        <div v-for="card in bucketSummaryCards" :key="card.label" class="ui-card-soft p-4">
          <div class="text-xs font-medium text-content-muted">{{ card.label }}</div>
          <div class="mt-3 text-3xl font-semibold leading-none text-content-primary">{{ card.value }}</div>
          <div class="mt-2 text-[11px] text-content-muted">{{ card.hint }}</div>
        </div>
      </div>
    </section>

    <section class="ui-panel overflow-hidden">
      <div class="ui-section-header">
        <div class="flex items-center gap-2">
          <Filter class="h-4 w-4 text-content-muted" aria-hidden="true" />
          <div>
            <h2 class="ui-section-title">视图筛选</h2>
            <p class="ui-section-copy">在当前分区内继续按时间、来源、状态和采集方式收窄。</p>
          </div>
        </div>
        <button v-if="hasActiveFilters" class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" @click="clearCurrentViewFilters">
          <X class="h-3.5 w-3.5" aria-hidden="true" />
          清除筛选
        </button>
      </div>

      <div class="grid gap-4 p-4 xl:grid-cols-[1.2fr_1fr]">
        <div class="grid gap-3 sm:grid-cols-4">
          <label class="space-y-1 text-xs text-content-muted sm:col-span-2">
            <span>搜索职位/公司/JD</span>
            <div class="relative">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" aria-hidden="true" />
              <input v-model="jobCandidateSearch" class="ui-input w-full pl-9" placeholder="输入关键词后刷新" @keydown.enter="reloadCandidatesFromFirstPage" />
            </div>
          </label>
          <label class="space-y-1 text-xs text-content-muted">
            <span>时间范围</span>
            <UiSelect v-model="jobCandidateTimeRangeModel">
              <option v-for="option in JOB_TIME_RANGE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </UiSelect>
          </label>
          <label class="space-y-1 text-xs text-content-muted">
            <span>处理状态</span>
            <UiSelect v-model="jobCandidateProcessedFilterModel">
              <option v-for="option in PROCESSED_FILTER_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </UiSelect>
          </label>
          <label class="space-y-1 text-xs text-content-muted">
            <span>每页数量</span>
            <UiSelect v-model="jobCandidatePageSizeModel">
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </UiSelect>
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
      <div class="ui-section-header">
        <div class="flex items-center gap-2">
          <Database class="h-4 w-4 text-content-muted" aria-hidden="true" />
          <div>
            <h2 class="ui-section-title">{{ activeBucket.label }}</h2>
            <p class="ui-section-copy">{{ activeBucket.description }}</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span v-if="showPagination" class="ui-badge">第 {{ jobCandidatePage }} / {{ jobCandidateTotalPages }} 页</span>
          <span class="ui-badge">{{ displayedJobsTotal }} 个岗位</span>
        </div>
      </div>

      <div v-if="activeJobLibraryBucket === 'confirm'" class="px-4 py-10">
        <div class="mx-auto max-w-xl rounded-lg border border-amber-400/20 bg-amber-400/10 p-5 text-sm text-amber-100">
          <div class="flex items-center gap-2 font-semibold">
            <AlertTriangle class="h-4 w-4" aria-hidden="true" />
            待确认分区需要后端 bucket 支持
          </div>
          <p class="mt-2 text-xs leading-6 text-amber-100/80">
            PRD 要求把信息不足、缺少 JD 或证据弱的岗位放到待确认。当前后端尚未单独返回这个 bucket，本次 UI 先保留入口，避免把推荐岗位冒充为待确认。
          </p>
        </div>
      </div>
      <div v-else-if="displayedJobsLoading" class="px-4 py-6 text-sm text-content-muted">正在加载岗位列表…</div>
      <div v-else-if="displayedJobs.length === 0" class="px-4 py-10 text-center text-sm text-content-muted">
        当前分区暂无岗位。
      </div>
      <div v-else class="divide-y divide-border/10">
        <JobsJobItem
          v-for="job in displayedJobs"
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

      <div v-if="showPagination" class="flex flex-wrap items-center justify-between gap-3 border-t border-border/10 px-4 py-3">
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
      <div v-else-if="activeJobLibraryBucket === 'filtered' && filteredJobs.length > 0" class="border-t border-border/10 px-4 py-3 text-xs text-content-muted">
        已过滤视图当前展示最近 20 条过滤结果；岗位仍保留在职位库，可通过采集配置调整规则后重算。
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
