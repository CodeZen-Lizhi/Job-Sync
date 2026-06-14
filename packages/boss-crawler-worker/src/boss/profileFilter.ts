export type BossProfileRuleHit = {
  rule_type: string;
  field: string;
  value: string;
  reason: string;
};

export type BossProfileFilterResult = {
  eligible: boolean;
  blocked_by: BossProfileRuleHit[];
  matched_preferences: string[];
  missing_preferences: string[];
};

export type BossProfileFilter = {
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
};

const FILTER_KEYS = [
  "mustKeywords",
  "must_keywords",
  "requiredKeywords",
  "required_keywords",
  "includeKeywords",
  "include_keywords",
];

const EXCLUDE_KEYS = [
  "mustNotKeywords",
  "must_not_keywords",
  "excludeKeywords",
  "exclude_keywords",
  "blacklistKeywords",
  "blacklist_keywords",
];

const PREFERENCE_KEYS = [
  "preferenceKeywords",
  "preference_keywords",
  "preferredKeywords",
  "preferred_keywords",
  "weakPreferenceKeywords",
  "weak_preference_keywords",
];

const REQUIRED_DIRECTION_KEYS = ["requiredDirections", "required_directions", "mustDirections", "must_directions"];
const EXCLUDED_DIRECTION_KEYS = ["excludedDirections", "excluded_directions", "mustNotDirections", "must_not_directions"];
const PREFERENCE_DIRECTION_KEYS = [
  "preferenceDirections",
  "preference_directions",
  "preferredDirections",
  "preferred_directions",
];
const REQUIRED_TECH_KEYS = ["requiredTechTags", "required_tech_tags", "mustTechTags", "must_tech_tags"];
const EXCLUDED_TECH_KEYS = ["excludedTechTags", "excluded_tech_tags", "blockedTechTags", "blocked_tech_tags"];
const PREFERENCE_TECH_KEYS = ["preferenceTechTags", "preference_tech_tags", "preferredTechTags", "preferred_tech_tags"];
const REQUIRED_WORK_MODE_KEYS = ["requiredWorkModes", "required_work_modes", "mustWorkModes", "must_work_modes"];
const EXCLUDED_WORK_MODE_KEYS = ["excludedWorkModes", "excluded_work_modes", "mustNotWorkModes", "must_not_work_modes"];
const PREFERENCE_WORK_MODE_KEYS = [
  "preferenceWorkModes",
  "preference_work_modes",
  "preferredWorkModes",
  "preferred_work_modes",
];
const TARGET_CITY_KEYS = ["targetCities", "target_cities", "allowedCities", "allowed_cities"];
const EXCLUDED_CITY_KEYS = ["excludedCities", "excluded_cities", "blockedCities", "blocked_cities"];
const SOURCE_PLATFORM_KEYS = ["sourcePlatforms", "source_platforms", "allowedSourcePlatforms", "allowed_source_platforms"];
const COMMUNICATION_STATUS_KEYS = [
  "communicationStatuses",
  "communication_statuses",
  "allowedCommunicationStatuses",
  "allowed_communication_statuses",
];
const ALLOWED_DEGREE_KEYS = ["allowedDegrees", "allowed_degrees", "requiredDegrees", "required_degrees"];
const EXCLUDED_DEGREE_KEYS = ["excludedDegrees", "excluded_degrees"];
const COMPANY_MUST_KEYS = ["companyMustKeywords", "company_must_keywords", "requiredCompanyKeywords", "required_company_keywords"];
const COMPANY_EXCLUDE_KEYS = ["companyMustNotKeywords", "company_must_not_keywords", "excludedCompanyKeywords", "excluded_company_keywords"];
const COMPANY_PREFERENCE_KEYS = [
  "companyPreferenceKeywords",
  "company_preference_keywords",
  "preferredCompanyKeywords",
  "preferred_company_keywords",
];

function asTextList(raw: unknown): string[] {
  if (typeof raw === "string") {
    return raw
      .split(/[\n,，]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => asTextList(item))
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniq(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function pickLists(obj: Record<string, unknown>, keys: string[]): string[] {
  return uniq(keys.flatMap((key) => asTextList(obj[key])));
}

function numberValue(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = numberValue(obj[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function pickBool(obj: Record<string, unknown>, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "boolean") return raw;
    if (typeof raw !== "string") continue;
    const token = raw.trim().toLowerCase();
    if (["true", "1", "yes", "y", "是", "接受"].includes(token)) return true;
    if (["false", "0", "no", "n", "否", "不接受"].includes(token)) return false;
  }
  return fallback;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function normalizeWorkMode(value: string): string | null {
  const token = normalizeToken(value);
  if (["remote", "远程", "远程办公", "居家", "居家办公", "在家办公"].includes(token)) return "remote";
  if (["long_remote", "长期远程", "全远程", "完全远程", "full_remote"].includes(token)) return "long_remote";
  if (["flex_remote", "flexible_remote", "弹性远程", "可远程", "部分远程"].includes(token)) return "flex_remote";
  if (["hybrid", "混合", "混合办公", "弹性办公"].includes(token)) return "hybrid";
  if (["office", "到岗", "到岗办公", "线下", "线下办公", "坐班"].includes(token)) return "office";
  if (["on_site", "onsite", "驻场", "客户现场"].includes(token)) return "on_site";
  if (["unknown", "未知"].includes(token)) return "unknown";
  return null;
}

function normalizeWorkModes(items: string[]): string[] {
  return uniq(items.map(normalizeWorkMode).filter((item): item is string => Boolean(item)));
}

function normalizeSources(items: string[]): string[] {
  return uniq(items.map(normalizeToken).filter(Boolean));
}

function normalizeStatus(value: string): string | null {
  const token = normalizeToken(value);
  if (["not_contacted", "未打招呼", "未沟通"].includes(token)) return "not_contacted";
  if (["greeted_unread", "已打招呼未读", "未读"].includes(token)) return "greeted_unread";
  if (["read_no_reply", "已读未回"].includes(token)) return "read_no_reply";
  if (["replied", "已回复", "有回复"].includes(token)) return "replied";
  if (["rejected", "已拒绝", "拒绝"].includes(token)) return "rejected";
  if (["manual_not_fit", "手动不合适", "不合适"].includes(token)) return "manual_not_fit";
  return null;
}

function normalizeStatuses(items: string[]): string[] {
  return uniq(items.map(normalizeStatus).filter((item): item is string => Boolean(item)));
}

function positiveInteger(value: number | null): number | null {
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

export function normalizeBossProfileFilter(raw: unknown): BossProfileFilter {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profile =
    root.profile && typeof root.profile === "object"
      ? { ...root, ...(root.profile as Record<string, unknown>) }
      : root;

  return {
    mustKeywords: pickLists(profile, FILTER_KEYS),
    mustNotKeywords: pickLists(profile, EXCLUDE_KEYS),
    preferenceKeywords: pickLists(profile, PREFERENCE_KEYS),
    requiredDirections: pickLists(profile, REQUIRED_DIRECTION_KEYS),
    excludedDirections: pickLists(profile, EXCLUDED_DIRECTION_KEYS),
    preferenceDirections: pickLists(profile, PREFERENCE_DIRECTION_KEYS),
    requiredTechTags: pickLists(profile, REQUIRED_TECH_KEYS),
    excludedTechTags: pickLists(profile, EXCLUDED_TECH_KEYS),
    preferenceTechTags: pickLists(profile, PREFERENCE_TECH_KEYS),
    requiredWorkModes: normalizeWorkModes(pickLists(profile, REQUIRED_WORK_MODE_KEYS)),
    excludedWorkModes: normalizeWorkModes(pickLists(profile, EXCLUDED_WORK_MODE_KEYS)),
    preferenceWorkModes: normalizeWorkModes(pickLists(profile, PREFERENCE_WORK_MODE_KEYS)),
    targetCities: pickLists(profile, TARGET_CITY_KEYS),
    excludedCities: pickLists(profile, EXCLUDED_CITY_KEYS),
    sourcePlatforms: normalizeSources(pickLists(profile, SOURCE_PLATFORM_KEYS)),
    communicationStatuses: normalizeStatuses(pickLists(profile, COMMUNICATION_STATUS_KEYS)),
    minimumSalaryK: pickNumber(profile, ["minimumSalaryK", "minimum_salary_k", "minSalaryK", "min_salary_k"]),
    maximumSalaryK: pickNumber(profile, ["maximumSalaryK", "maximum_salary_k", "maxSalaryK", "max_salary_k"]),
    acceptNegotiableSalary: pickBool(profile, ["acceptNegotiableSalary", "accept_negotiable_salary"], false),
    recentDays: positiveInteger(pickNumber(profile, ["recentDays", "recent_days", "maxJobAgeDays", "max_job_age_days"])),
    minimumExperienceYears: pickNumber(profile, [
      "minimumExperienceYears",
      "minimum_experience_years",
      "minExperienceYears",
      "min_experience_years",
    ]),
    maximumExperienceYears: pickNumber(profile, [
      "maximumExperienceYears",
      "maximum_experience_years",
      "maxExperienceYears",
      "max_experience_years",
    ]),
    acceptUnknownExperience: pickBool(profile, ["acceptUnknownExperience", "accept_unknown_experience"], true),
    allowedDegrees: pickLists(profile, ALLOWED_DEGREE_KEYS),
    excludedDegrees: pickLists(profile, EXCLUDED_DEGREE_KEYS),
    companyMustKeywords: pickLists(profile, COMPANY_MUST_KEYS),
    companyMustNotKeywords: pickLists(profile, COMPANY_EXCLUDE_KEYS),
    companyPreferenceKeywords: pickLists(profile, COMPANY_PREFERENCE_KEYS),
  };
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    const text = value.trim();
    if (text) out.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectStrings(item, out);
  }
}

export function buildBossListItemSearchText(item: unknown): string {
  const parts: string[] = [];
  collectStrings(item, parts);
  return parts.join(" ").toLowerCase();
}

function includesKeyword(searchText: string, keyword: string): boolean {
  return searchText.includes(keyword.toLowerCase());
}

function keywordHits(searchText: string, rules: string[]): string[] {
  return rules.filter((rule) => includesKeyword(searchText, rule));
}

function missingKeywords(searchText: string, rules: string[]): string[] {
  return rules.filter((rule) => !includesKeyword(searchText, rule));
}

function appendKeywordPreferences(
  matched: string[],
  missing: string[],
  prefix: string,
  searchText: string,
  rules: string[],
): void {
  for (const rule of rules) {
    const label = `${prefix}:${rule}`;
    if (includesKeyword(searchText, rule)) {
      matched.push(label);
    } else {
      missing.push(label);
    }
  }
}

function detectWorkModes(searchText: string): string[] {
  const out: string[] = [];
  const add = (mode: string) => {
    if (!out.includes(mode)) out.push(mode);
  };
  if (["长期远程", "全远程", "完全远程", "full remote", "full_remote"].some((item) => searchText.includes(item))) {
    add("long_remote");
    add("remote");
  }
  if (["弹性远程", "可远程", "部分远程", "flex remote", "flexible remote"].some((item) => searchText.includes(item))) {
    add("flex_remote");
    add("remote");
  }
  if (["远程", "remote", "居家办公", "在家办公"].some((item) => searchText.includes(item))) add("remote");
  if (["hybrid", "混合办公", "混合模式", "弹性办公"].some((item) => searchText.includes(item))) add("hybrid");
  if (["驻场", "客户现场", "onsite", "on-site"].some((item) => searchText.includes(item))) add("on_site");
  if (["线下办公", "到岗", "到公司", "坐班", "办公室办公"].some((item) => searchText.includes(item))) add("office");
  if (out.length === 0) add("unknown");
  return out;
}

function textMatchesRule(value: string, rule: string): boolean {
  const normalizedValue = value.trim().toLowerCase();
  const normalizedRule = rule.trim().toLowerCase();
  return (
    Boolean(normalizedValue) &&
    Boolean(normalizedRule) &&
    (normalizedValue === normalizedRule ||
      normalizedValue.includes(normalizedRule) ||
      normalizedRule.includes(normalizedValue))
  );
}

function getStringField(item: unknown, keys: string[]): string {
  if (!item || typeof item !== "object") return "";
  const obj = item as Record<string, unknown>;
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return "";
}

function parseSalaryRange(salaryDesc: string): { minK: number | null; maxK: number | null; negotiable: boolean } {
  const lower = salaryDesc.toLowerCase();
  const negotiable = lower.includes("面议") || lower.includes("negotiable");
  if (!lower.includes("k") && !lower.includes("千")) return { minK: null, maxK: null, negotiable };
  const numbers = lower.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  const minK = numbers[0] ?? null;
  const maxK = numbers[1] ?? minK;
  return { minK, maxK, negotiable };
}

function parseExperienceRange(experienceName: string): { minYears: number | null; maxYears: number | null; unknown: boolean } {
  const lower = experienceName.toLowerCase();
  if (
    lower.trim() === "" ||
    lower.includes("不限") ||
    lower.includes("无经验") ||
    lower.includes("应届") ||
    lower.includes("在校")
  ) {
    return { minYears: lower.trim() === "" ? null : 0, maxYears: null, unknown: lower.trim() === "" };
  }
  const numbers = lower.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  const minYears = numbers[0] ?? null;
  const maxYears = numbers[1] ?? minYears;
  return { minYears, maxYears, unknown: minYears === null };
}

export function evaluateBossProfileFilter(
  item: unknown,
  filter: BossProfileFilter,
): BossProfileFilterResult {
  const searchText = buildBossListItemSearchText(item);
  const blocked_by: BossProfileRuleHit[] = [];
  const detectedWorkModes = detectWorkModes(searchText);
  const cityName = getStringField(item, ["cityName", "city_name", "city"]);
  const salaryDesc = getStringField(item, ["salaryDesc", "salary_desc", "salary"]);
  const experienceName = getStringField(item, ["experienceName", "experience_name", "experience"]);
  const degreeName = getStringField(item, ["degreeName", "degree_name", "degree"]);
  const salaryRange = parseSalaryRange(salaryDesc);
  const experienceRange = parseExperienceRange(experienceName);
  const sourcePlatform = "boss";

  for (const keyword of filter.mustKeywords) {
    if (includesKeyword(searchText, keyword)) continue;
    blocked_by.push({
      rule_type: "must_keyword",
      field: "boss_list_item",
      value: keyword,
      reason: `Boss 列表项未命中必须包含关键词：${keyword}`,
    });
  }

  for (const keyword of filter.mustNotKeywords) {
    if (!includesKeyword(searchText, keyword)) continue;
    blocked_by.push({
      rule_type: "must_not_keyword",
      field: "boss_list_item",
      value: keyword,
      reason: `Boss 列表项命中必须排除关键词：${keyword}`,
    });
  }

  if (filter.requiredDirections.length > 0 && keywordHits(searchText, filter.requiredDirections).length === 0) {
    blocked_by.push({
      rule_type: "required_direction",
      field: "boss_list_item",
      value: filter.requiredDirections.join(","),
      reason: `Boss 列表项未命中必须岗位方向：${filter.requiredDirections.join("、")}`,
    });
  }
  for (const direction of keywordHits(searchText, filter.excludedDirections)) {
    blocked_by.push({
      rule_type: "excluded_direction",
      field: "boss_list_item",
      value: direction,
      reason: `Boss 列表项命中排除岗位方向：${direction}`,
    });
  }
  for (const tag of missingKeywords(searchText, filter.requiredTechTags)) {
    blocked_by.push({
      rule_type: "required_tech_tag",
      field: "boss_list_item",
      value: tag,
      reason: `Boss 列表项未命中必须技术标签：${tag}`,
    });
  }
  for (const tag of keywordHits(searchText, filter.excludedTechTags)) {
    blocked_by.push({
      rule_type: "excluded_tech_tag",
      field: "boss_list_item",
      value: tag,
      reason: `Boss 列表项命中排除技术标签：${tag}`,
    });
  }
  for (const keyword of missingKeywords(searchText, filter.companyMustKeywords)) {
    blocked_by.push({
      rule_type: "company_must_keyword",
      field: "company_condition",
      value: keyword,
      reason: `Boss 列表项公司条件未命中必须关键词：${keyword}`,
    });
  }
  for (const keyword of keywordHits(searchText, filter.companyMustNotKeywords)) {
    blocked_by.push({
      rule_type: "company_must_not_keyword",
      field: "company_condition",
      value: keyword,
      reason: `Boss 列表项公司条件命中排除关键词：${keyword}`,
    });
  }

  if (filter.requiredWorkModes.length > 0 && !filter.requiredWorkModes.some((mode) => detectedWorkModes.includes(mode))) {
    blocked_by.push({
      rule_type: "required_work_mode",
      field: "work_mode",
      value: filter.requiredWorkModes.join(","),
      reason: `Boss 列表项未命中必须工作方式：${filter.requiredWorkModes.join("、")}`,
    });
  }
  for (const mode of filter.excludedWorkModes.filter((mode) => detectedWorkModes.includes(mode))) {
    blocked_by.push({
      rule_type: "excluded_work_mode",
      field: "work_mode",
      value: mode,
      reason: `Boss 列表项命中排除工作方式：${mode}`,
    });
  }
  if (filter.targetCities.length > 0 && !filter.targetCities.some((city) => textMatchesRule(cityName, city))) {
    blocked_by.push({
      rule_type: "target_city",
      field: "city_name",
      value: filter.targetCities.join(","),
      reason: `Boss 列表项城市不在可接受城市内：${filter.targetCities.join("、")}`,
    });
  }
  for (const city of filter.excludedCities.filter((city) => textMatchesRule(cityName, city))) {
    blocked_by.push({
      rule_type: "excluded_city",
      field: "city_name",
      value: city,
      reason: `Boss 列表项城市命中排除城市：${city}`,
    });
  }
  if (filter.sourcePlatforms.length > 0 && !filter.sourcePlatforms.includes(sourcePlatform)) {
    blocked_by.push({
      rule_type: "source_platform",
      field: "source_platform",
      value: filter.sourcePlatforms.join(","),
      reason: `Boss 列表项来源不在允许平台内：${filter.sourcePlatforms.join("、")}`,
    });
  }
  if (filter.minimumSalaryK !== null || filter.maximumSalaryK !== null) {
    if (salaryRange.negotiable && !filter.acceptNegotiableSalary) {
      blocked_by.push({
        rule_type: "negotiable_salary",
        field: "salary_desc",
        value: salaryDesc,
        reason: "Boss 列表项薪资为面议，当前画像不接受面议薪资",
      });
    }
    if (salaryRange.minK === null || salaryRange.maxK === null) {
      blocked_by.push({
        rule_type: "unknown_salary",
        field: "salary_desc",
        value: salaryDesc,
        reason: "Boss 列表项薪资无法解析，不能满足薪资硬限制",
      });
    }
    if (filter.minimumSalaryK !== null && salaryRange.maxK !== null && salaryRange.maxK < filter.minimumSalaryK) {
      blocked_by.push({
        rule_type: "minimum_salary",
        field: "salary_desc",
        value: salaryDesc,
        reason: `Boss 列表项最高薪资 ${salaryRange.maxK}K 低于最低薪资要求 ${filter.minimumSalaryK}K`,
      });
    }
    if (filter.maximumSalaryK !== null && salaryRange.minK !== null && salaryRange.minK > filter.maximumSalaryK) {
      blocked_by.push({
        rule_type: "maximum_salary",
        field: "salary_desc",
        value: salaryDesc,
        reason: `Boss 列表项最低薪资 ${salaryRange.minK}K 高于最高薪资限制 ${filter.maximumSalaryK}K`,
      });
    }
  }

  if (filter.minimumExperienceYears !== null || filter.maximumExperienceYears !== null) {
    if (experienceRange.unknown && !filter.acceptUnknownExperience) {
      blocked_by.push({
        rule_type: "unknown_experience",
        field: "experience_name",
        value: experienceName,
        reason: "Boss 列表项经验要求无法解析，当前画像不接受未知经验",
      });
    }
    if (
      filter.minimumExperienceYears !== null &&
      experienceRange.maxYears !== null &&
      experienceRange.maxYears < filter.minimumExperienceYears
    ) {
      blocked_by.push({
        rule_type: "minimum_experience",
        field: "experience_name",
        value: experienceName,
        reason: `Boss 列表项最高经验 ${experienceRange.maxYears} 年低于最低经验要求 ${filter.minimumExperienceYears} 年`,
      });
    }
    if (
      filter.maximumExperienceYears !== null &&
      experienceRange.minYears !== null &&
      experienceRange.minYears > filter.maximumExperienceYears
    ) {
      blocked_by.push({
        rule_type: "maximum_experience",
        field: "experience_name",
        value: experienceName,
        reason: `Boss 列表项最低经验 ${experienceRange.minYears} 年高于最高经验限制 ${filter.maximumExperienceYears} 年`,
      });
    }
  }
  if (filter.allowedDegrees.length > 0 && !filter.allowedDegrees.some((degree) => textMatchesRule(degreeName, degree))) {
    blocked_by.push({
      rule_type: "allowed_degree",
      field: "degree_name",
      value: filter.allowedDegrees.join(","),
      reason: `Boss 列表项学历要求不在允许范围内：${filter.allowedDegrees.join("、")}`,
    });
  }
  for (const degree of filter.excludedDegrees.filter((degree) => textMatchesRule(degreeName, degree))) {
    blocked_by.push({
      rule_type: "excluded_degree",
      field: "degree_name",
      value: degree,
      reason: `Boss 列表项学历要求命中排除项：${degree}`,
    });
  }

  const matched_preferences = filter.preferenceKeywords.filter((keyword) => includesKeyword(searchText, keyword));
  const missing_preferences = filter.preferenceKeywords.filter((keyword) => !includesKeyword(searchText, keyword));
  for (const mode of filter.preferenceWorkModes) {
    const label = `work_mode:${mode}`;
    if (detectedWorkModes.includes(mode)) {
      matched_preferences.push(label);
    } else {
      missing_preferences.push(label);
    }
  }
  appendKeywordPreferences(matched_preferences, missing_preferences, "direction", searchText, filter.preferenceDirections);
  appendKeywordPreferences(matched_preferences, missing_preferences, "tech", searchText, filter.preferenceTechTags);
  appendKeywordPreferences(matched_preferences, missing_preferences, "company", searchText, filter.companyPreferenceKeywords);

  return {
    eligible: blocked_by.length === 0,
    blocked_by,
    matched_preferences,
    missing_preferences,
  };
}

export function hasBossProfileFilter(filter: BossProfileFilter): boolean {
  return (
    filter.mustKeywords.length > 0 ||
    filter.mustNotKeywords.length > 0 ||
    filter.preferenceKeywords.length > 0 ||
    filter.requiredDirections.length > 0 ||
    filter.excludedDirections.length > 0 ||
    filter.preferenceDirections.length > 0 ||
    filter.requiredTechTags.length > 0 ||
    filter.excludedTechTags.length > 0 ||
    filter.preferenceTechTags.length > 0 ||
    filter.requiredWorkModes.length > 0 ||
    filter.excludedWorkModes.length > 0 ||
    filter.preferenceWorkModes.length > 0 ||
    filter.targetCities.length > 0 ||
    filter.excludedCities.length > 0 ||
    filter.sourcePlatforms.length > 0 ||
    filter.communicationStatuses.length > 0 ||
    filter.minimumSalaryK !== null ||
    filter.maximumSalaryK !== null ||
    filter.recentDays !== null ||
    filter.minimumExperienceYears !== null ||
    filter.maximumExperienceYears !== null ||
    filter.allowedDegrees.length > 0 ||
    filter.excludedDegrees.length > 0 ||
    filter.companyMustKeywords.length > 0 ||
    filter.companyMustNotKeywords.length > 0 ||
    filter.companyPreferenceKeywords.length > 0
  );
}
