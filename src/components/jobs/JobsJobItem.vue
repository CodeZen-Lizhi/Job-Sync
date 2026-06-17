<script setup lang="ts">
import { computed, toRefs } from "vue";
import {
  companyRiskFlagLabel,
  companyReviewStatusLabel,
  COLLECTION_METHOD_LABELS,
  communicationStatusLabel,
  filterBucketLabel,
  formatAiPostCollectionJudgement,
  formatFilterReasonSummary,
  formatPreferenceSignals,
  formatScoreReasonSummary,
  parseFilterReasonJson,
  parseScoreReasonJson,
  reviewStatusLabel,
  type CommunicationStatus,
  type CompanyReviewStatus,
  type GreetingErrorState,
  type GreetingMessageResult,
  type JobDetail,
  type JobRow,
  type ReviewStatus,
} from "../../lib/jobs";
import { formatDate } from "../../lib/jobsPageHelpers";
import type { ResumeWorkspaceJobStatus } from "../../lib/resumeWorkspace";

const props = withDefaults(
  defineProps<{
    job: JobRow;
    expanded: boolean;
    detailLoading: boolean;
    detail: JobDetail | null;
    allowDelete?: boolean;
    allowReviewActions?: boolean;
    greeting?: GreetingMessageResult;
    greetingDraft?: string;
    greetingError?: GreetingErrorState;
    greetingLoading?: boolean;
    pendingEvidenceRefreshing?: boolean;
    resumeWorkspaceStatus?: ResumeWorkspaceJobStatus | null;
    rowPaddingClass?: string;
    detailPaddingClass?: string;
  }>(),
  {
    allowDelete: false,
    allowReviewActions: true,
    greeting: undefined,
    greetingDraft: "",
    greetingError: undefined,
    greetingLoading: false,
    pendingEvidenceRefreshing: false,
    rowPaddingClass: "px-4",
    detailPaddingClass: "px-10",
  },
);

const {
  job,
  expanded,
  detailLoading,
  detail,
  allowDelete,
  allowReviewActions,
  greeting,
  greetingDraft,
  greetingError,
  greetingLoading,
  pendingEvidenceRefreshing,
  rowPaddingClass,
  detailPaddingClass,
} = toRefs(props);

const emit = defineEmits<{
  (e: "toggle-detail", jobId: string): void;
  (e: "go-ai", jobId: string): void;
  (e: "go-resume-workspace", jobId: string): void;
  (e: "copy-link", job: JobRow): void;
  (e: "open-source-url", job: JobRow): void;
  (e: "delete", job: JobRow): void;
  (e: "open-filter-profile-config", job: JobRow): void;
  (e: "open-blacklist-management", job: JobRow): void;
  (e: "update-review", job: JobRow, status: ReviewStatus): void;
  (e: "restore-review-candidate", job: JobRow): void;
  (e: "update-communication", job: JobRow, status: CommunicationStatus): void;
  (e: "update-review-notes", job: JobRow): void;
  (e: "update-company-review", job: JobRow, status: CompanyReviewStatus): void;
  (e: "blacklist-company", job: JobRow): void;
  (e: "blacklist-job", job: JobRow): void;
  (e: "blacklist-keyword", job: JobRow): void;
  (e: "generate-greeting", job: JobRow): void;
  (e: "update-greeting-draft", jobId: string, message: string): void;
  (e: "copy-greeting", job: JobRow): void;
  (e: "copy-application-packet", job: JobRow): void;
  (e: "refresh-pending-evidence", job: JobRow): void;
}>();

type FilterNextActionKey = "filter-profile" | "blacklist" | "company" | "candidate";
type ApplicationNextActionKey =
  | "mark-ready"
  | "ai-analysis"
  | "open-source-url"
  | "resume-workspace"
  | "generate-greeting"
  | "copy-application-packet"
  | "copy-greeting"
  | "mark-applied";

interface FilterNextAction {
  key: FilterNextActionKey;
  label: string;
  title: string;
}

interface ApplicationNextAction {
  key: ApplicationNextActionKey;
  label: string;
  title: string;
}

function formatScore(score?: number | null): string {
  if (typeof score !== "number" || Number.isNaN(score)) return "待分析";
  return `${Math.round(score)}`;
}

const filterReason = computed(() => parseFilterReasonJson(props.job.filter_reason_json));
const aiPostCollectionJudgement = computed(() => filterReason.value?.ai_judgement);
const aiPostCollectionJudgementText = computed(() => formatAiPostCollectionJudgement(aiPostCollectionJudgement.value));
const isPendingConfirmation = computed(() => filterReason.value?.bucket === "pending_confirmation");
const canRefreshPendingEvidence = computed(() => isPendingConfirmation.value && props.job.source_platform === "boss");
const scoreReason = computed(() => parseScoreReasonJson(props.job.score_reason_json));
const filterReasonText = computed(() => formatFilterReasonSummary(filterReason.value));
const filterProfilePassed = computed(() => filterReason.value?.eligible === true || props.job.filter_eligible === true);
const filterProfileTraceText = computed(() => {
  if (!filterReason.value) return filterProfilePassed.value ? "通过筛选规则" : "暂无筛选规则结果";
  const summary = formatFilterReasonSummary(filterReason.value);
  if (filterReason.value.eligible === true && (summary === "不满足筛选画像" || summary === "不满足筛选规则")) return "通过筛选规则";
  if (filterReason.value.eligible === true) return `通过筛选规则；${summary}`;
  return summary;
});
const scoreReasonText = computed(() => formatScoreReasonSummary(scoreReason.value));
const filterBlockedReasons = computed(() => filterReason.value?.blocked_by ?? []);
const filterMatchedPreferences = computed(() => filterReason.value?.matched_preferences ?? []);
const filterMissingPreferences = computed(() => filterReason.value?.missing_preferences ?? []);
const filterDimensions = computed(() => filterReason.value?.dimensions);
const filterPreferenceSummary = computed(() => formatPreferenceSignals(filterMatchedPreferences.value, 4));
const filterMissingSummary = computed(() => formatPreferenceSignals(filterMissingPreferences.value, 4));
const scoreWeights = computed(() => scoreReason.value?.weights);
const scoreResumeMatchedStack = computed(() => scoreReason.value?.resume?.matched_stack ?? []);
const scoreResumeMatchedDirection = computed(() => scoreReason.value?.resume?.matched_direction ?? []);
const scoreResumeEvidence = computed(() => scoreReason.value?.resume?.matched_resume_evidence ?? []);
const scoreResumeExperienceFit = computed(() => scoreReason.value?.resume?.experience_fit?.trim() ?? "");
const scoreResumeMissingPoints = computed(() => scoreReason.value?.resume?.missing_points ?? []);
const scoreResumeConfidence = computed(() => scoreReason.value?.resume?.confidence);
const scoreResumeStrengths = computed(() => scoreReason.value?.resume?.strengths ?? []);
const scoreResumeGaps = computed(() => scoreReason.value?.resume?.gaps ?? []);
const scoreResumeKeywords = computed(() => scoreReason.value?.resume?.keywordSuggestions ?? []);
const scoreResumeRiskNotes = computed(() => scoreReason.value?.resume?.riskNotes ?? []);
const scoreDimensionSummary = computed(() => {
  const parts: string[] = [];
  if (scoreResumeMatchedDirection.value.length > 0) parts.push(`方向：${scoreResumeMatchedDirection.value.slice(0, 3).join("、")}`);
  if (scoreResumeMatchedStack.value.length > 0) parts.push(`技术栈：${scoreResumeMatchedStack.value.slice(0, 3).join("、")}`);
  if (scoreResumeExperienceFit.value) parts.push(`经验：${scoreResumeExperienceFit.value}`);
  return parts.join("；");
});
const scoreCompanyRiskFlags = computed(() => scoreReason.value?.company?.risk_flags ?? []);
const scoreCompanyEvidence = computed(() => scoreReason.value?.company?.evidence ?? []);
const scoreCompanyConfidence = computed(() => scoreReason.value?.company?.confidence);
const isApplicationReady = computed(() => props.job.review_status === "ready_to_apply" || props.job.review_status === "applied");
const canGenerateGreeting = computed(() => isApplicationReady.value);
const hasResumeMatchReport = computed(
  () => typeof props.job.resume_match_score === "number" && Number.isFinite(props.job.resume_match_score),
);
const hasGreetingDraft = computed(() => props.greetingDraft.trim().length > 0);
const canEditGreetingDraft = computed(() => isApplicationReady.value || hasGreetingDraft.value);
const resumeWorkspaceStatusLoaded = computed(() => props.resumeWorkspaceStatus !== undefined);
const hasLinkedResumeWorkspace = computed(() => !!props.resumeWorkspaceStatus);
const hasFinalResume = computed(() => props.resumeWorkspaceStatus?.has_final_resume === true);
const hasExportedPdf = computed(() => !!props.resumeWorkspaceStatus?.last_exported_pdf_path?.trim());
const resumeWorkspaceChecklistDetail = computed(() => {
  const status = props.resumeWorkspaceStatus;
  if (status === undefined) return "展开岗位后检查工作区状态";
  if (!status) return "未找到联动工作区，可进入定制简历";
  const parts = [
    `工作区 ${status.title}`,
    `确认模块 ${status.confirmed_modules}/4`,
    status.has_final_resume ? "最终稿已生成" : "最终稿待生成",
  ];
  if (status.last_exported_pdf_path) parts.push(`PDF ${status.last_exported_pdf_path}`);
  return parts.join(" / ");
});
const finalResumeChecklistDetail = computed(() => {
  const status = props.resumeWorkspaceStatus;
  if (status === undefined) return "展开岗位后检查最终稿和 PDF";
  if (!status) return "未找到联动工作区";
  const parts = [
    status.has_final_resume ? "最终稿已生成" : "最终稿待生成",
    status.last_exported_pdf_path ? `PDF ${status.last_exported_pdf_path}` : "PDF 待导出",
  ];
  if (status.last_exported_pdf_at) parts.push(`导出 ${formatDate(status.last_exported_pdf_at)}`);
  return parts.join(" / ");
});
const canRestoreReviewCandidate = computed(
  () =>
    props.job.review_status === "ignored" ||
    props.job.review_status === "applied" ||
    props.job.communication_status === "read_no_reply" ||
    props.job.communication_status === "rejected" ||
    props.job.communication_status === "manual_not_fit",
);
const hasBlacklistFilter = computed(
  () =>
    props.job.company_blacklisted ||
    props.job.job_blacklisted ||
    props.job.keyword_blacklisted ||
    filterBlockedReasons.value.some((reason) => reason.rule_type.endsWith("_blacklist")),
);
const hasProfileFilter = computed(
  () =>
    props.job.filter_eligible === false &&
    filterBlockedReasons.value.some(
      (reason) =>
        !reason.rule_type.endsWith("_blacklist") &&
        !["review_status", "communication_status", "company_review_status"].includes(reason.rule_type),
    ),
);
const hasCompanyStateFilter = computed(
  () =>
    props.job.company_review_status === "manual_not_fit" ||
    filterBlockedReasons.value.some((reason) => reason.rule_type === "company_review_status"),
);
const hasTerminalStateFilter = computed(
  () =>
    canRestoreReviewCandidate.value ||
    filterBlockedReasons.value.some((reason) => reason.rule_type === "review_status" || reason.rule_type === "communication_status"),
);
const filterNextActions = computed<FilterNextAction[]>(() => {
  const actions: FilterNextAction[] = [];
  if (hasProfileFilter.value) {
    actions.push({
      key: "filter-profile",
      label: "去采集配置",
      title: "跳到采集配置，统一调整采后规则后重新计算",
    });
  }
  if (hasBlacklistFilter.value) {
    actions.push({
      key: "blacklist",
      label: "查看黑名单",
      title: "跳到黑名单管理，核对公司、职位或关键词黑名单",
    });
  }
  if (hasCompanyStateFilter.value && props.job.brand_name) {
    actions.push({
      key: "company",
      label: "恢复公司",
      title: "把公司状态恢复为待判断；同公司岗位会重新参与后续筛选",
    });
  }
  if (hasTerminalStateFilter.value) {
    actions.push({
      key: "candidate",
      label: "恢复候选",
      title: "恢复为待审核和未打招呼；仍会继续受采后规则、黑名单和公司状态过滤",
    });
  }
  return actions;
});
const applicationChecklist = computed(() => [
  {
    label: "人工确认",
    ready: isApplicationReady.value,
    detail: isApplicationReady.value ? reviewStatusLabel(props.job.review_status) : "待标记准备投递",
  },
  {
    label: "采后规则",
    ready: filterProfilePassed.value && filterBlockedReasons.value.length === 0,
    detail: filterProfileTraceText.value,
  },
  {
    label: "简历工作区",
    ready: resumeWorkspaceStatusLoaded.value ? hasLinkedResumeWorkspace.value : false,
    detail: resumeWorkspaceChecklistDetail.value,
  },
  {
    label: "最终简历 / PDF",
    ready: hasFinalResume.value && hasExportedPdf.value,
    detail: finalResumeChecklistDetail.value,
  },
  {
    label: "简历匹配报告",
    ready: hasResumeMatchReport.value,
    detail: hasResumeMatchReport.value ? `Resume ${formatScore(props.job.resume_match_score)}` : "待分析",
  },
  {
    label: "打招呼草稿",
    ready: hasGreetingDraft.value,
    detail: hasGreetingDraft.value ? "已生成可编辑" : "待 AI 生成或手动粘贴",
  },
]);
const applicationReadinessGaps = computed(() =>
  applicationChecklist.value
    .filter((item) => !item.ready)
    .map((item) => `${item.label}：${item.detail}`),
);
const applicationReadinessSummary = computed(() =>
  applicationReadinessGaps.value.length === 0 ? "关键材料已就绪，仍需人工核对原平台动作。" : `仍有 ${applicationReadinessGaps.value.length} 项待补齐`,
);
const applicationNextActions = computed<ApplicationNextAction[]>(() => {
  const actions: ApplicationNextAction[] = [];
  if (!isApplicationReady.value) {
    actions.push({
      key: "mark-ready",
      label: "标记准备投递",
      title: "人工确认岗位后进入投递准备；不会自动发送或投递",
    });
  }
  if (!hasResumeMatchReport.value) {
    actions.push({
      key: "ai-analysis",
      label: "去 AI 分析",
      title: "生成简历匹配报告后再回到人工确认；不会自动投递",
    });
  }
  actions.push({
    key: "open-source-url",
    label: "打开来源",
    title: "打开原平台职位页供人工确认或手动投递；不会自动发送或投递",
  });
  actions.push({
    key: "resume-workspace",
    label: hasLinkedResumeWorkspace.value ? "打开简历工作区" : "创建联动简历",
    title: hasLinkedResumeWorkspace.value
      ? "打开当前岗位已绑定的简历工作区，继续定制简历并导出 PDF"
      : "创建绑定当前岗位的简历工作区，围绕岗位定制简历并导出 PDF",
  });
  if (isApplicationReady.value && !hasGreetingDraft.value) {
    actions.push({
      key: "generate-greeting",
      label: "定制打招呼",
      title: "基于 JD 和候选人证据生成打招呼草稿；不会自动发送",
    });
  }
  if (isApplicationReady.value) {
    actions.push({
      key: "copy-application-packet",
      label: "复制材料包",
      title: "复制本地投递材料包；不会把岗位自动改为已投递",
    });
  }
  if (isApplicationReady.value && hasGreetingDraft.value) {
    actions.push({
      key: "copy-greeting",
      label: "复制并标记未读",
      title: "复制草稿后仅记录已打招呼未读，不会自动发送",
    });
  }
  if (isApplicationReady.value && props.job.review_status !== "applied") {
    actions.push({
      key: "mark-applied",
      label: "标记已投递",
      title: "用户在外部平台手动投递后，只记录本地已投递状态",
    });
  }
  return actions;
});

const reviewActions: Array<{ status: ReviewStatus; label: string }> = [
  { status: "favorited", label: "收藏" },
  { status: "ready_to_apply", label: "准备投递" },
  { status: "applied", label: "已投递" },
  { status: "ignored", label: "忽略" },
];

const communicationActions: Array<{ status: CommunicationStatus; label: string }> = [
  { status: "not_contacted", label: "未打招呼" },
  { status: "greeted_unread", label: "未读" },
  { status: "read_no_reply", label: "已读未回" },
  { status: "replied", label: "已回复" },
  { status: "rejected", label: "已拒绝" },
  { status: "manual_not_fit", label: "岗位不合适" },
];

function triggerFilterNextAction(action: FilterNextAction): void {
  switch (action.key) {
    case "filter-profile":
      emit("open-filter-profile-config", props.job);
      return;
    case "blacklist":
      emit("open-blacklist-management", props.job);
      return;
    case "company":
      emit("update-company-review", props.job, "pending");
      return;
    case "candidate":
      emit("restore-review-candidate", props.job);
      return;
  }
}

function triggerApplicationNextAction(action: ApplicationNextAction): void {
  switch (action.key) {
    case "mark-ready":
      emit("update-review", props.job, "ready_to_apply");
      return;
    case "ai-analysis":
      emit("go-ai", props.job.encrypt_job_id);
      return;
    case "open-source-url":
      emit("open-source-url", props.job);
      return;
    case "resume-workspace":
      emit("go-resume-workspace", props.job.encrypt_job_id);
      return;
    case "generate-greeting":
      emit("generate-greeting", props.job);
      return;
    case "copy-application-packet":
      emit("copy-application-packet", props.job);
      return;
    case "copy-greeting":
      emit("copy-greeting", props.job);
      return;
    case "mark-applied":
      emit("update-review", props.job, "applied");
      return;
  }
}
</script>

<template>
  <div>
    <div
      class="flex cursor-pointer items-center gap-3 py-2.5 transition-colors"
      :class="[rowPaddingClass, expanded ? 'bg-card-hover/80' : 'hover:bg-card-hover/60']"
      @click="$emit('toggle-detail', job.encrypt_job_id)"
    >
      <svg
        class="h-3.5 w-3.5 shrink-0 text-content-muted transition-transform duration-200"
        :class="expanded ? 'rotate-90' : ''"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fill-rule="evenodd"
          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
          clip-rule="evenodd"
        />
      </svg>

      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span class="truncate text-sm font-medium text-content-primary" style="max-width: 220px;">{{ job.position_name ?? '-' }}</span>
        <span class="truncate text-sm text-content-secondary" style="max-width: 160px;">{{ job.brand_name ?? '-' }}</span>
        <span v-if="job.boss_name" class="truncate text-xs text-content-muted" style="max-width: 120px;">{{ job.boss_name }}</span>
        <span v-if="job.boss_active_status" class="ui-badge bg-sky-400/10 text-sky-300 ring-sky-400/20">
          {{ job.boss_active_status }}
        </span>
        <span class="ui-badge">{{ job.city_name ?? '-' }}</span>
        <span class="ui-badge bg-emerald-400/10 text-emerald-300 ring-emerald-400/20">{{ job.salary_desc ?? '-' }}</span>
        <span
          v-if="job.filter_eligible === false"
          class="ui-badge bg-rose-500/10 text-rose-300 ring-rose-400/20"
          :title="filterReasonText"
        >
          规则过滤
        </span>
        <span
          v-if="aiPostCollectionJudgement"
          class="ui-badge bg-violet-400/10 text-violet-200 ring-violet-400/20"
          :title="aiPostCollectionJudgementText"
        >
          AI {{ filterBucketLabel(aiPostCollectionJudgement.bucket) }}
        </span>
        <span
          v-else-if="filterProfilePassed"
          class="ui-badge bg-emerald-400/10 text-emerald-300 ring-emerald-400/20"
          :title="filterProfileTraceText"
        >
          规则通过
        </span>
        <span
          v-if="job.review_status && job.review_status !== 'pending'"
          class="ui-badge bg-cyan-400/10 text-cyan-300 ring-cyan-400/20"
        >
          {{ reviewStatusLabel(job.review_status) }}
        </span>
        <span
          v-if="job.communication_status && job.communication_status !== 'not_contacted'"
          class="ui-badge bg-amber-400/10 text-amber-300 ring-amber-400/20"
        >
          {{ job.communication_status === 'greeted_unread' ? '未读回流' : communicationStatusLabel(job.communication_status) }}
          <template v-if="job.communication_status === 'greeted_unread' && job.last_greeted_at">
            · 上次打招呼 {{ formatDate(job.last_greeted_at) }}
          </template>
        </span>
        <span
          v-if="job.company_review_status === 'manual_not_fit'"
          class="ui-badge bg-orange-500/10 text-orange-300 ring-orange-400/20"
          :title="job.company_review_notes ?? undefined"
        >
          {{ companyReviewStatusLabel(job.company_review_status) }}
        </span>
        <span
          v-if="job.company_negative_communication_count > 0"
          class="ui-badge bg-orange-500/10 text-orange-300 ring-orange-400/20"
          :title="`同公司已有 ${job.company_negative_communication_count} 条负面沟通记录，可拉黑公司沉淀判断`"
        >
          同公司沟通风险 {{ job.company_negative_communication_count }}
        </span>
        <span
          v-if="job.company_blacklisted || job.job_blacklisted || job.keyword_blacklisted"
          class="ui-badge bg-red-500/10 text-red-300 ring-red-400/20"
          :title="job.blacklist_reason ?? undefined"
        >
          黑名单
        </span>
        <span
          class="ui-badge bg-sky-400/10 text-sky-300 ring-sky-400/20"
          :title="scoreReasonText"
        >
          Final {{ formatScore(job.final_score) }}
        </span>
        <span class="text-xs text-content-muted">{{ job.experience_name ?? '' }}</span>
        <span class="text-xs text-content-muted">{{ job.degree_name ?? '' }}</span>
      </div>

      <div class="flex shrink-0 items-center gap-1.5" @click.stop>
        <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="$emit('go-ai', job.encrypt_job_id)">AI</button>
        <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="$emit('go-resume-workspace', job.encrypt_job_id)">简历</button>
        <button
          v-if="canRefreshPendingEvidence"
          class="ui-btn-secondary px-2.5 py-1 text-xs"
          :disabled="pendingEvidenceRefreshing"
          @click="$emit('refresh-pending-evidence', job)"
        >
          {{ pendingEvidenceRefreshing ? '补证据中' : '补证据' }}
        </button>
        <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="$emit('copy-link', job)">复制</button>
        <button
          v-if="allowDelete"
          class="ui-btn-danger px-2 py-1 text-xs"
          title="删除此职位"
          @click="$emit('delete', job)"
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd" />
          </svg>
        </button>
      </div>
    </div>

    <div v-if="expanded" class="bg-card-alt/70 py-4" :class="detailPaddingClass">
      <div v-if="allowReviewActions" class="mb-4 space-y-3 rounded-xl border border-border/10 bg-card/50 p-3">
        <div class="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span class="font-medium text-content-secondary">审核：{{ reviewStatusLabel(job.review_status) }}</span>
          <span>沟通：{{ communicationStatusLabel(job.communication_status) }}</span>
          <span>平台：{{ job.source_platform || 'boss' }}</span>
          <span>方式：{{ COLLECTION_METHOD_LABELS[job.collection_method] ?? job.collection_method }}</span>
          <span
            v-if="job.dedup_key"
            class="inline-block truncate align-bottom"
            style="max-width: 18rem;"
            :title="job.dedup_key"
          >
            职位 ID/去重：{{ job.dedup_key }}
          </span>
          <span
            v-if="job.source_url"
            class="inline-block truncate align-bottom"
            style="max-width: 18rem;"
            :title="job.source_url"
          >
            来源链接：{{ job.source_url }}
          </span>
          <span v-if="job.company_review_status && job.company_review_status !== 'pending'">
            公司：{{ companyReviewStatusLabel(job.company_review_status) }}
          </span>
          <span v-if="job.company_negative_communication_count > 0">
            同公司负面沟通：{{ job.company_negative_communication_count }} 次
            <template v-if="job.latest_company_negative_communication_status">
              ，最近 {{ communicationStatusLabel(job.latest_company_negative_communication_status) }}
            </template>
            <template v-if="job.latest_company_negative_communication_at">
              / {{ formatDate(job.latest_company_negative_communication_at) }}
            </template>
          </span>
          <span v-if="job.last_greeted_at">上次打招呼：{{ formatDate(job.last_greeted_at) }}</span>
          <span v-if="job.review_updated_at">沟通更新：{{ formatDate(job.review_updated_at) }}</span>
          <span v-if="job.review_notes">备注：{{ job.review_notes }}</span>
        </div>
        <div class="flex flex-wrap gap-2 text-xs">
          <span class="ui-badge bg-sky-400/10 text-sky-300 ring-sky-400/20">Final {{ formatScore(job.final_score) }}</span>
          <span class="ui-badge">Resume {{ formatScore(job.resume_match_score) }}</span>
          <span class="ui-badge">Preference {{ formatScore(job.preference_score) }}</span>
          <span class="ui-badge">Company {{ formatScore(job.company_score) }}</span>
          <span class="min-w-0 flex-1 text-content-muted">{{ scoreReasonText }}</span>
        </div>
        <div class="grid gap-2 text-xs text-content-muted sm:grid-cols-2 xl:grid-cols-4">
          <div v-if="filterBlockedReasons.length" class="space-y-1">
            <div class="font-medium text-content-secondary">硬限制</div>
            <div class="space-y-1">
              <div v-for="reason in filterBlockedReasons" :key="`${reason.rule_type}-${reason.field}-${reason.value}-${reason.reason}`">
                {{ reason.reason }}
              </div>
            </div>
          </div>
          <div v-if="filterPreferenceSummary || filterMissingSummary" class="space-y-1">
            <div class="font-medium text-content-secondary">偏好摘要</div>
            <div v-if="filterPreferenceSummary">偏好命中：{{ filterPreferenceSummary }}</div>
            <div v-if="filterMissingSummary">偏好缺失：{{ filterMissingSummary }}</div>
          </div>
          <div v-if="aiPostCollectionJudgement" class="space-y-1">
            <div class="font-medium text-content-secondary">AI 采后判断</div>
            <div>{{ aiPostCollectionJudgementText }}</div>
            <div v-if="aiPostCollectionJudgement.evidence?.length">证据：{{ aiPostCollectionJudgement.evidence.join("；") }}</div>
            <div v-if="aiPostCollectionJudgement.risks?.length">风险：{{ aiPostCollectionJudgement.risks.join("；") }}</div>
          </div>
          <div v-if="filterDimensions" class="space-y-1">
            <div class="font-medium text-content-secondary">维度摘要</div>
            <div class="space-y-0.5">
              <div v-if="filterDimensions.detected_work_modes?.length">工作方式：{{ filterDimensions.detected_work_modes.join("、") }}</div>
              <div v-if="filterDimensions.city_name">城市：{{ filterDimensions.city_name }}</div>
              <div v-if="filterDimensions.source_platform">来源：{{ filterDimensions.source_platform }}</div>
              <div v-if="filterDimensions.boss_active_status">Boss 活跃：{{ filterDimensions.boss_active_status }}</div>
              <div v-if="filterDimensions.review_status && filterDimensions.review_status !== 'pending'">审核：{{ reviewStatusLabel(filterDimensions.review_status as ReviewStatus) }}</div>
              <div v-if="filterDimensions.communication_status">沟通：{{ filterDimensions.communication_status }}</div>
              <div v-if="filterDimensions.company_review_status && filterDimensions.company_review_status !== 'pending'">公司状态：{{ companyReviewStatusLabel(filterDimensions.company_review_status as CompanyReviewStatus) }}</div>
              <div v-if="filterDimensions.salary_desc">薪资：{{ filterDimensions.salary_desc }}</div>
              <div v-if="filterDimensions.experience_name">经验：{{ filterDimensions.experience_name }}</div>
              <div v-if="filterDimensions.degree_name">学历：{{ filterDimensions.degree_name }}</div>
              <div v-if="filterDimensions.last_seen_at">采集：{{ formatDate(filterDimensions.last_seen_at) }}</div>
            </div>
          </div>
        </div>
        <div class="grid gap-2 text-xs text-content-muted sm:grid-cols-2 xl:grid-cols-4">
          <div v-if="scoreWeights" class="space-y-1">
            <div class="font-medium text-content-secondary">实际权重</div>
            <div class="space-y-0.5">
              <div v-if="typeof scoreWeights.resume === 'number'">Resume：{{ scoreWeights.resume.toFixed(2) }}</div>
              <div v-if="typeof scoreWeights.preference === 'number'">Preference：{{ scoreWeights.preference.toFixed(2) }}</div>
              <div v-if="typeof scoreWeights.company === 'number'">Company：{{ scoreWeights.company.toFixed(2) }}</div>
            </div>
          </div>
          <div v-if="scoreResumeMatchedStack.length || scoreResumeMatchedDirection.length || scoreResumeExperienceFit || typeof scoreResumeConfidence === 'number'" class="space-y-1">
            <div class="font-medium text-content-secondary">Resume 结构化匹配</div>
            <div v-if="scoreResumeMatchedStack.length">技术栈：{{ scoreResumeMatchedStack.join("、") }}</div>
            <div v-if="scoreResumeMatchedDirection.length">方向：{{ scoreResumeMatchedDirection.join("、") }}</div>
            <div v-if="scoreResumeExperienceFit">经验：{{ scoreResumeExperienceFit }}</div>
            <div v-if="typeof scoreResumeConfidence === 'number'">置信度：{{ Math.round(scoreResumeConfidence * 100) }}%</div>
          </div>
          <div v-if="scoreResumeEvidence.length" class="space-y-1">
            <div class="font-medium text-content-secondary">简历证据</div>
            <div>{{ scoreResumeEvidence.join("；") }}</div>
          </div>
          <div v-if="scoreResumeMissingPoints.length" class="space-y-1">
            <div class="font-medium text-content-secondary">未覆盖要求</div>
            <div>{{ scoreResumeMissingPoints.join("；") }}</div>
          </div>
          <div v-if="scoreResumeStrengths.length" class="space-y-1">
            <div class="font-medium text-content-secondary">简历匹配依据</div>
            <div>{{ scoreResumeStrengths.join("；") }}</div>
          </div>
          <div v-if="scoreResumeGaps.length" class="space-y-1">
            <div class="font-medium text-content-secondary">简历缺口</div>
            <div>{{ scoreResumeGaps.join("；") }}</div>
          </div>
          <div v-if="scoreResumeKeywords.length || scoreResumeRiskNotes.length" class="space-y-1">
            <div class="font-medium text-content-secondary">简历建议</div>
            <div v-if="scoreResumeKeywords.length">关键词：{{ scoreResumeKeywords.join("、") }}</div>
            <div v-if="scoreResumeRiskNotes.length">风险：{{ scoreResumeRiskNotes.join("；") }}</div>
          </div>
          <div v-if="scoreDimensionSummary" class="space-y-1">
            <div class="font-medium text-content-secondary">评分摘要</div>
            <div>{{ scoreDimensionSummary }}</div>
          </div>
          <div v-if="scoreCompanyRiskFlags.length || scoreCompanyEvidence.length" class="space-y-1">
            <div class="font-medium text-content-secondary">公司风险依据</div>
            <div v-if="scoreCompanyRiskFlags.length">标签：{{ scoreCompanyRiskFlags.map(companyRiskFlagLabel).join("、") }}</div>
            <div v-if="scoreCompanyEvidence.length">{{ scoreCompanyEvidence.join("；") }}</div>
            <div v-if="typeof scoreCompanyConfidence === 'number'">
              置信度：{{ Math.round(scoreCompanyConfidence * 100) }}%
            </div>
          </div>
        </div>
        <div
          v-if="filterNextActions.length"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-xs"
          @click.stop
        >
          <span class="font-semibold text-amber-200">过滤下一步</span>
          <button
            v-for="action in filterNextActions"
            :key="action.key"
            class="ui-btn-secondary px-2.5 py-1 text-xs"
            :title="action.title"
            @click="triggerFilterNextAction(action)"
          >
            {{ action.label }}
          </button>
        </div>
        <div class="flex flex-wrap gap-2" @click.stop>
          <button
            v-if="canRestoreReviewCandidate"
            class="ui-btn-secondary px-2.5 py-1 text-xs"
            title="恢复为待审核和未打招呼；仍会继续受采后规则、黑名单和公司状态过滤"
            @click="$emit('restore-review-candidate', job)"
          >
            恢复候选
          </button>
          <button
            v-for="action in reviewActions"
            :key="action.status"
            class="ui-btn-secondary px-2.5 py-1 text-xs"
            @click="$emit('update-review', job, action.status)"
          >
            {{ action.label }}
          </button>
          <button
            v-for="action in communicationActions"
            :key="action.status"
            class="ui-btn-secondary px-2.5 py-1 text-xs"
            @click="$emit('update-communication', job, action.status)"
          >
            {{ action.label }}
          </button>
          <button
            class="ui-btn-secondary px-2.5 py-1 text-xs"
            @click="$emit('update-review-notes', job)"
          >
            编辑备注
          </button>
          <button
            class="ui-btn-secondary px-2.5 py-1 text-xs"
            :disabled="!job.brand_name"
            @click="$emit('update-company-review', job, 'manual_not_fit')"
          >
            公司不合适
          </button>
          <button
            v-if="job.company_review_status === 'manual_not_fit'"
            class="ui-btn-secondary px-2.5 py-1 text-xs"
            :disabled="!job.brand_name"
            @click="$emit('update-company-review', job, 'pending')"
          >
            恢复公司
          </button>
          <button
            class="ui-btn-danger px-2.5 py-1 text-xs"
            :disabled="!job.brand_name"
            @click="$emit('blacklist-company', job)"
          >
            {{ job.company_negative_communication_count > 0 ? "拉黑风险公司" : "拉黑公司" }}
          </button>
          <button class="ui-btn-danger px-2.5 py-1 text-xs" @click="$emit('blacklist-job', job)">拉黑职位</button>
          <button
            class="ui-btn-danger px-2.5 py-1 text-xs"
            :disabled="!job.position_name"
            @click="$emit('blacklist-keyword', job)"
          >
            拉黑关键词
          </button>
        </div>
        <div class="space-y-2 border-t border-border/10 pt-3" @click.stop>
          <div class="rounded-lg border border-border/10 bg-surface-secondary/40 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="text-xs font-semibold text-content-secondary">投递准备下一步</div>
                <div class="mt-1 text-xs text-content-muted">简历、打招呼文案和沟通记录都由用户确认后手动使用。</div>
              </div>
              <span
                class="ui-badge"
                :class="isApplicationReady ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20' : 'bg-amber-400/10 text-amber-300 ring-amber-400/20'"
              >
                {{ isApplicationReady ? "人工确认后" : "等待人工确认" }}
              </span>
            </div>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-for="action in applicationNextActions"
                :key="action.key"
                class="ui-btn-secondary px-2.5 py-1 text-xs"
                :disabled="action.key === 'generate-greeting' && greetingLoading"
                :title="action.title"
                @click="triggerApplicationNextAction(action)"
              >
                {{ action.key === "generate-greeting" && greetingLoading ? "生成中…" : action.label }}
              </button>
              <span v-if="isApplicationReady && !hasGreetingDraft" class="ui-badge">等待文案草稿</span>
            </div>
            <div class="mt-3 text-xs text-content-muted">
              {{ canGenerateGreeting ? "复制后仅记录已打招呼未读，不会自动发送。" : "先标记准备投递后生成；不会自动发送。" }}
            </div>
            <div
              class="mt-3 rounded-md border px-3 py-2 text-xs"
              :class="applicationReadinessGaps.length === 0 ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' : 'border-amber-400/20 bg-amber-400/10 text-amber-100'"
            >
              <div class="font-semibold">投递准备预检：{{ applicationReadinessSummary }}</div>
              <ul v-if="applicationReadinessGaps.length > 0" class="mt-1 space-y-0.5">
                <li v-for="gap in applicationReadinessGaps" :key="gap">- {{ gap }}</li>
              </ul>
            </div>
            <div class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <div class="text-xs font-semibold text-content-secondary sm:col-span-2 xl:col-span-4">投递准备清单</div>
              <div
                v-for="item in applicationChecklist"
                :key="item.label"
                class="rounded-md border border-border/10 bg-surface-secondary/50 px-2.5 py-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-content-secondary">{{ item.label }}</span>
                  <span
                    class="ui-badge"
                    :class="item.ready ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20' : 'bg-amber-400/10 text-amber-300 ring-amber-400/20'"
                  >
                    {{ item.ready ? "就绪" : "待补齐" }}
                  </span>
                </div>
                <div class="mt-1 text-xs text-content-muted">{{ item.detail }}</div>
              </div>
            </div>
          </div>
          <div v-if="canEditGreetingDraft" class="space-y-1">
            <div class="text-xs font-semibold text-content-secondary">可编辑打招呼草稿</div>
            <textarea
              class="ui-textarea min-h-20 w-full text-sm"
              placeholder="粘贴或编辑打招呼草稿；复制后仅记录已打招呼未读"
              :value="greetingDraft"
              @input="$emit('update-greeting-draft', job.encrypt_job_id, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
          <div v-if="greetingError" class="ui-status-danger space-y-2 p-3 text-xs">
            <div class="font-semibold">{{ greetingError.title }}</div>
            <div>{{ greetingError.hint }}</div>
            <pre class="whitespace-pre-wrap text-[11px] text-red-100/80">{{ greetingError.message }}</pre>
            <button
              class="ui-btn-secondary px-2.5 py-1 text-xs"
              :disabled="greetingLoading || !canGenerateGreeting"
              @click="$emit('generate-greeting', job)"
            >
              {{ greetingLoading ? "重试中…" : "重试打招呼" }}
            </button>
          </div>
          <div v-if="greeting" class="space-y-1 text-xs text-content-muted">
            <div v-if="greeting.overlapKeywords.length" class="flex flex-wrap gap-1">
              <span v-for="keyword in greeting.overlapKeywords" :key="keyword" class="ui-badge">{{ keyword }}</span>
            </div>
            <div v-if="greeting.jobEvidence.length">岗位依据：{{ greeting.jobEvidence.join("；") }}</div>
            <div v-if="greeting.candidateEvidence.length">候选人依据：{{ greeting.candidateEvidence.join("；") }}</div>
            <div v-if="greeting.editNotes.length">编辑提示：{{ greeting.editNotes.join("；") }}</div>
          </div>
        </div>
      </div>

      <div v-if="detailLoading" class="flex items-center gap-2 text-sm text-content-muted">
        <svg class="h-4 w-4 animate-spin text-content-muted" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        加载详情…
      </div>
      <div v-else-if="!detail" class="text-sm text-content-muted">未采集到该职位的详情数据。</div>
      <div v-else class="space-y-3">
        <div class="flex flex-wrap gap-2">
          <span v-if="detail.jobInfo?.jobStatusDesc" class="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-amber-500/20">{{ detail.jobInfo.jobStatusDesc }}</span>
          <span v-if="detail.bossInfo?.activeTimeDesc" class="ui-badge">{{ detail.bossInfo.activeTimeDesc }}</span>
        </div>
        <div v-if="detail.jobInfo?.postDescription">
          <h4 class="mb-1 text-xs font-semibold text-content-muted">职位描述</h4>
          <div class="max-w-none text-sm leading-relaxed text-content-secondary [&_a]:text-accent [&_a]:underline [&_b]:text-content-primary [&_h1]:text-content-primary [&_h2]:text-content-primary [&_h3]:text-content-primary [&_h4]:text-content-primary [&_li]:text-content-secondary [&_p]:text-content-secondary [&_strong]:text-content-primary" v-html="detail.jobInfo.postDescription" />
        </div>
        <div v-if="detail.jobInfo?.skills?.length || detail.jobInfo?.showSkills?.length">
          <h4 class="mb-1 text-xs font-semibold text-content-muted">技能要求</h4>
          <div class="flex flex-wrap gap-1">
            <span v-for="skill in (detail.jobInfo.skills?.length ? detail.jobInfo.skills : detail.jobInfo.showSkills) || []" :key="skill" class="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs text-blue-400">{{ skill }}</span>
          </div>
        </div>
        <div v-if="detail.jobInfo?.jobLabels?.length">
          <h4 class="mb-1 text-xs font-semibold text-content-muted">职位标签</h4>
          <div class="flex flex-wrap gap-1">
            <span v-for="label in detail.jobInfo.jobLabels" :key="label" class="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs text-violet-400">{{ label }}</span>
          </div>
        </div>
        <div v-if="detail.jobInfo?.address">
          <h4 class="mb-1 text-xs font-semibold text-content-muted">工作地址</h4>
          <p class="text-sm text-content-secondary">{{ detail.jobInfo.address }}</p>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-if="detail.brandComInfo || detail.brandInfo">
            <h4 class="mb-1 text-xs font-semibold text-content-muted">公司信息</h4>
            <dl class="space-y-0.5 text-sm">
              <div v-if="detail.brandComInfo?.brandName || detail.brandInfo?.brandName" class="flex gap-1.5"><dt class="text-content-muted">公司</dt><dd class="text-content-secondary">{{ detail.brandComInfo?.brandName ?? detail.brandInfo?.brandName }}</dd></div>
              <div v-if="detail.brandComInfo?.industryName || detail.brandInfo?.industryName" class="flex gap-1.5"><dt class="text-content-muted">行业</dt><dd class="text-content-secondary">{{ detail.brandComInfo?.industryName ?? detail.brandInfo?.industryName }}</dd></div>
              <div v-if="detail.brandComInfo?.scaleName || detail.brandInfo?.scaleName" class="flex gap-1.5"><dt class="text-content-muted">规模</dt><dd class="text-content-secondary">{{ detail.brandComInfo?.scaleName ?? detail.brandInfo?.scaleName }}</dd></div>
              <div v-if="detail.brandComInfo?.stageName || detail.brandInfo?.stage" class="flex gap-1.5"><dt class="text-content-muted">融资</dt><dd class="text-content-secondary">{{ detail.brandComInfo?.stageName ?? detail.brandInfo?.stage }}</dd></div>
            </dl>
          </div>
          <div v-if="detail.bossInfo">
            <h4 class="mb-1 text-xs font-semibold text-content-muted">招聘者</h4>
            <dl class="space-y-0.5 text-sm">
              <div v-if="detail.bossInfo.name || detail.bossInfo.bossName" class="flex gap-1.5"><dt class="text-content-muted">姓名</dt><dd class="text-content-secondary">{{ detail.bossInfo.name ?? detail.bossInfo.bossName }}</dd></div>
              <div v-if="detail.bossInfo.title || detail.bossInfo.bossTitle" class="flex gap-1.5"><dt class="text-content-muted">职称</dt><dd class="text-content-secondary">{{ detail.bossInfo.title ?? detail.bossInfo.bossTitle }}</dd></div>
              <div v-if="detail.bossInfo.activeTimeDesc" class="flex gap-1.5"><dt class="text-content-muted">活跃</dt><dd class="text-content-secondary">{{ detail.bossInfo.activeTimeDesc }}</dd></div>
            </dl>
          </div>
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/10 pt-2 text-xs text-content-muted">
          <span>最后采集: {{ formatDate(job.last_seen_at) }}</span>
          <span>方式: {{ COLLECTION_METHOD_LABELS[job.collection_method] ?? job.collection_method }}</span>
          <span v-if="job.boss_active_status">Boss 活跃: {{ job.boss_active_status }}</span>
          <span>审核: {{ reviewStatusLabel(job.review_status) }}</span>
          <span>沟通: {{ communicationStatusLabel(job.communication_status) }}</span>
          <span>Final Score: {{ formatScore(job.final_score) }}</span>
          <span>Resume Match: {{ formatScore(job.resume_match_score) }}</span>
          <span>Preference: {{ formatScore(job.preference_score) }}</span>
          <span>Company: {{ formatScore(job.company_score) }}</span>
          <span v-if="job.last_greeted_at">上次打招呼: {{ formatDate(job.last_greeted_at) }}</span>
          <span v-if="job.review_updated_at">沟通更新: {{ formatDate(job.review_updated_at) }}</span>
          <span v-if="job.company_blacklisted || job.job_blacklisted || job.keyword_blacklisted" class="text-red-300">
            黑名单: {{ job.blacklist_reason ?? "已加入黑名单" }}
          </span>
          <span v-if="job.company_review_status === 'manual_not_fit'" class="text-orange-300">
            公司状态: {{ job.company_review_notes ?? "公司不合适" }}
          </span>
          <span v-if="job.company_negative_communication_count > 0" class="text-orange-300">
            同公司负面沟通: {{ job.company_negative_communication_count }} 次
          </span>
          <span v-if="filterProfilePassed" class="text-emerald-300">
            采后规则: {{ filterProfileTraceText }}
          </span>
          <span v-if="job.filter_eligible === false" class="text-rose-300">
            过滤原因: {{ filterReasonText }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
