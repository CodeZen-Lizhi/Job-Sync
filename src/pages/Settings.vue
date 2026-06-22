<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";

import UiSelect from "../components/ui/UiSelect.vue";
import AiProfileInputs from "../components/ai/AiProfileInputs.vue";
import { CRAWL_TASK_TYPE_LOGIN, JOB_SOURCE_PLATFORM_OPTIONS } from "../lib/crawl";
import { runtime } from "../lib/runtime";
import { invoke, isTauri } from "../lib/tauri";
import { useCopy } from "../lib/useCopy";

interface AppSettings {
  browser_executable_path?: string | null;
  openai_provider?: string | null;
  openai_api_key?: string | null;
  has_openai_api_key?: boolean | null;
  openai_base_url?: string | null;
  openai_model?: string | null;
  openai_api_mode?: string | null;
  openai_temperature?: number | null;
  openai_prompt_extra?: string | null;
  openai_schema_extra?: string | null;
  ai_greeting_prompt_extra?: string | null;
  telegram_bot_token?: string | null;
  has_telegram_bot_token?: boolean | null;
  telegram_chat_id?: string | null;
  has_telegram_chat_id?: boolean | null;
  proxy_url?: string | null;
  ai_resume_text?: string | null;
  ai_profile_updated_at?: string | null;
}

interface ModelInfo {
  id: string;
  owned_by: string;
}

interface JobSourceEntry {
  platform: string;
  display_name: string;
  adapter_kind: string;
  enabled: boolean;
  config_json?: string | null;
  created_at: string;
  updated_at: string;
}

interface BossSessionDiagnostic {
  status: string;
  checked_at: string;
  message: string;
  ready: boolean;
  cookies_present: boolean;
  cookies_valid_json: boolean;
  local_storage_present: boolean;
  local_storage_valid_json: boolean;
}

interface ModelServiceDiagnostic {
  status: string;
  checked_at: string;
  message: string;
  provider?: string | null;
  base_url?: string | null;
  model_count?: number | null;
  model_sample: string[];
}

interface TelegramDiagnostic {
  status: string;
  checked_at: string;
  message: string;
  has_bot_token: boolean;
  bot_token_valid: boolean;
  has_chat_id: boolean;
  chat_id_valid: boolean;
}

interface ExternalDependencyDiagnostics {
  checked_at: string;
  boss_session: BossSessionDiagnostic;
  model_service: ModelServiceDiagnostic;
  telegram: TelegramDiagnostic;
}

const tauri = isTauri();

const browserExecutablePath = ref("");
const provider = ref("openai_compatible");
const apiKey = ref("");
const hasSavedApiKey = ref(false);
const baseUrl = ref("");
const model = ref("");
const apiMode = ref("chat_completions");
const temperature = ref(0.2);
const promptExtra = ref("");
const schemaExtra = ref("");
const greetingPromptExtra = ref("");
const telegramBotToken = ref("");
const hasSavedTelegramBotToken = ref(false);
const telegramChatId = ref("");
const hasSavedTelegramChatId = ref(false);
const proxyUrl = ref("");
const resumeText = ref("");

const models = ref<ModelInfo[]>([]);
const jobSources = ref<JobSourceEntry[]>([]);
const diagnostics = ref<ExternalDependencyDiagnostics | null>(null);
const modelsLoading = ref(false);
const sourcesLoading = ref(false);
const sourceUpdatingPlatform = ref<string | null>(null);
const loginStatusByPlatform = ref<Record<string, boolean | null>>({
  boss: null,
  linuxdo: null,
});
const loginLoadingPlatform = ref<string | null>(null);
const loginLoading = ref(false);
const loginError = ref<string | null>(null);
const sidecarRunning = computed(() => runtime.sidecarTask.running);
const diagnosticsLoading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const success = ref(false);
const { copy, copyLabel } = useCopy();
const previewJobSources = JOB_SOURCE_PLATFORM_OPTIONS.map((source) => ({
  platform: source.value,
  display_name: source.label,
  adapter_kind: source.adapterKind,
  enabled: source.value === "boss",
  config_json: null,
  created_at: "",
  updated_at: "预览",
}));
const visibleJobSources = computed(() => (jobSources.value.length > 0 ? jobSources.value : previewJobSources));
const loginCapablePlatforms = new Set(["boss", "linuxdo"]);
const automatedLoginPlatforms = new Set(["boss"]);

const PROVIDER_PRESETS = {
  openai_compatible: {
    label: "OpenAI Compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiMode: "chat_completions",
    temperature: 0.2,
    help: "适用于 OpenAI 以及兼容 /v1/chat/completions 的服务。",
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiMode: "chat_completions",
    temperature: 0.2,
    help: "DeepSeek 使用 OpenAI-compatible Chat Completions 协议。",
  },
  ollama: {
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    apiMode: "chat_completions",
    temperature: 0.2,
    help: "Ollama 本地兼容接口通常不校验 API Key；需要时可填任意占位值。",
  },
} as const;

type ProviderPresetKey = keyof typeof PROVIDER_PRESETS;

const selectedProviderHelp = computed(() => PROVIDER_PRESETS[provider.value as ProviderPresetKey]?.help ?? "");

async function loadSettings(): Promise<void> {
  if (!tauri) return;
  try {
    const settings = await invoke<AppSettings>("get_settings");
    browserExecutablePath.value = settings.browser_executable_path ?? "";
    const savedProvider = settings.openai_provider?.trim().toLowerCase();
    if (savedProvider === "deepseek" || savedProvider === "ollama" || savedProvider === "openai_compatible") {
      provider.value = savedProvider;
    } else if ((settings.openai_base_url ?? "").includes("deepseek")) {
      provider.value = "deepseek";
    } else if ((settings.openai_base_url ?? "").includes("11434")) {
      provider.value = "ollama";
    } else {
      provider.value = "openai_compatible";
    }
    apiKey.value = "";
    hasSavedApiKey.value = typeof settings.has_openai_api_key === "boolean"
      ? settings.has_openai_api_key
      : !!settings.openai_api_key;
    baseUrl.value = settings.openai_base_url ?? "";
    model.value = settings.openai_model ?? "";
    temperature.value = clampTemperature(settings.openai_temperature ?? 0.2);
    promptExtra.value = settings.openai_prompt_extra ?? "";
    schemaExtra.value = settings.openai_schema_extra ?? "";
    greetingPromptExtra.value = settings.ai_greeting_prompt_extra ?? "";
    telegramBotToken.value = "";
    hasSavedTelegramBotToken.value = typeof settings.has_telegram_bot_token === "boolean"
      ? settings.has_telegram_bot_token
      : !!settings.telegram_bot_token;
    telegramChatId.value = "";
    hasSavedTelegramChatId.value = typeof settings.has_telegram_chat_id === "boolean"
      ? settings.has_telegram_chat_id
      : !!settings.telegram_chat_id;
    proxyUrl.value = settings.proxy_url ?? "";
    if (!resumeText.value.trim() && settings.ai_resume_text) resumeText.value = settings.ai_resume_text;
    if (settings.openai_api_mode) {
      const m = settings.openai_api_mode.trim().toLowerCase();
      if (m === "responses") apiMode.value = "responses";
      if (m === "chat_completions" || m === "chat" || m === "chat/completions") apiMode.value = "chat_completions";
    }
  } catch {
    // ignore
  }
}

function applyProviderPreset(): void {
  const preset = PROVIDER_PRESETS[provider.value as ProviderPresetKey];
  if (!preset) return;
  baseUrl.value = preset.baseUrl;
  model.value = preset.model;
  apiMode.value = preset.apiMode;
  temperature.value = preset.temperature;
  models.value = [];
}

function clearSavedApiKey(): void {
  apiKey.value = "";
  hasSavedApiKey.value = false;
}

function clearSavedTelegramConfig(): void {
  telegramBotToken.value = "";
  hasSavedTelegramBotToken.value = false;
  telegramChatId.value = "";
  hasSavedTelegramChatId.value = false;
}

function automaticCollectionLabel(source: JobSourceEntry): string {
  if (source.adapter_kind === "boss") return "支持自动采集";
  if (source.adapter_kind === "feed") return "支持自动采集";
  return "自动采集预留";
}

function platformCapabilityHint(source: JobSourceEntry): string {
  if (source.adapter_kind === "boss") {
    return "启用后可在采集配置中作为本次自动采集来源；登录态在本页按平台管理。";
  }
  if (source.platform === "linuxdo") {
    return "LinuxDo 受 Cloudflare 保护；请用本机浏览器登录，避免自动化浏览器触发人机验证。";
  }
  if (source.adapter_kind === "feed") {
    return "启用后可在采集配置中作为公开 Feed 自动采集来源；无需平台登录。";
  }
  return "当前保留为统一职位来源维度；自动采集、平台登录和职位库写入入口后续再接入。";
}

function platformLoginLabel(source: JobSourceEntry): string {
  if (source.adapter_kind === "feed") return "无需登录";
  if (!loginCapablePlatforms.has(source.platform)) return "登录预留";
  if (source.platform === "linuxdo") return "浏览器登录";
  const platformName = source.display_name || source.platform;
  const status = loginStatusByPlatform.value[source.platform] ?? null;
  if (status === true) return `${platformName} 已登录`;
  if (status === false) return `${platformName} 未登录`;
  return `${platformName} 登录状态未知`;
}

function platformLoginBadgeClass(source: JobSourceEntry): string {
  if (source.adapter_kind === "feed") return "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20";
  if (!loginCapablePlatforms.has(source.platform)) return "bg-slate-400/10 text-slate-300 ring-slate-400/20";
  if (source.platform === "linuxdo") return "bg-cyan-400/10 text-cyan-300 ring-cyan-400/20";
  const status = loginStatusByPlatform.value[source.platform] ?? null;
  if (status === true) return "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20";
  if (status === false) return "bg-rose-400/10 text-rose-300 ring-rose-400/20";
  return "bg-amber-400/10 text-amber-300 ring-amber-400/20";
}

async function loadModels(): Promise<void> {
  if (!tauri) return;
  modelsLoading.value = true;
  error.value = null;
  try {
    models.value = await invoke<ModelInfo[]>("list_models", {
      apiKey: apiKey.value.trim() || null,
      baseUrl: baseUrl.value.trim() || null,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    modelsLoading.value = false;
  }
}

async function loadJobSources(): Promise<void> {
  sourcesLoading.value = true;
  error.value = null;
  if (!tauri) {
    sourcesLoading.value = false;
    return;
  }
  try {
    jobSources.value = await invoke<JobSourceEntry[]>("list_job_sources");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    sourcesLoading.value = false;
  }
}

async function setJobSourceEnabled(source: JobSourceEntry, enabled: boolean): Promise<void> {
  if (!tauri || sourceUpdatingPlatform.value) return;
  sourceUpdatingPlatform.value = source.platform;
  error.value = null;
  try {
    jobSources.value = await invoke<JobSourceEntry[]>("set_job_source_enabled", {
      platform: source.platform,
      enabled,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    sourceUpdatingPlatform.value = null;
  }
}

async function refreshPlatformLogin(sourcePlatform = "boss"): Promise<void> {
  loginError.value = null;
  const platform = sourcePlatform.trim().toLowerCase() || "boss";
  if (!tauri) {
    loginStatusByPlatform.value = { ...loginStatusByPlatform.value, [platform]: null };
    return;
  }
  try {
    const status = await invoke<boolean>("get_login_status", { sourcePlatform: platform });
    loginStatusByPlatform.value = { ...loginStatusByPlatform.value, [platform]: status };
  } catch (e) {
    loginError.value = e instanceof Error ? e.message : String(e);
  }
}

async function refreshSupportedLoginStatuses(): Promise<void> {
  await Promise.all(Array.from(automatedLoginPlatforms).map((platform) => refreshPlatformLogin(platform)));
}

async function startPlatformLogin(source: JobSourceEntry): Promise<void> {
  loginError.value = null;
  if (!loginCapablePlatforms.has(source.platform)) return;
  if (!tauri) return;

  if (source.platform === "linuxdo") {
    loginLoadingPlatform.value = source.platform;
    try {
      await openUrl("https://linux.do/");
    } catch (e) {
      loginError.value = e instanceof Error ? e.message : String(e);
    } finally {
      loginLoadingPlatform.value = null;
    }
    return;
  }

  loginLoadingPlatform.value = source.platform;
  loginLoading.value = true;
  try {
    runtime.sidecarTask.running = true;
    runtime.sidecarTask.type = CRAWL_TASK_TYPE_LOGIN;
    await invoke<void>("start_login", { sourcePlatform: source.platform });
  } catch (e) {
    loginError.value = e instanceof Error ? e.message : String(e);
    if (runtime.sidecarTask.type === CRAWL_TASK_TYPE_LOGIN) {
      runtime.sidecarTask.running = false;
      runtime.sidecarTask.type = undefined;
    }
  } finally {
    loginLoading.value = false;
    loginLoadingPlatform.value = null;
  }
}

async function runExternalDiagnostics(): Promise<void> {
  if (!tauri) return;
  diagnosticsLoading.value = true;
  error.value = null;
  try {
    diagnostics.value = await invoke<ExternalDependencyDiagnostics>("diagnose_external_dependencies", {
      apiKey: apiKey.value.trim() || null,
      baseUrl: baseUrl.value.trim() || null,
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    diagnosticsLoading.value = false;
  }
}

function availabilityLabel(value: boolean): string {
  return value ? "是" : "否";
}

function parseabilityLabel(value: boolean): string {
  return value ? "可解析" : "不可解析或缺失";
}

function buildExternalDiagnosticsSummary(value: ExternalDependencyDiagnostics): string {
  const modelLines = [
    `模型服务：${diagnosticStatusLabel(value.model_service.status)}`,
    `- 供应商：${value.model_service.provider || provider.value || "-"}`,
    typeof value.model_service.model_count === "number"
      ? `- 模型数：${value.model_service.model_count}`
      : "- 模型数：未读取",
  ];

  if (value.model_service.model_sample.length > 0) {
    modelLines.push(`- 样例：${value.model_service.model_sample.join("、")}`);
  }

  return [
    "Job-Sync 外部依赖诊断摘要",
    `检查时间：${value.checked_at}`,
    "使用边界：仅用于本机依赖验收记录；不会触发采集、投递、开聊或 Telegram 发送；不包含 Key、Bot Token、Chat ID、Cookie 或 LocalStorage。",
    "",
    `Boss 登录复用：${diagnosticStatusLabel(value.boss_session.status)}`,
    `- Cookie 文件：${availabilityLabel(value.boss_session.cookies_present)} / JSON：${parseabilityLabel(value.boss_session.cookies_valid_json)}`,
    `- LocalStorage 文件：${availabilityLabel(value.boss_session.local_storage_present)} / JSON：${parseabilityLabel(value.boss_session.local_storage_valid_json)}`,
    "",
    ...modelLines,
    "",
    `Telegram 通知：${diagnosticStatusLabel(value.telegram.status)}`,
    `- Bot Token 已保存：${availabilityLabel(value.telegram.has_bot_token)}`,
    `- Bot Token 格式：${value.telegram.bot_token_valid ? "有效" : "待检查"}`,
    `- Chat ID 已保存：${availabilityLabel(value.telegram.has_chat_id)}`,
    `- Chat ID 格式：${value.telegram.chat_id_valid ? "有效" : "待检查"}`,
    "- 发送边界：只通过 AI 采后判断触发，不由设置页自动发送。",
  ].join("\n");
}

async function copyExternalDiagnosticsSummary(): Promise<void> {
  if (!diagnostics.value) return;
  await copy("external_diagnostics_summary", buildExternalDiagnosticsSummary(diagnostics.value));
}

async function save(): Promise<void> {
  if (!tauri) return;
  saving.value = true;
  error.value = null;
  success.value = false;
  try {
    const saved = await invoke<AppSettings>("save_settings", {
      browserExecutablePath: browserExecutablePath.value.trim() || null,
      openaiProvider: provider.value,
      openaiApiKey: apiKey.value.trim() || (hasSavedApiKey.value ? null : ""),
      openaiBaseUrl: baseUrl.value.trim() || null,
      openaiModel: model.value.trim() || null,
      openaiApiMode: apiMode.value,
      openaiTemperature: clampTemperature(temperature.value),
      openaiPromptExtra: promptExtra.value.trim() || null,
      openaiSchemaExtra: schemaExtra.value.trim() || null,
      aiGreetingPromptExtra: greetingPromptExtra.value.trim() || null,
      telegramBotToken: telegramBotToken.value.trim() || (hasSavedTelegramBotToken.value ? null : ""),
      telegramChatId: telegramChatId.value.trim() || (hasSavedTelegramChatId.value ? null : ""),
      proxyUrl: proxyUrl.value.trim() || null,
      aiResumeText: resumeText.value.trim() || null,
      aiContextText: "",
      aiResumeFiles: "",
    });
    hasSavedApiKey.value = typeof saved.has_openai_api_key === "boolean"
      ? saved.has_openai_api_key
      : !!apiKey.value.trim() || hasSavedApiKey.value;
    apiKey.value = "";
    hasSavedTelegramBotToken.value = typeof saved.has_telegram_bot_token === "boolean"
      ? saved.has_telegram_bot_token
      : !!telegramBotToken.value.trim() || hasSavedTelegramBotToken.value;
    hasSavedTelegramChatId.value = typeof saved.has_telegram_chat_id === "boolean"
      ? saved.has_telegram_chat_id
      : !!telegramChatId.value.trim() || hasSavedTelegramChatId.value;
    telegramBotToken.value = "";
    telegramChatId.value = "";
    proxyUrl.value = saved.proxy_url ?? proxyUrl.value.trim();
    success.value = true;
    setTimeout(() => { success.value = false; }, 2000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return 0.2;
  if (value < 0) return 0;
  if (value > 2) return 2;
  return Number(value.toFixed(2));
}

function diagnosticBadgeClass(status?: string): string {
  if (status === "ok") return "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20";
  if (status === "error") return "bg-rose-400/10 text-rose-300 ring-rose-400/20";
  return "bg-amber-400/10 text-amber-300 ring-amber-400/20";
}

function diagnosticStatusLabel(status?: string): string {
  if (status === "ok") return "正常";
  if (status === "error") return "失败";
  return "待处理";
}

onMounted(() => {
  void loadSettings();
  void loadJobSources();
  void refreshSupportedLoginStatuses();
});

watch(
  () => diagnostics.value?.boss_session.ready,
  (ready) => {
    if (typeof ready === "boolean") {
      loginStatusByPlatform.value = { ...loginStatusByPlatform.value, boss: ready };
    }
  },
);

watch(
  () => runtime.lastCookieCollectedAt,
  () => {
    void refreshSupportedLoginStatuses();
  },
);
</script>

<template>
  <section class="space-y-6">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-content-primary">设置</h1>
      <p class="text-sm text-content-secondary">浏览器路径、模型供应商与 OpenAI-compatible API 配置。</p>
    </header>

    <div
      v-if="!tauri"
      class="ui-status-warning p-4 text-sm"
    >
      当前是浏览器模式（非 Tauri）。设置不可用。
    </div>

    <!-- Platform Capability Model -->
    <div class="space-y-3">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">平台能力</div>
      <div class="ui-panel-muted p-5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div class="text-xs font-medium text-content-primary">统一职位来源与平台能力</div>
            <div class="text-xs text-content-muted">启用表示平台可作为职位来源；是否参与某次采集由采集配置的本次采集来源决定。</div>
          </div>
          <button class="ui-btn-secondary px-3 py-1.5 text-xs" type="button" :disabled="!tauri || sourcesLoading" @click="loadJobSources">
            {{ sourcesLoading ? "读取中…" : "刷新平台" }}
          </button>
        </div>
        <div class="mt-4 divide-y divide-border/10 overflow-hidden rounded-md border border-border/10">
          <div v-for="source in visibleJobSources" :key="source.platform" class="grid gap-3 px-3 py-3 text-sm md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
            <div class="flex flex-wrap gap-2">
              <span
                class="ui-badge"
                :class="source.enabled ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20' : 'bg-slate-400/10 text-slate-300 ring-slate-400/20'"
              >
                {{ source.enabled ? "已启用" : "未启用" }}
              </span>
              <span
                class="ui-badge"
                :class="source.adapter_kind === 'boss' || source.adapter_kind === 'feed' ? 'bg-cyan-400/10 text-cyan-300 ring-cyan-400/20' : 'bg-amber-400/10 text-amber-300 ring-amber-400/20'"
              >
                {{ automaticCollectionLabel(source) }}
              </span>
              <span class="ui-badge" :class="platformLoginBadgeClass(source)">
                {{ platformLoginLabel(source) }}
              </span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-content-primary">{{ source.display_name }}</div>
              <div class="mt-0.5 text-xs text-content-muted">
                平台：{{ source.platform }} · 适配器：{{ source.adapter_kind }} · 更新：{{ source.updated_at }}
              </div>
              <div class="mt-1 text-xs text-content-muted">{{ platformCapabilityHint(source) }}</div>
            </div>
            <div class="flex flex-wrap items-center justify-start gap-2 md:justify-end">
              <button
                class="inline-flex min-w-[6.25rem] items-center gap-2 rounded-full px-2 py-1 text-xs font-medium ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
                :class="source.enabled ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20 hover:bg-emerald-400/15' : 'bg-slate-400/10 text-slate-300 ring-slate-400/20 hover:bg-slate-400/15'"
                :disabled="!tauri || sourcesLoading || sourceUpdatingPlatform !== null"
                @click="setJobSourceEnabled(source, !source.enabled)"
                :aria-pressed="source.enabled"
              >
                <span
                  class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
                  :class="source.enabled ? 'bg-emerald-400/80' : 'bg-slate-500/60'"
                >
                  <span
                    class="h-4 w-4 rounded-full bg-white shadow transition-transform"
                    :class="source.enabled ? 'translate-x-4' : 'translate-x-0.5'"
                  />
                </span>
                <span>{{ sourceUpdatingPlatform === source.platform ? "保存中…" : source.enabled ? "禁用" : "启用" }}</span>
              </button>
              <template v-if="loginCapablePlatforms.has(source.platform)">
                <button
                  class="ui-btn-primary px-3 py-1.5 text-xs"
                  type="button"
                  :disabled="!tauri || !source.enabled || loginLoading || sidecarRunning"
                  @click="startPlatformLogin(source)"
                >
                  {{ loginLoadingPlatform === source.platform ? "打开中…" : source.platform === "linuxdo" ? "打开" : "登录" }}
                </button>
                <button
                  v-if="automatedLoginPlatforms.has(source.platform)"
                  class="ui-btn-secondary px-3 py-1.5 text-xs"
                  type="button"
                  :disabled="!tauri || !source.enabled"
                  @click="refreshPlatformLogin(source.platform)"
                >
                  刷新登录
                </button>
              </template>
              <button v-else-if="source.adapter_kind === 'feed'" class="ui-btn-secondary px-3 py-1.5 text-xs" type="button" disabled>无需登录</button>
              <button v-else class="ui-btn-secondary px-3 py-1.5 text-xs" type="button" disabled>登录预留</button>
            </div>
          </div>
        </div>
        <div v-if="loginError" class="mt-3 ui-status-danger p-3 text-xs">{{ loginError }}</div>
      </div>
    </div>

    <!-- Browser Config -->
    <div class="space-y-3">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">浏览器</div>
      <div class="ui-panel-muted p-5">
        <label class="block space-y-1">
          <div class="text-xs font-medium text-content-muted">浏览器路径（用于 Puppeteer）</div>
          <input
            v-model="browserExecutablePath"
            class="ui-input w-full"
            placeholder="C:\Program Files\Google\Chrome\Application\chrome.exe"
          />
          <div class="text-xs text-content-muted">Mac 默认使用 Google Chrome.app 路径；必要时可改为本机 Chrome/Edge 可执行文件。</div>
        </label>
      </div>
    </div>

    <!-- Network Proxy Config -->
    <div class="space-y-3">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">网络代理</div>
      <div class="ui-panel-muted p-5">
        <label class="block space-y-1">
          <div class="text-xs font-medium text-content-muted">Worker 代理 URL（可选）</div>
          <input
            v-model="proxyUrl"
            class="ui-input w-full"
            placeholder="例如：http://127.0.0.1:7890"
          />
          <div class="text-xs text-content-muted">
            保存后会注入到采集与 AI worker 的 HTTP_PROXY、HTTPS_PROXY 和 ALL_PROXY；本地 localhost 会保持直连。
          </div>
        </label>
      </div>
    </div>

    <!-- AI Provider Config -->
    <div class="space-y-3">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">模型供应商</div>

      <div class="ui-panel-muted grid gap-4 p-5 md:grid-cols-2">
        <label class="block space-y-1 md:col-span-2">
          <div class="text-xs font-medium text-content-muted">供应商预设</div>
          <div class="flex flex-col gap-2 sm:flex-row">
            <div class="flex-1">
              <UiSelect v-model="provider">
                <option value="openai_compatible">OpenAI Compatible</option>
                <option value="deepseek">DeepSeek</option>
                <option value="ollama">Ollama（本地）</option>
              </UiSelect>
            </div>
            <button class="ui-btn-secondary shrink-0" type="button" @click="applyProviderPreset">应用预设</button>
          </div>
          <div class="text-xs text-content-muted">{{ selectedProviderHelp }}</div>
        </label>

        <label class="block space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-content-muted">API Key</span>
            <span class="ui-badge">{{ hasSavedApiKey ? "已保存，当前不回显" : "未保存" }}</span>
          </div>
          <input
            v-model="apiKey"
            type="password"
            class="ui-input w-full"
            autocomplete="new-password"
            placeholder="输入新 Key；留空则保留已保存 Key 或使用环境变量"
          />
          <div class="flex flex-wrap items-center gap-2 text-xs text-content-muted">
            <span>已保存的 Key 不会在 UI 明文展示。保存空输入会保留旧 Key。</span>
            <button v-if="hasSavedApiKey" class="ui-btn-secondary px-2 py-1 text-xs" type="button" @click="clearSavedApiKey">清除已保存 Key</button>
          </div>
        </label>

        <label class="block space-y-1">
          <div class="text-xs font-medium text-content-muted">Base URL</div>
          <input
            v-model="baseUrl"
            class="ui-input w-full"
            placeholder="例如：https://api.openai.com/v1"
          />
        </label>

        <label class="block space-y-1 md:col-span-2">
          <div class="text-xs font-medium text-content-muted">API 接口</div>
          <UiSelect v-model="apiMode">
            <option value="chat_completions">Chat Completions（/v1/chat/completions）</option>
            <option value="responses">Responses（/v1/responses）</option>
          </UiSelect>
          <div class="text-xs text-content-muted">
            DeepSeek 和 Ollama 预设使用 Chat Completions；只有服务端明确支持 OpenAI Responses API 时再切换。
          </div>
        </label>

        <label class="block space-y-1 md:col-span-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-content-muted">Temperature</span>
            <span class="ui-badge">{{ clampTemperature(temperature).toFixed(2) }}</span>
          </div>
          <input
            v-model.number="temperature"
            class="ui-input w-full"
            type="number"
            min="0"
            max="2"
            step="0.05"
          />
          <div class="text-xs text-content-muted">
            建议保持 0.2；越低输出越稳定，越高越发散。保存时会限制在 0-2。
          </div>
        </label>

        <!-- Model dropdown with load button -->
        <div class="block space-y-1 md:col-span-2">
          <div class="text-xs font-medium text-content-muted">Model（可选）</div>
          <div class="flex items-center gap-2">
            <div class="flex-1">
              <UiSelect v-if="models.length > 0" v-model="model">
                <option value="">不指定（使用默认）</option>
                <option v-for="m in models" :key="m.id" :value="m.id">
                  {{ m.id }}
                </option>
              </UiSelect>
              <input
                v-else
                v-model="model"
                class="ui-input w-full"
                placeholder="点击右侧按钮加载模型列表，或手动输入模型名"
              />
            </div>
            <button
              class="ui-btn-secondary shrink-0"
              :disabled="!tauri || modelsLoading"
              @click="loadModels"
            >
              {{ modelsLoading ? "加载中…" : "加载模型" }}
            </button>
          </div>
          <div v-if="models.length > 0" class="ui-badge mt-1">
            已加载 {{ models.length }} 个模型
          </div>
        </div>

        <label class="block space-y-1 md:col-span-2">
          <div class="text-xs font-medium text-content-muted">补充 Prompt（可选）</div>
          <textarea
            v-model="promptExtra"
            class="ui-input min-h-28 w-full resize-y"
            placeholder="例如：回答更保守；优先关注 Go / Kubernetes / SRE；风险说明必须引用 JD 原文。"
          />
          <div class="text-xs text-content-muted">
            会追加到 AI 系统提示中；不会覆盖结构化 JSON 输出和不得编造事实的内置要求。
          </div>
        </label>

        <label class="block space-y-1 md:col-span-2">
          <div class="text-xs font-medium text-content-muted">结构化输出 Schema 补充（可选）</div>
          <textarea
            v-model="schemaExtra"
            class="ui-input min-h-28 w-full resize-y"
            placeholder="例如：额外输出 evidenceLevel 字段，取值 low / medium / high；每条 riskNotes 必须引用岗位或简历证据。"
          />
          <div class="text-xs text-content-muted">
            会追加到 AI 结构化输出提示中；只能增加字段说明或收紧约束，不能删除内置必填字段或改变内置字段类型。
          </div>
        </label>

        <label class="block space-y-1 md:col-span-2">
          <div class="text-xs font-medium text-content-muted">打招呼文案补充提示（可选）</div>
          <textarea
            v-model="greetingPromptExtra"
            class="ui-input min-h-28 w-full resize-y"
            placeholder="例如：语气更自然；优先突出项目成果和技术栈交集；不要写成群发模板。"
          />
          <div class="text-xs text-content-muted">
            只会影响“打招呼”生成，不会影响公司评分。
          </div>
        </label>
      </div>
    </div>

    <!-- AI Resume Config -->
    <div class="space-y-3">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">简历</div>
      <AiProfileInputs
        v-model:resumeText="resumeText"
      />
    </div>
    <!-- External Notification Config -->
    <div class="space-y-3">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">外部通知</div>
      <div class="ui-panel-muted grid gap-4 p-5 md:grid-cols-2">
        <label class="block space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-content-muted">Telegram Bot Token</span>
            <span class="ui-badge">{{ hasSavedTelegramBotToken ? "已保存，当前不回显" : "未保存" }}</span>
          </div>
          <input
            v-model="telegramBotToken"
            type="password"
            class="ui-input w-full"
            autocomplete="new-password"
            placeholder="123456789:AA..."
          />
          <div class="text-xs text-content-muted">用于向 Telegram 发送 AI 采后判断摘要；留空会保留已保存 Token，点击清除后保存会删除本地 Token。</div>
        </label>
        <label class="block space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-content-muted">Telegram Chat ID</span>
            <span class="ui-badge">{{ hasSavedTelegramChatId ? "已保存，当前不回显" : "未保存" }}</span>
          </div>
          <input
            v-model="telegramChatId"
            class="ui-input w-full"
            placeholder="987654321 或 @channelname"
          />
          <div class="text-xs text-content-muted">可填写个人 chat id、群组 ID 或频道名；必须先让机器人在目标会话里收到过消息。</div>
        </label>
        <div class="md:col-span-2">
          <button
            v-if="hasSavedTelegramBotToken || hasSavedTelegramChatId"
            class="ui-btn-secondary px-2 py-1 text-xs"
            type="button"
            @click="clearSavedTelegramConfig"
          >
            清除已保存 Telegram 配置
          </button>
        </div>
      </div>
    </div>

    <!-- External Diagnostics -->
    <div class="space-y-3">
      <div class="text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">外部依赖诊断</div>
      <div class="ui-panel-muted p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-xs font-medium text-content-primary">本机依赖状态</div>
            <div class="text-xs text-content-muted">诊断只返回状态摘要，不回显 Key、Bot Token、Chat ID、Cookie 或 LocalStorage。</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              class="ui-btn-secondary px-3 py-1.5 text-xs"
              type="button"
              :disabled="!tauri || diagnosticsLoading"
              @click="runExternalDiagnostics"
            >
              {{ diagnosticsLoading ? "诊断中…" : "运行诊断" }}
            </button>
            <button
              v-if="diagnostics"
              class="ui-btn-secondary px-3 py-1.5 text-xs"
              type="button"
              @click="copyExternalDiagnosticsSummary"
            >
              {{ copyLabel("external_diagnostics_summary", "复制诊断摘要") }}
            </button>
          </div>
        </div>

        <div v-if="diagnostics" class="mt-4 grid gap-3 lg:grid-cols-3">
          <div class="rounded-md border border-border/10 bg-surface-secondary/50 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-medium text-content-primary">Boss 登录复用</div>
              <span class="ui-badge" :class="diagnosticBadgeClass(diagnostics.boss_session.status)">
                {{ diagnosticStatusLabel(diagnostics.boss_session.status) }}
              </span>
            </div>
            <div class="mt-2 text-xs leading-5 text-content-muted">{{ diagnostics.boss_session.message }}</div>
            <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span class="ui-badge" :class="diagnostics.boss_session.cookies_valid_json ? diagnosticBadgeClass('ok') : diagnosticBadgeClass('warning')">
                Cookie {{ diagnostics.boss_session.cookies_present ? "存在" : "缺失" }}
              </span>
              <span class="ui-badge" :class="diagnostics.boss_session.local_storage_valid_json ? diagnosticBadgeClass('ok') : diagnosticBadgeClass('warning')">
                LocalStorage {{ diagnostics.boss_session.local_storage_present ? "存在" : "缺失" }}
              </span>
            </div>
          </div>

          <div class="rounded-md border border-border/10 bg-surface-secondary/50 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-medium text-content-primary">模型服务</div>
              <span class="ui-badge" :class="diagnosticBadgeClass(diagnostics.model_service.status)">
                {{ diagnosticStatusLabel(diagnostics.model_service.status) }}
              </span>
            </div>
            <div class="mt-2 text-xs leading-5 text-content-muted">{{ diagnostics.model_service.message }}</div>
            <div class="mt-3 space-y-1 text-[11px] text-content-muted">
              <div>供应商：{{ diagnostics.model_service.provider || provider }}</div>
              <div>Base URL：{{ diagnostics.model_service.base_url || baseUrl || "-" }}</div>
              <div v-if="typeof diagnostics.model_service.model_count === 'number'">模型数：{{ diagnostics.model_service.model_count }}</div>
              <div v-if="diagnostics.model_service.model_sample.length > 0" class="truncate">
                样例：{{ diagnostics.model_service.model_sample.join("、") }}
              </div>
            </div>
          </div>

          <div class="rounded-md border border-border/10 bg-surface-secondary/50 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-medium text-content-primary">Telegram 通知</div>
              <span class="ui-badge" :class="diagnosticBadgeClass(diagnostics.telegram.status)">
                {{ diagnosticStatusLabel(diagnostics.telegram.status) }}
              </span>
            </div>
            <div class="mt-2 text-xs leading-5 text-content-muted">{{ diagnostics.telegram.message }}</div>
            <div class="mt-1 text-xs leading-5 text-content-muted">手动通知入口，不自动投递。</div>
            <div class="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              <span class="ui-badge" :class="diagnostics.telegram.has_bot_token ? diagnosticBadgeClass('ok') : diagnosticBadgeClass('warning')">
                Bot Token {{ diagnostics.telegram.has_bot_token ? "已保存" : "未保存" }}
              </span>
              <span class="ui-badge" :class="diagnostics.telegram.bot_token_valid ? diagnosticBadgeClass('ok') : diagnosticBadgeClass('warning')">
                Token 格式 {{ diagnostics.telegram.bot_token_valid ? "有效" : "待检查" }}
              </span>
              <span class="ui-badge" :class="diagnostics.telegram.has_chat_id ? diagnosticBadgeClass('ok') : diagnosticBadgeClass('warning')">
                Chat ID {{ diagnostics.telegram.has_chat_id ? "已保存" : "未保存" }}
              </span>
              <span class="ui-badge" :class="diagnostics.telegram.chat_id_valid ? diagnosticBadgeClass('ok') : diagnosticBadgeClass('warning')">
                ID 格式 {{ diagnostics.telegram.chat_id_valid ? "有效" : "待检查" }}
              </span>
            </div>
          </div>
        </div>

        <div v-else class="mt-4 rounded-md border border-border/10 bg-surface-secondary/50 px-3 py-4 text-sm text-content-muted">
          尚未运行诊断。
        </div>
      </div>
    </div>

    <!-- Save button -->
    <div class="flex flex-wrap items-center gap-3">
      <button
        class="ui-btn-primary"
        :disabled="!tauri || saving"
        @click="save"
      >
        {{ saving ? "保存中…" : "保存设置" }}
      </button>
      <span v-if="success" class="ui-badge bg-emerald-400/10 text-emerald-300 ring-emerald-400/20">保存成功</span>
    </div>

    <div
      v-if="error"
      class="ui-status-danger p-4 text-sm"
    >
      {{ error }}
    </div>
  </section>
</template>
