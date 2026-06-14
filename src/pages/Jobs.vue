<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, watch } from "vue";
import { useRoute } from "vue-router";

import JobsConfirmDialog from "../components/jobs/JobsConfirmDialog.vue";
import JobsExportPanel from "../components/jobs/JobsExportPanel.vue";
import JobsGroupCard from "../components/jobs/JobsGroupCard.vue";
import JobsJobItem from "../components/jobs/JobsJobItem.vue";
import { blacklistKindLabel } from "../lib/jobs";
import { useJobsPage } from "../lib/useJobsPage";

const {
  tauri,
  search,
  loading,
  error,
  groups,
  flatResults,
  reviewCandidates,
  favoritedJobs,
  applicationReadyJobs,
  communicationFollowupJobs,
  filteredJobs,
  linkedJob,
  dailyIntelligence,
  dailyIntelligenceAutoNotifyEnabled,
  dailyIntelligenceExternalMessage,
  dailyIntelligenceWecomSending,
  externalImportPlatform,
  externalImportPayloadText,
  externalImportLoading,
  externalImportMessage,
  lastExternalImportedJob,
  externalImportPlatformOptions,
  blacklistEntries,
  filterProfiles,
  activeFilterProfileId,
  activeFilterProfileName,
  newFilterProfileName,
  activeFilterProfileIsDefault,
  mustKeywordsText,
  mustNotKeywordsText,
  preferenceKeywordsText,
  requiredDirectionsText,
  excludedDirectionsText,
  preferenceDirectionsText,
  requiredTechTagsText,
  excludedTechTagsText,
  preferenceTechTagsText,
  requiredWorkModesText,
  excludedWorkModesText,
  preferenceWorkModesText,
  targetCitiesText,
  excludedCitiesText,
  sourcePlatformsText,
  sourcePlatformModeLabel,
  sourcePlatformModeHint,
  sourcePlatformOptions,
  setBossOnlySourcePlatforms,
  setManualImportSourcePlatforms,
  setAllSourcePlatforms,
  communicationStatusesText,
  minimumSalaryK,
  maximumSalaryK,
  acceptNegotiableSalary,
  recentDays,
  minimumExperienceYears,
  maximumExperienceYears,
  acceptUnknownExperience,
  allowedDegreesText,
  excludedDegreesText,
  companyMustKeywordsText,
  companyMustNotKeywordsText,
  companyPreferenceKeywordsText,
  companyRequiredScalesText,
  companyExcludedScalesText,
  companyPreferenceScalesText,
  companyRequiredFinancingStagesText,
  companyExcludedFinancingStagesText,
  companyPreferenceFinancingStagesText,
  companyRequiredIndustriesText,
  companyExcludedIndustriesText,
  companyPreferenceIndustriesText,
  resumeWeight,
  preferenceWeight,
  companyWeight,
  filterProfileUpdatedAt,
  filterProfileLoading,
  filterRecomputing,
  filterRecomputeMessage,
  isSearchMode,
  reviewCandidatesLoading,
  favoritedJobsLoading,
  applicationReadyJobsLoading,
  communicationFollowupJobsLoading,
  filteredJobsLoading,
  linkedJobLoading,
  linkedJobError,
  dailyIntelligenceLoading,
  companyScoreRebuilding,
  companyScoreRebuildMessage,
  aiCompanyScoreGenerating,
  aiCompanyScoreMessage,
  aiCompanyScoreError,
  blacklistLoading,
  expandedKeyword,
  expandedJobId,
  keywordJobsCache,
  keywordJobsLoading,
  detailLoading,
  greetingCache,
  greetingDrafts,
  greetingErrors,
  greetingLoading,
  resumeWorkspaceStatuses,
  confirmDialog,
  expandedDetail,
  groupKey,
  jobSourceUrl,
  goAi,
  analyzeReviewCandidates,
  goResumeWorkspace,
  loadKeywords,
  loadReviewCandidates,
  loadFavoritedJobs,
  loadApplicationReadyJobs,
  loadCommunicationFollowupJobs,
  loadFilteredJobs,
  loadDailyIntelligence,
  loadJobBlacklist,
  loadDefaultFilterProfile,
  selectFilterProfile,
  saveActiveFilterProfile,
  createFilterProfile,
  setActiveFilterProfileAsDefault,
  recomputeDefaultFilterProfile,
  fillExternalImportExample,
  importExternalJob,
  copyExternalImportSummary,
  rebuildCompanyScores,
  generateAiCompanyScores,
  toggleKeyword,
  toggleDetail,
  copy,
  openJobSourceUrl,
  deleteJob,
  deleteAllJobs,
  updateReviewStatus,
  restoreReviewCandidate,
  updateCommunicationStatus,
  updateReviewNotes,
  updateCompanyReviewStatus,
  blacklistCompany,
  blacklistJob,
  blacklistKeyword,
  deleteJobBlacklist,
  generateGreeting,
  updateGreetingDraft,
  copyGreeting,
  copyApplicationPacket,
  copyApplicationReadySummary,
  copyReviewCandidatesSummary,
  copyCommunicationFollowupSummary,
  copyDailyIntelligence,
  copyDailyRecommendedCandidate,
  openDailyIntelligenceEmailDraft,
  sendDailyIntelligenceWecomNotification,
  copyFilteredJobsSummary,
  showDailyIntelligenceNotification,
  formatDate,
  closeConfirm,
  executeConfirm,
} = useJobsPage();

const route = useRoute();
let reviewQueueScrollTimers: number[] = [];
const routeAnalysisCompleted = computed(() => route.query.analysis === "resume" && routeRequestsReviewQueue(route.query.review));

function scrollToReviewQueue(): void {
  document.getElementById("top20-review-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToFavoritedQueue(): void {
  document.getElementById("favorited-jobs-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToApplicationReadyQueue(): void {
  document.getElementById("application-ready-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function reviewCandidateElementId(jobId: string): string {
  return `review-candidate-${jobId}`;
}

function scrollToReviewCandidate(jobId: string): void {
  const element = document.getElementById(reviewCandidateElementId(jobId));
  if (!element) {
    scrollToReviewQueue();
    return;
  }
  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function focusDailyRecommendedCandidate(jobId: string): Promise<void> {
  await loadReviewCandidates();
  await nextTick();
  if (expandedJobId.value !== jobId) {
    await toggleDetail(jobId);
  }
  await nextTick();
  scrollToReviewCandidate(jobId);
}

function scrollToFilterProfile(): void {
  document.getElementById("filter-profile-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function scrollToBlacklistManagement(): void {
  document.getElementById("job-blacklist-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function routeRequestsReviewQueue(value: unknown): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" && raw.trim().toLowerCase() === "top20";
}

function clearReviewQueueScrollTimers(): void {
  for (const timer of reviewQueueScrollTimers) {
    window.clearTimeout(timer);
  }
  reviewQueueScrollTimers = [];
}

function scrollToReviewQueueFromRoute(): void {
  clearReviewQueueScrollTimers();
  if (!routeRequestsReviewQueue(route.query.review)) return;
  void nextTick(() => {
    window.requestAnimationFrame(scrollToReviewQueue);
  });
  reviewQueueScrollTimers = [250, 800, 1400].map((delay) =>
    window.setTimeout(() => {
      scrollToReviewQueue();
    }, delay),
  );
}

onMounted(scrollToReviewQueueFromRoute);
onActivated(scrollToReviewQueueFromRoute);
onDeactivated(clearReviewQueueScrollTimers);
watch(() => route.fullPath, scrollToReviewQueueFromRoute, { flush: "post", immediate: true });
</script>

<template>
  <section class="space-y-5">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-content-primary">岗位研究库</h1>
      <p class="text-sm text-content-secondary">按采集关键词分组回溯岗位，围绕硬限制、匹配分和沟通状态筛出少量精准候选。</p>
    </header>

    <div v-if="!tauri" class="ui-status-warning p-4 text-sm">当前是浏览器模式（非 Tauri）。查询命令不可用。</div>

    <div class="ui-toolbar flex flex-wrap items-center gap-2 px-3 py-3">
      <input v-model="search" class="ui-input w-72" placeholder="搜索关键词 / 职位名 / 公司名…" @keyup.enter="() => loadKeywords()" />
      <button class="ui-btn-primary" :disabled="!tauri || loading" @click="() => loadKeywords()">{{ loading ? '加载中…' : '搜索' }}</button>
      <button v-if="isSearchMode" class="ui-btn-secondary" @click="search = ''; loadKeywords()">清除搜索</button>
      <button v-if="groups.length > 0" class="ui-btn-danger" :disabled="!tauri || loading" @click="deleteAllJobs">清空全部</button>
      <span class="ui-badge">{{ isSearchMode ? `搜索到 ${flatResults.length} 个职位` : `${groups.length} 个关键词组` }}</span>
    </div>

    <div v-if="error" class="ui-status-danger p-4 text-sm">{{ error }}</div>

    <div v-if="routeAnalysisCompleted" class="ui-status-success p-4 text-sm">
      简历匹配报告已生成，Top 20 候选队列会按最新评分刷新；继续人工确认，不会自动发送或投递。
    </div>

    <section class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">外部岗位导入</h2>
          <p class="mt-1 text-xs text-content-muted">导入猎聘、智联、脉脉、V2EX 或 LinuxDo 的单条岗位 JSON，进入本地筛选和人工确认队列。</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="externalImportLoading" @click="fillExternalImportExample">
            填入示例
          </button>
          <button
            class="ui-btn-primary px-3 py-1.5 text-xs"
            :disabled="!tauri || externalImportLoading || !externalImportPayloadText.trim()"
            @click="importExternalJob"
          >
            {{ externalImportLoading ? "导入中…" : "导入岗位" }}
          </button>
        </div>
      </div>
      <div class="grid gap-3 px-4 py-4 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">来源平台</div>
          <select v-model="externalImportPlatform" class="ui-input w-full" :disabled="!tauri || externalImportLoading">
            <option v-for="option in externalImportPlatformOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">岗位 JSON</div>
          <textarea
            v-model="externalImportPayloadText"
            class="ui-textarea h-40 w-full font-mono text-xs"
            :disabled="!tauri || externalImportLoading"
            placeholder='{"job_id":"liepin-123","job_url":"https://example.com/job/123","title":"Go 平台工程师","company":"某某科技","city":"上海","salary":"30-50K","experience":"5-10年","education":"本科","description":"岗位描述"}'
          />
        </label>
      </div>
      <div class="flex flex-wrap items-center gap-2 border-t border-border/10 px-4 py-3 text-xs text-content-muted">
        <span class="ui-badge">manual_import</span>
        <span>仅写入本地岗位库，不会自动投递或发送消息。</span>
        <span v-if="externalImportMessage" class="text-emerald-300">{{ externalImportMessage }}</span>
        <button
          v-if="lastExternalImportedJob"
          class="ui-btn-secondary px-2.5 py-1 text-xs"
          :disabled="externalImportLoading"
          @click="copyExternalImportSummary"
        >
          复制导入摘要
        </button>
      </div>
    </section>

    <section id="filter-profile-panel" class="ui-panel scroll-mt-24 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">筛选画像</h2>
          <p class="mt-1 text-xs text-content-muted">重算后会更新画像过滤结果、偏好分和 Top 20 候选队列。</p>
        </div>
        <div class="grid w-full gap-2 lg:w-auto lg:grid-cols-[minmax(10rem,12rem)_minmax(10rem,12rem)_minmax(10rem,12rem)_auto]">
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">当前画像</div>
            <select
              v-model="activeFilterProfileId"
              class="ui-input w-full"
              :disabled="!tauri || filterProfileLoading"
              @change="selectFilterProfile(activeFilterProfileId)"
            >
              <option v-for="profile in filterProfiles" :key="profile.id" :value="profile.id">
                {{ profile.name }}{{ profile.is_default ? "（默认）" : "" }}
              </option>
            </select>
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">画像名称</div>
            <input v-model="activeFilterProfileName" class="ui-input w-full" :disabled="!tauri || filterProfileLoading" />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">新建画像</div>
            <input v-model="newFilterProfileName" class="ui-input w-full" placeholder="例如：远程优先" :disabled="!tauri || filterProfileLoading" />
          </label>
          <div class="flex flex-wrap items-end gap-2">
            <span v-if="activeFilterProfileIsDefault" class="ui-badge mb-0.5">默认策略</span>
            <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filterProfileLoading || !newFilterProfileName.trim()" @click="createFilterProfile">
              新建
            </button>
            <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filterProfileLoading" @click="saveActiveFilterProfile">
              保存画像
            </button>
            <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filterProfileLoading || activeFilterProfileIsDefault" @click="setActiveFilterProfileAsDefault">
              设为默认
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filterProfileLoading" @click="loadDefaultFilterProfile">
            {{ filterProfileLoading ? "读取中…" : "读取画像" }}
          </button>
          <button class="ui-btn-primary px-3 py-1.5 text-xs" :disabled="!tauri || filterRecomputing" @click="recomputeDefaultFilterProfile">
            {{ filterRecomputing ? "重算中…" : "保存画像并重算" }}
          </button>
        </div>
      </div>
      <div class="grid gap-3 px-4 py-4 lg:grid-cols-3">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须包含关键词</div>
          <textarea
            v-model="mustKeywordsText"
            class="ui-textarea h-24 w-full"
            placeholder="例如：Go&#10;Kubernetes&#10;SRE"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须排除关键词</div>
          <textarea
            v-model="mustNotKeywordsText"
            class="ui-textarea h-24 w-full"
            placeholder="例如：外包&#10;驻场&#10;培训"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">偏好关键词</div>
          <textarea
            v-model="preferenceKeywordsText"
            class="ui-textarea h-24 w-full"
            placeholder="例如：远程&#10;云原生&#10;AI Infra"
          />
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-3">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须岗位方向</div>
          <textarea
            v-model="requiredDirectionsText"
            class="ui-textarea h-20 w-full"
            placeholder="Go&#10;Infra&#10;云原生"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除岗位方向</div>
          <textarea
            v-model="excludedDirectionsText"
            class="ui-textarea h-20 w-full"
            placeholder="前端&#10;销售型售前"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">偏好岗位方向</div>
          <textarea
            v-model="preferenceDirectionsText"
            class="ui-textarea h-20 w-full"
            placeholder="AI Infra&#10;平台工程"
          />
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-3">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须技术标签</div>
          <textarea
            v-model="requiredTechTagsText"
            class="ui-textarea h-20 w-full"
            placeholder="Kubernetes&#10;Docker"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除技术标签</div>
          <textarea
            v-model="excludedTechTagsText"
            class="ui-textarea h-20 w-full"
            placeholder="Java&#10;PHP&#10;Windows 运维"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">偏好技术标签</div>
          <textarea
            v-model="preferenceTechTagsText"
            class="ui-textarea h-20 w-full"
            placeholder="Prometheus&#10;Terraform&#10;CI/CD"
          />
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-3">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须工作方式</div>
          <textarea
            v-model="requiredWorkModesText"
            class="ui-textarea h-20 w-full"
            placeholder="remote&#10;hybrid"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除工作方式</div>
          <textarea
            v-model="excludedWorkModesText"
            class="ui-textarea h-20 w-full"
            placeholder="on_site&#10;office"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">偏好工作方式</div>
          <textarea
            v-model="preferenceWorkModesText"
            class="ui-textarea h-20 w-full"
            placeholder="remote&#10;long_remote"
          />
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-4">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">可接受城市</div>
          <textarea
            v-model="targetCitiesText"
            class="ui-textarea h-20 w-full"
            placeholder="北京&#10;上海&#10;深圳"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除城市</div>
          <textarea
            v-model="excludedCitiesText"
            class="ui-textarea h-20 w-full"
            placeholder="杭州&#10;广州"
          />
        </label>
        <label class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-content-muted">来源平台</span>
            <span class="text-[11px] text-content-muted">控制哪些来源进入 Top 20</span>
          </div>
          <div class="mb-1 flex flex-wrap gap-1.5">
            <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setBossOnlySourcePlatforms">Boss-only</button>
            <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setManualImportSourcePlatforms">手动导入来源</button>
            <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setAllSourcePlatforms">全来源</button>
          </div>
          <div class="mb-2 rounded-md border border-border/10 bg-surface-secondary/60 px-2.5 py-2 text-[11px] leading-5 text-content-muted">
            <span class="font-semibold text-content-secondary">{{ sourcePlatformModeLabel }}</span>
            <span class="ml-1">{{ sourcePlatformModeHint }}</span>
          </div>
          <textarea
            v-model="sourcePlatformsText"
            class="ui-textarea h-20 w-full"
            placeholder="boss&#10;liepin&#10;zhilian&#10;maimai&#10;v2ex&#10;linuxdo"
          />
          <div class="flex flex-wrap gap-1.5 text-[11px] text-content-muted">
            <span v-for="option in sourcePlatformOptions" :key="option.value" class="ui-badge">
              {{ option.value }} · {{ option.label }}
            </span>
          </div>
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">允许沟通状态</div>
          <textarea
            v-model="communicationStatusesText"
            class="ui-textarea h-20 w-full"
            placeholder="not_contacted&#10;greeted_unread"
          />
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-4">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">最低薪资 K</div>
          <input v-model.number="minimumSalaryK" type="number" min="0" step="1" class="ui-input w-full" />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">最高薪资 K</div>
          <input v-model.number="maximumSalaryK" type="number" min="0" step="1" class="ui-input w-full" />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">最近新增天数</div>
          <input v-model.number="recentDays" type="number" min="0" step="1" class="ui-input w-full" />
        </label>
        <label class="flex items-center gap-2 self-end rounded-md border border-border/10 bg-surface-secondary/50 px-3 py-2 text-xs text-content-muted">
          <input v-model="acceptNegotiableSalary" type="checkbox" class="h-4 w-4 accent-accent" />
          接受面议薪资
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-4">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">最低经验年限</div>
          <input v-model.number="minimumExperienceYears" type="number" min="0" step="0.5" class="ui-input w-full" />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">最高经验年限</div>
          <input v-model.number="maximumExperienceYears" type="number" min="0" step="0.5" class="ui-input w-full" />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">允许学历要求</div>
          <textarea
            v-model="allowedDegreesText"
            class="ui-textarea h-16 w-full"
            placeholder="学历不限&#10;本科"
          />
        </label>
        <label class="flex items-center gap-2 self-end rounded-md border border-border/10 bg-surface-secondary/50 px-3 py-2 text-xs text-content-muted">
          <input v-model="acceptUnknownExperience" type="checkbox" class="h-4 w-4 accent-accent" />
          接受未知经验
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-4">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除学历要求</div>
          <textarea
            v-model="excludedDegreesText"
            class="ui-textarea h-20 w-full"
            placeholder="硕士&#10;博士"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">公司必须条件</div>
          <textarea
            v-model="companyMustKeywordsText"
            class="ui-textarea h-20 w-full"
            placeholder="云计算&#10;B轮"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">公司排除条件</div>
          <textarea
            v-model="companyMustNotKeywordsText"
            class="ui-textarea h-20 w-full"
            placeholder="外包&#10;培训机构"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">公司偏好条件</div>
          <textarea
            v-model="companyPreferenceKeywordsText"
            class="ui-textarea h-20 w-full"
            placeholder="上市&#10;1000人以上"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须公司规模</div>
          <textarea
            v-model="companyRequiredScalesText"
            class="ui-textarea h-20 w-full"
            placeholder="1000人以上&#10;500-999人"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除公司规模</div>
          <textarea
            v-model="companyExcludedScalesText"
            class="ui-textarea h-20 w-full"
            placeholder="20人以下"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">偏好公司规模</div>
          <textarea
            v-model="companyPreferenceScalesText"
            class="ui-textarea h-20 w-full"
            placeholder="1000人以上"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须融资阶段</div>
          <textarea
            v-model="companyRequiredFinancingStagesText"
            class="ui-textarea h-20 w-full"
            placeholder="B轮&#10;上市"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除融资阶段</div>
          <textarea
            v-model="companyExcludedFinancingStagesText"
            class="ui-textarea h-20 w-full"
            placeholder="未融资"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">偏好融资阶段</div>
          <textarea
            v-model="companyPreferenceFinancingStagesText"
            class="ui-textarea h-20 w-full"
            placeholder="C轮&#10;上市"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">必须行业</div>
          <textarea
            v-model="companyRequiredIndustriesText"
            class="ui-textarea h-20 w-full"
            placeholder="云计算&#10;企业服务"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">排除行业</div>
          <textarea
            v-model="companyExcludedIndustriesText"
            class="ui-textarea h-20 w-full"
            placeholder="培训&#10;外包服务"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">偏好行业</div>
          <textarea
            v-model="companyPreferenceIndustriesText"
            class="ui-textarea h-20 w-full"
            placeholder="AI Infra&#10;SaaS"
          />
        </label>
      </div>
      <div class="grid gap-3 px-4 pb-4 lg:grid-cols-3">
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">Resume 权重</div>
          <input
            v-model.number="resumeWeight"
            type="number"
            min="0"
            step="0.05"
            class="ui-input w-full"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">Preference 权重</div>
          <input
            v-model.number="preferenceWeight"
            type="number"
            min="0"
            step="0.05"
            class="ui-input w-full"
          />
        </label>
        <label class="space-y-1">
          <div class="text-xs font-medium text-content-muted">Company 权重</div>
          <input
            v-model.number="companyWeight"
            type="number"
            min="0"
            step="0.05"
            class="ui-input w-full"
          />
        </label>
      </div>
      <div class="flex flex-wrap items-center gap-2 border-t border-border/10 px-4 py-3 text-xs text-content-muted">
        <span v-if="filterProfileUpdatedAt">上次保存：{{ formatDate(filterProfileUpdatedAt) }}</span>
        <span v-if="filterRecomputeMessage" class="text-emerald-300">{{ filterRecomputeMessage }}</span>
      </div>
    </section>

    <section v-if="linkedJob || linkedJobLoading || linkedJobError" class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">当前确认岗位</h2>
          <p class="mt-1 text-xs text-content-muted">从 AI 报告返回的岗位，可在这里人工确认、备注或准备投递；不会自动发送或投递。</p>
        </div>
      </div>
      <div v-if="linkedJobLoading" class="px-4 py-5 text-sm text-content-muted">正在读取联动岗位…</div>
      <div v-if="linkedJobError" class="ui-status-danger m-4 p-4 text-sm">
        <pre class="whitespace-pre-wrap">{{ linkedJobError }}</pre>
      </div>
      <div v-if="linkedJob" class="divide-y divide-border/10">
        <JobsJobItem
          :key="`linked-${linkedJob.encrypt_job_id}`"
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
          @open-filter-profile="() => scrollToFilterProfile()"
          @open-blacklist-management="() => scrollToBlacklistManagement()"
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
    </section>

    <section class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">最近过滤解释</h2>
          <p class="mt-1 text-xs text-content-muted">展示最近因画像过滤、黑名单、审核状态或沟通状态排除在 Top 20 外的岗位。</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" @click="scrollToFilterProfile">编辑画像</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" @click="scrollToBlacklistManagement">查看黑名单</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="filteredJobs.length === 0" @click="copyFilteredJobsSummary">复制过滤摘要</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filteredJobsLoading" @click="loadFilteredJobs">
            {{ filteredJobsLoading ? "刷新中…" : "刷新过滤解释" }}
          </button>
        </div>
      </div>
      <div v-if="filteredJobsLoading" class="px-4 py-5 text-sm text-content-muted">正在加载过滤解释…</div>
      <div v-else-if="filteredJobs.length === 0" class="px-4 py-5 text-sm text-content-muted">暂无被过滤岗位。</div>
      <div v-else class="divide-y divide-border/10">
        <JobsJobItem
          v-for="job in filteredJobs"
          :key="`filtered-${job.encrypt_job_id}`"
          :job="job"
          :expanded="expandedJobId === job.encrypt_job_id"
          :detail-loading="detailLoading === job.encrypt_job_id"
          :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
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
          @open-filter-profile="() => scrollToFilterProfile()"
          @open-blacklist-management="() => scrollToBlacklistManagement()"
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
    </section>

    <section class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">每日岗位情报</h2>
          <p class="mt-1 text-xs text-content-muted">
            本地 SQLite 摘要；推荐投递候选、准备投递和已投递分开统计，不会自动发送或投递。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <label class="flex items-center gap-2 rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-1.5 text-xs text-content-secondary">
            <input v-model="dailyIntelligenceAutoNotifyEnabled" type="checkbox" class="h-4 w-4 accent-accent" :disabled="!tauri" />
            自动本机通知
          </label>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || dailyIntelligenceLoading" @click="loadDailyIntelligence">
            {{ dailyIntelligenceLoading ? "生成中…" : "刷新情报" }}
          </button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!dailyIntelligence" @click="copyDailyIntelligence">复制摘要</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!dailyIntelligence" @click="scrollToReviewQueue">查看 Top 20</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!dailyIntelligence" @click="scrollToFavoritedQueue">查看收藏</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!dailyIntelligence" @click="scrollToApplicationReadyQueue">查看准备投递</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || !dailyIntelligence" @click="showDailyIntelligenceNotification">本机通知</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!dailyIntelligence" @click="openDailyIntelligenceEmailDraft">邮件草稿</button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || !dailyIntelligence || dailyIntelligenceWecomSending" @click="sendDailyIntelligenceWecomNotification">
            {{ dailyIntelligenceWecomSending ? "发送中…" : "企业微信通知" }}
          </button>
        </div>
      </div>
      <div v-if="dailyIntelligenceExternalMessage" class="border-b border-border/10 px-4 py-2 text-xs text-emerald-300">
        {{ dailyIntelligenceExternalMessage }}
      </div>

      <div v-if="dailyIntelligenceLoading && !dailyIntelligence" class="px-4 py-5 text-sm text-content-muted">正在生成今日岗位情报…</div>
      <div v-else-if="!dailyIntelligence" class="px-4 py-5 text-sm text-content-muted">暂无情报数据。</div>
      <div v-else class="px-4 py-4">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div class="rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3">
            <div class="text-[11px] font-medium text-content-muted">今日新增岗位</div>
            <div class="mt-2 text-2xl font-semibold text-content-primary">{{ dailyIntelligence.today_new_jobs }}</div>
          </div>
          <div class="rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3">
            <div class="text-[11px] font-medium text-content-muted">高匹配</div>
            <div class="mt-2 text-2xl font-semibold text-content-primary">{{ dailyIntelligence.high_match_jobs }}</div>
          </div>
          <div class="rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3">
            <div class="text-[11px] font-medium text-content-muted">满足关键限制</div>
            <div class="mt-2 text-2xl font-semibold text-content-primary">{{ dailyIntelligence.eligible_jobs }}</div>
          </div>
          <div class="rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3">
            <div class="text-[11px] font-medium text-content-muted">推荐投递候选</div>
            <div class="mt-2 text-2xl font-semibold text-content-primary">{{ dailyIntelligence.recommended_jobs }}</div>
          </div>
          <div class="rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3">
            <div class="text-[11px] font-medium text-content-muted">准备投递</div>
            <div class="mt-2 text-2xl font-semibold text-content-primary">{{ dailyIntelligence.ready_to_apply_jobs }}</div>
          </div>
          <div class="rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3">
            <div class="text-[11px] font-medium text-content-muted">已投递记录</div>
            <div class="mt-2 text-2xl font-semibold text-content-primary">{{ dailyIntelligence.applied_jobs }}</div>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span class="ui-badge">日期 {{ dailyIntelligence.report_date }}</span>
          <span class="ui-badge">高匹配 ≥ {{ dailyIntelligence.high_match_threshold }}</span>
          <span class="ui-badge">推荐阈值 ≥ {{ dailyIntelligence.recommendation_threshold }}</span>
          <span class="ui-badge">来源策略 {{ sourcePlatformModeLabel }}</span>
          <span v-if="dailyIntelligenceAutoNotifyEnabled" class="ui-badge bg-emerald-400/10 text-emerald-300 ring-emerald-400/20">自动通知已启用</span>
          <span>生成时间：{{ formatDate(dailyIntelligence.generated_at) }}</span>
          <span class="basis-full text-content-muted">{{ sourcePlatformModeHint }}</span>
        </div>
        <div v-if="dailyIntelligence.recommended_candidates.length" class="mt-4 space-y-2">
          <div class="text-xs font-semibold text-content-secondary">推荐候选预览</div>
          <div class="divide-y divide-border/10 overflow-hidden rounded-md border border-border/10 bg-surface-secondary/40">
            <div
              v-for="candidate in dailyIntelligence.recommended_candidates"
              :key="candidate.encrypt_job_id"
              class="flex flex-wrap items-center gap-3 px-3 py-2.5 text-xs"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate font-medium text-content-primary">
                  {{ candidate.position_name ?? candidate.encrypt_job_id }}
                </div>
                <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-content-muted">
                  <span>{{ candidate.brand_name ?? '未知公司' }}</span>
                  <span>{{ candidate.city_name ?? '未知城市' }}</span>
                  <span>{{ candidate.source_platform || 'boss' }}</span>
                  <span class="max-w-36 truncate" :title="candidate.source_url ?? candidate.dedup_key ?? candidate.encrypt_job_id">
                    去重 {{ candidate.dedup_key ?? candidate.encrypt_job_id }}
                  </span>
                  <span>Final {{ Math.round(candidate.final_score) }}</span>
                  <span>Resume {{ candidate.resume_match_score === null ? '待分析' : Math.round(candidate.resume_match_score) }}</span>
                  <span>Preference {{ Math.round(candidate.preference_score) }}</span>
                  <span>Company {{ Math.round(candidate.company_score) }}</span>
                </div>
                <div class="mt-1 text-content-muted">
                  推荐理由：{{ candidate.recommendation_reason || '达到当前推荐阈值' }}
                </div>
              </div>
              <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="copyDailyRecommendedCandidate(candidate)">复制理由</button>
              <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="focusDailyRecommendedCandidate(candidate.encrypt_job_id)">查看岗位</button>
              <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="goAi(candidate.encrypt_job_id)">AI 分析</button>
              <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="goResumeWorkspace(candidate.encrypt_job_id)">定制简历</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="top20-review-queue" class="ui-panel scroll-mt-24 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">Top 20 人工审核队列</h2>
          <p class="mt-1 text-xs text-content-muted">默认排除画像过滤、黑名单、已拒绝、手动不合适、已收藏、准备投递、已投递和已忽略职位。</p>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-content-muted">
            <span class="ui-badge">来源策略 {{ sourcePlatformModeLabel }}</span>
            <span>{{ sourcePlatformModeHint }}</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || reviewCandidatesLoading" @click="loadReviewCandidates">
            {{ reviewCandidatesLoading ? "刷新中…" : "刷新候选" }}
          </button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="reviewCandidates.length === 0" @click="copyReviewCandidatesSummary">
            复制候选摘要
          </button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || companyScoreRebuilding || aiCompanyScoreGenerating" @click="rebuildCompanyScores">
            {{ companyScoreRebuilding ? "重建中…" : "重建公司评分" }}
          </button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || aiCompanyScoreGenerating || companyScoreRebuilding" @click="generateAiCompanyScores">
            {{ aiCompanyScoreGenerating ? "AI 评分中…" : "AI 公司评分" }}
          </button>
          <button
            class="ui-btn-primary px-3 py-1.5 text-xs"
            :disabled="!tauri || reviewCandidatesLoading || reviewCandidates.length === 0"
            @click="analyzeReviewCandidates"
          >
            分析 Top 20
          </button>
        </div>
      </div>
      <div v-if="companyScoreRebuildMessage" class="border-b border-border/10 px-4 py-2 text-xs text-emerald-300">
        {{ companyScoreRebuildMessage }}
      </div>
      <div v-if="aiCompanyScoreMessage" class="border-b border-border/10 px-4 py-2 text-xs text-emerald-300">
        {{ aiCompanyScoreMessage }}
      </div>
      <div v-if="aiCompanyScoreError" class="ui-status-danger space-y-2 rounded-none border-x-0 border-t-0 px-4 py-3 text-xs">
        <div class="font-semibold">{{ aiCompanyScoreError.title }}</div>
        <div>{{ aiCompanyScoreError.hint }}</div>
        <pre class="whitespace-pre-wrap text-[11px] text-red-100/80">{{ aiCompanyScoreError.message }}</pre>
        <button
          type="button"
          class="ui-btn-secondary px-3 py-1 text-xs"
          :disabled="!tauri || aiCompanyScoreGenerating || companyScoreRebuilding"
          @click="generateAiCompanyScores"
        >
          {{ aiCompanyScoreGenerating ? "重试中…" : "重试 AI 公司评分" }}
        </button>
      </div>
      <div v-if="reviewCandidatesLoading" class="px-4 py-5 text-sm text-content-muted">正在加载候选岗位…</div>
      <div v-else-if="reviewCandidates.length === 0" class="px-4 py-5 text-sm text-content-muted">暂无可审核候选岗位。</div>
      <div v-else class="divide-y divide-border/10">
        <JobsJobItem
          v-for="job in reviewCandidates"
          :key="`candidate-${job.encrypt_job_id}`"
          :id="reviewCandidateElementId(job.encrypt_job_id)"
          :job="job"
          :expanded="expandedJobId === job.encrypt_job_id"
          :detail-loading="detailLoading === job.encrypt_job_id"
          :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
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
          @open-filter-profile="() => scrollToFilterProfile()"
          @open-blacklist-management="() => scrollToBlacklistManagement()"
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
    </section>

    <section id="favorited-jobs-queue" class="ui-panel scroll-mt-24 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">已收藏岗位</h2>
          <p class="mt-1 text-xs text-content-muted">人工暂存的候选岗位；可继续 AI 分析、定制简历或确认进入投递准备。</p>
        </div>
        <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || favoritedJobsLoading" @click="loadFavoritedJobs">
          {{ favoritedJobsLoading ? "刷新中…" : "刷新收藏" }}
        </button>
      </div>
      <div v-if="favoritedJobsLoading" class="px-4 py-5 text-sm text-content-muted">正在加载已收藏岗位…</div>
      <div v-else-if="favoritedJobs.length === 0" class="px-4 py-5 text-sm text-content-muted">暂无已收藏岗位。</div>
      <div v-else class="divide-y divide-border/10">
        <JobsJobItem
          v-for="job in favoritedJobs"
          :key="`favorited-${job.encrypt_job_id}`"
          :id="`favorited-${job.encrypt_job_id}`"
          :job="job"
          :expanded="expandedJobId === job.encrypt_job_id"
          :detail-loading="detailLoading === job.encrypt_job_id"
          :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
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
          @open-filter-profile="() => scrollToFilterProfile()"
          @open-blacklist-management="() => scrollToBlacklistManagement()"
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
    </section>

    <section id="application-ready-queue" class="ui-panel scroll-mt-24 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">投递准备台</h2>
          <p class="mt-1 text-xs text-content-muted">人工确认为准备投递的岗位；复制材料包、文案和已投递状态仍需手动确认。</p>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-content-muted">
            <span class="ui-badge">来源策略 {{ sourcePlatformModeLabel }}</span>
            <span>{{ sourcePlatformModeHint }}</span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || applicationReadyJobsLoading" @click="loadApplicationReadyJobs">
            {{ applicationReadyJobsLoading ? "刷新中…" : "刷新准备台" }}
          </button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="applicationReadyJobs.length === 0" @click="copyApplicationReadySummary">
            复制准备清单
          </button>
        </div>
      </div>
      <div v-if="applicationReadyJobsLoading" class="px-4 py-5 text-sm text-content-muted">正在加载准备投递岗位…</div>
      <div v-else-if="applicationReadyJobs.length === 0" class="px-4 py-5 text-sm text-content-muted">暂无准备投递岗位。</div>
      <div v-else class="divide-y divide-border/10">
        <JobsJobItem
          v-for="job in applicationReadyJobs"
          :key="`application-ready-${job.encrypt_job_id}`"
          :id="`application-ready-${job.encrypt_job_id}`"
          :job="job"
          :expanded="expandedJobId === job.encrypt_job_id"
          :detail-loading="detailLoading === job.encrypt_job_id"
          :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
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
          @open-filter-profile="() => scrollToFilterProfile()"
          @open-blacklist-management="() => scrollToBlacklistManagement()"
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
    </section>

    <section id="communication-followup-queue" class="ui-panel scroll-mt-24 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">沟通回溯台</h2>
          <p class="mt-1 text-xs text-content-muted">集中查看已打招呼、已读未回、已回复、已拒绝、已投递或有备注的岗位记录。</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || communicationFollowupJobsLoading" @click="loadCommunicationFollowupJobs">
            {{ communicationFollowupJobsLoading ? "刷新中…" : "刷新回溯" }}
          </button>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="communicationFollowupJobs.length === 0" @click="copyCommunicationFollowupSummary">
            复制复盘摘要
          </button>
        </div>
      </div>
      <div v-if="communicationFollowupJobsLoading" class="px-4 py-5 text-sm text-content-muted">正在加载沟通回溯记录…</div>
      <div v-else-if="communicationFollowupJobs.length === 0" class="px-4 py-5 text-sm text-content-muted">暂无沟通回溯记录。</div>
      <div v-else class="divide-y divide-border/10">
        <JobsJobItem
          v-for="job in communicationFollowupJobs"
          :key="`communication-followup-${job.encrypt_job_id}`"
          :id="`communication-followup-${job.encrypt_job_id}`"
          :job="job"
          :expanded="expandedJobId === job.encrypt_job_id"
          :detail-loading="detailLoading === job.encrypt_job_id"
          :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
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
          @open-filter-profile="() => scrollToFilterProfile()"
          @open-blacklist-management="() => scrollToBlacklistManagement()"
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
    </section>

    <section id="job-blacklist-panel" class="ui-panel scroll-mt-24 overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border/10 px-4 py-3">
        <div>
          <h2 class="text-sm font-semibold text-content-primary">黑名单管理</h2>
          <p class="mt-1 text-xs text-content-muted">公司、职位和关键词黑名单会在排序前过滤候选岗位。</p>
        </div>
        <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || blacklistLoading" @click="loadJobBlacklist">
          {{ blacklistLoading ? "刷新中…" : "刷新黑名单" }}
        </button>
      </div>
      <div v-if="blacklistLoading && blacklistEntries.length === 0" class="px-4 py-5 text-sm text-content-muted">正在加载黑名单…</div>
      <div v-else-if="blacklistEntries.length === 0" class="px-4 py-5 text-sm text-content-muted">暂无黑名单规则。</div>
      <div v-else class="divide-y divide-border/10">
        <div
          v-for="entry in blacklistEntries"
          :key="entry.id"
          class="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm"
        >
          <span class="ui-badge shrink-0">{{ blacklistKindLabel(entry.kind) }}</span>
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-content-primary">{{ entry.value }}</div>
            <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-content-muted">
              <span v-if="entry.reason" class="min-w-0 truncate">{{ entry.reason }}</span>
              <span>创建时间：{{ formatDate(entry.created_at) }}</span>
            </div>
          </div>
          <button class="ui-btn-danger px-2.5 py-1 text-xs" :disabled="blacklistLoading" @click="deleteJobBlacklist(entry)">移除</button>
        </div>
      </div>
    </section>

    <JobsExportPanel />

    <div v-if="isSearchMode && flatResults.length > 0" class="space-y-2">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">职位搜索结果</div>
      <div class="ui-panel overflow-hidden">
        <div class="divide-y divide-border/10">
          <JobsJobItem
            v-for="job in flatResults"
            :key="`flat-${job.encrypt_job_id}`"
            :job="job"
            :expanded="expandedJobId === job.encrypt_job_id"
            :detail-loading="detailLoading === job.encrypt_job_id"
            :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
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
            @open-filter-profile="() => scrollToFilterProfile()"
            @open-blacklist-management="() => scrollToBlacklistManagement()"
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
      </div>
    </div>

    <div v-else-if="isSearchMode" class="ui-panel px-4 py-10 text-center text-sm text-content-muted">未找到匹配的职位或关键词，请尝试其他搜索词。</div>

    <div v-if="isSearchMode && groups.length > 0" class="text-xs font-semibold uppercase tracking-wider text-content-muted">匹配的关键词组</div>

    <div class="space-y-2">
      <JobsGroupCard
        v-for="group in groups"
        :key="groupKey(group)"
        :group="group"
        :group-key-value="groupKey(group)"
        :expanded="expandedKeyword === groupKey(group)"
        :loading="keywordJobsLoading === groupKey(group)"
        :jobs="keywordJobsCache.get(groupKey(group))"
        :expanded-job-id="expandedJobId"
        :detail-loading-id="detailLoading"
        :expanded-detail="expandedDetail"
        :greeting-cache="greetingCache"
        :greeting-drafts="greetingDrafts"
        :greeting-errors="greetingErrors"
        :greeting-loading-id="greetingLoading"
        :resume-workspace-statuses="resumeWorkspaceStatuses"
        @toggle-group="(group) => toggleKeyword(group)"
        @toggle-detail="(jobId) => toggleDetail(jobId)"
        @go-ai="(jobId) => goAi(jobId)"
        @go-resume-workspace="(jobId) => goResumeWorkspace(jobId)"
        @copy-link="(job) => copy(jobSourceUrl(job))"
        @open-source-url="(job) => openJobSourceUrl(job)"
        @open-filter-profile="() => scrollToFilterProfile()"
        @open-blacklist-management="() => scrollToBlacklistManagement()"
        @delete-job="(job, groupKeyValue) => deleteJob(job, groupKeyValue)"
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

    <div v-if="groups.length === 0 && !loading && !isSearchMode" class="ui-panel px-4 py-12 text-center text-sm text-content-muted">暂无数据。</div>

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

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
