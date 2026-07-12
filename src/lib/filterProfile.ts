import { computed, ref, watch, type ComputedRef, type Ref } from "vue";

import {
  DEFAULT_AI_PREFERRED_TEXT,
  DEFAULT_AI_REJECTED_TEXT,
  DEFAULT_AI_RISK_TEXT,
  DEFAULT_AI_UNCERTAIN_STRATEGY,
  DEFAULT_ACCEPT_NEGOTIABLE_SALARY,
  DEFAULT_ACCEPT_UNKNOWN_EXPERIENCE,
  BOSS_ONLY_SOURCE_PLATFORMS,
  DEFAULT_COMMUNICATION_STATUSES,
  JOB_SOURCE_PLATFORM_OPTIONS,
  MANUAL_IMPORT_SOURCE_PLATFORMS,
  DEFAULT_MUST_NOT_KEYWORDS,
  DEFAULT_PREFERENCE_DIRECTIONS,
  DEFAULT_PREFERENCE_TECH_TAGS,
  DEFAULT_SCORE_WEIGHTS,
  DEFAULT_SOURCE_PLATFORMS,
  formatList,
  normalizeOptionalNumber,
  normalizeScoreWeights,
  parseList,
  type FilterProfilePayload,
  type FilterProfileRecord,
  type AiUncertainStrategy,
  type JobSourcePlatformOption,
  type RecomputeFilterProfileResult,
} from "./crawl";
import { invoke, isTauri } from "./tauri";

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedRight = new Set(right.map((item) => item.trim().toLowerCase()));
  return left.every((item) => normalizedRight.has(item.trim().toLowerCase()));
}

function normalizeSourcePlatforms(platforms: readonly string[]): string[] {
  return Array.from(new Set(platforms.map((item) => item.trim().toLowerCase()).filter(Boolean)));
}

function normalizeProfileText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeAiUncertainStrategy(value: unknown): AiUncertainStrategy {
  if (value === "filtered" || value === "recommended" || value === "pending_confirmation") return value;
  return DEFAULT_AI_UNCERTAIN_STRATEGY;
}

export type FilterProfileState = {
  filterProfiles: Ref<FilterProfileRecord[]>;
  activeFilterProfileId: Ref<string>;
  activeFilterProfileName: Ref<string>;
  newFilterProfileName: Ref<string>;
  activeFilterProfileIsDefault: ComputedRef<boolean>;
  aiPreferredText: Ref<string>;
  aiRejectedText: Ref<string>;
  aiRiskText: Ref<string>;
  aiUncertainStrategy: Ref<AiUncertainStrategy>;
  mustKeywordsText: Ref<string>;
  mustNotKeywordsText: Ref<string>;
  preferenceKeywordsText: Ref<string>;
  requiredDirectionsText: Ref<string>;
  excludedDirectionsText: Ref<string>;
  preferenceDirectionsText: Ref<string>;
  requiredTechTagsText: Ref<string>;
  excludedTechTagsText: Ref<string>;
  preferenceTechTagsText: Ref<string>;
  requiredWorkModesText: Ref<string>;
  excludedWorkModesText: Ref<string>;
  preferenceWorkModesText: Ref<string>;
  targetCitiesText: Ref<string>;
  excludedCitiesText: Ref<string>;
  sourcePlatformsText: Ref<string>;
  selectedSourcePlatforms: Ref<string[]>;
  requiredBossActiveStatusesText: Ref<string>;
  excludedBossActiveStatusesText: Ref<string>;
  sourcePlatformModeLabel: ComputedRef<string>;
  sourcePlatformModeHint: ComputedRef<string>;
  sourcePlatformOptions: readonly JobSourcePlatformOption[];
  communicationStatusesText: Ref<string>;
  minimumSalaryK: Ref<number | null>;
  maximumSalaryK: Ref<number | null>;
  acceptNegotiableSalary: Ref<boolean>;
  recentDays: Ref<number | null>;
  minimumExperienceYears: Ref<number | null>;
  maximumExperienceYears: Ref<number | null>;
  acceptUnknownExperience: Ref<boolean>;
  allowedDegreesText: Ref<string>;
  excludedDegreesText: Ref<string>;
  companyMustKeywordsText: Ref<string>;
  companyMustNotKeywordsText: Ref<string>;
  companyPreferenceKeywordsText: Ref<string>;
  companyRequiredScalesText: Ref<string>;
  companyExcludedScalesText: Ref<string>;
  companyPreferenceScalesText: Ref<string>;
  companyRequiredFinancingStagesText: Ref<string>;
  companyExcludedFinancingStagesText: Ref<string>;
  companyPreferenceFinancingStagesText: Ref<string>;
  companyRequiredIndustriesText: Ref<string>;
  companyExcludedIndustriesText: Ref<string>;
  companyPreferenceIndustriesText: Ref<string>;
  resumeWeight: Ref<number>;
  preferenceWeight: Ref<number>;
  companyWeight: Ref<number>;
  filterProfile: ComputedRef<FilterProfilePayload>;
  loadFilterProfiles: () => Promise<FilterProfileRecord[]>;
  selectFilterProfile: (profileId: string) => Promise<FilterProfileRecord | null>;
  saveActiveFilterProfile: (options?: { makeDefault?: boolean }) => Promise<FilterProfileRecord | null>;
  createFilterProfile: (name?: string) => Promise<FilterProfileRecord | null>;
  setDefaultFilterProfileId: (profileId: string) => Promise<FilterProfileRecord | null>;
  setActiveFilterProfileAsDefault: () => Promise<FilterProfileRecord | null>;
  setBossOnlySourcePlatforms: () => void;
  setManualImportSourcePlatforms: () => void;
  setAllSourcePlatforms: () => void;
  applyAiPrecisionTemplate: () => void;
  loadDefaultFilterProfile: () => Promise<FilterProfileRecord | null>;
  saveDefaultFilterProfile: () => Promise<FilterProfileRecord | null>;
  recomputeDefaultFilterProfile: () => Promise<RecomputeFilterProfileResult | null>;
};

export function useFilterProfile() {
  const tauri = isTauri();
  const aiPreferredText = ref(DEFAULT_AI_PREFERRED_TEXT);
  const aiRejectedText = ref(DEFAULT_AI_REJECTED_TEXT);
  const aiRiskText = ref(DEFAULT_AI_RISK_TEXT);
  const aiUncertainStrategy = ref<AiUncertainStrategy>(DEFAULT_AI_UNCERTAIN_STRATEGY);
  const mustKeywordsText = ref("");
  const mustNotKeywordsText = ref(DEFAULT_MUST_NOT_KEYWORDS.join("\n"));
  const preferenceKeywordsText = ref("");
  const requiredDirectionsText = ref("");
  const excludedDirectionsText = ref("");
  const preferenceDirectionsText = ref(DEFAULT_PREFERENCE_DIRECTIONS.join("\n"));
  const requiredTechTagsText = ref("");
  const excludedTechTagsText = ref("");
  const preferenceTechTagsText = ref(DEFAULT_PREFERENCE_TECH_TAGS.join("\n"));
  const requiredWorkModesText = ref("");
  const excludedWorkModesText = ref("");
  const preferenceWorkModesText = ref("");
  const targetCitiesText = ref("");
  const excludedCitiesText = ref("");
  const sourcePlatformsText = ref(DEFAULT_SOURCE_PLATFORMS.join("\n"));
  const requiredBossActiveStatusesText = ref("");
  const excludedBossActiveStatusesText = ref("");
  const communicationStatusesText = ref(DEFAULT_COMMUNICATION_STATUSES.join("\n"));
  const minimumSalaryK = ref<number | null>(null);
  const maximumSalaryK = ref<number | null>(null);
  const acceptNegotiableSalary = ref(DEFAULT_ACCEPT_NEGOTIABLE_SALARY);
  const recentDays = ref<number | null>(null);
  const minimumExperienceYears = ref<number | null>(null);
  const maximumExperienceYears = ref<number | null>(null);
  const acceptUnknownExperience = ref(DEFAULT_ACCEPT_UNKNOWN_EXPERIENCE);
  const allowedDegreesText = ref("");
  const excludedDegreesText = ref("");
  const companyMustKeywordsText = ref("");
  const companyMustNotKeywordsText = ref("");
  const companyPreferenceKeywordsText = ref("");
  const companyRequiredScalesText = ref("");
  const companyExcludedScalesText = ref("");
  const companyPreferenceScalesText = ref("");
  const companyRequiredFinancingStagesText = ref("");
  const companyExcludedFinancingStagesText = ref("");
  const companyPreferenceFinancingStagesText = ref("");
  const companyRequiredIndustriesText = ref("");
  const companyExcludedIndustriesText = ref("");
  const companyPreferenceIndustriesText = ref("");
  const resumeWeight = ref(DEFAULT_SCORE_WEIGHTS.resume);
  const preferenceWeight = ref(DEFAULT_SCORE_WEIGHTS.preference);
  const companyWeight = ref(DEFAULT_SCORE_WEIGHTS.company);
  const filterProfiles = ref<FilterProfileRecord[]>([]);
  const activeFilterProfileId = ref("default");
  const activeFilterProfileName = ref("默认采后规则");
  const newFilterProfileName = ref("");
  const activeFilterProfile = computed(() => filterProfiles.value.find((profile) => profile.id === activeFilterProfileId.value) ?? null);
  const activeFilterProfileIsDefault = computed(() => activeFilterProfile.value?.is_default === true);
  const selectedSourcePlatforms = ref<string[]>([...DEFAULT_SOURCE_PLATFORMS]);
  const normalizedSourcePlatforms = computed(() => normalizeSourcePlatforms(selectedSourcePlatforms.value));
  const sourcePlatformModeLabel = computed(() => {
    const selected = normalizedSourcePlatforms.value;
    if (sameSet(selected, DEFAULT_SOURCE_PLATFORMS)) return "自动采集来源";
    if (sameSet(selected, BOSS_ONLY_SOURCE_PLATFORMS)) return "Boss-only";
    if (sameSet(selected, MANUAL_IMPORT_SOURCE_PLATFORMS)) return "外部保留来源";
    if (sameSet(selected, JOB_SOURCE_PLATFORM_OPTIONS.map((option) => option.value))) return "全来源";
    return selected.length > 0 ? "自定义来源" : "未限制来源";
  });
  const sourcePlatformModeHint = computed(() => {
    const selected = normalizedSourcePlatforms.value;
    if (sameSet(selected, DEFAULT_SOURCE_PLATFORMS)) return "允许 Boss、猎聘、V2EX、LinuxDo、智联、脉脉等已支持自动采集来源进入筛选和 Top 20；保存并重算后对已有岗位生效。";
    if (sameSet(selected, BOSS_ONLY_SOURCE_PLATFORMS)) return "只允许 Boss 岗位进入筛选和 Top 20；保存并重算后对已有岗位生效。";
    if (sameSet(selected, MANUAL_IMPORT_SOURCE_PLATFORMS)) return "只允许非 Boss 保留来源岗位进入筛选和 Top 20；保存并重算后对已有岗位生效。";
    if (sameSet(selected, JOB_SOURCE_PLATFORM_OPTIONS.map((option) => option.value))) return "允许所有来源岗位进入筛选和 Top 20；保存并重算后生效。";
    if (selected.length > 0) return `当前允许来源：${selected.join("、")}；保存并重算后生效。`;
    return "来源为空时不会按来源限制岗位；保存并重算后生效。";
  });

  function applyAiPrecisionTemplate(): void {
    aiPreferredText.value = DEFAULT_AI_PREFERRED_TEXT;
    aiRejectedText.value = DEFAULT_AI_REJECTED_TEXT;
    aiRiskText.value = DEFAULT_AI_RISK_TEXT;
  }

  const filterProfile = computed<FilterProfilePayload>(() => ({
    aiPreferredText: aiPreferredText.value.trim(),
    aiRejectedText: aiRejectedText.value.trim(),
    aiRiskText: aiRiskText.value.trim(),
    aiUncertainStrategy: aiUncertainStrategy.value,
    mustKeywords: parseList(mustKeywordsText.value),
    mustNotKeywords: parseList(mustNotKeywordsText.value),
    preferenceKeywords: parseList(preferenceKeywordsText.value),
    requiredDirections: parseList(requiredDirectionsText.value),
    excludedDirections: parseList(excludedDirectionsText.value),
    preferenceDirections: parseList(preferenceDirectionsText.value),
    requiredTechTags: parseList(requiredTechTagsText.value),
    excludedTechTags: parseList(excludedTechTagsText.value),
    preferenceTechTags: parseList(preferenceTechTagsText.value),
    requiredWorkModes: parseList(requiredWorkModesText.value),
    excludedWorkModes: parseList(excludedWorkModesText.value),
    preferenceWorkModes: parseList(preferenceWorkModesText.value),
    targetCities: parseList(targetCitiesText.value),
    excludedCities: parseList(excludedCitiesText.value),
    sourcePlatforms: normalizedSourcePlatforms.value,
    requiredBossActiveStatuses: parseList(requiredBossActiveStatusesText.value),
    excludedBossActiveStatuses: parseList(excludedBossActiveStatusesText.value),
    communicationStatuses: parseList(communicationStatusesText.value),
    minimumSalaryK: normalizeOptionalNumber(minimumSalaryK.value),
    maximumSalaryK: normalizeOptionalNumber(maximumSalaryK.value),
    acceptNegotiableSalary: acceptNegotiableSalary.value,
    recentDays: normalizeOptionalNumber(recentDays.value),
    minimumExperienceYears: normalizeOptionalNumber(minimumExperienceYears.value),
    maximumExperienceYears: normalizeOptionalNumber(maximumExperienceYears.value),
    acceptUnknownExperience: acceptUnknownExperience.value,
    allowedDegrees: parseList(allowedDegreesText.value),
    excludedDegrees: parseList(excludedDegreesText.value),
    companyMustKeywords: parseList(companyMustKeywordsText.value),
    companyMustNotKeywords: parseList(companyMustNotKeywordsText.value),
    companyPreferenceKeywords: parseList(companyPreferenceKeywordsText.value),
    companyRequiredScales: parseList(companyRequiredScalesText.value),
    companyExcludedScales: parseList(companyExcludedScalesText.value),
    companyPreferenceScales: parseList(companyPreferenceScalesText.value),
    companyRequiredFinancingStages: parseList(companyRequiredFinancingStagesText.value),
    companyExcludedFinancingStages: parseList(companyExcludedFinancingStagesText.value),
    companyPreferenceFinancingStages: parseList(companyPreferenceFinancingStagesText.value),
    companyRequiredIndustries: parseList(companyRequiredIndustriesText.value),
    companyExcludedIndustries: parseList(companyExcludedIndustriesText.value),
    companyPreferenceIndustries: parseList(companyPreferenceIndustriesText.value),
    scoreWeights: {
      resume: resumeWeight.value,
      preference: preferenceWeight.value,
      company: companyWeight.value,
    },
  }));

  function applyFilterProfileRecord(profile: FilterProfileRecord): void {
    activeFilterProfileId.value = profile.id;
    activeFilterProfileName.value = profile.name;
    const json = profile.profile_json;
    aiPreferredText.value = normalizeProfileText(json.aiPreferredText, DEFAULT_AI_PREFERRED_TEXT);
    aiRejectedText.value = normalizeProfileText(json.aiRejectedText, DEFAULT_AI_REJECTED_TEXT);
    aiRiskText.value = normalizeProfileText(json.aiRiskText, DEFAULT_AI_RISK_TEXT);
    aiUncertainStrategy.value = normalizeAiUncertainStrategy(json.aiUncertainStrategy);
    mustKeywordsText.value = Array.isArray(json.mustKeywords) ? json.mustKeywords.join("\n") : "";
    mustNotKeywordsText.value = Array.isArray(json.mustNotKeywords)
      ? json.mustNotKeywords.join("\n")
      : DEFAULT_MUST_NOT_KEYWORDS.join("\n");
    preferenceKeywordsText.value = Array.isArray(json.preferenceKeywords) ? json.preferenceKeywords.join("\n") : "";
    requiredDirectionsText.value = formatList(json.requiredDirections);
    excludedDirectionsText.value = formatList(json.excludedDirections);
    preferenceDirectionsText.value = Array.isArray(json.preferenceDirections)
      ? json.preferenceDirections.join("\n")
      : DEFAULT_PREFERENCE_DIRECTIONS.join("\n");
    requiredTechTagsText.value = formatList(json.requiredTechTags);
    excludedTechTagsText.value = formatList(json.excludedTechTags);
    preferenceTechTagsText.value = Array.isArray(json.preferenceTechTags)
      ? json.preferenceTechTags.join("\n")
      : DEFAULT_PREFERENCE_TECH_TAGS.join("\n");
    requiredWorkModesText.value = formatList(json.requiredWorkModes);
    excludedWorkModesText.value = formatList(json.excludedWorkModes);
    preferenceWorkModesText.value = formatList(json.preferenceWorkModes);
    targetCitiesText.value = formatList(json.targetCities);
    excludedCitiesText.value = formatList(json.excludedCities);
    setSourcePlatforms(Array.isArray(json.sourcePlatforms) ? json.sourcePlatforms : DEFAULT_SOURCE_PLATFORMS);
    requiredBossActiveStatusesText.value = formatList(json.requiredBossActiveStatuses);
    excludedBossActiveStatusesText.value = formatList(json.excludedBossActiveStatuses);
    communicationStatusesText.value = Array.isArray(json.communicationStatuses)
      ? json.communicationStatuses.join("\n")
      : DEFAULT_COMMUNICATION_STATUSES.join("\n");
    minimumSalaryK.value = normalizeOptionalNumber(json.minimumSalaryK);
    maximumSalaryK.value = normalizeOptionalNumber(json.maximumSalaryK);
    acceptNegotiableSalary.value =
      typeof json.acceptNegotiableSalary === "boolean" ? json.acceptNegotiableSalary : DEFAULT_ACCEPT_NEGOTIABLE_SALARY;
    recentDays.value = normalizeOptionalNumber(json.recentDays);
    minimumExperienceYears.value = normalizeOptionalNumber(json.minimumExperienceYears);
    maximumExperienceYears.value = normalizeOptionalNumber(json.maximumExperienceYears);
    acceptUnknownExperience.value =
      typeof json.acceptUnknownExperience === "boolean" ? json.acceptUnknownExperience : DEFAULT_ACCEPT_UNKNOWN_EXPERIENCE;
    allowedDegreesText.value = formatList(json.allowedDegrees);
    excludedDegreesText.value = formatList(json.excludedDegrees);
    companyMustKeywordsText.value = formatList(json.companyMustKeywords);
    companyMustNotKeywordsText.value = formatList(json.companyMustNotKeywords);
    companyPreferenceKeywordsText.value = formatList(json.companyPreferenceKeywords);
    companyRequiredScalesText.value = formatList(json.companyRequiredScales);
    companyExcludedScalesText.value = formatList(json.companyExcludedScales);
    companyPreferenceScalesText.value = formatList(json.companyPreferenceScales);
    companyRequiredFinancingStagesText.value = formatList(json.companyRequiredFinancingStages);
    companyExcludedFinancingStagesText.value = formatList(json.companyExcludedFinancingStages);
    companyPreferenceFinancingStagesText.value = formatList(json.companyPreferenceFinancingStages);
    companyRequiredIndustriesText.value = formatList(json.companyRequiredIndustries);
    companyExcludedIndustriesText.value = formatList(json.companyExcludedIndustries);
    companyPreferenceIndustriesText.value = formatList(json.companyPreferenceIndustries);
    const weights = normalizeScoreWeights(json.scoreWeights);
    resumeWeight.value = weights.resume;
    preferenceWeight.value = weights.preference;
    companyWeight.value = weights.company;
  }

  function setSourcePlatforms(platforms: readonly string[]): void {
    selectedSourcePlatforms.value = normalizeSourcePlatforms(platforms);
    sourcePlatformsText.value = selectedSourcePlatforms.value.join("\n");
  }

  function setBossOnlySourcePlatforms(): void {
    setSourcePlatforms(BOSS_ONLY_SOURCE_PLATFORMS);
  }

  function setManualImportSourcePlatforms(): void {
    setSourcePlatforms(MANUAL_IMPORT_SOURCE_PLATFORMS);
  }

  function setAllSourcePlatforms(): void {
    setSourcePlatforms(JOB_SOURCE_PLATFORM_OPTIONS.map((option) => option.value));
  }

  watch(sourcePlatformsText, (value) => {
    const parsed = normalizeSourcePlatforms(parseList(value));
    if (sameSet(parsed, selectedSourcePlatforms.value)) return;
    selectedSourcePlatforms.value = parsed;
  });

  watch(selectedSourcePlatforms, (value) => {
    const text = normalizeSourcePlatforms(value).join("\n");
    if (sourcePlatformsText.value === text) return;
    sourcePlatformsText.value = text;
  });

  async function loadFilterProfiles(): Promise<FilterProfileRecord[]> {
    if (!tauri) return [];
    const profiles = await invoke<FilterProfileRecord[]>("list_filter_profiles");
    filterProfiles.value = profiles;
    if (!profiles.some((profile) => profile.id === activeFilterProfileId.value)) {
      const fallback = profiles.find((profile) => profile.is_default) ?? profiles[0];
      if (fallback) {
        applyFilterProfileRecord(fallback);
      }
    }
    return profiles;
  }

  async function selectFilterProfile(profileId: string): Promise<FilterProfileRecord | null> {
    if (!tauri) return null;
    let profile = filterProfiles.value.find((item) => item.id === profileId);
    if (!profile) {
      const profiles = await loadFilterProfiles();
      profile = profiles.find((item) => item.id === profileId);
    }
    if (!profile) return null;
    applyFilterProfileRecord(profile);
    return profile;
  }

  async function saveActiveFilterProfile(options: { makeDefault?: boolean } = {}): Promise<FilterProfileRecord | null> {
    if (!tauri) return null;
    const name = activeFilterProfileName.value.trim() || "默认采后规则";
    const shouldMakeDefault =
      options.makeDefault ?? activeFilterProfile.value?.is_default ?? activeFilterProfileId.value === "default";
    const saved = await invoke<FilterProfileRecord>("save_filter_profile", {
      id: activeFilterProfileId.value,
      name,
      profile: filterProfile.value,
      isDefault: shouldMakeDefault,
    });
    applyFilterProfileRecord(saved);
    await loadFilterProfiles();
    return saved;
  }

  async function createFilterProfile(name?: string): Promise<FilterProfileRecord | null> {
    if (!tauri) return null;
    const profileName = (name ?? newFilterProfileName.value).trim();
    if (!profileName) {
      throw new Error("请输入新规则名称。");
    }
    const saved = await invoke<FilterProfileRecord>("save_filter_profile", {
      id: null,
      name: profileName,
      profile: filterProfile.value,
      isDefault: false,
    });
    newFilterProfileName.value = "";
    applyFilterProfileRecord(saved);
    await loadFilterProfiles();
    return saved;
  }

  async function setDefaultFilterProfileId(profileId: string): Promise<FilterProfileRecord | null> {
    if (!tauri) return null;
    const profile = await invoke<FilterProfileRecord>("set_default_filter_profile_id", { profileId });
    applyFilterProfileRecord(profile);
    await loadFilterProfiles();
    return profile;
  }

  async function setActiveFilterProfileAsDefault(): Promise<FilterProfileRecord | null> {
    return saveActiveFilterProfile({ makeDefault: true });
  }

  async function loadDefaultFilterProfile(): Promise<FilterProfileRecord | null> {
    if (!tauri) return null;
    const profile = await invoke<FilterProfileRecord>("get_default_filter_profile");
    applyFilterProfileRecord(profile);
    await loadFilterProfiles();
    return profile;
  }

  async function saveDefaultFilterProfile(): Promise<FilterProfileRecord | null> {
    return saveActiveFilterProfile({ makeDefault: true });
  }

  async function recomputeDefaultFilterProfile(): Promise<RecomputeFilterProfileResult | null> {
    if (!tauri) return null;
    await saveDefaultFilterProfile();
    return invoke<RecomputeFilterProfileResult>("recompute_default_filter_profile");
  }

  return {
    filterProfiles,
    activeFilterProfileId,
    activeFilterProfileName,
    newFilterProfileName,
    activeFilterProfileIsDefault,
    aiPreferredText,
    aiRejectedText,
    aiRiskText,
    aiUncertainStrategy,
    mustKeywordsText,
    mustNotKeywordsText,
    preferenceKeywordsText,
    requiredDirectionsText,
    excludedDirectionsText,
    preferenceDirectionsText,
    requiredTechTagsText,
    excludedTechTagsText,
    preferenceTechTagsText,
    requiredWorkModesText,
    excludedWorkModesText,
    preferenceWorkModesText,
    targetCitiesText,
    excludedCitiesText,
    sourcePlatformsText,
    selectedSourcePlatforms,
    requiredBossActiveStatusesText,
    excludedBossActiveStatusesText,
    sourcePlatformModeLabel,
    sourcePlatformModeHint,
    sourcePlatformOptions: JOB_SOURCE_PLATFORM_OPTIONS,
    communicationStatusesText,
    minimumSalaryK,
    maximumSalaryK,
    acceptNegotiableSalary,
    recentDays,
    minimumExperienceYears,
    maximumExperienceYears,
    acceptUnknownExperience,
    allowedDegreesText,
    excludedDegreesText,
    companyMustKeywordsText,
    companyMustNotKeywordsText,
    companyPreferenceKeywordsText,
    companyRequiredScalesText,
    companyExcludedScalesText,
    companyPreferenceScalesText,
    companyRequiredFinancingStagesText,
    companyExcludedFinancingStagesText,
    companyPreferenceFinancingStagesText,
    companyRequiredIndustriesText,
    companyExcludedIndustriesText,
    companyPreferenceIndustriesText,
    resumeWeight,
    preferenceWeight,
    companyWeight,
    filterProfile,
    loadFilterProfiles,
    selectFilterProfile,
    saveActiveFilterProfile,
    createFilterProfile,
    setDefaultFilterProfileId,
    setActiveFilterProfileAsDefault,
    setBossOnlySourcePlatforms,
    setManualImportSourcePlatforms,
    setAllSourcePlatforms,
    applyAiPrecisionTemplate,
    loadDefaultFilterProfile,
    saveDefaultFilterProfile,
    recomputeDefaultFilterProfile,
  };
}
