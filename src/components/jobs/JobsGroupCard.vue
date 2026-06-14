<script setup lang="ts">
import type {
  CommunicationStatus,
  CompanyReviewStatus,
  GreetingErrorState,
  GreetingMessageResult,
  JobDetail,
  JobRow,
  KeywordGroup,
  ReviewStatus,
} from "../../lib/jobs";
import type { ResumeWorkspaceJobStatus } from "../../lib/resumeWorkspace";
import JobsJobItem from "./JobsJobItem.vue";

defineProps<{
  group: KeywordGroup;
  groupKeyValue: string;
  expanded: boolean;
  loading: boolean;
  jobs: JobRow[] | undefined;
  expandedJobId: string | null;
  detailLoadingId: string | null;
  expandedDetail: JobDetail | null;
  greetingCache: Map<string, GreetingMessageResult>;
  greetingDrafts: Map<string, string>;
  greetingErrors: Map<string, GreetingErrorState>;
  greetingLoadingId: string | null;
  resumeWorkspaceStatuses: Map<string, ResumeWorkspaceJobStatus | null>;
}>();

defineEmits<{
  (e: "toggle-group", group: KeywordGroup): void;
  (e: "toggle-detail", jobId: string): void;
  (e: "go-ai", jobId: string): void;
  (e: "go-resume-workspace", jobId: string): void;
  (e: "copy-link", job: JobRow): void;
  (e: "open-source-url", job: JobRow): void;
  (e: "delete-job", job: JobRow, groupKeyValue: string): void;
  (e: "open-filter-profile", job: JobRow): void;
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
}>();
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-border/10 bg-card/70 backdrop-blur-sm transition-colors" :class="expanded ? 'border-border/20' : ''">
    <div class="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover/60" @click="$emit('toggle-group', group)">
      <svg class="h-4 w-4 shrink-0 text-content-muted transition-transform duration-200" :class="expanded ? 'rotate-90' : ''" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
      </svg>
      <span class="text-sm font-semibold text-content-primary">{{ group.label }}</span>
      <span class="ui-badge">{{ group.job_count }} 个职位</span>
    </div>

    <div v-if="expanded" class="border-t border-border/10">
      <div v-if="loading" class="flex items-center gap-2 px-6 py-4 text-sm text-content-muted">
        <svg class="h-4 w-4 animate-spin text-content-muted" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        加载职位列表…
      </div>
      <template v-else>
        <div v-if="!jobs || jobs.length === 0" class="px-6 py-4 text-sm text-content-muted">暂无职位数据。</div>
        <div v-else class="divide-y divide-border/10">
          <JobsJobItem
            v-for="job in jobs"
            :key="job.encrypt_job_id"
            :job="job"
            :expanded="expandedJobId === job.encrypt_job_id"
            :detail-loading="detailLoadingId === job.encrypt_job_id"
            :detail="expandedJobId === job.encrypt_job_id ? expandedDetail : null"
            :greeting="greetingCache.get(job.encrypt_job_id)"
            :greeting-draft="greetingDrafts.get(job.encrypt_job_id) ?? ''"
            :greeting-error="greetingErrors.get(job.encrypt_job_id)"
            :greeting-loading="greetingLoadingId === job.encrypt_job_id"
            :resume-workspace-status="resumeWorkspaceStatuses.get(job.encrypt_job_id)"
            :allow-delete="true"
            row-padding-class="px-6"
            detail-padding-class="px-10"
            @toggle-detail="(jobId) => $emit('toggle-detail', jobId)"
            @go-ai="(jobId) => $emit('go-ai', jobId)"
            @go-resume-workspace="(jobId) => $emit('go-resume-workspace', jobId)"
            @copy-link="(job) => $emit('copy-link', job)"
            @open-source-url="(job) => $emit('open-source-url', job)"
            @delete="(job) => $emit('delete-job', job, groupKeyValue)"
            @open-filter-profile="(job) => $emit('open-filter-profile', job)"
            @open-blacklist-management="(job) => $emit('open-blacklist-management', job)"
            @update-review="(job, status) => $emit('update-review', job, status)"
            @restore-review-candidate="(job) => $emit('restore-review-candidate', job)"
            @update-communication="(job, status) => $emit('update-communication', job, status)"
            @update-review-notes="(job) => $emit('update-review-notes', job)"
            @update-company-review="(job, status) => $emit('update-company-review', job, status)"
            @blacklist-company="(job) => $emit('blacklist-company', job)"
            @blacklist-job="(job) => $emit('blacklist-job', job)"
            @blacklist-keyword="(job) => $emit('blacklist-keyword', job)"
            @generate-greeting="(job) => $emit('generate-greeting', job)"
            @update-greeting-draft="(jobId, message) => $emit('update-greeting-draft', jobId, message)"
            @copy-greeting="(job) => $emit('copy-greeting', job)"
            @copy-application-packet="(job) => $emit('copy-application-packet', job)"
          />
        </div>
      </template>
    </div>
  </div>
</template>
