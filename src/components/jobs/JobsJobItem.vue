<script setup lang="ts">
import { computed, ref, toRefs, watch } from "vue";
import { ChevronDown, FileText } from "lucide-vue-next";
import {
  aiAuditStatusLabel,
  companyReviewStatusLabel,
  communicationStatusLabel,
  reviewStatusLabel,
  sourcePlatformLabel,
  type GreetingErrorState,
  type CommunicationStatus,
  type CompanyReviewStatus,
  type JobDetail,
  type JobRow,
  type ReviewStatus,
} from "../../lib/jobs";
import { formatDate } from "../../lib/jobsPageHelpers";
import type { ResumeJobLinkStatus } from "../../lib/resumeLibrary";
import UiActionMenu from "../ui/UiActionMenu.vue";

const props = withDefaults(
  defineProps<{
    job: JobRow;
    expanded: boolean;
    detailLoading: boolean;
    detail: JobDetail | null;
    rowPaddingClass?: string;
    detailPaddingClass?: string;
    aiAuditStatusOverride?: string | null;
    greetingDraft?: string;
    greetingError?: GreetingErrorState;
    greetingLoading?: boolean;
    optimizedResumeGenerating?: boolean;
    resumeStatus?: ResumeJobLinkStatus;
  }>(),
  {
    rowPaddingClass: "px-4",
    detailPaddingClass: "px-10",
    aiAuditStatusOverride: null,
    greetingDraft: "",
    greetingError: undefined,
    greetingLoading: false,
    optimizedResumeGenerating: false,
    resumeStatus: undefined,
  },
);

const { job, expanded, detailLoading, detail, rowPaddingClass, detailPaddingClass } = toRefs(props);

const emit = defineEmits<{
  (e: "toggle-detail", jobId: string): void;
  (e: "copy-link", job: JobRow): void;
  (e: "open-source-url", job: JobRow): void;
  (e: "update-review", job: JobRow, status: ReviewStatus): void;
  (e: "restore-review-candidate", job: JobRow): void;
  (e: "update-communication", job: JobRow, status: CommunicationStatus): void;
  (e: "update-review-notes", job: JobRow): void;
  (e: "update-company-review", job: JobRow, status: CompanyReviewStatus): void;
  (e: "generate-greeting", job: JobRow): void;
  (e: "copy-greeting", job: JobRow): void;
  (e: "generate-optimized-resume", job: JobRow): void;
  (e: "open-resume", job: JobRow): void;
}>();

type MoreActionValue = "notes" | "company_not_fit" | "company_restore";

const aiAuditStatus = computed(() =>
  props.aiAuditStatusOverride || props.job.ai_audit_status || (props.job.filter_eligible === false ? "rejected" : "not_judged"),
);
const aiAuditBadgeClass = computed(() => {
  if (aiAuditStatus.value === "passed") return "!bg-white !text-emerald-700 !ring-emerald-200";
  if (aiAuditStatus.value === "rejected" || aiAuditStatus.value === "failed") return "!bg-white !text-rose-700 !ring-rose-200";
  if (aiAuditStatus.value === "pending_confirmation") return "!bg-white !text-amber-700 !ring-amber-200";
  if (aiAuditStatus.value === "processing") return "!bg-white !text-blue-700 !ring-blue-200";
  return "!bg-white !text-slate-600 !ring-slate-200";
});
const aiAuditReasonText = computed(() => {
  const summary = props.job.ai_audit_summary?.trim();
  if (aiAuditStatus.value === "processing") return summary || "AI 正在审核";
  if (aiAuditStatus.value === "passed") return summary || "AI 已通过筛选";
  if (aiAuditStatus.value === "pending_confirmation") return summary || "AI 待确认";
  if (aiAuditStatus.value === "failed") return summary || "AI 审核失败";
  if (aiAuditStatus.value === "rejected") return summary || "AI 未通过筛选";
  return summary || "待 AI 判断";
});
const aiPostCollectionJudgementText = computed(() => {
  if (props.aiAuditStatusOverride) return `AI 审核：${aiAuditStatusLabel(props.aiAuditStatusOverride)}`;
  return props.job.ai_audit_summary || `AI 审核：${aiAuditStatusLabel(aiAuditStatus.value)}`;
});

const canGenerateGreeting = computed(
  () => props.job.review_status === "ready_to_apply" || props.job.review_status === "applied",
);
const hasGreetingDraft = computed(() => props.greetingDraft.trim().length > 0);
const resumeBadgeText = computed(() => {
  if (props.resumeStatus?.resume_title) return `简历：${props.resumeStatus.resume_title}`;
  if (props.resumeStatus?.default_resume_title) return `默认：${props.resumeStatus.default_resume_title}`;
  return "关联简历";
});
const resumeBadgeClass = computed(() =>
  props.resumeStatus?.resume_id
    ? "!bg-white !text-emerald-700 !ring-emerald-200"
    : props.resumeStatus?.default_resume_id
      ? "!bg-white !text-amber-700 !ring-amber-200"
      : "!bg-white !text-slate-600 !ring-slate-200",
);
const descriptionOpen = ref(false);

function handleReviewAction(value: string): void {
  if (value === "restore") {
    emit("restore-review-candidate", props.job);
    return;
  }
  emit("update-review", props.job, value as ReviewStatus);
}

function handleCommunicationAction(value: string): void {
  emit("update-communication", props.job, value as CommunicationStatus);
}

function handleMoreAction(value: string): void {
  const action = value as MoreActionValue;
  if (action === "notes") {
    emit("update-review-notes", props.job);
    return;
  }
  if (action === "company_not_fit") {
    emit("update-company-review", props.job, "manual_not_fit");
    return;
  }
  if (action === "company_restore") {
    emit("update-company-review", props.job, "pending");
  }
}

watch(
  () => expanded.value,
  (value) => {
    if (!value) {
      descriptionOpen.value = false;
    }
  },
);
</script>

<template>
  <div>
    <div
      class="flex cursor-pointer items-center gap-3 py-2.5 transition-colors"
      :class="[rowPaddingClass, expanded ? 'bg-slate-50' : 'hover:bg-slate-50']"
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
        <span class="ui-badge !bg-white !text-blue-700 !ring-blue-200">{{ sourcePlatformLabel(job.source_platform) }}</span>
        <span class="ui-badge !bg-white !text-cyan-700 !ring-cyan-200">岗位状态：{{ reviewStatusLabel(job.review_status) }}</span>
        <span
          class="ui-badge"
          :class="aiAuditBadgeClass"
          :title="aiPostCollectionJudgementText"
        >
          AI 结果：{{ aiAuditStatusLabel(aiAuditStatus) }}
        </span>
        <button
          type="button"
          class="ui-badge inline-flex items-center gap-1 transition-colors hover:bg-slate-50"
          :class="resumeBadgeClass"
          @click.stop="$emit('open-resume', job)"
        >
          <FileText class="h-3 w-3" aria-hidden="true" />
          {{ resumeBadgeText }}
        </button>
      </div>

      <div class="flex shrink-0 items-center gap-1.5" @click.stop>
        <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="$emit('copy-link', job)">复制</button>
        <button class="ui-btn-secondary px-2.5 py-1 text-xs" @click="$emit('open-source-url', job)">岗位详情</button>
      </div>
    </div>

    <div v-if="expanded" class="bg-white py-4" :class="detailPaddingClass">
      <div class="mb-4 space-y-3 rounded-lg border border-border/90 bg-white p-3">
        <div class="flex flex-wrap items-center gap-2 text-xs text-content-muted">
          <span class="font-medium text-content-secondary">岗位状态：{{ reviewStatusLabel(job.review_status) }}</span>
          <span>平台：{{ sourcePlatformLabel(job.source_platform) }}</span>
          <span>AI 结果：{{ aiAuditStatusLabel(aiAuditStatus) }}</span>
          <span v-if="aiAuditStatus !== 'not_judged'" :class="aiAuditStatus === 'failed' || aiAuditStatus === 'rejected' ? 'text-rose-700' : 'text-content-muted'">
            原因：{{ aiAuditReasonText }}
          </span>
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
        </div>
        <div class="grid gap-2 sm:grid-cols-3">
          <UiActionMenu
            label="岗位状态"
            :summary="reviewStatusLabel(job.review_status)"
            @select="handleReviewAction"
          >
            <option value="restore">恢复候选</option>
            <option value="favorited">收藏</option>
            <option value="ready_to_apply">准备投递</option>
            <option value="applied">已投递</option>
            <option value="ignored">忽略</option>
          </UiActionMenu>

          <UiActionMenu
            label="沟通状态"
            :summary="communicationStatusLabel(job.communication_status)"
            @select="handleCommunicationAction"
          >
            <option value="not_contacted">未打招呼</option>
            <option value="greeted_unread">已打招呼未读</option>
            <option value="read_no_reply">已读未回</option>
            <option value="replied">已回复</option>
            <option value="rejected">已拒绝</option>
            <option value="manual_not_fit">岗位不合适</option>
          </UiActionMenu>

          <UiActionMenu
            label="其他操作"
            summary="备注 / 公司"
            @select="handleMoreAction"
          >
            <option value="notes">编辑备注</option>
            <option value="company_not_fit" :disabled="!job.brand_name">公司不合适</option>
            <option v-if="job.company_review_status === 'manual_not_fit'" value="company_restore" :disabled="!job.brand_name">恢复公司</option>
          </UiActionMenu>
        </div>
        <div class="space-y-2 border-t border-border/90 pt-3">
          <div class="flex flex-wrap items-center gap-2">
            <button
              class="ui-btn-secondary px-2.5 py-1 text-xs"
              :disabled="props.greetingLoading"
              @click="$emit('generate-greeting', job)"
            >
              {{ props.greetingLoading ? "生成中…" : canGenerateGreeting ? "定制打招呼" : "打招呼" }}
            </button>
            <button
              class="ui-btn-secondary px-2.5 py-1 text-xs"
              :disabled="!hasGreetingDraft"
              @click="$emit('copy-greeting', job)"
            >
              复制打招呼
            </button>
            <button
              class="ui-btn-secondary px-2.5 py-1 text-xs"
              :disabled="props.optimizedResumeGenerating"
              @click="$emit('generate-optimized-resume', job)"
            >
              {{ props.optimizedResumeGenerating ? "生成中…" : "生成岗位版简历" }}
            </button>
          </div>
          <div v-if="props.greetingError" class="ui-status-danger space-y-1 px-3 py-2 text-xs">
            <div class="font-semibold">{{ props.greetingError.title }}</div>
            <div>{{ props.greetingError.hint }}</div>
            <div class="whitespace-pre-wrap text-[11px] text-red-700">{{ props.greetingError.message }}</div>
          </div>
          <div v-if="props.greetingDraft" class="rounded-lg border border-border/90 bg-surface-secondary p-3 text-xs leading-6 text-content-secondary">
            <div class="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-content-muted">打招呼草稿</div>
            <pre class="whitespace-pre-wrap break-words font-sans">{{ props.greetingDraft }}</pre>
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
          <span v-if="detail.jobInfo?.jobStatusDesc" class="rounded-md bg-white px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">{{ detail.jobInfo.jobStatusDesc }}</span>
          <span v-if="detail.bossInfo?.activeTimeDesc" class="ui-badge">{{ detail.bossInfo.activeTimeDesc }}</span>
        </div>
        <div v-if="detail.jobInfo?.postDescription">
          <button
            type="button"
            class="flex w-full items-center justify-between gap-3 rounded-lg border border-border/80 bg-surface-secondary px-3 py-2 text-left transition-colors hover:bg-slate-100"
            @click="descriptionOpen = !descriptionOpen"
          >
            <span class="text-xs font-semibold text-content-muted">职位描述</span>
            <span class="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-content-muted">
              {{ descriptionOpen ? "收起" : "展开" }}
              <ChevronDown class="h-4 w-4 transition-transform duration-200" :class="descriptionOpen ? 'rotate-180' : ''" />
            </span>
          </button>
          <div
            v-if="descriptionOpen"
            class="mt-3 max-w-none text-sm leading-relaxed text-content-secondary [&_a]:text-accent [&_a]:underline [&_b]:text-content-primary [&_h1]:text-content-primary [&_h2]:text-content-primary [&_h3]:text-content-primary [&_h4]:text-content-primary [&_li]:text-content-secondary [&_p]:text-content-secondary [&_strong]:text-content-primary"
            v-html="detail.jobInfo.postDescription"
          />
        </div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/90 pt-2 text-xs text-content-muted">
          <span>最后采集: {{ formatDate(job.last_seen_at) }}</span>
          <span v-if="job.boss_active_status">Boss 活跃: {{ job.boss_active_status }}</span>
          <span>沟通: {{ communicationStatusLabel(job.communication_status) }}</span>
          <span v-if="job.last_greeted_at">上次打招呼: {{ formatDate(job.last_greeted_at) }}</span>
          <span v-if="job.review_updated_at">沟通更新: {{ formatDate(job.review_updated_at) }}</span>
          <span v-if="job.company_blacklisted || job.job_blacklisted || job.keyword_blacklisted" class="text-red-700">
            黑名单: {{ job.blacklist_reason ?? "已加入黑名单" }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
