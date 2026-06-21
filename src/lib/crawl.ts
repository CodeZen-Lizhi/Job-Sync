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
  adapterKind: "boss" | "feed" | "manual_import";
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
  "优先看 Go / Infra / DevOps / SRE / 平台工程 / AI Infra / 云原生方向。",
  "JD 里最好能看到真实工程建设、稳定性、自动化、平台化、可观测性、Kubernetes 或云基础设施证据。",
  "远程、混合办公、技术深度强、业务稳定的岗位可加分。",
].join("\n");
export const DEFAULT_AI_REJECTED_TEXT = [
  "明显外包、驻场、培训机构、销售导向、纯实施交付、电话销售、低代码搭建、重复客服支持类岗位。",
  "标题写技术但正文主要是售前销售、客户驻场、人力外派、拉新获客、课程销售、招转培。",
  "技术栈与目标方向明显无关，或 JD 缺少真实研发/平台工程职责。",
].join("\n");
export const DEFAULT_AI_RISK_TEXT = [
  "信息太少、职责含糊、公司业务不清楚、薪资/经验/城市描述矛盾时不要直接推荐。",
  "软排除只有隐约迹象但证据不够时，放入待确认并说明需要人工看的点。",
].join("\n");
export const DEFAULT_AI_UNCERTAIN_STRATEGY: AiUncertainStrategy = "pending_confirmation";
export const BOSS_SOURCE_PLATFORM: JobSourcePlatform = "boss";
export const V2EX_SOURCE_PLATFORM: JobSourcePlatform = "v2ex";
export const MANUAL_IMPORT_SOURCE_PLATFORMS = ["liepin", "zhilian", "maimai", "linuxdo"] as const;
export const COLLECTABLE_SOURCE_PLATFORMS = [BOSS_SOURCE_PLATFORM, V2EX_SOURCE_PLATFORM] as const;
export const DEFAULT_V2EX_FEED_URL = "";
export const DEFAULT_V2EX_MAX_PAGES = 5;
export const JOB_SOURCE_PLATFORM_OPTIONS: JobSourcePlatformOption[] = [
  { value: BOSS_SOURCE_PLATFORM, label: "Boss 直聘", adapterKind: "boss" },
  { value: "liepin", label: "猎聘", adapterKind: "manual_import" },
  { value: "zhilian", label: "智联招聘", adapterKind: "manual_import" },
  { value: "maimai", label: "脉脉", adapterKind: "manual_import" },
  { value: V2EX_SOURCE_PLATFORM, label: "V2EX", adapterKind: "feed" },
  { value: "linuxdo", label: "LinuxDo", adapterKind: "manual_import" },
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
