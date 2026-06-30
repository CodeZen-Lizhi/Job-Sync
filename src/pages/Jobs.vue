<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChevronLeft, ChevronRight, Database, Filter, RefreshCw, Search, X } from "lucide-vue-next";

import JobsExportPanel from "../components/jobs/JobsExportPanel.vue";
import JobsConfirmDialog from "../components/jobs/JobsConfirmDialog.vue";
import JobsJobItem from "../components/jobs/JobsJobItem.vue";
import UiMultiSelect from "../components/ui/UiMultiSelect.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import { useJobsPage } from "../lib/useJobsPage";

const {
  tauri,
  error,
  jobCandidates,
  resumeStatusByJobId,
  jobCandidatesTotal,
  jobCandidatesLoading,
  jobCandidateSearch,
  jobCandidatePage,
  jobCandidatePageSize,
  jobCandidateTimeRange,
  jobCandidateCustomStartDate,
  jobCandidateCustomEndDate,
  jobCandidateProcessedFilter,
  jobCandidateBucket,
  selectedJobStatusFilters,
  selectedAiAuditFilters,
  selectedSourcePlatformFilters,
  selectedCollectionMethodFilters,
  jobCandidateTotalPages,
  expandedJobId,
  detailLoading,
  expandedDetail,
  greetingDrafts,
  greetingErrors,
  greetingLoading,
  optimizedResumeGeneratingJobId,
  optimizedResumePreview,
  optimizedResumeTitle,
  optimizedResumeTargetJob,
  optimizedResumeSaving,
  optimizedResumeMessage,
  optimizedResumeError,
  confirmDialog,
  JOB_TIME_RANGE_OPTIONS,
  PROCESSED_FILTER_OPTIONS,
  JOB_STATUS_FILTER_OPTIONS,
  AI_AUDIT_FILTER_OPTIONS,
  SOURCE_PLATFORM_FILTER_OPTIONS,
  COLLECTION_METHOD_FILTER_OPTIONS,
  loadJobCandidates,
  goJobCandidatePage,
  toggleDetail,
  copy,
  jobSourceUrl,
  openJobSourceUrl,
  generateGreeting,
  copyGreeting,
  generateOptimizedResume,
  copyOptimizedResumeMarkdown,
  saveOptimizedResumeAndLink,
  closeOptimizedResumePreview,
  updateReviewStatus,
  restoreReviewCandidate,
  updateCommunicationStatus,
  updateReviewNotes,
  updateCompanyReviewStatus,
  closeConfirm,
  executeConfirm,
} = useJobsPage();

type JobLibraryBucket = "recommended" | "confirm" | "filtered" | "processed" | "all";

const activeJobLibraryBucket = ref<JobLibraryBucket>("recommended");
const router = useRouter();
const route = useRoute();

const bucketOptions: Array<{ value: JobLibraryBucket; label: string; description: string }> = [
  {
    value: "recommended",
    label: "推荐查看",
    description: "通过采后规则且尚未处理的候选岗位。",
  },
  {
    value: "confirm",
    label: "待确认",
    description: "信息不足或需要人工补证据的岗位，可对 Boss 岗位补抓详情后重新判断。",
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
    selectedAiAuditFilters.value.length > 0 ||
    selectedSourcePlatformFilters.value.length > 0 ||
    selectedCollectionMethodFilters.value.length > 0 ||
    jobCandidateTimeRange.value !== "last7",
);

const activeBucket = computed(() => bucketOptions.find((bucket) => bucket.value === activeJobLibraryBucket.value) ?? bucketOptions[0]);

const displayedJobs = computed(() => jobCandidates.value);

const displayedJobsLoading = computed(() => jobCandidatesLoading.value);

const displayedJobsTotal = computed(() => jobCandidatesTotal.value);

const showPagination = computed(() => true);

const selectedJobStatusFilterModel = computed<string[]>({
  get: () => selectedJobStatusFilters.value,
  set: (value) => {
    selectedJobStatusFilters.value = value as typeof selectedJobStatusFilters.value;
    reloadCandidatesFromFirstPage();
  },
});

const selectedAiAuditFilterModel = computed<string[]>({
  get: () => selectedAiAuditFilters.value,
  set: (value) => {
    selectedAiAuditFilters.value = value as typeof selectedAiAuditFilters.value;
    reloadCandidatesFromFirstPage();
  },
});

const selectedSourcePlatformFilterModel = computed<string[]>({
  get: () => selectedSourcePlatformFilters.value,
  set: (value) => {
    selectedSourcePlatformFilters.value = value;
    reloadCandidatesFromFirstPage();
  },
});

const selectedCollectionMethodFilterModel = computed<string[]>({
  get: () => selectedCollectionMethodFilters.value,
  set: (value) => {
    selectedCollectionMethodFilters.value = value as typeof selectedCollectionMethodFilters.value;
    reloadCandidatesFromFirstPage();
  },
});

function applyBucket(bucket: JobLibraryBucket): void {
  activeJobLibraryBucket.value = bucket;
  jobCandidateBucket.value = bucket === "confirm" ? "pending_confirmation" : bucket;
  if (bucket === "recommended") {
    jobCandidateProcessedFilter.value = "unprocessed";
    selectedJobStatusFilters.value = [];
    selectedAiAuditFilters.value = [];
    void loadJobCandidates();
    return;
  }
  if (bucket === "all") {
    jobCandidateProcessedFilter.value = "all";
    selectedJobStatusFilters.value = [];
    selectedAiAuditFilters.value = [];
    void loadJobCandidates();
    return;
  }
  jobCandidateProcessedFilter.value = "all";
  selectedJobStatusFilters.value = [];
  selectedAiAuditFilters.value = [];
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

function openResumeLibrary(jobId: string): void {
  const status = resumeStatusByJobId.get(jobId);
  const query = status?.resume_id ? { resumeId: status.resume_id } : { jobId };
  void router.push({ path: "/resume-library", query });
}

async function focusJobFromRoute(jobId: string): Promise<void> {
  activeJobLibraryBucket.value = "all";
  jobCandidateBucket.value = "all";
  jobCandidateProcessedFilter.value = "all";
  jobCandidateSearch.value = jobId;
  jobCandidateTimeRange.value = "custom";
  jobCandidateCustomStartDate.value = "";
  jobCandidateCustomEndDate.value = "";
  selectedJobStatusFilters.value = [];
  selectedAiAuditFilters.value = [];
  selectedSourcePlatformFilters.value = [];
  selectedCollectionMethodFilters.value = [];
  await loadJobCandidates();
  if (expandedJobId.value !== jobId && jobCandidates.value.some((job) => job.encrypt_job_id === jobId)) {
    await toggleDetail(jobId);
  }
}

watch(
  () => [route.path, route.query.jobId],
  async ([path, jobId]) => {
    if (path !== "/jobs") return;
    await nextTick();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (typeof jobId === "string" && jobId.trim()) {
      void focusJobFromRoute(jobId.trim());
      return;
    }
    if (jobCandidates.value.length === 0) {
      applyBucket("recommended");
    }
  },
  { immediate: true },
);
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

      <div class="border-t border-border/90 bg-surface-secondary/30 p-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="space-y-1.5 text-xs text-content-muted">
            <span class="font-semibold text-content-secondary">岗位状态</span>
            <UiMultiSelect
              v-model="selectedJobStatusFilterModel"
              variant="filter"
              empty-label="全部岗位状态"
              empty-badge-label="全部"
            >
              <option v-for="option in JOB_STATUS_FILTER_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </UiMultiSelect>
          </label>

          <label class="space-y-1.5 text-xs text-content-muted">
            <span class="font-semibold text-content-secondary">AI 结果</span>
            <UiMultiSelect
              v-model="selectedAiAuditFilterModel"
              variant="filter"
              empty-label="全部 AI 结果"
              empty-badge-label="全部"
            >
              <option v-for="option in AI_AUDIT_FILTER_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </UiMultiSelect>
          </label>

          <label class="space-y-1.5 text-xs text-content-muted">
            <span class="font-semibold text-content-secondary">岗位平台</span>
            <UiMultiSelect
              v-model="selectedSourcePlatformFilterModel"
              variant="filter"
              empty-label="全部岗位平台"
              empty-badge-label="全部"
            >
              <option v-for="option in SOURCE_PLATFORM_FILTER_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </UiMultiSelect>
          </label>

          <label class="space-y-1.5 text-xs text-content-muted">
            <span class="font-semibold text-content-secondary">采集方式</span>
            <UiMultiSelect
              v-model="selectedCollectionMethodFilterModel"
              variant="filter"
              empty-label="全部采集方式"
              empty-badge-label="全部"
            >
              <option v-for="option in COLLECTION_METHOD_FILTER_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </UiMultiSelect>
          </label>
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

      <div v-if="displayedJobsLoading" class="px-4 py-6 text-sm text-content-muted">正在加载岗位列表…</div>
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
          :greeting-draft="greetingDrafts.get(job.encrypt_job_id) ?? ''"
          :greeting-error="greetingErrors.get(job.encrypt_job_id) ?? undefined"
          :greeting-loading="greetingLoading === job.encrypt_job_id"
          :optimized-resume-generating="optimizedResumeGeneratingJobId === job.encrypt_job_id"
          :resume-status="resumeStatusByJobId.get(job.encrypt_job_id)"
          @toggle-detail="(jobId) => toggleDetail(jobId)"
          @copy-link="(job) => copy(jobSourceUrl(job))"
          @open-source-url="(job) => openJobSourceUrl(job)"
          @update-review="(job, status) => updateReviewStatus(job, status)"
          @restore-review-candidate="(job) => restoreReviewCandidate(job)"
          @update-communication="(job, status) => updateCommunicationStatus(job, status)"
          @update-review-notes="(job) => updateReviewNotes(job)"
          @update-company-review="(job, status) => updateCompanyReviewStatus(job, status)"
          @generate-greeting="(job) => generateGreeting(job)"
          @copy-greeting="(job) => copyGreeting(job)"
          @generate-optimized-resume="(job) => generateOptimizedResume(job)"
          @open-resume="(job) => openResumeLibrary(job.encrypt_job_id)"
        />
      </div>

      <div v-if="showPagination" class="flex flex-wrap items-center justify-between gap-3 border-t border-border/90 px-4 py-3">
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="jobCandidatePage <= 1 || jobCandidatesLoading" @click="goJobCandidatePage(jobCandidatePage - 1)">
            <ChevronLeft class="h-3.5 w-3.5" aria-hidden="true" />
            上一页
          </button>
          <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="jobCandidatePage >= jobCandidateTotalPages || jobCandidatesLoading" @click="goJobCandidatePage(jobCandidatePage + 1)">
            下一页
            <ChevronRight class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <div class="text-xs text-content-muted">第 {{ jobCandidatePage }} / {{ jobCandidateTotalPages }} 页</div>
        </div>
        <label class="flex items-center gap-2 text-xs text-content-muted">
          <span>每页</span>
          <UiSelect v-model="jobCandidatePageSizeModel" class="min-w-24">
            <option value="10">10</option>
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </UiSelect>
        </label>
      </div>
      <div v-else-if="activeJobLibraryBucket === 'filtered'" class="border-t border-border/90 px-4 py-3 text-xs text-content-muted">
        已过滤岗位仍保留在职位库里，可通过当前规则调整后重算。
      </div>
    </section>

    <div v-if="optimizedResumePreview" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <section class="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-white shadow-xl">
        <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border/90 px-4 py-3">
          <div class="min-w-0">
            <div class="ui-section-kicker">Optimized Resume</div>
            <h2 class="mt-1 text-base font-semibold text-content-primary">岗位版简历预览</h2>
            <p class="mt-1 text-xs text-content-muted">
              {{ optimizedResumeTargetJob?.position_name ?? optimizedResumeTargetJob?.encrypt_job_id }} / {{ optimizedResumeTargetJob?.brand_name ?? "未知公司" }}
            </p>
          </div>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="optimizedResumeSaving" @click="closeOptimizedResumePreview">
            关闭
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div class="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
            <div class="space-y-3">
              <label class="block space-y-1 text-xs text-content-muted">
                <span>新简历标题</span>
                <input v-model="optimizedResumeTitle" class="ui-input w-full" />
              </label>
              <div class="rounded-lg border border-border/90 bg-surface-secondary/40">
                <div class="border-b border-border/90 px-3 py-2 text-xs font-semibold text-content-muted">Markdown 预览</div>
                <pre class="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-sm leading-6 text-content-secondary">{{ optimizedResumePreview.optimized_resume_markdown }}</pre>
              </div>
            </div>

            <aside class="space-y-3">
              <section class="rounded-lg border border-border/90 bg-white p-3">
                <h3 class="text-xs font-semibold text-content-primary">来源简历</h3>
                <p class="mt-2 text-xs text-content-secondary">
                  {{ optimizedResumePreview.source_resume?.title ?? "已按岗位关联/默认简历解析" }}
                </p>
              </section>

              <section class="rounded-lg border border-border/90 bg-white p-3">
                <h3 class="text-xs font-semibold text-content-primary">调整摘要</h3>
                <ul class="mt-2 space-y-1 text-xs leading-5 text-content-secondary">
                  <li v-for="item in optimizedResumePreview.change_summary" :key="item">- {{ item }}</li>
                </ul>
              </section>

              <section class="rounded-lg border border-border/90 bg-white p-3">
                <h3 class="text-xs font-semibold text-content-primary">岗位关键词</h3>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span v-for="keyword in optimizedResumePreview.job_keywords_used" :key="keyword" class="ui-badge">{{ keyword }}</span>
                  <span v-if="optimizedResumePreview.job_keywords_used.length === 0" class="text-xs text-content-muted">暂无可安全写入的关键词。</span>
                </div>
              </section>

              <section class="rounded-lg border border-border/90 bg-white p-3">
                <h3 class="text-xs font-semibold text-content-primary">证据映射</h3>
                <div class="mt-2 space-y-2 text-xs leading-5 text-content-secondary">
                  <div v-for="item in optimizedResumePreview.evidence" :key="`${item.resume_fact}-${item.rewrite_location}`" class="rounded-md bg-surface-secondary/50 p-2">
                    <div>简历事实：{{ item.resume_fact }}</div>
                    <div>岗位要求：{{ item.job_requirement }}</div>
                    <div>写入位置：{{ item.rewrite_location }}</div>
                  </div>
                </div>
              </section>

              <section class="rounded-lg border border-border/90 bg-white p-3">
                <h3 class="text-xs font-semibold text-content-primary">风险</h3>
                <ul v-if="optimizedResumePreview.risks.length > 0" class="mt-2 space-y-1 text-xs leading-5 text-content-secondary">
                  <li v-for="risk in optimizedResumePreview.risks" :key="risk">- {{ risk }}</li>
                </ul>
                <p v-else class="mt-2 text-xs text-content-muted">未识别到需要额外提示的缺口。</p>
              </section>
            </aside>
          </div>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-border/90 px-4 py-3">
          <div class="min-w-0 text-xs">
            <span v-if="optimizedResumeMessage" class="text-emerald-700">{{ optimizedResumeMessage }}</span>
            <span v-else-if="optimizedResumeError" class="text-red-700">{{ optimizedResumeError }}</span>
            <span v-else class="text-content-muted">保存会创建一份新简历，并关联当前岗位。</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="optimizedResumeSaving" @click="copyOptimizedResumeMarkdown">
              复制 Markdown
            </button>
            <button class="ui-btn-primary px-3 py-1.5 text-xs" :disabled="optimizedResumeSaving" @click="saveOptimizedResumeAndLink">
              {{ optimizedResumeSaving ? "保存中…" : "保存并关联岗位" }}
            </button>
          </div>
        </footer>
      </section>
    </div>

    <JobsConfirmDialog
      :visible="confirmDialog.visible"
      :title="confirmDialog.title"
      :message="confirmDialog.message"
      :confirm-label="confirmDialog.confirmLabel"
      :loading="confirmDialog.loading"
      @close="closeConfirm"
      @confirm="executeConfirm"
    />
  </section>
</template>
