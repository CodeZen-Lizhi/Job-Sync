import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import type { JobRow } from "./jobs";
import { formatDate } from "./jobsPageHelpers";
import {
  createResume,
  deleteResume,
  getResumeJobSummaries,
  getResumeLibraryState,
  linkResumeToJobs,
  listRecommendedJobsForResumeLinking,
  setDefaultResume,
  unlinkResumeFromJob,
  updateResume,
  type ResumeJobSummary,
  type ResumeLibraryState,
} from "./resumeLibrary";
import { isTauri } from "./tauri";

export function useResumeLibraryPage() {
  interface LinkJobOption {
    encrypt_job_id: string;
    position_name: string | null;
    brand_name: string | null;
    city_name: string | null;
    salary_desc: string | null;
    final_score?: number | null;
    linked_resume_title?: string | null;
  }

  const route = useRoute();
  const router = useRouter();
  const tauri = isTauri();
  const loading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);
  const state = ref<ResumeLibraryState>({
    resumes: [],
    active_resume_id: null,
    default_resume_id: null,
    selected_resume: null,
    linked_jobs: [],
  });
  const formTitle = ref("");
  const formBody = ref("");
  const isCreating = ref(false);
  const highlightedResumeId = ref<string | null>(null);
  const pendingJobId = ref<string | null>(typeof route.query.jobId === "string" ? route.query.jobId : null);
  const linkModalOpen = ref(false);
  const linkJobsLoading = ref(false);
  const linkJobs = ref<LinkJobOption[]>([]);
  const selectedJobIds = ref<Set<string>>(new Set());
  const pinnedJobSummaries = ref<ResumeJobSummary[]>([]);

  const resumes = computed(() => state.value.resumes);
  const selectedResume = computed(() => state.value.selected_resume);
  const linkedJobs = computed(() => state.value.linked_jobs);
  const hasResumes = computed(() => resumes.value.length > 0);
  const isDirty = computed(() => {
    if (isCreating.value) return formTitle.value.trim().length > 0 || formBody.value.trim().length > 0;
    const selected = selectedResume.value;
    if (!selected) return false;
    return formTitle.value !== selected.title || formBody.value !== selected.body;
  });
  const pendingJobSummary = computed(() =>
    pendingJobId.value
      ? pinnedJobSummaries.value.find((job) => job.encrypt_job_id === pendingJobId.value) ?? null
      : null,
  );

  function applyState(next: ResumeLibraryState): void {
    state.value = next;
    isCreating.value = false;
    formTitle.value = next.selected_resume?.title ?? "";
    formBody.value = next.selected_resume?.body ?? "";
    if (next.active_resume_id) {
      highlightedResumeId.value = next.active_resume_id;
      window.setTimeout(() => {
        if (highlightedResumeId.value === next.active_resume_id) highlightedResumeId.value = null;
      }, 1800);
    }
  }

  async function load(selectedResumeId?: string | null): Promise<void> {
    error.value = null;
    if (!tauri) return;
    loading.value = true;
    try {
      applyState(await getResumeLibraryState(selectedResumeId));
      await loadPinnedJobSummary();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  }

  async function loadPinnedJobSummary(): Promise<void> {
    if (!tauri || !pendingJobId.value) {
      pinnedJobSummaries.value = [];
      return;
    }
    pinnedJobSummaries.value = await getResumeJobSummaries([pendingJobId.value]);
  }

  async function selectResume(resumeId: string): Promise<void> {
    await router.replace({ path: "/resume-library", query: { ...route.query, resumeId } });
    await load(resumeId);
  }

  function startCreate(): void {
    isCreating.value = true;
    formTitle.value = "";
    formBody.value = "";
  }

  async function saveResume(): Promise<void> {
    error.value = null;
    if (!tauri || saving.value) return;
    saving.value = true;
    try {
      if (isCreating.value || !selectedResume.value) {
        applyState(await createResume(formTitle.value, formBody.value));
      } else {
        applyState(await updateResume(selectedResume.value.id, formTitle.value, formBody.value));
      }
      if (state.value.active_resume_id) {
        await router.replace({ path: "/resume-library", query: { ...route.query, resumeId: state.value.active_resume_id } });
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving.value = false;
    }
  }

  async function removeSelectedResume(): Promise<void> {
    const selected = selectedResume.value;
    if (!selected || saving.value) return;
    if (!window.confirm(`确认删除「${selected.title}」？关联到它的岗位会一并解除关联。`)) return;
    saving.value = true;
    error.value = null;
    try {
      applyState(await deleteResume(selected.id));
      await router.replace({ path: "/resume-library", query: {} });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving.value = false;
    }
  }

  async function makeSelectedDefault(): Promise<void> {
    const selected = selectedResume.value;
    if (!selected || saving.value) return;
    saving.value = true;
    error.value = null;
    try {
      applyState(await setDefaultResume(selected.id));
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving.value = false;
    }
  }

  async function openLinkModal(): Promise<void> {
    if (!selectedResume.value || !tauri) return;
    linkModalOpen.value = true;
    linkJobsLoading.value = true;
    error.value = null;
    try {
      const [page] = await Promise.all([listRecommendedJobsForResumeLinking(), loadPinnedJobSummary()]);
      const seen = new Set<string>();
      const pinned = pinnedJobSummaries.value.filter((job) => {
        if (seen.has(job.encrypt_job_id)) return false;
        seen.add(job.encrypt_job_id);
        return true;
      });
      const recommended = page.jobs.filter((job) => {
        if (seen.has(job.encrypt_job_id)) return false;
        seen.add(job.encrypt_job_id);
        return true;
      });
      linkJobs.value = [...pinned, ...recommended];
      selectedJobIds.value = new Set(pendingJobId.value ? [pendingJobId.value] : []);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      linkJobsLoading.value = false;
    }
  }

  function toggleLinkJob(jobId: string): void {
    const next = new Set(selectedJobIds.value);
    if (next.has(jobId)) next.delete(jobId);
    else next.add(jobId);
    selectedJobIds.value = next;
  }

  async function saveJobLinks(): Promise<void> {
    const selected = selectedResume.value;
    if (!selected || saving.value || selectedJobIds.value.size === 0) return;
    saving.value = true;
    error.value = null;
    try {
      applyState(await linkResumeToJobs(selected.id, Array.from(selectedJobIds.value)));
      linkModalOpen.value = false;
      pendingJobId.value = null;
      await router.replace({ path: "/resume-library", query: { resumeId: selected.id } });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving.value = false;
    }
  }

  async function unlinkJob(jobId: string): Promise<void> {
    if (saving.value) return;
    saving.value = true;
    error.value = null;
    try {
      applyState(await unlinkResumeFromJob(jobId));
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving.value = false;
    }
  }

  function jobLabel(job: Pick<JobRow, "position_name" | "brand_name" | "city_name" | "encrypt_job_id">): string {
    return [job.position_name, job.brand_name, job.city_name].filter(Boolean).join(" / ") || job.encrypt_job_id;
  }

  function jobScoreLabel(job: LinkJobOption): string {
    return typeof job.final_score === "number" && Number.isFinite(job.final_score)
      ? `Final ${Math.round(job.final_score)}`
      : "待评分";
  }

  watch(
    () => route.query.resumeId,
    (resumeId) => {
      if (route.path !== "/resume-library") return;
      void load(typeof resumeId === "string" ? resumeId : null);
    },
  );

  watch(
    () => route.query.jobId,
    (jobId) => {
      pendingJobId.value = typeof jobId === "string" ? jobId : null;
      void loadPinnedJobSummary();
    },
  );

  return {
    tauri,
    loading,
    saving,
    error,
    resumes,
    selectedResume,
    linkedJobs,
    formTitle,
    formBody,
    isCreating,
    hasResumes,
    isDirty,
    highlightedResumeId,
    pendingJobId,
    pendingJobSummary,
    linkModalOpen,
    linkJobsLoading,
    linkJobs,
    selectedJobIds,
    state,
    load,
    selectResume,
    startCreate,
    saveResume,
    removeSelectedResume,
    makeSelectedDefault,
    openLinkModal,
    toggleLinkJob,
    saveJobLinks,
    unlinkJob,
    jobLabel,
    jobScoreLabel,
    formatDate,
  };
}
