<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import AiJobPicker from "../components/ai/AiJobPicker.vue";
import AiProfileInputs from "../components/ai/AiProfileInputs.vue";
import { aiSelectedJobs } from "../lib/aiSelection";
import { invoke, isTauri } from "../lib/tauri";

interface AppSettings {
  ai_resume_text?: string | null;
  ai_context_text?: string | null;
  ai_resume_files?: string | null;
  ai_profile_updated_at?: string | null;
}

const tauri = isTauri();
const resumeMode = ref<"text" | "file">("text");
const resumeText = ref("");
const resumeFilePath = ref("");
const contextText = ref("");

const selectedJobs = aiSelectedJobs;

const force = ref(false);

const loading = ref(false);
const error = ref<string | null>(null);
const profileUpdatedAt = ref<string | null>(null);
const groupLoading = ref(false);
const groupError = ref<string | null>(null);

const route = useRoute();
const router = useRouter();

async function loadSettings(): Promise<void> {
  if (!tauri) return;
  try {
    const settings = await invoke<AppSettings>("get_settings");
    profileUpdatedAt.value = settings.ai_profile_updated_at ?? null;

    if (!resumeText.value.trim() && settings.ai_resume_text) resumeText.value = settings.ai_resume_text;
    if (!contextText.value.trim() && settings.ai_context_text) contextText.value = settings.ai_context_text;
    if (!resumeFilePath.value.trim() && settings.ai_resume_files) {
      resumeFilePath.value = settings.ai_resume_files;
      if (settings.ai_resume_files) resumeMode.value = "file";
    }
  } catch {
    // ignore
  }
}

async function saveSettings(): Promise<void> {
  if (!tauri) return;
  try {
    const saved = await invoke<AppSettings>("set_ai_settings", {
      resumeText: resumeMode.value === "text" ? resumeText.value : "",
      contextText: contextText.value.trim() || null,
      resumeFiles: resumeMode.value === "file" ? resumeFilePath.value : null,
    });
    profileUpdatedAt.value = saved.ai_profile_updated_at ?? null;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

const jobId = computed(() => {
  const q = route.query.jobId;
  if (typeof q !== "string") return null;
  const trimmed = q.trim();
  return trimmed ? trimmed : null;
});
const source = computed(() => {
  const q = route.query.source;
  if (typeof q !== "string") return null;
  const trimmed = q.trim().toLowerCase();
  return trimmed ? trimmed : null;
});
const isCandidateSource = computed(() => source.value === "top20" || source.value === "candidates");
const candidateContextJobs = computed(() => selectedJobs.value.slice(0, 5));

const errorTitle = computed(() => describeAiFailure(error.value).title);
const errorHint = computed(() => describeAiFailure(error.value).hint);
const groupErrorTitle = computed(() => describeAiFailure(groupError.value).title);
const groupErrorHint = computed(() => describeAiFailure(groupError.value).hint);

function describeAiFailure(message: string | null): { title: string; hint: string } {
  if (!message) {
    return { title: "", hint: "" };
  }

  const normalized = message.toLowerCase();
  if (normalized.includes("json") || normalized.includes("parse") || normalized.includes("schema")) {
    return {
      title: "结构化输出解析失败",
      hint: "模型返回内容不是可用 JSON。可打开“强制重新生成”后重试，或在设置中降低 Temperature / 切换支持 JSON 输出的模型。",
    };
  }
  if (normalized.includes("openai request failed") || normalized.includes("http ")) {
    return {
      title: "模型接口请求失败",
      hint: "请检查 Base URL、模型名、API Key、接口模式和本地 Ollama 服务状态，然后重试。",
    };
  }
  if (normalized.includes("missing openai_api_key")) {
    return {
      title: "缺少 API Key",
      hint: "请在设置中保存 API Key；Ollama 本地接口可应用 Ollama 预设后重试。",
    };
  }

  return {
    title: "AI 分析失败",
    hint: "可以修正输入或模型配置后重试；若命中了缓存，请打开“强制重新生成”。",
  };
}

function retryAnalyze(): void {
  force.value = true;
  void analyze();
}

function retryAnalyzeGroup(): void {
  force.value = true;
  void analyzeGroup();
}

async function routeAfterResumeAnalysis(): Promise<void> {
  if (isCandidateSource.value) {
    await router.push({ path: "/jobs" });
    return;
  }
  await router.push({ path: "/ai-reports", query: { open: "latest" } });
}

async function analyze(): Promise<void> {
  error.value = null;
  if (!tauri) return;
  if (selectedJobs.value.length === 0) {
    error.value = "请从职位库中选择至少一个职位。";
    return;
  }
  if (resumeMode.value === "text" && !resumeText.value.trim()) {
    error.value = "请粘贴简历文本。";
    return;
  }
  if (resumeMode.value === "file" && !resumeFilePath.value.trim()) {
    error.value = "请选择 PDF 简历文件。";
    return;
  }

  loading.value = true;
  try {
    const outcomes = await Promise.all(
      selectedJobs.value.map(async (job) => {
      try {
        await invoke<unknown>("analyze_resume_for_job", {
          encryptJobId: job.encrypt_job_id,
          resumeText: resumeMode.value === "text" ? resumeText.value : "",
          contextText: contextText.value.trim() || null,
          resumeFiles: resumeMode.value === "file" ? resumeFilePath.value : null,
          apiKey: null,
          baseUrl: null,
          model: null,
          apiMode: null,
          force: force.value,
        });
        return { ok: true as const, error: null as string | null };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    }),
    );

    const okCount = outcomes.filter((it) => it.ok).length;
    if (okCount === 0) {
      const firstError = outcomes.find((it) => !it.ok && it.error)?.error;
      error.value = firstError ?? "生成报告失败。";
      return;
    }

    await routeAfterResumeAnalysis();
  } finally {
    loading.value = false;
  }
}

async function analyzeGroup(): Promise<void> {
  groupError.value = null;
  if (!tauri) return;
  if (selectedJobs.value.length === 0) {
    groupError.value = "请从职位库中选择至少一个职位。";
    return;
  }
  if (!contextText.value.trim()) {
    groupError.value = "请填写当前情况说明（综合分析不需要简历）。";
    return;
  }
  if (selectedJobs.value.length > 20) {
    groupError.value = "综合分析最多支持 20 个职位，请减少选择数量。";
    return;
  }

  groupLoading.value = true;
  try {
    await invoke<unknown>("analyze_profile_for_jobs", {
      jobIds: selectedJobs.value.map((j) => j.encrypt_job_id),
      contextText: contextText.value.trim(),
      apiKey: null,
      baseUrl: null,
      model: null,
      apiMode: null,
      force: force.value,
    });
    await router.push({ path: "/ai-reports", query: { open: "latest" } });
  } catch (e) {
    groupError.value = e instanceof Error ? e.message : String(e);
  } finally {
    groupLoading.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <section class="space-y-4">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-content-primary">AI 岗位研究</h1>
      <p class="text-sm text-content-secondary">基于简历和岗位证据生成匹配分析，服务人工确认后的精准投递准备。</p>
    </header>

    <div
      v-if="!tauri"
      class="rounded-lg bg-amber-500/10 p-4 text-sm text-amber-400 ring-1 ring-white/[0.06]"
    >
      当前是浏览器模式（非 Tauri）。AI 命令不可用。
    </div>

    <AiJobPicker :tauri="tauri" :job-id="jobId" />

    <div
      v-if="isCandidateSource"
      class="ui-panel-muted space-y-2 p-4"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="ui-badge bg-sky-400/10 text-sky-300 ring-sky-400/20">候选岗位</span>
        <span v-if="selectedJobs.length" class="text-sm font-medium text-content-primary">
          已载入 {{ selectedJobs.length }} 个候选岗位
        </span>
        <span v-else class="text-sm font-medium text-content-primary">
          未检测到候选岗位
        </span>
      </div>
      <p class="text-sm text-content-secondary">
        先使用简历生成单岗位匹配报告，再回到岗位确认；综合报告用于理解候选池共性，不会触发自动发送或投递。
      </p>
      <div v-if="selectedJobs.length" class="space-y-2">
        <div class="text-xs font-semibold text-content-secondary">候选上下文</div>
        <div class="grid gap-2 lg:grid-cols-2">
          <div
            v-for="job in candidateContextJobs"
            :key="`candidate-context-${job.encrypt_job_id}`"
            class="rounded-lg bg-card/70 p-3 text-xs ring-1 ring-border/10"
          >
            <div class="truncate font-medium text-content-primary">
              {{ job.position_name ?? job.encrypt_job_id }}
            </div>
            <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-content-muted">
              <span v-if="job.brand_name">{{ job.brand_name }}</span>
              <span v-if="job.city_name">{{ job.city_name }}</span>
              <span v-if="job.score_trace">{{ job.score_trace }}</span>
            </div>
            <div class="mt-2 space-y-1 text-content-muted">
              <div v-if="job.source_strategy_trace">{{ job.source_strategy_trace }}</div>
              <div v-if="job.filter_trace">采后规则：{{ job.filter_trace }}</div>
              <div v-if="job.communication_trace">沟通追踪：{{ job.communication_trace }}</div>
              <div v-if="job.source_trace">来源追踪：{{ job.source_trace }}</div>
            </div>
          </div>
        </div>
        <div v-if="selectedJobs.length > candidateContextJobs.length" class="text-xs text-content-muted">
          其余 {{ selectedJobs.length - candidateContextJobs.length }} 个候选岗位已载入，将一并参与分析。
        </div>
      </div>
    </div>

    <AiProfileInputs
      :tauri="tauri"
      v-model:contextText="contextText"
      v-model:resumeMode="resumeMode"
      v-model:resumeText="resumeText"
      v-model:resumeFilePath="resumeFilePath"
    />

    <div class="flex flex-wrap items-center gap-3">
      <button
        class="ui-btn-primary"
        :disabled="!tauri || loading || groupLoading"
        @click="analyze"
      >
        {{ loading ? "分析中…" : "一键生成报告" }}
      </button>

      <button
        class="ui-btn-secondary"
        :disabled="!tauri || loading || groupLoading"
        @click="analyzeGroup"
      >
        {{ groupLoading ? "分析中…" : "生成综合报告（无需简历）" }}
      </button>

      <button
        class="ui-btn-secondary"
        :disabled="!tauri"
        @click="saveSettings"
      >
        保存上次输入
      </button>

      <span v-if="profileUpdatedAt" class="text-xs text-content-muted">
        上次保存：{{ profileUpdatedAt }}
      </span>

      <label class="flex items-center gap-2 text-sm text-content-secondary">
        <input v-model="force" type="checkbox" class="h-4 w-4 rounded border-white/20 bg-input/80" />
        强制重新生成（忽略缓存）
      </label>
    </div>

    <div
      v-if="error"
      class="rounded-lg bg-red-500/10 p-4 text-sm text-accent-danger ring-1 ring-white/[0.06]"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="font-semibold">{{ errorTitle }}</div>
          <div class="mt-1 text-xs text-content-secondary">{{ errorHint }}</div>
        </div>
        <button class="ui-btn-secondary px-3 py-1 text-xs" type="button" :disabled="loading || groupLoading" @click="retryAnalyze">
          强制重试
        </button>
      </div>
      <pre class="mt-3 whitespace-pre-wrap">{{ error }}</pre>
    </div>

    <div
      v-if="groupError"
      class="rounded-lg bg-red-500/10 p-4 text-sm text-accent-danger ring-1 ring-white/[0.06]"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="font-semibold">{{ groupErrorTitle }}</div>
          <div class="mt-1 text-xs text-content-secondary">{{ groupErrorHint }}</div>
        </div>
        <button class="ui-btn-secondary px-3 py-1 text-xs" type="button" :disabled="loading || groupLoading" @click="retryAnalyzeGroup">
          强制重试
        </button>
      </div>
      <pre class="mt-3 whitespace-pre-wrap">{{ groupError }}</pre>
    </div>
	  </section>
</template>
