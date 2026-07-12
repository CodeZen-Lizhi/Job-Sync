export type BossOption = { code: number; name: string };
export type BossCityGroup = { firstChar: string; cityList: BossOption[] };
export type BossIndustryGroup = { name: string; options: BossOption[] };
export type BossFilterConditionGroup = {
  key: string;
  field: string;
  label: string;
  options: BossOption[];
};
export type ScoreWeights = {
  resume: number;
  preference: number;
  company: number;
};
export type AiUncertainStrategy = "pending_confirmation" | "filtered" | "recommended";
export type JobSourcePlatform = "boss" | "liepin" | "zhilian" | "maimai" | "v2ex" | "linuxdo";
export type JobSourcePlatformOption = {
  value: JobSourcePlatform;
  label: string;
  adapterKind: "boss" | "feed" | "liepin" | "manual_import" | "zhilian";
};
export type FilterProfilePayload = {
  aiPreferredText: string;
  aiRejectedText: string;
  aiRiskText: string;
  aiUncertainStrategy: AiUncertainStrategy;
  mustKeywords: string[];
  mustNotKeywords: string[];
  preferenceKeywords: string[];
  requiredDirections: string[];
  excludedDirections: string[];
  preferenceDirections: string[];
  requiredTechTags: string[];
  excludedTechTags: string[];
  preferenceTechTags: string[];
  requiredWorkModes: string[];
  excludedWorkModes: string[];
  preferenceWorkModes: string[];
  targetCities: string[];
  excludedCities: string[];
  sourcePlatforms: string[];
  requiredBossActiveStatuses: string[];
  excludedBossActiveStatuses: string[];
  communicationStatuses: string[];
  minimumSalaryK: number | null;
  maximumSalaryK: number | null;
  acceptNegotiableSalary: boolean;
  recentDays: number | null;
  minimumExperienceYears: number | null;
  maximumExperienceYears: number | null;
  acceptUnknownExperience: boolean;
  allowedDegrees: string[];
  excludedDegrees: string[];
  companyMustKeywords: string[];
  companyMustNotKeywords: string[];
  companyPreferenceKeywords: string[];
  companyRequiredScales: string[];
  companyExcludedScales: string[];
  companyPreferenceScales: string[];
  companyRequiredFinancingStages: string[];
  companyExcludedFinancingStages: string[];
  companyPreferenceFinancingStages: string[];
  companyRequiredIndustries: string[];
  companyExcludedIndustries: string[];
  companyPreferenceIndustries: string[];
  scoreWeights: ScoreWeights;
};

export type FilterProfileRecord = {
  id: string;
  name: string;
  profile_json: FilterProfilePayload;
  is_default: boolean;
  updated_at: string;
};

export type BucketCounts = {
  recommended: number;
  pending: number;
  filtered: number;
  processed: number;
  all: number;
};

export type RecomputeFilterProfileResult = {
  updated: number;
  counts: BucketCounts;
};

export type CollectionRun = {
  id: string;
  batch_id?: string | null;
  source_platform: string;
  keywords_json: string;
  filters_json?: string | null;
  limits_json?: string | null;
  status: string;
  started_at: string;
  finished_at?: string | null;
  error_message?: string | null;
  captured: number;
  inserted: number;
  updated: number;
  duplicate: number;
  recommended: number;
  pending: number;
  filtered: number;
  failed: number;
  processed: number;
  all_jobs: number;
};

export type CollectionBatchSummary = {
  batch_id: string;
  captured: number;
  inserted: number;
  not_inserted: number;
  passed: number;
};

export type CollectionFailure = {
  id: number;
  run_id?: string | null;
  source_platform?: string | null;
  event_type: string;
  keyword?: string | null;
  encrypt_job_id?: string | null;
  reason: string;
  raw_payload_json?: string | null;
  created_at: string;
};

export const DEFAULT_DELAY_MS = 800;
export const BOSS_META_SYNC_TIMEOUT_MS = 20_000;
export const CRAWL_TASK_TYPE_AUTO = "crawl_auto";
export const CRAWL_TASK_TYPE_LOGIN = "login";
export const CRAWL_TASK_TYPE_META_SYNC = "meta_sync";
export const CRAWL_TASK_TYPE_CHAT_SYNC = "chat_sync";
export const DEFAULT_MUST_NOT_KEYWORDS = ["外包", "驻场", "培训", "销售", "电话销售"];
export const DEFAULT_PREFERENCE_DIRECTIONS = ["Go", "Infra", "DevOps", "SRE", "平台工程", "AI Infra", "AI Agent", "云原生"];
export const DEFAULT_PREFERENCE_TECH_TAGS = ["Go", "Kubernetes", "Docker", "AWS", "Prometheus", "Linux", "CI/CD", "Terraform"];
export const DEFAULT_AI_PREFERRED_TEXT = [
  "只推荐真实、当前有效、面向候选人的具体招聘或内推岗位，并且下面所有必须条件要由同一个具体岗位同时满足：",
  "1. 必须是正式招聘或内推中的软件研发岗位，主要职责属于 Go 后端、Java 后端、AI Agent/LLM 应用开发或 AI 工程化研发。正文未标注兼职、项目制或短期合作时，可按常规全职岗位判断，不要求逐字出现“全职”。",
  "2. AI 岗位可以使用 Python，但 Python 必须主要用于 Agent、RAG、模型/API 接入、工作流编排或 AI 应用工程；纯模型训练、算法研究、数据分析不属于目标方向。",
  "3. 必须明确支持全远程、Remote 或居家办公。只要正文没有坐班、到岗、混合办公、偶尔远程或其他附加条件，即可判断满足，不要求逐字出现“长期、无条件”。",
  "4. 多岗位帖子必须能清楚定位到一个独立岗位，并确认技术方向、职责、工作方式、英语和学历等条件都属于该岗位；不得从不同岗位拼接证据。",
  "5. 必须根据具体岗位职责和任职要求判断；仅标题或正文出现 Go、Java、AI、Agent、远程等关键词不能算匹配。",
].join("\n");
export const DEFAULT_AI_REJECTED_TEXT = [
  "以下任一条件有明确岗位原文证据时直接过滤，不能被技术方向、公司品牌或其他优点抵消：",
  "1. 要求英语口语、英语交流、英文会议、英文汇报、全英面试，或以英语作为主要工作语言、需要与海外团队持续英文沟通。仅阅读英文技术文档不等同于英语交流要求。",
  "2. 不支持长期无条件全远程或居家办公，包括坐班、必须到岗、线下办公、混合办公、偶尔远程、远程可协商、试用期/磨合期后远程、表现优秀才可远程或优先坐班。",
  "3. 主要职责是前端、全栈、移动端/客户端、Flutter 或 H5 开发。",
  "4. 主要职责是产品经理/产品运营、开发者关系/Developer Advocate、销售/售前/客服或纯实施交付。",
  "5. 主要职责是纯推荐算法、算法研究、数据分析/数据科学、模型训练/微调、CV/NLP 研究等非 AI 应用研发。",
  "6. 以智能合约或 Web3 为核心主职，不能仅因同时出现 AI Agent 或 Go 就放行。",
  "7. 兼职、短期外包、项目制合作、个人寻合作/接项目，而不是正式全职招聘。",
  "8. 核心方向与 Go 后端、Java 后端、AI Agent/LLM 应用开发、AI 工程化研发无关。",
  "9. 明确要求全日制本科。",
  "10. 明显外包、驻场、人力外派、培训/招转培、低代码搭建等非目标工作。",
  "11. 内容不是具体招聘或内推岗位，而是开源项目、产品/工具介绍、AI 模拟面试、课程推广、求职经验、技术分享、自我介绍、求职/项目合作，或没有具体在招岗位和投递方式的资讯/聚合帖。",
].join("\n");
export const DEFAULT_AI_RISK_TEXT = [
  "只有在岗位事实不足、语义含糊或信息互相矛盾时才使用不确定策略，并明确说明缺少什么证据：",
  "1. 无法确认是否明确支持全远程、Remote 或居家办公，或远程是否附带到岗/混合/试用期等条件。",
  "2. 无法判断英语只是阅读要求，还是需要口语交流、英文会议或全英面试。",
  "3. 无法确认主要职责是否属于目标研发方向，而不是产品、算法研究、开发者关系、智能合约或其他非目标岗位。",
  "4. 岗位标题相关，但正文没有足够职责、技术栈、招聘主体或投递信息。",
  "5. 一个帖子聚合多个岗位，无法把职责、远程、英语、学历等条件明确归属于同一个具体岗位。",
  "6. 薪资、经验、学历、城市或工作方式描述互相矛盾。",
  "已经有明确排除证据时不要放入待确认，直接过滤。",
].join("\n");
export const DEFAULT_AI_UNCERTAIN_STRATEGY: AiUncertainStrategy = "pending_confirmation";
export const BOSS_SOURCE_PLATFORM: JobSourcePlatform = "boss";
export const V2EX_SOURCE_PLATFORM: JobSourcePlatform = "v2ex";
export const LINUXDO_SOURCE_PLATFORM: JobSourcePlatform = "linuxdo";
export const ZHILIAN_SOURCE_PLATFORM: JobSourcePlatform = "zhilian";
export const LIEPIN_SOURCE_PLATFORM: JobSourcePlatform = "liepin";
export const MAIMAI_SOURCE_PLATFORM: JobSourcePlatform = "maimai";
export const MANUAL_IMPORT_SOURCE_PLATFORMS = [] as const;
export const COLLECTABLE_SOURCE_PLATFORMS = [BOSS_SOURCE_PLATFORM, LIEPIN_SOURCE_PLATFORM, V2EX_SOURCE_PLATFORM, LINUXDO_SOURCE_PLATFORM, ZHILIAN_SOURCE_PLATFORM, MAIMAI_SOURCE_PLATFORM] as const;
export const DEFAULT_V2EX_FEED_URL = "";
export const DEFAULT_MAIMAI_FEED_URL = "";
export const DEFAULT_BOSS_LOW_RISK_MODE = true;
export const DEFAULT_BOSS_LOW_RISK_MAX_PAGES = 1;
export const DEFAULT_BOSS_LOW_RISK_MAX_JOBS = 30;
export const DEFAULT_BOSS_LOW_RISK_DELAY_MS = 8_000;
export const DEFAULT_BOSS_LOW_RISK_JITTER_MS = 12_000;
export const BOSS_LOW_RISK_MAX_PAGES_CAP = 2;
export const BOSS_LOW_RISK_MAX_JOBS_CAP = 50;
export const DEFAULT_BOSS_MAX_PAGES = DEFAULT_BOSS_LOW_RISK_MAX_PAGES;
export const DEFAULT_BOSS_MAX_JOBS = DEFAULT_BOSS_LOW_RISK_MAX_JOBS;
export const DEFAULT_V2EX_MAX_PAGES = 5;
export const DEFAULT_MAIMAI_MAX_PAGES = 3;
export const DEFAULT_MAIMAI_MAX_JOBS = 20;
export const DEFAULT_LINUXDO_CATEGORY_URL = "https://linux.do/c/job/27";
export const DEFAULT_LINUXDO_MAX_PAGES = 3;
export const DEFAULT_ZHILIAN_MAX_PAGES = 3;
export const DEFAULT_ZHILIAN_MAX_JOBS = 50;
export const DEFAULT_LIEPIN_MAX_PAGES = 3;
export const DEFAULT_LIEPIN_MAX_JOBS = 50;
export const JOB_SOURCE_PLATFORM_OPTIONS: JobSourcePlatformOption[] = [
  { value: BOSS_SOURCE_PLATFORM, label: "Boss 直聘", adapterKind: "boss" },
  { value: LIEPIN_SOURCE_PLATFORM, label: "猎聘", adapterKind: "liepin" },
  { value: ZHILIAN_SOURCE_PLATFORM, label: "智联招聘", adapterKind: "zhilian" },
  { value: MAIMAI_SOURCE_PLATFORM, label: "脉脉", adapterKind: "feed" },
  { value: V2EX_SOURCE_PLATFORM, label: "V2EX", adapterKind: "feed" },
  { value: LINUXDO_SOURCE_PLATFORM, label: "LinuxDo", adapterKind: "feed" },
];
export const BOSS_ONLY_SOURCE_PLATFORMS = [BOSS_SOURCE_PLATFORM] as const;
export const DEFAULT_SOURCE_PLATFORMS = [...COLLECTABLE_SOURCE_PLATFORMS];
export const DEFAULT_COMMUNICATION_STATUSES = ["not_contacted", "greeted_unread"];
export const DEFAULT_ACCEPT_NEGOTIABLE_SALARY = false;
export const DEFAULT_ACCEPT_UNKNOWN_EXPERIENCE = true;
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  resume: 0.6,
  preference: 0.25,
  company: 0.15,
};

export function formatLocalDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  if (value === "预览") return value;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

export function parseList(text: string): string[] {
  return text
    .split(/[\n,，]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatList(value: unknown): string {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join("\n") : "";
}

function finiteOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function normalizeOptionalNumber(value: unknown): number | null {
  return finiteOptionalNumber(value);
}

function finiteWeight(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function normalizeScoreWeights(value: unknown): ScoreWeights {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    resume: finiteWeight(raw.resume, DEFAULT_SCORE_WEIGHTS.resume),
    preference: finiteWeight(raw.preference, DEFAULT_SCORE_WEIGHTS.preference),
    company: finiteWeight(raw.company, DEFAULT_SCORE_WEIGHTS.company),
  };
}

export function asBossOptions(list: unknown): BossOption[] {
  if (!Array.isArray(list)) return [];
  const out: BossOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const codeRaw = (item as any).code;
    const code = typeof codeRaw === "number" ? codeRaw : Number(codeRaw);
    const name = typeof (item as any).name === "string" ? (item as any).name : "";
    if (!Number.isFinite(code) || !name) continue;
    out.push({ code, name });
  }
  return out;
}

export function buildBossCityGroups(meta: unknown): BossCityGroup[] {
  const groups = (meta as any)?.city_group?.cityGroup;
  if (!Array.isArray(groups)) return [];
  const out: BossCityGroup[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const firstChar = typeof (group as any).firstChar === "string" ? (group as any).firstChar : "";
    const cityList = asBossOptions((group as any).cityList);
    if (!firstChar || cityList.length === 0) continue;
    out.push({ firstChar, cityList });
  }
  return out;
}

export function buildBossIndustryGroups(meta: unknown): BossIndustryGroup[] {
  const raw = (meta as any)?.industry_filter_exemption;
  if (!Array.isArray(raw)) return [];
  const out: BossIndustryGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = typeof (item as any).name === "string" ? (item as any).name : "";
    if (!name) continue;
    const options = asBossOptions((item as any).subLevelModelList);
    if (options.length > 0) {
      out.push({ name, options });
      continue;
    }
    const codeRaw = (item as any).code;
    const code = typeof codeRaw === "number" ? codeRaw : Number(codeRaw);
    if (!Number.isFinite(code)) continue;
    out.push({ name, options: [{ code, name }] });
  }
  return out;
}

export function filterBossOptions(list: unknown): BossOption[] {
  return asBossOptions(list).filter((item) => item.code !== 0);
}

const BOSS_FILTER_FIELD_LABELS: Record<string, string> = {
  salary: "薪资",
  experience: "经验",
  degree: "学历",
  scale: "公司规模",
  stage: "融资阶段",
  financing: "融资阶段",
  jobType: "职位类型",
  jobStatus: "职位状态",
  brandStage: "融资阶段",
  brandScale: "公司规模",
};

const PRIMARY_BOSS_FILTER_FIELDS = new Set(["salary", "experience", "degree", "scale"]);
const SECONDARY_BOSS_FILTER_FIELDS = new Set(["stage", "jobType"]);

function normalizeBossFilterField(key: string): string {
  return key.replace(/List$/u, "");
}

function formatBossFilterLabel(field: string): string {
  return BOSS_FILTER_FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, " $1").trim();
}

export function buildBossFilterConditionGroups(meta: unknown): BossFilterConditionGroup[] {
  const raw = (meta as any)?.filter_conditions;
  if (!raw || typeof raw !== "object") return [];

  const out: BossFilterConditionGroup[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.endsWith("List")) continue;
    const field = normalizeBossFilterField(key);
    if (PRIMARY_BOSS_FILTER_FIELDS.has(field)) continue;
    if (!SECONDARY_BOSS_FILTER_FIELDS.has(field)) continue;
    const options = filterBossOptions(value);
    if (options.length === 0) continue;
    out.push({
      key,
      field,
      label: formatBossFilterLabel(field),
      options,
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"));
}
