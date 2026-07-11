<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import UiSelect from "../components/ui/UiSelect.vue";
import { CRAWL_TASK_TYPE_LOGIN, formatLocalDateTime, JOB_SOURCE_PLATFORM_OPTIONS } from "../lib/crawl";
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

const SETTINGS_SECTIONS = [
  { id: "platforms", index: "01", label: "平台与登录", description: "来源开关与登录状态" },
  { id: "model", index: "02", label: "模型服务", description: "供应商、模型与提示" },
  { id: "connection", index: "03", label: "网络与浏览器", description: "代理和浏览器路径" },
  { id: "notifications", index: "04", label: "通知", description: "Telegram 投递配置" },
  { id: "diagnostics", index: "05", label: "系统诊断", description: "依赖状态与摘要" },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

const activeSection = ref<SettingsSectionId>("platforms");
const activeSettingsSection = computed(
  () => SETTINGS_SECTIONS.find((section) => section.id === activeSection.value) ?? SETTINGS_SECTIONS[0],
);

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

const models = ref<ModelInfo[]>([]);
const jobSources = ref<JobSourceEntry[]>([]);
const diagnostics = ref<ExternalDependencyDiagnostics | null>(null);
const modelsLoading = ref(false);
const sourcesLoading = ref(false);
const sourceUpdatingPlatform = ref<string | null>(null);
const loginStatusByPlatform = ref<Record<string, boolean | null>>({
  boss: null,
  liepin: null,
  linuxdo: null,
  zhilian: null,
});
const loginLoadingPlatform = ref<string | null>(null);
const loginRefreshingPlatform = ref<string | null>(null);
const loginLoading = ref(false);
const loginError = ref<string | null>(null);
const loginMessage = ref<string | null>(null);
const sidecarRunning = computed(() => runtime.sidecarTask.running);
const liveLoginMessage = computed(() => {
  if (runtime.sidecarTask.type !== CRAWL_TASK_TYPE_LOGIN) return null;
  return runtime.login.message ?? (runtime.login.status ? `登录状态：${runtime.login.status}` : null);
});
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
const loginCapablePlatforms = new Set(["boss", "liepin", "linuxdo", "zhilian"]);
const automatedLoginPlatforms = new Set(["boss", "liepin", "linuxdo", "zhilian"]);

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
  if (source.adapter_kind === "liepin") return "支持自动采集";
  if (source.adapter_kind === "zhilian") return "支持自动采集";
  return "自动采集预留";
}

function automaticCollectionBadgeClass(source: JobSourceEntry): string {
  return source.adapter_kind === "boss" || source.adapter_kind === "feed" || source.adapter_kind === "liepin" || source.adapter_kind === "zhilian"
    ? "bg-cyan-50 text-cyan-700 ring-cyan-200"
    : "bg-amber-50 text-amber-700 ring-amber-200";
}

function platformCapabilityHint(source: JobSourceEntry): string {
  if (source.adapter_kind === "boss") {
    return "启用后可在采集配置中作为本次自动采集来源；登录态在本页按平台管理。";
  }
  if (source.platform === "liepin") {
    return "猎聘搜索页会复用独立浏览器 profile；请点“打开”完成一次登录或安全验证，后续采集后台复用同一 profile。";
  }
  if (source.platform === "linuxdo") {
    return "LinuxDo 受 Cloudflare 保护；请点“打开”在应用内浏览器里完成登录，采集会复用同一 profile。";
  }
  if (source.platform === "zhilian") {
    return "智联公开路径可能触发安全验证；请点“打开”完成一次验证，后续采集后台复用同一 profile。采集时若未就绪会提示重连，不会停下来等人工验证。";
  }
  if (source.adapter_kind === "feed") {
    return "启用后可在采集配置中作为公开 Feed 自动采集来源；无需平台登录。";
  }
  return "当前保留为统一职位来源维度；自动采集、平台登录和职位库写入入口后续再接入。";
}

function platformLoginLabel(source: JobSourceEntry): string {
  if (source.platform === "linuxdo") {
    const status = loginStatusByPlatform.value[source.platform] ?? null;
    if (status === true) return "LinuxDo 已可采集";
    if (status === false) return "LinuxDo 未就绪";
    return "浏览器登录";
  }
  if (source.platform === "liepin") {
    const status = loginStatusByPlatform.value[source.platform] ?? null;
    if (status === true) return "猎聘已可采集";
    if (status === false) return "猎聘未就绪";
    return "浏览器验证";
  }
  if (source.platform === "zhilian") {
    const status = loginStatusByPlatform.value[source.platform] ?? null;
    if (status === true) return "智联已可采集";
    if (status === false) return "智联未就绪";
    return "浏览器验证";
  }
  if (source.adapter_kind === "feed") return "无需登录";
  if (!loginCapablePlatforms.has(source.platform)) return "登录预留";
  const platformName = source.display_name || source.platform;
  const status = loginStatusByPlatform.value[source.platform] ?? null;
  if (status === true) return `${platformName} 已登录`;
  if (status === false) return `${platformName} 未登录`;
  return `${platformName} 登录状态未知`;
}

function platformLoginBadgeClass(source: JobSourceEntry): string {
  if (source.platform === "linuxdo") {
    const status = loginStatusByPlatform.value[source.platform] ?? null;
    if (status === true) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    if (status === false) return "bg-rose-50 text-rose-700 ring-rose-200";
    return "bg-cyan-50 text-cyan-700 ring-cyan-200";
  }
  if (source.platform === "liepin") {
    const status = loginStatusByPlatform.value[source.platform] ?? null;
    if (status === true) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    if (status === false) return "bg-rose-50 text-rose-700 ring-rose-200";
    return "bg-cyan-50 text-cyan-700 ring-cyan-200";
  }
  if (source.platform === "zhilian") {
    const status = loginStatusByPlatform.value[source.platform] ?? null;
    if (status === true) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
    if (status === false) return "bg-rose-50 text-rose-700 ring-rose-200";
    return "bg-cyan-50 text-cyan-700 ring-cyan-200";
  }
  if (source.adapter_kind === "feed") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (!loginCapablePlatforms.has(source.platform)) return "bg-slate-100 text-slate-700 ring-slate-300";
  const status = loginStatusByPlatform.value[source.platform] ?? null;
  if (status === true) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === false) return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-amber-50 text-amber-700 ring-amber-200";
}

function liveLoginMessageClass(): string {
  if (runtime.login.status === "valid" || runtime.login.status === "ok") return "ui-status-success";
  if (runtime.login.status === "captcha" || runtime.login.status === "invalid") return "ui-status-warning";
  if (runtime.login.status === "denied") return "ui-status-danger";
  return "ui-status-warning";
}

function loginPlatformName(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  return visibleJobSources.value.find((source) => source.platform === normalized)?.display_name
    || (normalized === "boss" ? "Boss 直聘" : normalized === "liepin" ? "猎聘" : normalized === "linuxdo" ? "LinuxDo" : normalized === "zhilian" ? "智联招聘" : normalized);
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

async function refreshPlatformLogin(sourcePlatform = "boss", showMessage = false): Promise<void> {
  loginError.value = null;
  if (showMessage) loginMessage.value = null;
  const platform = sourcePlatform.trim().toLowerCase() || "boss";
  if (!tauri) {
    loginStatusByPlatform.value = { ...loginStatusByPlatform.value, [platform]: null };
    if (showMessage) loginMessage.value = `${loginPlatformName(platform)} 登录状态只在桌面端可刷新。`;
    return;
  }
  if (showMessage) loginRefreshingPlatform.value = platform;
  try {
    const status = await invoke<boolean>("get_login_status", { sourcePlatform: platform });
    loginStatusByPlatform.value = { ...loginStatusByPlatform.value, [platform]: status };
    if (showMessage) {
      const statusLabel = platform === "linuxdo" || platform === "zhilian" || platform === "liepin"
        ? status ? "已可采集" : "未就绪"
        : status ? "已登录" : "未登录";
      loginMessage.value = `${loginPlatformName(platform)} 登录状态已刷新：${statusLabel}`;
    }
  } catch (e) {
    loginError.value = e instanceof Error ? e.message : String(e);
    if (showMessage) loginMessage.value = null;
  } finally {
    if (showMessage && loginRefreshingPlatform.value === platform) {
      loginRefreshingPlatform.value = null;
    }
  }
}

async function refreshSupportedLoginStatuses(): Promise<void> {
  await Promise.all(Array.from(automatedLoginPlatforms).map((platform) => refreshPlatformLogin(platform)));
}

async function startPlatformLogin(source: JobSourceEntry): Promise<void> {
  loginError.value = null;
  if (!loginCapablePlatforms.has(source.platform)) return;
  if (!tauri) return;

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
  if (status === "ok") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (status === "error") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
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

watch(
  () => runtime.finishedCounter,
  () => {
    void refreshSupportedLoginStatuses();
  },
);

</script>

<template>
  <section class="space-y-4 pb-6">
    <header class="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold tracking-tight text-content-primary">设置</h1>
        <p class="mt-1 text-xs leading-5 text-content-muted">配置采集平台、模型服务和本机连接。</p>
      </div>
      <div class="flex items-center gap-2 text-[11px] text-content-muted">
        <span class="h-1.5 w-1.5 rounded-full" :class="tauri ? 'bg-emerald-500' : 'bg-amber-500'" />
        {{ tauri ? "桌面配置已连接" : "浏览器预览模式" }}
      </div>
    </header>

    <div v-if="!tauri" class="ui-status-warning px-3 py-2 text-xs">
      浏览器模式仅用于预览，读取和保存设置需要桌面端。
    </div>

    <div v-if="error" class="ui-status-danger px-3 py-2 text-xs">{{ error }}</div>

    <div class="grid min-w-0 gap-3 lg:grid-cols-[11rem_minmax(0,1fr)] lg:items-start">
      <nav class="min-w-0 lg:sticky lg:top-0" aria-label="设置类别">
        <div class="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface-alt/50 p-1 lg:flex-col lg:overflow-visible lg:bg-transparent lg:p-1.5">
          <button
            v-for="section in SETTINGS_SECTIONS"
            :key="section.id"
            class="group flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-border-glow/40 lg:w-full"
            :class="activeSection === section.id ? 'bg-white text-content-primary shadow-sm ring-1 ring-border' : 'text-content-muted hover:bg-white/70 hover:text-content-primary'"
            type="button"
            :aria-current="activeSection === section.id ? 'page' : undefined"
            @click="activeSection = section.id"
          >
            <span class="font-mono text-[10px] tabular-nums text-content-muted">{{ section.index }}</span>
            <span class="min-w-0">
              <span class="block whitespace-nowrap text-xs font-medium">{{ section.label }}</span>
              <span class="mt-0.5 hidden truncate text-[10px] text-content-muted lg:block">{{ section.description }}</span>
            </span>
          </button>
        </div>
      </nav>

      <section class="min-w-0 overflow-hidden rounded-lg border border-border bg-white shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
        <header class="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-content-primary">{{ activeSettingsSection.label }}</h2>
            <p class="mt-0.5 text-[11px] text-content-muted">{{ activeSettingsSection.description }}</p>
          </div>
          <span v-if="success" class="ui-badge shrink-0 bg-emerald-50 text-emerald-700 ring-emerald-200">已保存</span>
        </header>

        <div v-if="activeSection === 'platforms'" class="p-3 sm:p-4">
          <div class="mb-3 flex items-center justify-between gap-3">
            <p class="text-[11px] leading-5 text-content-muted">启用平台后，可在采集配置中选择为职位来源。</p>
            <button class="ui-btn-secondary min-h-8 shrink-0 px-2.5 py-1 text-xs" type="button" :disabled="!tauri || sourcesLoading" @click="loadJobSources">
              {{ sourcesLoading ? "读取中…" : "刷新" }}
            </button>
          </div>

          <div class="divide-y divide-border overflow-hidden rounded-md border border-border">
            <div v-for="source in visibleJobSources" :key="source.platform" class="px-3 py-3">
              <div class="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="text-sm font-medium text-content-primary">{{ source.display_name }}</span>
                    <span class="ui-badge" :class="platformLoginBadgeClass(source)">{{ platformLoginLabel(source) }}</span>
                    <span class="ui-badge" :class="automaticCollectionBadgeClass(source)">{{ automaticCollectionLabel(source) }}</span>
                  </div>
                  <div class="mt-1 font-mono text-[10px] text-content-muted">{{ source.platform }} / {{ source.adapter_kind }}</div>
                </div>

                <div class="flex flex-wrap items-center gap-1.5 xl:justify-end">
                  <button
                    class="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    :class="source.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-border bg-white text-content-secondary hover:bg-surface-alt'"
                    :disabled="!tauri || sourcesLoading || sourceUpdatingPlatform !== null"
                    :aria-pressed="source.enabled"
                    @click="setJobSourceEnabled(source, !source.enabled)"
                  >
                    <span class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors" :class="source.enabled ? 'bg-emerald-500' : 'bg-slate-400'">
                      <span class="h-3 w-3 rounded-full bg-white shadow-sm transition-transform" :class="source.enabled ? 'translate-x-3.5' : 'translate-x-0.5'" />
                    </span>
                    {{ sourceUpdatingPlatform === source.platform ? "保存中" : source.enabled ? "已启用" : "未启用" }}
                  </button>
                  <template v-if="loginCapablePlatforms.has(source.platform)">
                    <button class="ui-btn-primary min-h-8 px-2.5 py-1 text-xs" type="button" :disabled="!tauri || !source.enabled || loginLoading || sidecarRunning" @click="startPlatformLogin(source)">
                      {{ loginLoadingPlatform === source.platform ? "打开中…" : source.platform === "linuxdo" || source.platform === "zhilian" ? "打开" : "登录" }}
                    </button>
                    <button v-if="automatedLoginPlatforms.has(source.platform)" class="ui-btn-secondary min-h-8 px-2.5 py-1 text-xs" type="button" :disabled="!tauri || !source.enabled || loginRefreshingPlatform !== null" @click="refreshPlatformLogin(source.platform, true)">
                      {{ loginRefreshingPlatform === source.platform ? "检查中…" : "刷新状态" }}
                    </button>
                  </template>
                  <span v-else class="text-[11px] text-content-muted">{{ source.adapter_kind === "feed" ? "无需登录" : "登录预留" }}</span>
                </div>
              </div>

              <details class="mt-2 text-[11px] text-content-muted">
                <summary class="w-fit cursor-pointer select-none rounded text-content-secondary outline-none hover:text-content-primary focus-visible:ring-2 focus-visible:ring-border-glow/40">详情</summary>
                <div class="mt-2 rounded-md bg-surface-alt/60 px-2.5 py-2 leading-5">
                  <p>{{ platformCapabilityHint(source) }}</p>
                  <p class="mt-1">最近更新：{{ formatLocalDateTime(source.updated_at) }}</p>
                </div>
              </details>
            </div>
          </div>

          <div v-if="liveLoginMessage" class="mt-3 px-3 py-2 text-xs" :class="liveLoginMessageClass()">{{ liveLoginMessage }}</div>
          <div v-if="loginMessage" class="mt-3 ui-status-success px-3 py-2 text-xs">{{ loginMessage }}</div>
          <div v-if="loginError" class="mt-3 ui-status-danger px-3 py-2 text-xs">{{ loginError }}</div>
        </div>

        <div v-else-if="activeSection === 'model'" class="grid gap-x-3 gap-y-3 p-3 sm:p-4 md:grid-cols-2">
          <div class="space-y-1 md:col-span-2">
            <label class="ui-field-label" for="settings-provider">供应商预设</label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <div class="min-w-0 flex-1">
                <UiSelect id="settings-provider" v-model="provider">
                  <option value="openai_compatible">OpenAI Compatible</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="ollama">Ollama（本地）</option>
                </UiSelect>
              </div>
              <button class="ui-btn-secondary min-h-10 shrink-0" type="button" @click="applyProviderPreset">应用预设</button>
            </div>
            <p class="text-[11px] leading-5 text-content-muted">{{ selectedProviderHelp }}</p>
          </div>

          <label class="block min-w-0 space-y-1">
            <span class="flex items-center justify-between gap-2">
              <span class="ui-field-label">API Key</span>
              <span class="text-[10px] text-content-muted">{{ hasSavedApiKey ? "已保存" : "未保存" }}</span>
            </span>
            <input v-model="apiKey" type="password" class="ui-input w-full" autocomplete="new-password" placeholder="输入新 Key，留空保留原值" />
            <button v-if="hasSavedApiKey" class="text-[11px] text-content-muted underline-offset-2 hover:text-content-primary hover:underline" type="button" @click="clearSavedApiKey">清除已保存 Key</button>
          </label>

          <label class="block min-w-0 space-y-1">
            <span class="ui-field-label">Base URL</span>
            <input v-model="baseUrl" class="ui-input w-full" placeholder="https://api.openai.com/v1" />
          </label>

          <label class="block min-w-0 space-y-1">
            <span class="ui-field-label">API 接口</span>
            <UiSelect v-model="apiMode">
              <option value="chat_completions">Chat Completions</option>
              <option value="responses">Responses</option>
            </UiSelect>
          </label>

          <label class="block min-w-0 space-y-1">
            <span class="flex items-center justify-between gap-2">
              <span class="ui-field-label">Temperature</span>
              <span class="font-mono text-[10px] tabular-nums text-content-muted">{{ clampTemperature(temperature).toFixed(2) }}</span>
            </span>
            <input v-model.number="temperature" class="ui-input w-full" type="number" min="0" max="2" step="0.05" />
          </label>

          <div class="min-w-0 space-y-1 md:col-span-2">
            <label for="settings-model-input" class="ui-field-label">模型</label>
            <div class="flex flex-col gap-2 sm:flex-row">
              <div class="min-w-0 flex-1">
                <UiSelect v-if="models.length > 0" id="settings-model-input" v-model="model" aria-label="模型">
                  <option value="">不指定（使用默认）</option>
                  <option v-for="m in models" :key="m.id" :value="m.id">{{ m.id }}</option>
                </UiSelect>
                <input v-else id="settings-model-input" v-model="model" class="ui-input w-full" placeholder="输入模型名，或从服务加载" />
              </div>
              <button class="ui-btn-secondary min-h-10 shrink-0" type="button" :disabled="!tauri || modelsLoading" @click="loadModels">
                {{ modelsLoading ? "加载中…" : "加载模型" }}
              </button>
            </div>
            <p v-if="models.length > 0" class="text-[11px] text-content-muted">已读取 {{ models.length }} 个模型</p>
          </div>

          <details class="group rounded-md border border-border bg-surface-alt/35 md:col-span-2">
            <summary class="flex cursor-pointer select-none items-center justify-between px-3 py-2.5 text-xs font-medium text-content-primary outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-glow/40">
              高级提示
              <span class="text-[10px] font-normal text-content-muted group-open:hidden">3 项，默认收起</span>
              <span class="hidden text-[10px] font-normal text-content-muted group-open:inline">收起</span>
            </summary>
            <div class="grid gap-3 border-t border-border p-3">
              <label class="block space-y-1">
                <span class="ui-field-label">通用 AI 补充提示</span>
                <textarea v-model="promptExtra" class="ui-textarea min-h-20 w-full resize-y" placeholder="补充通用判断偏好" />
                <span class="block text-[11px] text-content-muted">用于简历匹配、岗位版简历和公司评分。</span>
              </label>
              <label class="block space-y-1">
                <span class="ui-field-label">结构化输出 Schema 补充</span>
                <textarea v-model="schemaExtra" class="ui-textarea min-h-20 w-full resize-y" placeholder="只新增兼容字段" />
                <span class="block text-[11px] text-content-muted">不能删除内置必填字段，也不能改变严格 JSON 输出。</span>
              </label>
              <label class="block space-y-1">
                <span class="ui-field-label">打招呼文案补充提示</span>
                <textarea v-model="greetingPromptExtra" class="ui-textarea min-h-20 w-full resize-y" placeholder="补充语气和内容偏好" />
              </label>
            </div>
          </details>
        </div>

        <div v-else-if="activeSection === 'connection'" class="divide-y divide-border">
          <label class="grid gap-2 px-3 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:px-4">
            <span>
              <span class="block text-xs font-medium text-content-primary">网络代理 URL</span>
              <span class="mt-0.5 block text-[11px] leading-5 text-content-muted">采集、AI 和通知共用；localhost 直连。</span>
            </span>
            <input v-model="proxyUrl" class="ui-input w-full" placeholder="http://127.0.0.1:7890" />
          </label>
          <label class="grid gap-2 px-3 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:px-4">
            <span>
              <span class="block text-xs font-medium text-content-primary">浏览器路径</span>
              <span class="mt-0.5 block text-[11px] leading-5 text-content-muted">留空时使用系统默认 Chrome。</span>
            </span>
            <input v-model="browserExecutablePath" class="ui-input w-full" placeholder="Chrome / Edge 可执行文件路径" />
          </label>
        </div>

        <div v-else-if="activeSection === 'notifications'" class="divide-y divide-border">
          <label class="grid gap-2 px-3 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:px-4">
            <span>
              <span class="block text-xs font-medium text-content-primary">Telegram Bot Token</span>
              <span class="mt-0.5 block text-[11px] text-content-muted">{{ hasSavedTelegramBotToken ? "已保存，当前不回显" : "尚未保存" }}</span>
            </span>
            <input v-model="telegramBotToken" type="password" class="ui-input w-full" autocomplete="new-password" placeholder="123456789:AA..." />
          </label>
          <label class="grid gap-2 px-3 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:px-4">
            <span>
              <span class="block text-xs font-medium text-content-primary">Telegram 通知 Chat ID</span>
              <span class="mt-0.5 block text-[11px] text-content-muted">{{ hasSavedTelegramChatId ? "已保存，当前不回显" : "个人、群组或频道" }}</span>
            </span>
            <input v-model="telegramChatId" class="ui-input w-full" placeholder="987654321 或 @channelname" />
          </label>
          <div v-if="hasSavedTelegramBotToken || hasSavedTelegramChatId" class="px-3 py-3 sm:px-4">
            <button class="text-xs text-red-600 underline-offset-2 hover:text-red-700 hover:underline" type="button" @click="clearSavedTelegramConfig">清除已保存的 Telegram 配置</button>
          </div>
        </div>

        <div v-else class="p-3 sm:p-4">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p class="text-xs font-medium text-content-primary">外部依赖诊断</p>
              <p class="mt-0.5 text-[11px] leading-5 text-content-muted">不回显 Key、Bot Token、Chat ID、Cookie 或 LocalStorage。</p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-1.5">
              <button class="ui-btn-secondary min-h-8 px-2.5 py-1 text-xs" type="button" :disabled="!tauri || diagnosticsLoading" @click="runExternalDiagnostics">
                {{ diagnosticsLoading ? "诊断中…" : "运行诊断" }}
              </button>
              <button v-if="diagnostics" class="ui-btn-secondary min-h-8 px-2.5 py-1 text-xs" type="button" @click="copyExternalDiagnosticsSummary">
                {{ copyLabel("external_diagnostics_summary", "复制诊断摘要") }}
              </button>
            </div>
          </div>

          <details class="mt-2 text-[11px] text-content-muted">
            <summary class="w-fit cursor-pointer select-none text-content-secondary outline-none hover:text-content-primary focus-visible:ring-2 focus-visible:ring-border-glow/40">安全边界</summary>
            <p class="mt-1 leading-5">仅用于本机依赖验收记录；不会触发采集、投递、开聊或 Telegram 发送。</p>
          </details>

          <div v-if="diagnostics" class="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border">
            <div class="grid gap-2 px-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start">
              <div class="text-xs font-medium text-content-primary">Boss 登录复用</div>
              <div class="min-w-0 text-[11px] leading-5 text-content-muted">
                <p>{{ diagnostics.boss_session.message }}</p>
                <p class="mt-1">Cookie {{ diagnostics.boss_session.cookies_present ? "存在" : "缺失" }} · LocalStorage {{ diagnostics.boss_session.local_storage_present ? "存在" : "缺失" }}</p>
              </div>
              <span class="ui-badge w-fit" :class="diagnosticBadgeClass(diagnostics.boss_session.status)">{{ diagnosticStatusLabel(diagnostics.boss_session.status) }}</span>
            </div>
            <div class="grid gap-2 px-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start">
              <div class="text-xs font-medium text-content-primary">模型服务</div>
              <div class="min-w-0 text-[11px] leading-5 text-content-muted">
                <p>{{ diagnostics.model_service.message }}</p>
                <p class="mt-1 break-all">{{ diagnostics.model_service.provider || provider }} · {{ diagnostics.model_service.base_url || baseUrl || "-" }}</p>
                <p v-if="typeof diagnostics.model_service.model_count === 'number'">模型数 {{ diagnostics.model_service.model_count }}</p>
              </div>
              <span class="ui-badge w-fit" :class="diagnosticBadgeClass(diagnostics.model_service.status)">{{ diagnosticStatusLabel(diagnostics.model_service.status) }}</span>
            </div>
            <div class="grid gap-2 px-3 py-3 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start">
              <div class="text-xs font-medium text-content-primary">Telegram</div>
              <div class="min-w-0 text-[11px] leading-5 text-content-muted">
                <p>{{ diagnostics.telegram.message }}</p>
                <p class="mt-1">Token {{ diagnostics.telegram.has_bot_token ? "已保存" : "未保存" }} · Chat ID {{ diagnostics.telegram.has_chat_id ? "已保存" : "未保存" }}</p>
              </div>
              <span class="ui-badge w-fit" :class="diagnosticBadgeClass(diagnostics.telegram.status)">{{ diagnosticStatusLabel(diagnostics.telegram.status) }}</span>
            </div>
          </div>

          <div v-else class="mt-3 rounded-md border border-dashed border-border bg-surface-alt/35 px-3 py-6 text-center text-xs text-content-muted">
            尚未运行诊断
          </div>
        </div>

        <footer class="flex flex-col gap-2 border-t border-border bg-surface-alt/35 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <p class="text-[11px] text-content-muted">修改只在点击保存后生效。</p>
          <button class="ui-btn-primary min-h-9 px-3 py-1.5 text-xs" type="button" :disabled="!tauri || saving" @click="save">
            {{ saving ? "保存中…" : "保存设置" }}
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>
