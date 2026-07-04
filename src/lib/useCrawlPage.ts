import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Cron } from "croner";
import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN.js";

import {
  asBossOptions,
  BOSS_LOW_RISK_MAX_JOBS_CAP,
  BOSS_LOW_RISK_MAX_PAGES_CAP,
  BOSS_META_SYNC_TIMEOUT_MS,
  buildBossCityGroups,
  buildBossFilterConditionGroups,
  buildBossIndustryGroups,
  DEFAULT_BOSS_LOW_RISK_DELAY_MS,
  DEFAULT_BOSS_LOW_RISK_JITTER_MS,
  DEFAULT_BOSS_LOW_RISK_MODE,
  DEFAULT_BOSS_MAX_JOBS,
  DEFAULT_BOSS_MAX_PAGES,
  BOSS_SOURCE_PLATFORM,
  COLLECTABLE_SOURCE_PLATFORMS,
  CRAWL_TASK_TYPE_AUTO,
  CRAWL_TASK_TYPE_META_SYNC,
  DEFAULT_DELAY_MS,
  DEFAULT_LINUXDO_CATEGORY_URL,
  DEFAULT_LINUXDO_MAX_PAGES,
  DEFAULT_V2EX_MAX_PAGES,
  DEFAULT_V2EX_FEED_URL,
  DEFAULT_ZHILIAN_MAX_JOBS,
  DEFAULT_ZHILIAN_MAX_PAGES,
  filterBossOptions,
  JOB_SOURCE_PLATFORM_OPTIONS,
  LINUXDO_SOURCE_PLATFORM,
  MANUAL_IMPORT_SOURCE_PLATFORMS,
  parseList,
  V2EX_SOURCE_PLATFORM,
  ZHILIAN_SOURCE_PLATFORM,
  type BossCityGroup,
  type BossFilterConditionGroup,
  type BossOption,
  type BossIndustryGroup,
  type CollectionFailure,
  type CollectionRun,
  type JobSourcePlatform,
} from "./crawl";
import {
  formatAiPostCollectionJudgeSummary,
  recomputeAiPostCollectionJudgementForAllJobs,
  recomputeAiPostCollectionJudgementForJobIds,
} from "./aiRecompute";
import { runAfterInitialPaint } from "./defer";
import { useFilterProfile } from "./filterProfile";
import { appendRuntimeLog, clearLogs, resetCrawlProgress, runtime } from "./runtime";
import { invoke, isTauri } from "./tauri";

export type CrawlPageState = ReturnType<typeof createCrawlPageState>;

type AppSettings = {
  collection_config?: CollectionConfigPayload | null;
};

type CollectionConfigPayload = {
  version?: number;
  selectedCollectionSources?: string[];
  crawlScheduleEnabled?: boolean;
  crawlScheduleExpression?: string;
  crawlScheduleTime?: string;
  crawlScheduleLastRunAt?: string | null;
  crawlScheduleLastStatus?: CrawlScheduleRunStatus | null;
  crawlScheduleLastMessage?: string | null;
  v2exFeedUrl?: string;
  v2exKeywordsText?: string;
  v2exFeedSortBy?: string;
  v2exRecentDays?: number | null;
  v2exMaxPages?: number | null;
  v2exMaxEntries?: number | null;
  linuxdoCategoryUrl?: string;
  linuxdoKeywordsText?: string;
  linuxdoSortBy?: string;
  linuxdoRecentDays?: number | null;
  linuxdoMaxPages?: number | null;
  linuxdoMaxJobs?: number | null;
  zhilianKeywordsText?: string;
  zhilianCityText?: string;
  zhilianSalaryText?: string;
  zhilianExperienceText?: string;
  zhilianDegreeText?: string;
  zhilianIndustryText?: string;
  zhilianCompanyTypeText?: string;
  zhilianCompanyScaleText?: string;
  zhilianJobTypeText?: string;
  zhilianPublishDateText?: string;
  zhilianSortByText?: string;
  zhilianRawParamsText?: string;
  zhilianMaxPages?: number | null;
  zhilianMaxJobs?: number | null;
  bossKeywordsText?: string;
  bossLowRiskMode?: boolean;
  bossMaxPages?: number | null;
  bossMaxJobs?: number | null;
  cityText?: string;
  salaryText?: string;
  experienceText?: string;
  degreeText?: string;
  industryText?: string;
  scaleText?: string;
  selectedCity?: string;
  selectedCities?: string[];
  selectedSalary?: string;
  selectedExperience?: string;
  selectedDegree?: string;
  selectedIndustry?: string;
  selectedScale?: string;
  selectedBossFilterConditions?: Record<string, string>;
  delayMs?: number;
};

type V2exFeedSortBy = "published_desc" | "updated_desc";
type LinuxDoSortBy = "latest" | "created";
type CrawlScheduleRunStatus = "success" | "failed" | "skipped";
type CollectionSourceRegistryEntry = { platform: string; display_name?: string; adapter_kind: string; enabled: boolean };

const DEFAULT_CRAWL_SCHEDULE_EXPRESSION = "0 9 * * *";
const DEFAULT_CRAWL_SCHEDULE_PERIOD = "day";
const CRAWL_SCHEDULE_UPCOMING_RUN_COUNT = 3;
const PREVIEW_COLLECTION_SOURCES: CollectionSourceRegistryEntry[] = [
  { platform: BOSS_SOURCE_PLATFORM, adapter_kind: "boss", enabled: true },
  { platform: V2EX_SOURCE_PLATFORM, adapter_kind: "feed", enabled: true },
  { platform: LINUXDO_SOURCE_PLATFORM, adapter_kind: "feed", enabled: true },
  { platform: ZHILIAN_SOURCE_PLATFORM, adapter_kind: "zhilian", enabled: true },
];

let crawlPageState: CrawlPageState | null = null;

type CrawlPageInitializeMode = "full" | "runtime" | "schedule";

export function useCrawlPage(options: { initialize?: CrawlPageInitializeMode } = {}): CrawlPageState {
  const state = crawlPageState ?? createCrawlPageState();
  crawlPageState = state;

  onMounted(() => {
    if (options.initialize === "schedule") {
      runAfterInitialPaint(() => void state.initializeSchedule());
      return;
    }
    if (options.initialize === "runtime") {
      runAfterInitialPaint(() => void state.initializeRuntime());
      return;
    }
    void state.initialize();
  });

  onUnmounted(() => {
    state.clearBossMetaSyncTimeout();
  });

  return state;
}

function createCrawlPageState() {
  const tauri = isTauri();
  const initialized = ref(false);
  const runtimeInitialized = ref(false);
  const scheduleInitialized = ref(false);
  const selectedCollectionSources = ref<JobSourcePlatform[]>([BOSS_SOURCE_PLATFORM]);
  const bossCollectionEnabled = ref(false);
  const collectionSourcesLoaded = ref(false);
  const collectionSourceRegistry = ref<CollectionSourceRegistryEntry[]>([]);
  const collectionRuns = ref<CollectionRun[]>([]);
  const collectionFailures = ref<CollectionFailure[]>([]);
  const collectionSummaryLoading = ref(false);
  const v2exFeedSettingsOpen = ref(false);
  const v2exFeedUrl = ref(DEFAULT_V2EX_FEED_URL);
  const v2exKeywordsText = ref("");
  const v2exFeedSortBy = ref<V2exFeedSortBy>("published_desc");
  const v2exRecentDays = ref<number | null>(null);
  const v2exMaxPages = ref(DEFAULT_V2EX_MAX_PAGES);
  const linuxdoSettingsOpen = ref(false);
  const linuxdoCategoryUrl = ref(DEFAULT_LINUXDO_CATEGORY_URL);
  const linuxdoKeywordsText = ref("");
  const linuxdoSortBy = ref<LinuxDoSortBy>("latest");
  const linuxdoRecentDays = ref<number | null>(null);
  const linuxdoMaxPages = ref(DEFAULT_LINUXDO_MAX_PAGES);
  const linuxdoMaxJobs = ref<number | null>(20);
  const zhilianSettingsOpen = ref(false);
  const zhilianKeywordsText = ref("");
  const zhilianCityText = ref("");
  const zhilianSalaryText = ref("");
  const zhilianExperienceText = ref("");
  const zhilianDegreeText = ref("");
  const zhilianIndustryText = ref("");
  const zhilianCompanyTypeText = ref("");
  const zhilianCompanyScaleText = ref("");
  const zhilianJobTypeText = ref("");
  const zhilianPublishDateText = ref("");
  const zhilianSortByText = ref("");
  const zhilianRawParamsText = ref("");
  const zhilianMaxPages = ref(DEFAULT_ZHILIAN_MAX_PAGES);
  const zhilianMaxJobs = ref<number | null>(DEFAULT_ZHILIAN_MAX_JOBS);
  const bossKeywordsText = ref("");
  const bossLowRiskMode = ref(DEFAULT_BOSS_LOW_RISK_MODE);
  const bossMaxPages = ref(DEFAULT_BOSS_MAX_PAGES);
  const bossMaxJobs = ref<number | null>(DEFAULT_BOSS_MAX_JOBS);
  const cityText = ref("");
  const salaryText = ref("");
  const experienceText = ref("");
  const degreeText = ref("");
  const industryText = ref("");
  const scaleText = ref("");
  const selectedCity = ref("");
  const selectedCities = ref<string[]>([]);
  const selectedSalary = ref("");
  const selectedExperience = ref("");
  const selectedDegree = ref("");
  const selectedIndustry = ref("");
  const selectedScale = ref("");
  const selectedBossFilterConditions = ref<Record<string, string>>({});
  const delayMs = ref(DEFAULT_DELAY_MS);
  const actionBusy = ref(false);
  const stopRequested = ref(false);
  const error = ref<string | null>(null);
  const bossMetaLoading = ref(false);
  const bossMetaSyncing = ref(false);
  const bossMetaError = ref<string | null>(null);
  const filterRecomputing = ref(false);
  const filterRecomputeMessage = ref<string | null>(null);
  const collectionConfigSaving = ref(false);
  const collectionConfigMessage = ref<string | null>(null);
  const crawlScheduleEnabled = ref(false);
  const crawlScheduleExpression = ref(DEFAULT_CRAWL_SCHEDULE_EXPRESSION);
  const crawlScheduleEditorPeriod = ref(DEFAULT_CRAWL_SCHEDULE_PERIOD);
  const crawlScheduleLastRunAt = ref<string | null>(null);
  const crawlScheduleLastStatus = ref<CrawlScheduleRunStatus | null>(null);
  const crawlScheduleLastMessage = ref<string | null>(null);
  const crawlScheduleNextRunAt = ref<string | null>(null);
  const crawlScheduleUpcomingRuns = ref<string[]>([]);
  const crawlScheduleValidationError = ref<string | null>(null);
  const bossSettingsOpen = ref(false);
  const filterProfileOpen = ref(false);
  let bossMetaSyncTimeout: number | null = null;
  let crawlScheduleTimer: number | null = null;
  const filterProfileState = useFilterProfile();

  const bossMetaSyncedAt = computed(() => (runtime.bossMeta as any)?.synced_at as string | undefined);
  const bossCityGroups = computed<BossCityGroup[]>(() => buildBossCityGroups(runtime.bossMeta));
  const bossHotCities = computed<BossOption[]>(() => asBossOptions((runtime.bossMeta as any)?.city_group?.hotCityList));
  const bossSalaryOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.salaryList));
  const bossExperienceOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.experienceList));
  const bossDegreeOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.degreeList));
  const bossScaleOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.scaleList));
  const bossAdditionalFilterGroups = computed<BossFilterConditionGroup[]>(() => buildBossFilterConditionGroups(runtime.bossMeta));
  const bossIndustryGroups = computed<BossIndustryGroup[]>(() => buildBossIndustryGroups(runtime.bossMeta));
  const bossMetaReady = computed(() => bossCityGroups.value.length > 0 && bossSalaryOptions.value.length > 0);
  const bossSourceAvailable = computed(() => collectionSourcesLoaded.value && collectableSourceOptions.value.some((source) => source.value === BOSS_SOURCE_PLATFORM));
  const selectableCollectionSourcePlatforms = computed(() => [
    ...COLLECTABLE_SOURCE_PLATFORMS,
    ...MANUAL_IMPORT_SOURCE_PLATFORMS,
  ] as readonly JobSourcePlatform[]);
  const bossFilterConditionCount = computed(
    () => 5 + (bossIndustryGroups.value.length > 0 ? 1 : 0) + bossAdditionalFilterGroups.value.length,
  );
  const collectableSourceOptions = computed(() => {
    const sources = collectionSourceRegistry.value.length > 0
      ? collectionSourceRegistry.value
      : PREVIEW_COLLECTION_SOURCES.map((source) => (
          source.platform === BOSS_SOURCE_PLATFORM ? { ...source, enabled: bossCollectionEnabled.value } : source
        ));
    return sources
      .filter((source) => {
        if (!source.enabled) return false;
        return (selectableCollectionSourcePlatforms.value as readonly string[]).includes(source.platform);
      })
      .map((source) => {
        const option = JOB_SOURCE_PLATFORM_OPTIONS.find((item) => item.value === source.platform);
        return {
          value: source.platform as JobSourcePlatform,
          label: source.display_name || option?.label || source.platform,
        };
      });
  });
  const latestCollectionRun = computed(() => collectionRuns.value[0] ?? null);
  const crawlScheduleNextRunLabel = computed(() => formatScheduleDateTime(crawlScheduleNextRunAt.value));
  const crawlScheduleUpcomingRunLabels = computed(() =>
    crawlScheduleUpcomingRuns.value.map((value) => formatScheduleDateTime(value)).filter((value) => value !== "未安排"),
  );
  const crawlScheduleDescription = computed(() => {
    if (crawlScheduleValidationError.value) return "表达式无效，无法生成说明。";
    try {
      return cronstrue.toString(crawlScheduleExpression.value, {
        locale: "zh_CN",
        use24HourTimeFormat: true,
      });
    } catch {
      return "暂无法解析当前 cron 表达式。";
    }
  });
  const crawlScheduleLastRunLabel = computed(() => formatScheduleDateTime(crawlScheduleLastRunAt.value));
  const crawlScheduleLastStatusLabel = computed(() => {
    if (crawlScheduleLastStatus.value === "success") return "成功";
    if (crawlScheduleLastStatus.value === "failed") return "失败";
    if (crawlScheduleLastStatus.value === "skipped") return "已跳过";
    return "暂无记录";
  });
  const crawlScheduleStatusTone = computed(() => {
    if (crawlScheduleLastStatus.value === "success") return "success";
    if (crawlScheduleLastStatus.value === "failed") return "danger";
    if (crawlScheduleLastStatus.value === "skipped") return "warning";
    return "muted";
  });
  const bossKeywords = computed(() => parseList(bossKeywordsText.value));
  const filters = computed(() => ({
    city: selectedCities.value.length > 0 ? selectedCities.value : selectedCity.value ? [selectedCity.value] : parseList(cityText.value),
    salary: selectedSalary.value ? [selectedSalary.value] : parseList(salaryText.value),
    experience: selectedExperience.value ? [selectedExperience.value] : parseList(experienceText.value),
    degree: selectedDegree.value ? [selectedDegree.value] : parseList(degreeText.value),
    industry: selectedIndustry.value ? [selectedIndustry.value] : parseList(industryText.value),
    scale: selectedScale.value ? [selectedScale.value] : parseList(scaleText.value),
    ...Object.fromEntries(
      Object.entries(selectedBossFilterConditions.value)
        .map(([field, value]) => [field, String(value).trim()])
        .filter(([, value]) => value),
    ),
    profile: filterProfileState.filterProfile.value,
  }));
  const selectedCollectionSourceLabel = computed(() => {
    const labels = selectedCollectionSources.value
      .map((source) => collectableSourceOptions.value.find((option) => option.value === source)?.label ?? source)
      .filter(Boolean);
    if (labels.length === 0) return "未选择";
    return labels.join("、");
  });
  const v2exKeywords = computed(() => uniqueList(parseList(v2exKeywordsText.value)));
  const v2exTaskKeywords = computed(() => v2exKeywords.value.length > 0 ? v2exKeywords.value : ["V2EX"]);
  const linuxdoKeywords = computed(() => uniqueList(parseList(linuxdoKeywordsText.value)));
  const linuxdoTaskKeywords = computed(() => linuxdoKeywords.value.length > 0 ? linuxdoKeywords.value : ["LinuxDo"]);
  const zhilianKeywords = computed(() => uniqueList(parseList(zhilianKeywordsText.value)));
  const zhilianCities = computed(() => uniqueList(splitZhilianCityList(zhilianCityText.value)));
  const selectedCollectionSourceSet = computed(() => new Set(selectedCollectionSources.value));
  const bossSelected = computed(() => selectedCollectionSourceSet.value.has(BOSS_SOURCE_PLATFORM));
  const v2exSelected = computed(() => selectedCollectionSourceSet.value.has(V2EX_SOURCE_PLATFORM));
  const linuxdoSelected = computed(() => selectedCollectionSourceSet.value.has(LINUXDO_SOURCE_PLATFORM));
  const zhilianSelected = computed(() => selectedCollectionSourceSet.value.has(ZHILIAN_SOURCE_PLATFORM));
  function buildTaskForSource(sourcePlatform: JobSourcePlatform) {
    if (sourcePlatform === ZHILIAN_SOURCE_PLATFORM) {
      return {
        keywords: zhilianKeywords.value,
        source_platform: ZHILIAN_SOURCE_PLATFORM,
        filters: {
          city: zhilianCities.value,
          salary: zhilianSalaryText.value.trim(),
          experience: zhilianExperienceText.value.trim(),
          degree: zhilianDegreeText.value.trim(),
          industry: zhilianIndustryText.value.trim(),
          company_type: zhilianCompanyTypeText.value.trim(),
          company_scale: zhilianCompanyScaleText.value.trim(),
          job_type: zhilianJobTypeText.value.trim(),
          publish_date: zhilianPublishDateText.value.trim(),
          sort_by: zhilianSortByText.value.trim(),
          raw_params: zhilianRawParamsText.value.trim(),
          keywords: zhilianKeywords.value,
          profile: filterProfileState.filterProfile.value,
        },
        limits: {
          delayMs: delayMs.value,
          maxPages: optionalNumber(zhilianMaxPages.value) ?? DEFAULT_ZHILIAN_MAX_PAGES,
          maxJobs: optionalNumber(zhilianMaxJobs.value),
        },
        mode: "auto",
      };
    }
    if (sourcePlatform === LINUXDO_SOURCE_PLATFORM) {
      return {
        keywords: linuxdoTaskKeywords.value,
        source_platform: LINUXDO_SOURCE_PLATFORM,
        filters: {
          category_url: linuxdoCategoryUrl.value.trim() || DEFAULT_LINUXDO_CATEGORY_URL,
          sort_by: linuxdoSortBy.value,
          recent_days: optionalNumber(linuxdoRecentDays.value),
          keywords: linuxdoKeywords.value,
          profile: filterProfileState.filterProfile.value,
        },
        limits: {
          delayMs: delayMs.value,
          maxPages: optionalNumber(linuxdoMaxPages.value) ?? DEFAULT_LINUXDO_MAX_PAGES,
          maxJobs: optionalNumber(linuxdoMaxJobs.value),
        },
        mode: "auto",
      };
    }
    if (sourcePlatform === V2EX_SOURCE_PLATFORM) {
      const feedUrls = splitUrlList(v2exFeedUrl.value);
      return {
        keywords: v2exTaskKeywords.value,
        source_platform: V2EX_SOURCE_PLATFORM,
        filters: {
          feed_urls: feedUrls,
          sort_by: v2exFeedSortBy.value,
          recent_days: optionalNumber(v2exRecentDays.value),
          profile: filterProfileState.filterProfile.value,
        },
        limits: {
          delayMs: delayMs.value,
          maxPages: optionalNumber(v2exMaxPages.value) ?? DEFAULT_V2EX_MAX_PAGES,
        },
        mode: "auto",
      };
    }
    return {
      keywords: bossKeywords.value,
      source_platform: BOSS_SOURCE_PLATFORM,
      filters: filters.value,
      limits: {
        delayMs: effectiveBossDelayMs(),
        jitterMs: bossLowRiskMode.value ? DEFAULT_BOSS_LOW_RISK_JITTER_MS : undefined,
        lowRiskMode: bossLowRiskMode.value,
        maxPages: effectiveBossMaxPages(),
        maxJobs: effectiveBossMaxJobs(),
        bossDetailFetchLimit: 0,
      },
      mode: "auto",
    };
  }
  const sidecarRunning = computed(() => runtime.sidecarTask.running);

  function collectionSourceLabel(source: JobSourcePlatform): string {
    return collectableSourceOptions.value.find((option) => option.value === source)?.label ?? source;
  }

  function validateCollectionSource(source: JobSourcePlatform): string | null {
    if (!(COLLECTABLE_SOURCE_PLATFORMS as readonly string[]).includes(source)) {
      return `${collectionSourceLabel(source)} 当前只作为职位来源和采后筛选来源，暂未接入自动采集适配器。`;
    }
    if (source === BOSS_SOURCE_PLATFORM && bossKeywords.value.length === 0) {
      return "Boss 搜索关键词为空。请在 Boss 配置中输入至少 1 个关键词。";
    }
    if (source === BOSS_SOURCE_PLATFORM) {
      if ((optionalNumber(bossMaxPages.value) ?? 0) <= 0) {
        return "Boss 页数上限必须大于 0。";
      }
      const maxJobs = optionalNumber(bossMaxJobs.value);
      if (maxJobs !== null && maxJobs <= 0) {
        return "Boss 岗位上限必须大于 0，或留空不限。";
      }
    }
    if (source === V2EX_SOURCE_PLATFORM && splitUrlList(v2exFeedUrl.value).length === 0) {
      return "V2EX URL 为空。请填写至少 1 个 feed 或节点 URL。";
    }
    if (source === LINUXDO_SOURCE_PLATFORM) {
      const url = linuxdoCategoryUrl.value.trim();
      if (!url) return "LinuxDo 分类 URL 为空。";
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== "linux.do" && !parsed.hostname.endsWith(".linux.do")) {
          return "LinuxDo 分类 URL 必须是 linux.do 域名。";
        }
      } catch {
        return "LinuxDo 分类 URL 格式不正确。";
      }
      if ((optionalNumber(linuxdoMaxPages.value) ?? 0) <= 0) {
        return "LinuxDo 页数上限必须大于 0。";
      }
    }
    if (source === ZHILIAN_SOURCE_PLATFORM) {
      if (zhilianKeywords.value.length === 0) {
        return "智联搜索关键词为空。请在智联配置中输入至少 1 个关键词。";
      }
      if ((optionalNumber(zhilianMaxPages.value) ?? 0) <= 0) {
        return "智联页数上限必须大于 0。";
      }
      const maxJobs = optionalNumber(zhilianMaxJobs.value);
      if (maxJobs !== null && maxJobs <= 0) {
        return "智联岗位上限必须大于 0，或留空不限。";
      }
    }
    return null;
  }

  function normalizeToken(value: string): string {
    return value.trim().toLowerCase();
  }

  function splitUrlList(text: string): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of text.split(/[\n,，、]+/g)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
    return out;
  }

  function splitZhilianCityList(text: string): string[] {
    return text
      .split(/[\n,，、]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function effectiveBossMaxPages(): number {
    const configured = optionalNumber(bossMaxPages.value) ?? DEFAULT_BOSS_MAX_PAGES;
    const normalized = Math.max(1, Math.floor(configured));
    return bossLowRiskMode.value ? Math.min(normalized, BOSS_LOW_RISK_MAX_PAGES_CAP) : normalized;
  }

  function effectiveBossMaxJobs(): number | null {
    const configured = optionalNumber(bossMaxJobs.value);
    if (configured === null) return bossLowRiskMode.value ? DEFAULT_BOSS_MAX_JOBS : null;
    const normalized = Math.max(1, Math.floor(configured));
    return bossLowRiskMode.value ? Math.min(normalized, BOSS_LOW_RISK_MAX_JOBS_CAP) : normalized;
  }

  function effectiveBossDelayMs(): number {
    const configured = optionalNumber(delayMs.value) ?? DEFAULT_DELAY_MS;
    const normalized = Math.max(0, Math.floor(configured));
    return bossLowRiskMode.value ? Math.max(normalized, DEFAULT_BOSS_LOW_RISK_DELAY_MS) : normalized;
  }

  function uniqueList(items: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = normalizeToken(trimmed);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }

  function optionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function textValue(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  function sanitizeV2exFeedSortBy(value: unknown): V2exFeedSortBy {
    return value === "updated_desc" ? "updated_desc" : "published_desc";
  }

  function sanitizeLinuxDoSortBy(value: unknown): LinuxDoSortBy {
    return value === "created" ? "created" : "latest";
  }

  function sanitizeDailyTime(value: unknown): string {
    if (typeof value !== "string") return "09:00";
    const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? `${match[1]}:${match[2]}` : "09:00";
  }

  function dailyTimeToCronExpression(value: string): string {
    const [hourText, minuteText] = sanitizeDailyTime(value).split(":");
    return `${Number(minuteText)} ${Number(hourText)} * * *`;
  }

  function sanitizeCronExpression(value: unknown): string {
    const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
    if (!text) return DEFAULT_CRAWL_SCHEDULE_EXPRESSION;
    try {
      const cron = new Cron(text, { paused: true, mode: "5-part" });
      const next = cron.nextRun();
      if (!next) throw new Error("missing next run");
      return text;
    } catch {
      return DEFAULT_CRAWL_SCHEDULE_EXPRESSION;
    }
  }

  function resolveScheduleExpression(config: CollectionConfigPayload): string {
    if (typeof config.crawlScheduleExpression === "string" && config.crawlScheduleExpression.trim()) {
      return sanitizeCronExpression(config.crawlScheduleExpression);
    }
    if (typeof config.crawlScheduleTime === "string" && config.crawlScheduleTime.trim()) {
      return dailyTimeToCronExpression(config.crawlScheduleTime);
    }
    return DEFAULT_CRAWL_SCHEDULE_EXPRESSION;
  }

  function getScheduleCron(expression: string): Cron {
    return new Cron(expression, { paused: true, mode: "5-part" });
  }

  function validateScheduleExpression(value: string): string | null {
    try {
      const cron = getScheduleCron(value);
      const next = cron.nextRun();
      if (!next) return "当前 cron 表达式没有可触发的下一次时间。";
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "cron 表达式无效";
    }
  }

  function inferScheduleEditorPeriod(expression: string): string {
    const parts = expression.trim().split(/\s+/);
    const [minute = "*", hour = "*", day = "*", month = "*", weekday = "*"] = parts;
    if (minute.includes("/") && hour === "*" && day === "*" && month === "*" && weekday === "*") return "minute";
    if (hour.includes("/") && day === "*" && month === "*" && weekday === "*") return "hour";
    if (day === "*" && month === "*" && weekday === "*") return "day";
    if (weekday !== "*" && month === "*") return "week";
    if (day !== "*" && month === "*") return "month";
    return DEFAULT_CRAWL_SCHEDULE_PERIOD;
  }

  function sanitizeScheduleRunStatus(value: unknown): CrawlScheduleRunStatus | null {
    return value === "success" || value === "failed" || value === "skipped" ? value : null;
  }

  function formatScheduleDateTime(value: string | null): string {
    if (!value) return "未安排";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未安排";
    return date.toLocaleString();
  }

  function sanitizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)));
  }

  function buildCollectionConfigPayload(): CollectionConfigPayload {
    return {
      version: 1,
      selectedCollectionSources: selectedCollectionSources.value,
      crawlScheduleEnabled: crawlScheduleEnabled.value,
      crawlScheduleExpression: sanitizeCronExpression(crawlScheduleExpression.value),
      crawlScheduleLastRunAt: crawlScheduleLastRunAt.value,
      crawlScheduleLastStatus: crawlScheduleLastStatus.value,
      crawlScheduleLastMessage: crawlScheduleLastMessage.value,
      v2exFeedUrl: v2exFeedUrl.value,
      v2exKeywordsText: v2exKeywordsText.value,
      v2exFeedSortBy: v2exFeedSortBy.value,
      v2exRecentDays: optionalNumber(v2exRecentDays.value),
      v2exMaxPages: optionalNumber(v2exMaxPages.value) ?? DEFAULT_V2EX_MAX_PAGES,
      linuxdoCategoryUrl: linuxdoCategoryUrl.value,
      linuxdoKeywordsText: linuxdoKeywordsText.value,
      linuxdoSortBy: linuxdoSortBy.value,
      linuxdoRecentDays: optionalNumber(linuxdoRecentDays.value),
      linuxdoMaxPages: optionalNumber(linuxdoMaxPages.value) ?? DEFAULT_LINUXDO_MAX_PAGES,
      linuxdoMaxJobs: optionalNumber(linuxdoMaxJobs.value),
      zhilianKeywordsText: zhilianKeywordsText.value,
      zhilianCityText: zhilianCityText.value,
      zhilianSalaryText: zhilianSalaryText.value,
      zhilianExperienceText: zhilianExperienceText.value,
      zhilianDegreeText: zhilianDegreeText.value,
      zhilianIndustryText: zhilianIndustryText.value,
      zhilianCompanyTypeText: zhilianCompanyTypeText.value,
      zhilianCompanyScaleText: zhilianCompanyScaleText.value,
      zhilianJobTypeText: zhilianJobTypeText.value,
      zhilianPublishDateText: zhilianPublishDateText.value,
      zhilianSortByText: zhilianSortByText.value,
      zhilianRawParamsText: zhilianRawParamsText.value,
      zhilianMaxPages: optionalNumber(zhilianMaxPages.value) ?? DEFAULT_ZHILIAN_MAX_PAGES,
      zhilianMaxJobs: optionalNumber(zhilianMaxJobs.value),
      bossKeywordsText: bossKeywordsText.value,
      bossLowRiskMode: bossLowRiskMode.value,
      bossMaxPages: optionalNumber(bossMaxPages.value) ?? DEFAULT_BOSS_MAX_PAGES,
      bossMaxJobs: optionalNumber(bossMaxJobs.value),
      cityText: cityText.value,
      salaryText: salaryText.value,
      experienceText: experienceText.value,
      degreeText: degreeText.value,
      industryText: industryText.value,
      scaleText: scaleText.value,
      selectedCity: selectedCity.value,
      selectedCities: selectedCities.value,
      selectedSalary: selectedSalary.value,
      selectedExperience: selectedExperience.value,
      selectedDegree: selectedDegree.value,
      selectedIndustry: selectedIndustry.value,
      selectedScale: selectedScale.value,
      selectedBossFilterConditions: selectedBossFilterConditions.value,
      delayMs: typeof delayMs.value === "number" && Number.isFinite(delayMs.value) && delayMs.value >= 0
        ? Math.floor(delayMs.value)
        : DEFAULT_DELAY_MS,
    };
  }

  function applyCollectionConfigPayload(config: CollectionConfigPayload | null | undefined): void {
    if (!config || typeof config !== "object") return;
    if (Array.isArray(config.selectedCollectionSources)) {
      const selected = config.selectedCollectionSources.filter((source): source is JobSourcePlatform =>
        (selectableCollectionSourcePlatforms.value as readonly string[]).includes(source),
      );
      selectedCollectionSources.value = selected.length > 0 ? Array.from(new Set(selected)) : selectedCollectionSources.value;
    }
    crawlScheduleEnabled.value = config.crawlScheduleEnabled === true;
    crawlScheduleExpression.value = resolveScheduleExpression(config);
    crawlScheduleEditorPeriod.value = inferScheduleEditorPeriod(crawlScheduleExpression.value);
    crawlScheduleValidationError.value = validateScheduleExpression(crawlScheduleExpression.value);
    crawlScheduleLastRunAt.value = textValue(config.crawlScheduleLastRunAt) || null;
    crawlScheduleLastStatus.value = sanitizeScheduleRunStatus(config.crawlScheduleLastStatus);
    crawlScheduleLastMessage.value = textValue(config.crawlScheduleLastMessage) || null;
    v2exFeedUrl.value = textValue(config.v2exFeedUrl);
    v2exKeywordsText.value = textValue(config.v2exKeywordsText);
    v2exFeedSortBy.value = sanitizeV2exFeedSortBy(config.v2exFeedSortBy);
    v2exRecentDays.value = optionalNumber(config.v2exRecentDays);
    v2exMaxPages.value = optionalNumber(config.v2exMaxPages ?? config.v2exMaxEntries) ?? DEFAULT_V2EX_MAX_PAGES;
    linuxdoCategoryUrl.value = textValue(config.linuxdoCategoryUrl) || DEFAULT_LINUXDO_CATEGORY_URL;
    linuxdoKeywordsText.value = textValue(config.linuxdoKeywordsText);
    linuxdoSortBy.value = sanitizeLinuxDoSortBy(config.linuxdoSortBy);
    linuxdoRecentDays.value = optionalNumber(config.linuxdoRecentDays);
    linuxdoMaxPages.value = optionalNumber(config.linuxdoMaxPages) ?? DEFAULT_LINUXDO_MAX_PAGES;
    linuxdoMaxJobs.value = optionalNumber(config.linuxdoMaxJobs) ?? 20;
    zhilianKeywordsText.value = textValue(config.zhilianKeywordsText);
    zhilianCityText.value = textValue(config.zhilianCityText);
    zhilianSalaryText.value = textValue(config.zhilianSalaryText);
    zhilianExperienceText.value = textValue(config.zhilianExperienceText);
    zhilianDegreeText.value = textValue(config.zhilianDegreeText);
    zhilianIndustryText.value = textValue(config.zhilianIndustryText);
    zhilianCompanyTypeText.value = textValue(config.zhilianCompanyTypeText);
    zhilianCompanyScaleText.value = textValue(config.zhilianCompanyScaleText);
    zhilianJobTypeText.value = textValue(config.zhilianJobTypeText);
    zhilianPublishDateText.value = textValue(config.zhilianPublishDateText);
    zhilianSortByText.value = textValue(config.zhilianSortByText);
    zhilianRawParamsText.value = textValue(config.zhilianRawParamsText);
    zhilianMaxPages.value = optionalNumber(config.zhilianMaxPages) ?? DEFAULT_ZHILIAN_MAX_PAGES;
    zhilianMaxJobs.value = Object.prototype.hasOwnProperty.call(config, "zhilianMaxJobs")
      ? optionalNumber(config.zhilianMaxJobs)
      : DEFAULT_ZHILIAN_MAX_JOBS;
    bossKeywordsText.value = textValue(config.bossKeywordsText);
    bossLowRiskMode.value = typeof config.bossLowRiskMode === "boolean"
      ? config.bossLowRiskMode
      : DEFAULT_BOSS_LOW_RISK_MODE;
    bossMaxPages.value = optionalNumber(config.bossMaxPages) ?? DEFAULT_BOSS_MAX_PAGES;
    bossMaxJobs.value = Object.prototype.hasOwnProperty.call(config, "bossMaxJobs")
      ? optionalNumber(config.bossMaxJobs)
      : DEFAULT_BOSS_MAX_JOBS;
    cityText.value = textValue(config.cityText);
    salaryText.value = textValue(config.salaryText);
    experienceText.value = textValue(config.experienceText);
    degreeText.value = textValue(config.degreeText);
    industryText.value = textValue(config.industryText);
    scaleText.value = textValue(config.scaleText);
    selectedCities.value = sanitizeStringList(config.selectedCities);
    selectedCity.value = selectedCities.value[0] ?? textValue(config.selectedCity);
    if (selectedCities.value.length === 0 && selectedCity.value) {
      selectedCities.value = [selectedCity.value];
    }
    selectedSalary.value = textValue(config.selectedSalary);
    selectedExperience.value = textValue(config.selectedExperience);
    selectedDegree.value = textValue(config.selectedDegree);
    selectedIndustry.value = textValue(config.selectedIndustry);
    selectedScale.value = textValue(config.selectedScale);
    selectedBossFilterConditions.value = sanitizeBossFilterConditionSelection(config.selectedBossFilterConditions);
    delayMs.value = typeof config.delayMs === "number" && Number.isFinite(config.delayMs) && config.delayMs >= 0
      ? Math.floor(config.delayMs)
      : DEFAULT_DELAY_MS;
    openSelectedSourceSettings();
  }

  function openSelectedSourceSettings(): void {
    bossSettingsOpen.value = bossSelected.value;
    v2exFeedSettingsOpen.value = v2exSelected.value;
    linuxdoSettingsOpen.value = linuxdoSelected.value;
    zhilianSettingsOpen.value = zhilianSelected.value;
  }

  function sanitizeBossFilterConditionSelection(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out: Record<string, string> = {};
    for (const [field, rawValue] of Object.entries(value as Record<string, unknown>)) {
      const cleanField = field.trim();
      const cleanValue = typeof rawValue === "string" ? rawValue.trim() : "";
      if (cleanField && cleanValue) out[cleanField] = cleanValue;
    }
    return out;
  }

  function setBossAdditionalFilter(field: string, value: string): void {
    const cleanField = field.trim();
    if (!cleanField) return;
    const next = { ...selectedBossFilterConditions.value };
    const cleanValue = value.trim();
    if (cleanValue) {
      next[cleanField] = cleanValue;
    } else {
      delete next[cleanField];
    }
    selectedBossFilterConditions.value = next;
  }

  async function loadBossMeta(): Promise<void> {
    bossMetaError.value = null;
    if (!tauri) return;
    bossMetaLoading.value = true;
    try {
      const meta = await invoke<unknown | null>("get_boss_meta");
      if (meta && typeof meta === "object") {
        runtime.bossMeta = meta as any;
      }
    } catch (cause) {
      bossMetaError.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      bossMetaLoading.value = false;
    }
  }

  async function syncBossMeta(): Promise<void> {
    bossMetaError.value = null;
    if (!tauri) return;
    bossMetaSyncing.value = true;
    clearBossMetaSyncTimeout();
    bossMetaSyncTimeout = window.setTimeout(() => {
      bossMetaSyncing.value = false;
    }, BOSS_META_SYNC_TIMEOUT_MS);
    try {
      runtime.sidecarTask.running = true;
      runtime.sidecarTask.type = CRAWL_TASK_TYPE_META_SYNC;
      await invoke<void>("sync_boss_meta");
    } catch (cause) {
      bossMetaError.value = cause instanceof Error ? cause.message : String(cause);
      bossMetaSyncing.value = false;
      if (runtime.sidecarTask.type === CRAWL_TASK_TYPE_META_SYNC) {
        runtime.sidecarTask.running = false;
        runtime.sidecarTask.type = undefined;
      }
    }
  }

  async function loadDefaultFilterProfile(): Promise<void> {
    if (!tauri) return;
    try {
      await filterProfileState.loadDefaultFilterProfile();
    } catch (cause) {
      bossMetaError.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function loadCollectionSources(): Promise<void> {
    if (!tauri) {
      bossCollectionEnabled.value = true;
      collectionSourceRegistry.value = PREVIEW_COLLECTION_SOURCES;
      collectionSourcesLoaded.value = true;
      openSelectedSourceSettings();
      return;
    }
    try {
      const sources = await invoke<Array<{ platform: string; adapter_kind: string; enabled: boolean }>>("list_job_sources");
      collectionSourceRegistry.value = sources;
      const boss = sources.find((source) => source.platform === BOSS_SOURCE_PLATFORM && source.adapter_kind === "boss");
      bossCollectionEnabled.value = boss?.enabled !== false;
      collectionSourcesLoaded.value = true;
      const availableValues = new Set(collectableSourceOptions.value.map((source) => source.value));
      selectedCollectionSources.value = selectedCollectionSources.value.filter((source) => availableValues.has(source));
      if (selectedCollectionSources.value.length === 0 && collectableSourceOptions.value[0]) {
        selectedCollectionSources.value = [collectableSourceOptions.value[0].value];
      }
      if (!bossCollectionEnabled.value) {
        selectedCollectionSources.value = selectedCollectionSources.value.filter((source) => source !== BOSS_SOURCE_PLATFORM);
      }
      openSelectedSourceSettings();
    } catch {
      bossCollectionEnabled.value = false;
      collectionSourcesLoaded.value = true;
      collectionSourceRegistry.value = [];
    }
  }

  async function loadCollectionConfig(): Promise<void> {
    if (!tauri) return;
    try {
      const settings = await invoke<AppSettings>("get_settings");
      applyCollectionConfigPayload(settings.collection_config);
      rescheduleCrawlTimer();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function saveCollectionConfig(): Promise<void> {
    if (!tauri) return;
    collectionConfigSaving.value = true;
    collectionConfigMessage.value = null;
    error.value = null;
    try {
      await persistCollectionConfig();
      rescheduleCrawlTimer();
      collectionConfigMessage.value = "已保存采集配置";
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      collectionConfigSaving.value = false;
    }
  }

  async function persistCollectionConfig(): Promise<void> {
    await invoke<AppSettings>("save_collection_config", {
      collectionConfig: buildCollectionConfigPayload(),
    });
  }

  function clearCrawlScheduleTimer(): void {
    if (crawlScheduleTimer === null) return;
    window.clearTimeout(crawlScheduleTimer);
    crawlScheduleTimer = null;
  }

  function rescheduleCrawlTimer(): void {
    clearCrawlScheduleTimer();
    crawlScheduleValidationError.value = validateScheduleExpression(crawlScheduleExpression.value);
    if (!tauri || !crawlScheduleEnabled.value) {
      crawlScheduleNextRunAt.value = null;
      crawlScheduleUpcomingRuns.value = [];
      return;
    }
    if (crawlScheduleValidationError.value) {
      crawlScheduleNextRunAt.value = null;
      crawlScheduleUpcomingRuns.value = [];
      return;
    }
    const cron = getScheduleCron(crawlScheduleExpression.value);
    const next = cron.nextRun();
    const upcoming = cron.nextRuns(CRAWL_SCHEDULE_UPCOMING_RUN_COUNT);
    if (!next) {
      crawlScheduleNextRunAt.value = null;
      crawlScheduleUpcomingRuns.value = [];
      crawlScheduleValidationError.value = "当前 cron 表达式没有可触发的下一次时间。";
      return;
    }
    crawlScheduleNextRunAt.value = next.toISOString();
    crawlScheduleUpcomingRuns.value = upcoming.map((date) => date.toISOString());
    const delay = Math.max(0, next.getTime() - Date.now());
    crawlScheduleTimer = window.setTimeout(() => {
      crawlScheduleTimer = null;
      void runScheduledCrawl();
    }, delay);
  }

  async function recordCrawlScheduleRun(status: CrawlScheduleRunStatus, message: string): Promise<void> {
    crawlScheduleLastRunAt.value = new Date().toISOString();
    crawlScheduleLastStatus.value = status;
    crawlScheduleLastMessage.value = message;
    try {
      await persistCollectionConfig();
    } catch (cause) {
      appendRuntimeLog("warn", `定时采集状态保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  async function runScheduledCrawl(): Promise<void> {
    if (!crawlScheduleEnabled.value) {
      rescheduleCrawlTimer();
      return;
    }
    if (sidecarRunning.value || actionBusy.value) {
      const message = "采集任务正在运行，本次定时采集已跳过。";
      appendRuntimeLog("warn", message);
      await recordCrawlScheduleRun("skipped", message);
      rescheduleCrawlTimer();
      return;
    }
    appendRuntimeLog("info", `定时采集触发：${crawlScheduleExpression.value}`);
    try {
      const completed = await start();
      if (completed) {
        await recordCrawlScheduleRun("success", "定时采集已完成。");
      } else if (error.value) {
        await recordCrawlScheduleRun("failed", error.value);
      } else {
        await recordCrawlScheduleRun("skipped", "定时采集未完成：没有可执行平台或任务被跳过。");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await recordCrawlScheduleRun("failed", message);
    } finally {
      rescheduleCrawlTimer();
    }
  }

  async function saveActiveFilterProfile(): Promise<void> {
    if (!tauri) return;
    filterRecomputeMessage.value = null;
    try {
      await filterProfileState.saveActiveFilterProfile();
      filterRecomputeMessage.value = "已保存采后规则";
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function recomputeDefaultFilterProfile(): Promise<void> {
    error.value = null;
    filterRecomputeMessage.value = null;
    if (!tauri) return;
    filterRecomputing.value = true;
    try {
      const result = await filterProfileState.recomputeDefaultFilterProfile();
      if (result) {
        const aiResult = await recomputeAiPostCollectionJudgementForAllJobs();
        filterRecomputeMessage.value = `已保存并重算普通+AI：普通规则 ${result.updated} 个职位；${formatAiPostCollectionJudgeSummary(aiResult)}`;
        runtime.finishedCounter += 1;
      }
      await loadCollectionSummary();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filterRecomputing.value = false;
    }
  }

  async function start(): Promise<boolean> {
    error.value = null;
    if (!tauri) return false;
    actionBusy.value = true;
    stopRequested.value = false;
    try {
      resetCrawlProgress();
      await persistCollectionConfig();
      const selectedSources = selectedCollectionSources.value.filter((source) =>
        collectableSourceOptions.value.some((option) => option.value === source),
      );
      if (selectedSources.length === 0) {
        appendRuntimeLog("warn", "没有可执行的自动采集平台，任务已结束。");
        return false;
      }
      await filterProfileState.saveDefaultFilterProfile();
      let completedSources = 0;
      let skippedSources = 0;
      const insertedJobIds = new Set<string>();
      for (const source of selectedSources) {
        if (stopRequested.value) break;
        const label = collectionSourceLabel(source);
        const invalidReason = validateCollectionSource(source);
        if (invalidReason) {
          skippedSources += 1;
          appendRuntimeLog("warn", `跳过 ${label}：${invalidReason}`);
          continue;
        }
        const beforeFinished = runtime.finishedCounter;
        const beforeError = runtime.errorCounter;
        try {
          runtime.sidecarTask.running = true;
          runtime.sidecarTask.type = CRAWL_TASK_TYPE_AUTO;
          appendRuntimeLog("info", `准备启动 ${label} 自动采集。`);
          const runId = await invoke<string>("crawl_auto_start", { task: buildTaskForSource(source) });
          await waitForFinishedCounterToAdvance(beforeFinished);
          const runInsertedJobIds = await loadCollectionRunInsertedJobIds(runId);
          for (const jobId of runInsertedJobIds) insertedJobIds.add(jobId);
          if (runtime.errorCounter > beforeError) {
            skippedSources += 1;
            appendRuntimeLog("warn", `${label} 自动采集失败，已跳过该平台。`);
          } else {
            completedSources += 1;
          }
        } catch (cause) {
          skippedSources += 1;
          const message = cause instanceof Error ? cause.message : String(cause);
          appendRuntimeLog("warn", `跳过 ${label}：${message}`);
          if (runtime.sidecarTask.type === CRAWL_TASK_TYPE_AUTO) {
            runtime.sidecarTask.running = false;
            runtime.sidecarTask.type = undefined;
          }
        } finally {
          await loadCollectionSummary();
        }
        if (stopRequested.value) break;
      }
      if (stopRequested.value) {
        appendRuntimeLog("warn", "已停止自动采集，后续平台不再执行。");
      } else if (completedSources === 0) {
        appendRuntimeLog("warn", skippedSources > 0 ? "所有自动采集平台都不可用，任务已结束。" : "没有可执行的自动采集平台，任务已结束。");
      } else if (skippedSources > 0) {
        appendRuntimeLog("info", `自动采集已结束：完成 ${completedSources} 个平台，跳过 ${skippedSources} 个平台。`);
      }
      if (!stopRequested.value && insertedJobIds.size > 0) {
        const aiResult = await recomputeAiPostCollectionJudgementForJobIds([...insertedJobIds]);
        appendRuntimeLog("info", formatAiPostCollectionJudgeSummary(aiResult));
      } else if (!stopRequested.value && completedSources > 0) {
        appendRuntimeLog("info", "本次采集没有新入库岗位，跳过 AI 采后判断和 Telegram 推送。");
      }
      return completedSources > 0 || insertedJobIds.size > 0;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (runtime.sidecarTask.type === CRAWL_TASK_TYPE_AUTO) {
        runtime.sidecarTask.running = false;
        runtime.sidecarTask.type = undefined;
      }
      return false;
    } finally {
      actionBusy.value = false;
    }
  }

  async function loadCollectionRunInsertedJobIds(runId: string): Promise<string[]> {
    try {
      return await invoke<string[]>("list_collection_run_inserted_job_ids", { runId });
    } catch (cause) {
      appendRuntimeLog("warn", `读取本轮新增岗位失败：${cause instanceof Error ? cause.message : String(cause)}`);
      return [];
    }
  }

  async function stop(): Promise<void> {
    error.value = null;
    if (!tauri) return;
    stopRequested.value = true;
    if (!sidecarRunning.value) return;
    actionBusy.value = true;
    try {
      await invoke<void>("crawl_stop");
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      actionBusy.value = false;
    }
  }

  async function initialize(): Promise<void> {
    if (initialized.value) {
      void loadCollectionSources();
      return;
    }
    initialized.value = true;
    runtimeInitialized.value = true;
    void initializeSchedule();
    void loadCollectionSources();
    runAfterInitialPaint(() => {
      void loadBossMeta();
      void loadDefaultFilterProfile();
    });
  }

  async function initializeRuntime(): Promise<void> {
    if (runtimeInitialized.value) {
      void refreshCollectionSourceState();
      return;
    }
    runtimeInitialized.value = true;
    void initializeSchedule();
    void refreshCollectionSourceState();
  }

  async function refreshCollectionSourceState(): Promise<void> {
    await Promise.all([
      loadCollectionSources(),
      loadCollectionSummary(),
    ]);
  }

  async function initializeSchedule(): Promise<void> {
    if (scheduleInitialized.value) return;
    scheduleInitialized.value = true;
    await Promise.all([
      loadCollectionSources(),
      loadDefaultFilterProfile(),
    ]);
    await loadCollectionConfig();
  }

  async function loadCollectionSummary(): Promise<void> {
    if (!tauri) return;
    collectionSummaryLoading.value = true;
    try {
      const [runs, failures] = await Promise.all([
        invoke<CollectionRun[]>("list_collection_runs", { limit: 5 }),
        invoke<CollectionFailure[]>("list_collection_failures", { limit: 8 }),
      ]);
      collectionRuns.value = runs;
      collectionFailures.value = failures;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      collectionSummaryLoading.value = false;
    }
  }

  watch(
    () => bossMetaSyncedAt.value,
    () => {
      if (!bossMetaSyncing.value) return;
      bossMetaSyncing.value = false;
      clearBossMetaSyncTimeout();
    },
  );

  watch(
    () => [crawlScheduleEnabled.value, crawlScheduleExpression.value] as const,
    () => {
      crawlScheduleEditorPeriod.value = inferScheduleEditorPeriod(crawlScheduleExpression.value);
      rescheduleCrawlTimer();
    },
  );

  return {
    tauri,
    runtime,
    clearLogs,
    selectedCollectionSources,
    collectionRuns,
    collectionFailures,
    collectionSummaryLoading,
    latestCollectionRun,
    selectedCollectionSourceLabel,
    bossSelected,
    v2exSelected,
    linuxdoSelected,
    zhilianSelected,
    collectableSourceOptions,
    collectionSourcesLoaded,
    v2exFeedSettingsOpen,
    v2exFeedUrl,
    v2exKeywordsText,
    v2exFeedSortBy,
    v2exRecentDays,
    v2exMaxPages,
    v2exKeywords,
    linuxdoSettingsOpen,
    linuxdoCategoryUrl,
    linuxdoKeywordsText,
    linuxdoSortBy,
    linuxdoRecentDays,
    linuxdoMaxPages,
    linuxdoMaxJobs,
    linuxdoKeywords,
    zhilianSettingsOpen,
    zhilianKeywordsText,
    zhilianCityText,
    zhilianSalaryText,
    zhilianExperienceText,
    zhilianDegreeText,
    zhilianIndustryText,
    zhilianCompanyTypeText,
    zhilianCompanyScaleText,
    zhilianJobTypeText,
    zhilianPublishDateText,
    zhilianSortByText,
    zhilianRawParamsText,
    zhilianMaxPages,
    zhilianMaxJobs,
    zhilianKeywords,
    bossKeywordsText,
    bossLowRiskMode,
    bossMaxPages,
    bossMaxJobs,
    cityText,
    salaryText,
    experienceText,
    degreeText,
    industryText,
    scaleText,
    ...filterProfileState,
    selectedCity,
    selectedCities,
    selectedSalary,
    selectedExperience,
    selectedDegree,
    selectedIndustry,
    selectedScale,
    selectedBossFilterConditions,
    delayMs,
    actionBusy,
    error,
    bossMetaLoading,
    bossMetaSyncing,
    bossMetaError,
    filterRecomputing,
    filterRecomputeMessage,
    collectionConfigSaving,
    collectionConfigMessage,
    crawlScheduleEnabled,
    crawlScheduleExpression,
    crawlScheduleEditorPeriod,
    crawlScheduleLastRunAt,
    crawlScheduleLastStatus,
    crawlScheduleLastMessage,
    crawlScheduleNextRunAt,
    crawlScheduleUpcomingRuns,
    crawlScheduleUpcomingRunLabels,
    crawlScheduleDescription,
    crawlScheduleValidationError,
    crawlScheduleNextRunLabel,
    crawlScheduleLastRunLabel,
    crawlScheduleLastStatusLabel,
    crawlScheduleStatusTone,
    bossSettingsOpen,
    filterProfileOpen,
    bossMetaSyncedAt,
    bossCityGroups,
    bossHotCities,
    bossSalaryOptions,
    bossExperienceOptions,
    bossDegreeOptions,
    bossScaleOptions,
    bossAdditionalFilterGroups,
    bossIndustryGroups,
    bossFilterConditionCount,
    bossMetaReady,
    bossSourceAvailable,
    sidecarRunning,
    loadBossMeta,
    syncBossMeta,
    loadDefaultFilterProfile,
    saveActiveFilterProfile,
    recomputeDefaultFilterProfile,
    setBossAdditionalFilter,
    saveCollectionConfig,
    loadCollectionSummary,
    initialize,
    initializeRuntime,
    initializeSchedule,
    clearBossMetaSyncTimeout,
    clearCrawlScheduleTimer,
    start,
    stop,
  };

  function clearBossMetaSyncTimeout(): void {
    if (bossMetaSyncTimeout === null) return;
    window.clearTimeout(bossMetaSyncTimeout);
    bossMetaSyncTimeout = null;
  }

  function waitForFinishedCounterToAdvance(previousValue: number): Promise<void> {
    if (runtime.finishedCounter > previousValue) return Promise.resolve();
    return new Promise((resolve) => {
      const stop = watch(
        () => runtime.finishedCounter,
        (value) => {
          if (value <= previousValue) return;
          stop();
          resolve();
        },
      );
    });
  }
}
