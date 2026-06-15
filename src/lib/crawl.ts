export type CrawlMode = "manual" | "auto";
export type BossOption = { code: number; name: string };
export type BossCityGroup = { firstChar: string; cityList: BossOption[] };
export type BossIndustryGroup = { name: string; options: BossOption[] };
export type ScoreWeights = {
  resume: number;
  preference: number;
  company: number;
};
export type JobSourcePlatform = "boss" | "liepin" | "zhilian" | "maimai" | "v2ex" | "linuxdo";
export type JobSourcePlatformOption = {
  value: JobSourcePlatform;
  label: string;
  adapterKind: "boss" | "feed" | "manual_import";
};
export type FilterProfilePayload = {
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

export type RecomputeFilterProfileResult = {
  updated: number;
};

export const DEFAULT_CRAWL_MODE: CrawlMode = "manual";
export const DEFAULT_MAX_PAGES = 3;
export const DEFAULT_MAX_JOBS = 50;
export const DEFAULT_DELAY_MS = 800;
export const BOSS_META_SYNC_TIMEOUT_MS = 20_000;
export const CRAWL_TASK_TYPE_MANUAL = "crawl_manual";
export const CRAWL_TASK_TYPE_AUTO = "crawl_auto";
export const CRAWL_TASK_TYPE_LOGIN = "login";
export const CRAWL_TASK_TYPE_META_SYNC = "meta_sync";
export const DEFAULT_MUST_NOT_KEYWORDS = ["外包", "驻场", "培训", "销售", "电话销售"];
export const DEFAULT_PREFERENCE_DIRECTIONS = ["Go", "Infra", "DevOps", "SRE", "平台工程", "AI Infra", "AI Agent", "云原生"];
export const DEFAULT_PREFERENCE_TECH_TAGS = ["Go", "Kubernetes", "Docker", "AWS", "Prometheus", "Linux", "CI/CD", "Terraform"];
export const BOSS_SOURCE_PLATFORM: JobSourcePlatform = "boss";
export const V2EX_SOURCE_PLATFORM: JobSourcePlatform = "v2ex";
export const MANUAL_IMPORT_SOURCE_PLATFORMS = ["liepin", "zhilian", "maimai", "linuxdo"] as const;
export const COLLECTABLE_SOURCE_PLATFORMS = [BOSS_SOURCE_PLATFORM, V2EX_SOURCE_PLATFORM] as const;
export const DEFAULT_V2EX_FEED_URL = "https://www.v2ex.com/feed/tab/jobs.xml";
export const JOB_SOURCE_PLATFORM_OPTIONS: JobSourcePlatformOption[] = [
  { value: BOSS_SOURCE_PLATFORM, label: "Boss 直聘", adapterKind: "boss" },
  { value: "liepin", label: "猎聘", adapterKind: "manual_import" },
  { value: "zhilian", label: "智联招聘", adapterKind: "manual_import" },
  { value: "maimai", label: "脉脉", adapterKind: "manual_import" },
  { value: V2EX_SOURCE_PLATFORM, label: "V2EX", adapterKind: "feed" },
  { value: "linuxdo", label: "LinuxDo", adapterKind: "manual_import" },
];
export const DEFAULT_SOURCE_PLATFORMS = [BOSS_SOURCE_PLATFORM];
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
