export type JobPostingClassification = {
  isJobPosting: boolean;
  hasHiringSignal: boolean;
  matched: string[];
  strongMatches: string[];
  supportingMatches: string[];
  keywordMatches: string[];
  nonHiringMatches: string[];
};

type ClassifyJobPostingInput = {
  text: string;
  keywords?: readonly string[];
  strongHiringTerms: readonly string[];
  supportingHiringTerms: readonly string[];
};

const EXPLICIT_HIRING_TERMS = ["招聘", "招人", "内推", "急招", "社招", "校招", "hiring", "招募", "接单"];
const ACTIONABLE_HIRING_TERMS = [
  "投递",
  "简历投递",
  "投简历",
  "招聘邮箱",
  "邮箱",
  "wechat",
  "微信",
  "联系我",
  "岗位职责",
  "任职要求",
  "薪资",
  "hc",
  "base",
];
const ROLE_TERMS = ["岗位", "职位", "工程师", "开发", "全职", "兼职", "实习"];
const NEGATED_HIRING_TERMS = ["不是招聘", "非招聘", "不招聘", "不招人", "停止招聘", "已经招满"];
const NON_HIRING_INTENT_TERMS = [
  ...NEGATED_HIRING_TERMS,
  "模拟面试",
  "面试工具",
  "求职工具",
  "开源项目",
  "项目介绍",
  "产品介绍",
  "工具介绍",
  "课程推广",
  "经验分享",
  "求职经验",
  "技术分享",
  "学习路线",
  "注册邀请码",
  "欢迎体验",
  "欢迎试用",
  "后续开源",
  "做了一个",
  "搞了一个",
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function includesAny(text: string, terms: readonly string[]): string[] {
  const haystack = normalizeText(text);
  return terms.filter((term) => haystack.includes(normalizeText(term)));
}

function unique(items: readonly string[]): string[] {
  return [...new Set(items)];
}

/**
 * 判断内容是否具备真实招聘或内推意图，不处理用户个人岗位偏好。
 */
export function classifyJobPostingContent(input: ClassifyJobPostingInput): JobPostingClassification {
  const strongMatches = includesAny(input.text, input.strongHiringTerms);
  const supportingMatches = includesAny(input.text, input.supportingHiringTerms);
  const keywordMatches = includesAny(input.text, input.keywords ?? []);
  const explicitHiringMatches = includesAny(input.text, EXPLICIT_HIRING_TERMS);
  const actionableMatches = includesAny(input.text, ACTIONABLE_HIRING_TERMS);
  const roleMatches = includesAny(input.text, ROLE_TERMS);
  const nonHiringMatches = includesAny(input.text, NON_HIRING_INTENT_TERMS);

  const hasExplicitHiringIntent = explicitHiringMatches.length > 0;
  const hasActionableHiringEvidence =
    (actionableMatches.length >= 2 && roleMatches.length > 0)
    || (supportingMatches.length >= 3 && actionableMatches.length > 0);
  const hasNegatedHiringIntent = includesAny(input.text, NEGATED_HIRING_TERMS).length > 0;
  const effectiveExplicitHiringIntent = hasExplicitHiringIntent && !hasNegatedHiringIntent;
  const clearlyNonHiring = nonHiringMatches.length > 0 && !effectiveExplicitHiringIntent;
  const hasHiringSignal = (effectiveExplicitHiringIntent || hasActionableHiringEvidence) && !clearlyNonHiring;

  return {
    isJobPosting: hasHiringSignal,
    hasHiringSignal,
    matched: unique([...strongMatches, ...supportingMatches, ...keywordMatches]),
    strongMatches,
    supportingMatches,
    keywordMatches,
    nonHiringMatches,
  };
}
