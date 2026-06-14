import { open } from "@tauri-apps/plugin-dialog";
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { formatScoreReasonSummary, parseScoreReasonJson, type JobDetail, type JobRow } from "./jobs";
import {
  RESUME_MODULES,
  assembleResumeWorkspace,
  diagnoseResumeWorkspace,
  exportResumeWorkspacePdf,
  getModuleLabel,
  rewriteResumeWorkspaceModule,
  type ResumeDiagnosisSection,
  type ResumeModuleKey,
  type ResumeWorkspaceDraft,
  type ResumeWorkspaceNavItem,
  type ResumeWorkspaceStepKey,
} from "./resumeWorkspace";
import { isTauri } from "./tauri";
import { invoke } from "./tauri";
import { useResumeWorkspaceStore } from "./useResumeWorkspaceStore";

const ACCEPT_TOAST_FADE_DELAY_MS = 2600;
const ACCEPT_TOAST_HIDE_DELAY_MS = 3000;
type ResumeWorkspaceRetryAction =
  | { kind: "diagnosis" }
  | { kind: "generate"; module: ResumeModuleKey }
  | { kind: "assemble" }
  | { kind: "export" }
  | null;
const FINAL_RESUME_SECTIONS: Array<{ key: ResumeModuleKey; title: string }> = [
  { key: "summary", title: "个人简介" },
  { key: "projects", title: "项目经历" },
  { key: "experience", title: "工作经历" },
  { key: "skills", title: "技能清单" },
];
const LINKED_JOB_CONTEXT_PREFIX = "【目标岗位上下文】";
const LINKED_JOB_CONTEXT_SUFFIX = "【目标岗位上下文结束】";
const LINKED_JOB_DESCRIPTION_MAX_LENGTH = 1800;

function normalizeResumeText(value?: string | null): string {
  return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function isOriginalStepComplete(draft: ResumeWorkspaceDraft): boolean {
  return !!(draft.original_resume_text.trim() || draft.original_resume_file);
}

function isDiagnosisStepComplete(draft: ResumeWorkspaceDraft): boolean {
  return !!draft.diagnosis;
}

function isFinalStepComplete(draft: ResumeWorkspaceDraft): boolean {
  return !!draft.final_resume_text?.trim();
}

function isPristineDraft(draft: ResumeWorkspaceDraft): boolean {
  return !(
    draft.original_resume_text.trim() ||
    draft.original_resume_file ||
    draft.context_text.trim() ||
    draft.linked_job_id ||
    draft.diagnosis ||
    draft.final_resume_text?.trim() ||
    draft.last_exported_pdf_path?.trim() ||
    draft.summary.input.trim() ||
    draft.summary.followup_input.trim() ||
    draft.summary.confirmed?.trim() ||
    draft.projects.input.trim() ||
    draft.projects.followup_input.trim() ||
    draft.projects.confirmed?.trim() ||
    draft.experience.input.trim() ||
    draft.experience.followup_input.trim() ||
    draft.experience.confirmed?.trim() ||
    draft.skills.input.trim() ||
    draft.skills.followup_input.trim() ||
    draft.skills.confirmed?.trim()
  );
}

function stripHtml(value?: string | null): string {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function describeWorkspaceFailure(message: string | null): { title: string; hint: string } {
  if (!message) return { title: "", hint: "" };

  const normalized = message.toLowerCase();
  if (normalized.includes("json") || normalized.includes("parse") || normalized.includes("schema")) {
    return {
      title: "结构化输出解析失败",
      hint: "AI 返回内容不是可用 JSON。可以直接重试当前步骤，或先补充简历/上下文后再试。",
    };
  }
  if (normalized.includes("openai request failed") || normalized.includes("http ")) {
    return {
      title: "模型接口请求失败",
      hint: "请检查 Base URL、模型名、API Key、接口模式和本地服务状态，然后重试。",
    };
  }
  if (normalized.includes("missing openai_api_key")) {
    return {
      title: "缺少 API Key",
      hint: "请在设置中保存 API Key 后重试；如果使用 Ollama 本地接口，确认预设和服务状态正常。",
    };
  }

  return {
    title: "AI 处理失败",
    hint: "可以修正输入或模型配置后重试当前步骤。",
  };
}

function routeJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function removeLinkedJobContext(contextText: string): string {
  const start = contextText.indexOf(LINKED_JOB_CONTEXT_PREFIX);
  if (start < 0) return contextText.trim();
  const end = contextText.indexOf(LINKED_JOB_CONTEXT_SUFFIX, start);
  if (end < 0) return contextText.slice(0, start).trim();
  return `${contextText.slice(0, start)}${contextText.slice(end + LINKED_JOB_CONTEXT_SUFFIX.length)}`.trim();
}

function mergeLinkedJobContext(currentContext: string, jobContext: string): string {
  const preserved = removeLinkedJobContext(currentContext);
  return [jobContext.trim(), preserved].filter(Boolean).join("\n\n");
}

function readDetailText(detail: JobDetail | null): string {
  const postDescription = stripHtml(detail?.jobInfo?.postDescription);
  const skills = detail?.jobInfo?.skills?.length ? detail.jobInfo.skills : detail?.jobInfo?.showSkills;
  const labels = detail?.jobInfo?.jobLabels ?? [];
  const parts = [
    postDescription,
    skills?.length ? `技能要求：${skills.join("、")}` : "",
    labels.length ? `职位标签：${labels.join("、")}` : "",
    detail?.jobInfo?.address ? `工作地址：${detail.jobInfo.address}` : "",
  ].filter(Boolean);
  return truncateText(parts.join("\n"), LINKED_JOB_DESCRIPTION_MAX_LENGTH);
}

function buildLinkedJobContext(job: JobRow, detail: JobDetail | null): string {
  const lines = [
    LINKED_JOB_CONTEXT_PREFIX,
    `岗位ID：${job.encrypt_job_id}`,
    `职位：${job.position_name ?? detail?.jobInfo?.jobName ?? detail?.jobInfo?.positionName ?? job.encrypt_job_id}`,
    `公司：${job.brand_name ?? detail?.brandComInfo?.brandName ?? detail?.brandInfo?.brandName ?? "未知"}`,
    `城市：${job.city_name ?? detail?.jobInfo?.cityName ?? detail?.jobInfo?.locationName ?? "未知"}`,
    `薪资：${job.salary_desc ?? detail?.jobInfo?.salaryDesc ?? "未知"}`,
    `经验/学历：${job.experience_name ?? detail?.jobInfo?.experienceName ?? "未知"} / ${job.degree_name ?? detail?.jobInfo?.degreeName ?? "未知"}`,
    `评分：Final ${Math.round(job.final_score)}，Resume ${typeof job.resume_match_score === "number" ? Math.round(job.resume_match_score) : "待分析"}，Preference ${Math.round(job.preference_score)}，Company ${Math.round(job.company_score)}`,
  ];
  const scoreSummary = formatScoreReasonSummary(parseScoreReasonJson(job.score_reason_json));
  if (scoreSummary !== "暂无额外评分原因") {
    lines.push(`评分依据：${scoreSummary}`);
  }
  const detailText = readDetailText(detail);
  if (detailText) {
    lines.push("JD 摘要：", detailText);
  }
  lines.push(LINKED_JOB_CONTEXT_SUFFIX);
  return lines.join("\n");
}

function stepHint(step: ResumeWorkspaceStepKey, readyForFinal: boolean): string {
  switch (step) {
    case "original":
      return "先导入原始简历、完善基础资料，再开始诊断。";
    case "diagnosis":
      return "先读诊断摘要，再决定优先处理哪个模块。";
    case "summary":
      return "优先把你的定位、亮点和目标方向打磨清楚。";
    case "projects":
      return "把项目成果、角色与量化结果补充完整。";
    case "experience":
      return "突出职责范围、业务影响和协作价值。";
    case "skills":
      return "明确技术栈、熟练度和实际应用场景。";
    case "final":
      return readyForFinal ? "检查最终稿是否达到了预期，再决定是否导出 PDF。" : "先确认所有模块，再生成最终成稿。";
  }
}

export function useResumeWorkspacePage() {
  const tauri = isTauri();
  const route = useRoute();
  const router = useRouter();
  const {
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceSummary,
    activeWorkspaceUpdatedAt,
    createNewWorkspace,
    deleteCurrentWorkspace,
    draft,
    loadState,
    persistCurrentDraft,
    renameCurrentWorkspace,
    switchToWorkspace,
    workspaces,
  } = useResumeWorkspaceStore();

  const currentStep = ref<ResumeWorkspaceStepKey>("original");
  const loadingDraft = ref(false);
  const diagnosing = ref(false);
  const rewritingModule = ref<ResumeModuleKey | null>(null);
  const assembling = ref(false);
  const exporting = ref(false);
  const error = ref<string | null>(null);
  const success = ref<string | null>(null);
  const createDialogVisible = ref(false);
  const createDialogLoading = ref(false);
  const renameDialogVisible = ref(false);
  const renameDialogLoading = ref(false);
  const deleteDialogVisible = ref(false);
  const deleteDialogLoading = ref(false);
  const acceptToastMessage = ref<string | null>(null);
  const acceptToastVisible = ref(false);
  const acceptToastFading = ref(false);
  const retryAction = ref<ResumeWorkspaceRetryAction>(null);
  const linkedJobLoading = ref(false);
  const linkedJob = ref<JobRow | null>(null);
  const linkedJobContextApplied = ref(false);
  const linkedJobIdApplied = ref<string | null>(null);

  let acceptToastFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let acceptToastHideTimer: ReturnType<typeof setTimeout> | null = null;

  const currentModule = computed(() => RESUME_MODULES.find((item) => item.key === currentStep.value) ?? null);
  const readyForFinal = computed(() => RESUME_MODULES.every((item) => !!draft.value[item.key].confirmed?.trim()));
  const showCandidateAside = computed(() => !!currentModule.value);
  const confirmedModulesCount = computed(() => RESUME_MODULES.filter((item) => !!draft.value[item.key].confirmed?.trim()).length);
  const assembledConfirmedResumeText = computed(() => {
    const sections = FINAL_RESUME_SECTIONS.flatMap(({ key, title }) => {
      const content = draft.value[key].confirmed?.trim();
      return content ? [`## ${title}\n${content}`] : [];
    });
    return sections.join("\n\n");
  });
  const needsRegenerateFinal = computed(() => {
    if (!draft.value.final_resume_text?.trim()) return false;
    return normalizeResumeText(assembledConfirmedResumeText.value) !== normalizeResumeText(draft.value.final_resume_text);
  });
  const navItems = computed<ResumeWorkspaceNavItem[]>(() => {
    const items: ResumeWorkspaceNavItem[] = [
      { key: "original", label: "原始简历", status: currentStep.value === "original" ? "active" : isOriginalStepComplete(draft.value) ? "done" : "idle" },
      { key: "diagnosis", label: "AI 诊断", status: currentStep.value === "diagnosis" ? "active" : isDiagnosisStepComplete(draft.value) ? "done" : "idle" },
    ];
    for (const module of RESUME_MODULES) {
      const done = !!draft.value[module.key].confirmed?.trim();
      items.push({ key: module.key, label: module.label, status: currentStep.value === module.key ? "active" : done ? "done" : "idle" });
    }
    items.push({ key: "final", label: "最终简历", status: currentStep.value === "final" ? "active" : isFinalStepComplete(draft.value) ? "done" : "idle" });
    return items;
  });
  const currentStepLabel = computed(() => {
    if (currentStep.value === "original") return "原始简历";
    if (currentStep.value === "diagnosis") return "AI 诊断";
    if (currentStep.value === "final") return "最终简历";
    return getModuleLabel(currentStep.value);
  });
  const currentStepHint = computed(() => stepHint(currentStep.value, readyForFinal.value));
  const errorTitle = computed(() => describeWorkspaceFailure(error.value).title);
  const errorHint = computed(() => describeWorkspaceFailure(error.value).hint);
  const retryActionLabel = computed(() => {
    if (!retryAction.value) return "";
    switch (retryAction.value.kind) {
      case "diagnosis":
        return "重试诊断";
      case "generate":
        return `重试 ${getModuleLabel(retryAction.value.module)} 候选稿`;
      case "assemble":
        return "重试生成最终稿";
      case "export":
        return "重试导出 PDF";
    }
  });
  const canRetryAction = computed(() => !!retryAction.value);
  const linkedReviewJobId = computed(() => linkedJob.value?.encrypt_job_id ?? draft.value.linked_job_id ?? null);
  const canGoLinkedJobReview = computed(() => !!linkedReviewJobId.value);
  const workflowProgressCount = computed(() => {
    let count = 0;
    if (isOriginalStepComplete(draft.value)) count += 1;
    if (isDiagnosisStepComplete(draft.value)) count += 1;
    count += confirmedModulesCount.value;
    if (isFinalStepComplete(draft.value)) count += 1;
    return count;
  });

  function buildModuleInput(module: ResumeModuleKey): string {
    const parts = [draft.value[module].input.trim(), draft.value[module].followup_input.trim()].filter(Boolean);
    return parts.join("\n\n【补充回答】\n");
  }

  function canGenerateCandidate(module: ResumeModuleKey): boolean {
    return !!buildModuleInput(module).trim();
  }

  function activeDiagnosisSection(): ResumeDiagnosisSection | null {
    if (!currentModule.value || !draft.value.diagnosis) return null;
    return draft.value.diagnosis[currentModule.value.key] ?? null;
  }

  function clearAcceptToastTimers(): void {
    if (acceptToastFadeTimer) {
      clearTimeout(acceptToastFadeTimer);
      acceptToastFadeTimer = null;
    }
    if (acceptToastHideTimer) {
      clearTimeout(acceptToastHideTimer);
      acceptToastHideTimer = null;
    }
  }

  function showAcceptToast(message: string): void {
    clearAcceptToastTimers();
    acceptToastMessage.value = message;
    acceptToastVisible.value = true;
    acceptToastFading.value = false;
    acceptToastFadeTimer = setTimeout(() => {
      acceptToastFading.value = true;
    }, ACCEPT_TOAST_FADE_DELAY_MS);
    acceptToastHideTimer = setTimeout(() => {
      acceptToastVisible.value = false;
      acceptToastFading.value = false;
      acceptToastMessage.value = null;
      clearAcceptToastTimers();
    }, ACCEPT_TOAST_HIDE_DELAY_MS);
  }

  async function persistDraft(): Promise<void> {
    if (!tauri) return;
    await persistCurrentDraft();
  }

  async function loadWorkspaceState(): Promise<void> {
    if (!tauri) return;
    loadingDraft.value = true;
    try {
      await loadState();
    } finally {
      loadingDraft.value = false;
    }
  }

  async function loadLinkedJobContext(): Promise<void> {
    const jobId = routeJobId(route.query.jobId);
    if (!tauri || !jobId) return;
    if (linkedJobIdApplied.value === jobId) return;
    linkedJobLoading.value = true;
    try {
      const job = await invoke<JobRow | null>("get_job", { encryptJobId: jobId });
      if (!job) {
        error.value = `未找到联动岗位：${jobId}`;
        return;
      }
      const detail = await invoke<JobDetail | null>("get_job_detail", { encryptJobId: jobId });
      linkedJob.value = job;
      draft.value.linked_job_id = job.encrypt_job_id;
      draft.value.context_text = mergeLinkedJobContext(draft.value.context_text, buildLinkedJobContext(job, detail));
      await persistCurrentDraft();
      linkedJobContextApplied.value = true;
      linkedJobIdApplied.value = jobId;
      currentStep.value = "original";
      success.value = "已把目标岗位写入简历优化上下文。";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      linkedJobLoading.value = false;
    }
  }

  async function reapplyLinkedJobContextForActiveWorkspace(): Promise<void> {
    linkedJobIdApplied.value = null;
    linkedJobContextApplied.value = false;
    await loadLinkedJobContext();
  }

  function goLinkedJobReview(): void {
    const jobId = linkedReviewJobId.value;
    if (!jobId) return;
    void router.push({ path: "/jobs", query: { jobId } });
  }

  function openCreateWorkspaceDialog(): void {
    createDialogVisible.value = true;
  }

  function closeCreateWorkspaceDialog(): void {
    if (createDialogLoading.value) return;
    createDialogVisible.value = false;
  }

  async function createBlankWorkspace(title: string): Promise<void> {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    error.value = null;
    success.value = null;
    createDialogLoading.value = true;
    try {
      await persistCurrentDraft();
      await createNewWorkspace({ title: nextTitle });
      createDialogVisible.value = false;
      currentStep.value = "original";
      success.value = "已创建新的工作区。";
      await reapplyLinkedJobContextForActiveWorkspace();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      createDialogLoading.value = false;
    }
  }

  async function switchWorkspace(workspaceId: string): Promise<void> {
    error.value = null;
    success.value = null;
    try {
      await switchToWorkspace(workspaceId);
      currentStep.value = "original";
      await reapplyLinkedJobContextForActiveWorkspace();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  function openRenameWorkspaceDialog(): void {
    if (!activeWorkspace.value) return;
    renameDialogVisible.value = true;
  }

  function closeRenameWorkspaceDialog(): void {
    if (renameDialogLoading.value) return;
    renameDialogVisible.value = false;
  }

  async function renameWorkspace(title: string): Promise<void> {
    const next = title.trim();
    if (!activeWorkspace.value || !next) return;
    error.value = null;
    success.value = null;
    renameDialogLoading.value = true;
    try {
      await renameCurrentWorkspace(next);
      renameDialogVisible.value = false;
      success.value = "工作区名称已更新。";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      renameDialogLoading.value = false;
    }
  }

  function openDeleteWorkspaceDialog(): void {
    if (!activeWorkspace.value) return;
    deleteDialogVisible.value = true;
  }

  function closeDeleteWorkspaceDialog(): void {
    if (deleteDialogLoading.value) return;
    deleteDialogVisible.value = false;
  }

  async function deleteWorkspace(): Promise<void> {
    if (!activeWorkspace.value) return;
    error.value = null;
    success.value = null;
    deleteDialogLoading.value = true;
    try {
      await deleteCurrentWorkspace();
      deleteDialogVisible.value = false;
      currentStep.value = "original";
      success.value = "工作区已删除。";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      deleteDialogLoading.value = false;
    }
  }

  async function pickPdfFile(): Promise<void> {
    if (!tauri) return;
    const selected = await open({ title: "选择原始 PDF 简历", filters: [{ name: "PDF", extensions: ["pdf"] }] });
    if (typeof selected !== "string") return;
    error.value = null;
    success.value = null;

    try {
      if (isPristineDraft(draft.value) && activeWorkspaceId.value) {
        draft.value.source_mode = "file";
        draft.value.original_resume_file = selected;
        draft.value.original_resume_text = "";
        await persistCurrentDraft();
      } else {
        await persistCurrentDraft();
        await createNewWorkspace({
          source_mode: "file",
          original_resume_file: selected,
        });
      }
      currentStep.value = "original";
      success.value = "已基于 PDF 创建并切换工作区。";
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function runDiagnosis(): Promise<void> {
    error.value = null;
    success.value = null;
    retryAction.value = { kind: "diagnosis" };
    diagnosing.value = true;
    try {
      draft.value.diagnosis = await diagnoseResumeWorkspace({
        resume_text: draft.value.source_mode === "text" ? draft.value.original_resume_text : "",
        context_text: draft.value.context_text.trim() || null,
        resume_files: draft.value.source_mode === "file" ? draft.value.original_resume_file ?? null : null,
      });
      await persistCurrentDraft();
      currentStep.value = "diagnosis";
      success.value = "AI 诊断已生成。";
      retryAction.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      diagnosing.value = false;
    }
  }

  async function generateCandidate(module: ResumeModuleKey): Promise<void> {
    error.value = null;
    success.value = null;
    retryAction.value = { kind: "generate", module };
    rewritingModule.value = module;
    try {
      const result = await rewriteResumeWorkspaceModule({
        module,
        resume_text: draft.value.source_mode === "text" ? draft.value.original_resume_text : "",
        context_text: draft.value.context_text.trim() || null,
        resume_files: draft.value.source_mode === "file" ? draft.value.original_resume_file ?? null : null,
        module_input: buildModuleInput(module),
        confirmed_summary: draft.value.summary.confirmed ?? null,
        confirmed_projects: draft.value.projects.confirmed ?? null,
        confirmed_experience: draft.value.experience.confirmed ?? null,
        confirmed_skills: draft.value.skills.confirmed ?? null,
      });
      draft.value[module].candidate = result.candidate;
      draft.value[module].notes = result.notes;
      draft.value[module].checklist = result.checklist;
      draft.value[module].updated_at = new Date().toISOString();
      await persistCurrentDraft();
      success.value = `${getModuleLabel(module)}候选稿已生成。`;
      retryAction.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      rewritingModule.value = null;
    }
  }

  async function acceptCandidate(module: ResumeModuleKey): Promise<void> {
    const candidate = draft.value[module].candidate?.trim();
    if (!candidate) return;

    error.value = null;
    success.value = null;
    const previousConfirmed = draft.value[module].confirmed ?? null;
    draft.value[module].confirmed = candidate;

    try {
      await persistCurrentDraft();
      showAcceptToast(`${getModuleLabel(module)}已确认。`);
    } catch (e) {
      draft.value[module].confirmed = previousConfirmed;
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  async function assembleFinalResume(): Promise<void> {
    error.value = null;
    success.value = null;
    retryAction.value = { kind: "assemble" };
    assembling.value = true;
    try {
      draft.value = await assembleResumeWorkspace(draft.value);
      await persistCurrentDraft();
      currentStep.value = "final";
      success.value = "最终简历已生成。";
      retryAction.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      assembling.value = false;
    }
  }

  async function exportPdf(): Promise<void> {
    error.value = null;
    success.value = null;
    retryAction.value = { kind: "export" };
    exporting.value = true;
    try {
      const path = await exportResumeWorkspacePdf(draft.value, "修改后的简历");
      draft.value.last_exported_pdf_path = path;
      draft.value.last_exported_pdf_at = new Date().toISOString();
      await persistCurrentDraft();
      success.value = `PDF 已导出：${path}`;
      retryAction.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      exporting.value = false;
    }
  }

  async function retryCurrentAction(): Promise<void> {
    if (!retryAction.value) return;
    const action = retryAction.value;
    switch (action.kind) {
      case "diagnosis":
        await runDiagnosis();
        return;
      case "generate":
        await generateCandidate(action.module);
        return;
      case "assemble":
        await assembleFinalResume();
        return;
      case "export":
        await exportPdf();
    }
  }

  onMounted(() => {
    void (async () => {
      await loadWorkspaceState();
      await loadLinkedJobContext();
    })();
  });

  onActivated(() => {
    void loadLinkedJobContext();
  });

  watch(
    () => route.query.jobId,
    () => {
      void loadLinkedJobContext();
    },
  );

  onBeforeUnmount(() => {
    clearAcceptToastTimers();
  });

  return {
    RESUME_MODULES,
    acceptCandidate,
    acceptToastFading,
    acceptToastMessage,
    acceptToastVisible,
    activeDiagnosisSection,
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceSummary,
    activeWorkspaceUpdatedAt,
    assembleFinalResume,
    assembling,
    canGenerateCandidate,
    canGoLinkedJobReview,
    closeCreateWorkspaceDialog,
    confirmedModulesCount,
    createBlankWorkspace,
    createDialogLoading,
    createDialogVisible,
    currentModule,
    currentStep,
    currentStepHint,
    canRetryAction,
    errorHint,
    errorTitle,
    currentStepLabel,
    deleteWorkspace,
    deleteDialogLoading,
    deleteDialogVisible,
    diagnosing,
    draft,
    error,
    exportPdf,
    exporting,
    generateCandidate,
    goLinkedJobReview,
    loadingDraft,
    linkedJob,
    linkedJobContextApplied,
    linkedJobLoading,
    navItems,
    openCreateWorkspaceDialog,
    openDeleteWorkspaceDialog,
    openRenameWorkspaceDialog,
    needsRegenerateFinal,
    persistDraft,
    pickPdfFile,
    readyForFinal,
    renameWorkspace,
    renameDialogLoading,
    renameDialogVisible,
    rewritingModule,
    retryActionLabel,
    retryCurrentAction,
    runDiagnosis,
    showCandidateAside,
    success,
    switchWorkspace,
    tauri,
    workflowProgressCount,
    workspaces,
    closeDeleteWorkspaceDialog,
    closeRenameWorkspaceDialog,
  };
}
