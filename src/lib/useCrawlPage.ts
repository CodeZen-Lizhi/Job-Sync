import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import {
  asBossOptions,
  BOSS_META_SYNC_TIMEOUT_MS,
  buildBossCityGroups,
  buildBossIndustryGroups,
  BOSS_SOURCE_PLATFORM,
  COLLECTABLE_SOURCE_PLATFORMS,
  CRAWL_TASK_TYPE_AUTO,
  CRAWL_TASK_TYPE_MANUAL,
  CRAWL_TASK_TYPE_META_SYNC,
  DEFAULT_CRAWL_MODE,
  DEFAULT_DELAY_MS,
  DEFAULT_MAX_JOBS,
  DEFAULT_MAX_PAGES,
  DEFAULT_V2EX_FEED_URL,
  filterBossOptions,
  JOB_SOURCE_PLATFORM_OPTIONS,
  parseList,
  V2EX_SOURCE_PLATFORM,
  type BossCityGroup,
  type BossOption,
  type BossIndustryGroup,
  type JobSourcePlatform,
  type CrawlMode,
} from "./crawl";
import { useFilterProfile } from "./filterProfile";
import { clearLogs, runtime } from "./runtime";
import { invoke, isTauri } from "./tauri";

export type CrawlPageState = ReturnType<typeof createCrawlPageState>;

let crawlPageState: CrawlPageState | null = null;

export function useCrawlPage(): CrawlPageState {
  const state = crawlPageState ?? createCrawlPageState();
  crawlPageState = state;

  onMounted(() => {
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
  const mode = ref<CrawlMode>(DEFAULT_CRAWL_MODE);
  const collectionKeywordsText = ref("");
  const collectionTargetCitiesText = ref("");
  const collectionWorkModesText = ref("");
  const collectionTechStackText = ref("");
  const collectionExcludedKeywordsText = ref("");
  const collectionDegreesText = ref("");
  const collectionMinimumSalaryK = ref<number | null>(null);
  const collectionMaximumSalaryK = ref<number | null>(null);
  const collectionMinimumExperienceYears = ref<number | null>(null);
  const collectionMaximumExperienceYears = ref<number | null>(null);
  const selectedCollectionSource = ref<JobSourcePlatform | "">(BOSS_SOURCE_PLATFORM);
  const bossCollectionEnabled = ref(true);
  const collectionSourceRegistry = ref<Array<{ platform: string; display_name?: string; adapter_kind: string; enabled: boolean }>>([]);
  const v2exFeedSettingsOpen = ref(true);
  const v2exFeedUrl = ref(DEFAULT_V2EX_FEED_URL);
  const bossKeywordsText = ref("");
  const cityText = ref("");
  const salaryText = ref("");
  const experienceText = ref("");
  const degreeText = ref("");
  const industryText = ref("");
  const scaleText = ref("");
  const selectedCity = ref("");
  const selectedSalary = ref("");
  const selectedExperience = ref("");
  const selectedDegree = ref("");
  const selectedIndustry = ref("");
  const selectedScale = ref("");
  const maxPages = ref(DEFAULT_MAX_PAGES);
  const maxJobs = ref(DEFAULT_MAX_JOBS);
  const delayMs = ref(DEFAULT_DELAY_MS);
  const actionBusy = ref(false);
  const error = ref<string | null>(null);
  const bossMetaLoading = ref(false);
  const bossMetaSyncing = ref(false);
  const bossMetaError = ref<string | null>(null);
  const filterRecomputing = ref(false);
  const filterRecomputeMessage = ref<string | null>(null);
  const bossSettingsOpen = ref(true);
  const filterProfileOpen = ref(false);
  const bossSyncMappedFields = ref<string[]>([]);
  const bossSyncUnmappedFields = ref<string[]>([]);
  const bossSyncMessage = ref<string | null>(null);
  let bossMetaSyncTimeout: number | null = null;
  const filterProfileState = useFilterProfile();

  const bossMetaSyncedAt = computed(() => (runtime.bossMeta as any)?.synced_at as string | undefined);
  const bossCityGroups = computed<BossCityGroup[]>(() => buildBossCityGroups(runtime.bossMeta));
  const bossHotCities = computed<BossOption[]>(() => asBossOptions((runtime.bossMeta as any)?.city_group?.hotCityList));
  const bossSalaryOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.salaryList));
  const bossExperienceOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.experienceList));
  const bossDegreeOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.degreeList));
  const bossScaleOptions = computed<BossOption[]>(() => filterBossOptions((runtime.bossMeta as any)?.filter_conditions?.scaleList));
  const bossIndustryGroups = computed<BossIndustryGroup[]>(() => buildBossIndustryGroups(runtime.bossMeta));
  const bossMetaReady = computed(() => bossCityGroups.value.length > 0 && bossSalaryOptions.value.length > 0);
  const collectableSourceOptions = computed(() => {
    const sources = collectionSourceRegistry.value.length > 0
      ? collectionSourceRegistry.value
      : [
          { platform: BOSS_SOURCE_PLATFORM, adapter_kind: "boss", enabled: bossCollectionEnabled.value },
          { platform: V2EX_SOURCE_PLATFORM, adapter_kind: "feed", enabled: true },
        ];
    return sources
      .filter((source) => {
        if (!source.enabled) return false;
        if (!(COLLECTABLE_SOURCE_PLATFORMS as readonly string[]).includes(source.platform)) return false;
        return source.adapter_kind === "boss" || source.adapter_kind === "feed";
      })
      .map((source) => {
        const option = JOB_SOURCE_PLATFORM_OPTIONS.find((item) => item.value === source.platform);
        return {
          value: source.platform as JobSourcePlatform,
          label: source.display_name || option?.label || source.platform,
        };
      });
  });
  const collectionKeywords = computed(() => parseList(collectionKeywordsText.value));
  const collectionTechStack = computed(() => parseList(collectionTechStackText.value));
  const collectionTargetCities = computed(() => parseList(collectionTargetCitiesText.value));
  const collectionWorkModes = computed(() => parseList(collectionWorkModesText.value));
  const collectionExcludedKeywords = computed(() => parseList(collectionExcludedKeywordsText.value));
  const collectionDegrees = computed(() => parseList(collectionDegreesText.value));
  const bossKeywords = computed(() => parseList(bossKeywordsText.value));
  const filters = computed(() => ({
    city: selectedCity.value ? [selectedCity.value] : parseList(cityText.value),
    salary: selectedSalary.value ? [selectedSalary.value] : parseList(salaryText.value),
    experience: selectedExperience.value ? [selectedExperience.value] : parseList(experienceText.value),
    degree: selectedDegree.value ? [selectedDegree.value] : parseList(degreeText.value),
    industry: selectedIndustry.value ? [selectedIndustry.value] : parseList(industryText.value),
    scale: selectedScale.value ? [selectedScale.value] : parseList(scaleText.value),
    profile: filterProfileState.filterProfile.value,
  }));
  const selectedCollectionSourceLabel = computed(() => {
    const source = collectableSourceOptions.value.find((option) => option.value === selectedCollectionSource.value);
    return source?.label ?? (selectedCollectionSource.value || "未选择");
  });
  const v2exKeywords = computed(() => uniqueList([...collectionKeywords.value, ...collectionTechStack.value]));
  const v2exTaskKeywords = computed(() => v2exKeywords.value.length > 0 ? v2exKeywords.value : ["V2EX"]);
  const task = computed(() => {
    if (selectedCollectionSource.value === V2EX_SOURCE_PLATFORM) {
      return {
        keywords: v2exTaskKeywords.value,
        source_platform: V2EX_SOURCE_PLATFORM,
        filters: {
          feed_url: v2exFeedUrl.value.trim() || DEFAULT_V2EX_FEED_URL,
          excluded_keywords: collectionExcludedKeywords.value,
          profile: filterProfileState.filterProfile.value,
          collection_intent: {
            target_cities: collectionTargetCities.value,
            work_modes: collectionWorkModes.value,
            degrees: collectionDegrees.value,
            minimum_salary_k: collectionMinimumSalaryK.value,
            maximum_salary_k: collectionMaximumSalaryK.value,
            minimum_experience_years: collectionMinimumExperienceYears.value,
            maximum_experience_years: collectionMaximumExperienceYears.value,
          },
        },
        limits: {
          maxEntries: Math.max(1, maxPages.value * 20),
          maxJobs: maxJobs.value,
          delayMs: delayMs.value,
        },
        mode: "auto",
      };
    }
    return {
      keywords: bossKeywords.value,
      source_platform: BOSS_SOURCE_PLATFORM,
      filters: filters.value,
      limits: { maxPages: maxPages.value, maxJobs: maxJobs.value, delayMs: delayMs.value },
      mode: "auto",
    };
  });
  const sidecarRunning = computed(() => runtime.sidecarTask.running);

  function normalizeToken(value: string): string {
    return value.trim().toLowerCase();
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

  function allBossCities(): BossOption[] {
    const grouped = bossCityGroups.value.flatMap((group) => group.cityList);
    return [...bossHotCities.value, ...grouped];
  }

  function findBossOption(values: readonly string[], options: readonly BossOption[]): BossOption | null {
    for (const value of values) {
      const key = normalizeToken(value);
      const found = options.find((option) => normalizeToken(option.name) === key || String(option.code) === value.trim());
      if (found) return found;
    }
    return null;
  }

  function syncCollectionIntentToBoss(): void {
    const mapped: string[] = [];
    const unmapped: string[] = [];
    const expandedKeywords = uniqueList([...collectionKeywords.value, ...collectionTechStack.value]);

    if (expandedKeywords.length > 0) {
      bossKeywordsText.value = expandedKeywords.join("\n");
      mapped.push(`关键词：${expandedKeywords.join("、")}`);
    }

    const city = findBossOption(collectionTargetCities.value, allBossCities());
    if (city) {
      selectedCity.value = String(city.code);
      cityText.value = "";
      mapped.push(`城市：${city.name}`);
    } else if (collectionTargetCities.value.length > 0) {
      selectedCity.value = "";
      cityText.value = "";
      unmapped.push(`目标城市：${collectionTargetCities.value.join("、")}（Boss 字典未匹配）`);
    }

    const degree = findBossOption(collectionDegrees.value, bossDegreeOptions.value);
    if (degree) {
      selectedDegree.value = String(degree.code);
      degreeText.value = "";
      mapped.push(`学历：${degree.name}`);
    } else if (collectionDegrees.value.length > 0) {
      selectedDegree.value = "";
      degreeText.value = "";
      unmapped.push(`学历：${collectionDegrees.value.join("、")}（Boss 字典未匹配）`);
    }

    if (collectionWorkModes.value.length > 0) {
      unmapped.push(`工作方式：${collectionWorkModes.value.join("、")}（Boss 站内筛选暂不支持稳定映射）`);
    }
    if (collectionExcludedKeywords.value.length > 0) {
      unmapped.push(`排除关键词：${collectionExcludedKeywords.value.join("、")}（交给筛选画像做采后排除）`);
    }
    if (collectionMinimumSalaryK.value !== null || collectionMaximumSalaryK.value !== null) {
      unmapped.push("薪资范围（暂不自动映射 Boss 薪资枚举，可在 Boss 设置手动选择）");
    }
    if (collectionMinimumExperienceYears.value !== null || collectionMaximumExperienceYears.value !== null) {
      unmapped.push("经验范围（暂不自动映射 Boss 经验枚举，可在 Boss 设置手动选择）");
    }

    selectedCollectionSource.value = bossCollectionEnabled.value ? BOSS_SOURCE_PLATFORM : "";
    bossSyncMappedFields.value = mapped;
    bossSyncUnmappedFields.value = unmapped;
    bossSyncMessage.value = mapped.length > 0
      ? `已同步 ${mapped.length} 项到 Boss 配置`
      : "没有可直接同步到 Boss 的采集意图；请补充关键词或手动调整 Boss 配置";
    bossSettingsOpen.value = true;
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
    if (!tauri) return;
    try {
      const sources = await invoke<Array<{ platform: string; adapter_kind: string; enabled: boolean }>>("list_job_sources");
      collectionSourceRegistry.value = sources;
      const boss = sources.find((source) => source.platform === BOSS_SOURCE_PLATFORM && source.adapter_kind === "boss");
      bossCollectionEnabled.value = boss?.enabled !== false;
      const selectedStillAvailable = collectableSourceOptions.value.some((source) => source.value === selectedCollectionSource.value);
      if (!selectedStillAvailable) {
        selectedCollectionSource.value = collectableSourceOptions.value[0]?.value ?? "";
      }
      if (!bossCollectionEnabled.value && selectedCollectionSource.value === BOSS_SOURCE_PLATFORM) {
        selectedCollectionSource.value = "";
      }
    } catch {
      bossCollectionEnabled.value = true;
      collectionSourceRegistry.value = [];
    }
  }

  async function selectFilterProfile(profileId: string): Promise<void> {
    if (!tauri) return;
    try {
      await filterProfileState.selectFilterProfile(profileId);
    } catch (cause) {
      bossMetaError.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function saveActiveFilterProfile(): Promise<void> {
    if (!tauri) return;
    filterRecomputeMessage.value = null;
    try {
      await filterProfileState.saveActiveFilterProfile();
      filterRecomputeMessage.value = "已保存当前筛选画像";
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function createFilterProfile(): Promise<void> {
    if (!tauri) return;
    filterRecomputeMessage.value = null;
    try {
      await filterProfileState.createFilterProfile();
      filterRecomputeMessage.value = "已新建筛选画像";
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function setActiveFilterProfileAsDefault(): Promise<void> {
    if (!tauri) return;
    filterRecomputeMessage.value = null;
    try {
      await filterProfileState.setActiveFilterProfileAsDefault();
      filterRecomputeMessage.value = "已设为默认画像，重算后更新候选队列";
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
        filterRecomputeMessage.value = `已重新计算 ${result.updated} 个职位`;
        runtime.finishedCounter += 1;
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      filterRecomputing.value = false;
    }
  }

  async function start(): Promise<void> {
    error.value = null;
    if (!tauri) return;
    actionBusy.value = true;
    try {
      if (mode.value === "manual") {
        runtime.sidecarTask.running = true;
        runtime.sidecarTask.type = CRAWL_TASK_TYPE_MANUAL;
        await invoke<void>("crawl_manual_start");
        return;
      }
      if (!selectedCollectionSource.value) {
        throw new Error("请先到采集配置里选择一个已启用的自动采集平台。");
      }
      if (selectedCollectionSource.value === BOSS_SOURCE_PLATFORM && bossKeywords.value.length === 0) {
        throw new Error("请先填写采集意图并同步到 Boss，或在 Boss 配置中输入至少 1 个关键词。");
      }
      await filterProfileState.saveDefaultFilterProfile();
      runtime.sidecarTask.running = true;
      runtime.sidecarTask.type = CRAWL_TASK_TYPE_AUTO;
      await invoke<void>("crawl_auto_start", { task: task.value });
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      if (runtime.sidecarTask.type === CRAWL_TASK_TYPE_MANUAL || runtime.sidecarTask.type === CRAWL_TASK_TYPE_AUTO) {
        runtime.sidecarTask.running = false;
        runtime.sidecarTask.type = undefined;
      }
    } finally {
      actionBusy.value = false;
    }
  }

  async function stop(): Promise<void> {
    error.value = null;
    if (!tauri) return;
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
    if (initialized.value) return;
    initialized.value = true;
    void loadCollectionSources();
    void loadBossMeta();
    void loadDefaultFilterProfile();
  }

  watch(
    () => bossMetaSyncedAt.value,
    () => {
      if (!bossMetaSyncing.value) return;
      bossMetaSyncing.value = false;
      clearBossMetaSyncTimeout();
    },
  );

  return {
    tauri,
    runtime,
    clearLogs,
    mode,
    collectionKeywordsText,
    collectionTargetCitiesText,
    collectionWorkModesText,
    collectionTechStackText,
    collectionExcludedKeywordsText,
    collectionDegreesText,
    collectionMinimumSalaryK,
    collectionMaximumSalaryK,
    collectionMinimumExperienceYears,
    collectionMaximumExperienceYears,
    selectedCollectionSource,
    selectedCollectionSourceLabel,
    collectableSourceOptions,
    v2exFeedSettingsOpen,
    v2exFeedUrl,
    v2exKeywords,
    bossKeywordsText,
    cityText,
    salaryText,
    experienceText,
    degreeText,
    industryText,
    scaleText,
    ...filterProfileState,
    selectedCity,
    selectedSalary,
    selectedExperience,
    selectedDegree,
    selectedIndustry,
    selectedScale,
    maxPages,
    maxJobs,
    delayMs,
    actionBusy,
    error,
    bossMetaLoading,
    bossMetaSyncing,
    bossMetaError,
    filterRecomputing,
    filterRecomputeMessage,
    bossSettingsOpen,
    filterProfileOpen,
    bossSyncMappedFields,
    bossSyncUnmappedFields,
    bossSyncMessage,
    bossMetaSyncedAt,
    bossCityGroups,
    bossHotCities,
    bossSalaryOptions,
    bossExperienceOptions,
    bossDegreeOptions,
    bossScaleOptions,
    bossIndustryGroups,
    bossMetaReady,
    sidecarRunning,
    loadBossMeta,
    syncBossMeta,
    loadDefaultFilterProfile,
    selectFilterProfile,
    saveActiveFilterProfile,
    createFilterProfile,
    setActiveFilterProfileAsDefault,
    recomputeDefaultFilterProfile,
    syncCollectionIntentToBoss,
    initialize,
    clearBossMetaSyncTimeout,
    start,
    stop,
  };

  function clearBossMetaSyncTimeout(): void {
    if (bossMetaSyncTimeout === null) return;
    window.clearTimeout(bossMetaSyncTimeout);
    bossMetaSyncTimeout = null;
  }
}
