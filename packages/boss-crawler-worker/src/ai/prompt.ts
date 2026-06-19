import { withGreetingPromptExtra, withPromptExtra, withSchemaExtra } from "./promptExtra.js";

type JobAiPromptContext = {
  filterReason?: unknown;
  scoreReason?: unknown;
  sourceContext?: unknown;
  reviewContext?: unknown;
};

function buildJobAiContextJson(context?: JobAiPromptContext): string {
  if (!context) return "（无）";
  const payload = {
    source_context: context.sourceContext ?? null,
    filter_reason: context.filterReason ?? null,
    score_reason: context.scoreReason ?? null,
    review_context: context.reviewContext ?? null,
  };
  const hasAny = Object.values(payload).some((value) => value !== null && value !== undefined);
  return hasAny ? JSON.stringify(payload) : "（无）";
}

function readProfileText(profile: unknown, key: string): string {
  if (!profile || typeof profile !== "object") return "（无）";
  const value = (profile as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : "（无）";
}

function readAiUncertainStrategy(profile: unknown): string {
  if (!profile || typeof profile !== "object") return "pending_confirmation";
  const value = (profile as Record<string, unknown>).aiUncertainStrategy;
  if (value === "filtered" || value === "recommended" || value === "pending_confirmation") return value;
  return "pending_confirmation";
}

export function buildAiPrompts(
  resumeText: string,
  jobDetail: unknown,
  contextText?: string,
  resumeFiles?: string,
  jobContext?: JobAiPromptContext,
): { system: string; user: string } {
  const system = withPromptExtra([
    "你是一名严谨的招聘经理与简历教练。",
    "你必须输出严格 JSON（不要 Markdown，不要代码块，不要额外文本）。",
    "字符串值中不要出现未转义的英文双引号（\"）；如需引用请使用中文引号“”或用 \\\" 转义。",
    "你不能编造事实；只能基于简历原文与岗位信息给建议。",
    "筛选/排序/来源上下文只能作为 Job Sync 的系统证据，不能替代简历原文中的候选人事实。",
  ]);

  const schemaHint = {
    resume_match_score: 0,
    matched_stack: ["Go", "Kubernetes"],
    matched_direction: ["Infra", "SRE"],
    matched_resume_evidence: ["简历项目中出现可验证证据"],
    experience_fit: "3-5年",
    missing_points: ["岗位要求中未在简历看到的点"],
    confidence: 0.82,
    matchScore: 0,
    strengths: ["..."],
    gaps: ["..."],
    keywordSuggestions: ["..."],
    resumeRewrite: {
      summaryRewrite: "...",
      experienceBulletsRewrite: ["..."],
    },
    riskNotes: ["..."],
  };

  const user = withSchemaExtra([
    "任务：基于【简历】与【岗位】做匹配分析与可执行改进建议。",
    "",
    "补充说明：你必须同时参考【当前情况说明】与【简历文件说明】；但不可把文件路径当作事实来源，只有简历原文里出现的内容才算事实。",
    "",
    "输出要求：只输出一个 JSON 对象，字段必须包含：",
    "resume_match_score（0-100 数字）、matched_stack（字符串数组）、matched_direction（字符串数组）、matched_resume_evidence（字符串数组）、experience_fit（字符串）、missing_points（字符串数组）、confidence（0-1 数字）。",
    "同时保留兼容字段：matchScore（0-100 数字）、strengths（字符串数组）、gaps（字符串数组）、keywordSuggestions（字符串数组）、resumeRewrite（对象）、riskNotes（字符串数组）。",
    "matched_resume_evidence 必须引用简历原文中的具体经历或项目；missing_points 只能列岗位要求里简历未明确覆盖的点。",
    "",
    `输出示例结构（值可变）：${JSON.stringify(schemaHint)}`,
    "",
    "【当前情况说明】",
    (contextText ?? "").trim() || "（无）",
    "",
    "【简历文件说明】",
    (resumeFiles ?? "").trim() || "（无）",
    "",
    "【简历】",
    resumeText,
    "",
    "【筛选/排序/来源上下文 JSON】",
    buildJobAiContextJson(jobContext),
    "",
    "【岗位（原始 JSON）】",
    JSON.stringify(jobDetail),
  ]);

  return { system, user };
}

export function buildAiGroupPrompts(
  contextText: string,
  jobs: unknown,
): { system: string; user: string } {
  const system = withPromptExtra([
    "你是一名严谨的职业规划顾问与简历教练。",
    "你必须输出严格 JSON（不要 Markdown，不要代码块，不要额外文本）。",
    "字符串值中不要出现未转义的英文双引号（\"）；如需引用请使用中文引号“”或用 \\\" 转义。",
    "你不能编造事实；只能基于当前情况说明与岗位摘要给建议。",
    "如果信息不足，你必须在 assumptions / questions 中明确指出，并用条件句给出分支建议。",
    "你必须对多个岗位做横向对比，并给出职位适配度排序。",
    "岗位摘要中的 filter_reason、score_reason、source_context、review_context 是 Job Sync 的系统筛选/排序证据；你需要参考它们，但不能把它们当作候选人简历事实。",
    "重要：你已经收到了完成任务所需的全部输入（当前情况说明 + 岗位列表摘要），禁止输出 meta/status/message/required_inputs 这类“等待输入”的占位结构。",
    "如果你还想问问题，只能把问题写进 questions 数组，但仍必须输出完整报告结构。",
  ]);

  const schemaHint = {
    summary: "...",
    jobRanking: [
      {
        encrypt_job_id: "...",
        position_name: "...",
        brand_name: "...",
        matchScore: 0,
        conclusion: "...",
        reasons: ["..."],
        risks: ["..."],
      },
    ],
    commonRequirements: {
      mustHave: ["..."],
      niceToHave: ["..."],
      responsibilities: ["..."],
      keywords: ["..."],
    },
    resumeStrategy: {
      positioning: "...",
      mustHighlight: ["..."],
      bullets: ["..."],
    },
    projectBoosters: [
      {
        title: "...",
        why: "...",
        deliverables: ["..."],
        resumeBullets: ["..."],
      },
    ],
    learningPlan: {
      p0: [{ topic: "...", why: "...", expectedOutput: ["..."] }],
      p1: [{ topic: "...", why: "...", expectedOutput: ["..."] }],
      p2: [{ topic: "...", why: "...", expectedOutput: ["..."] }],
    },
    assumptions: ["..."],
    questions: ["..."],
    riskNotes: ["..."],
    nextSteps: ["..."],
  };

  const user = withSchemaExtra([
    "任务：仅根据【当前情况说明】与【岗位列表（摘要）】生成一份综合分析报告。",
    "",
    "输出要求：只输出一个 JSON 对象，字段必须包含：",
    "summary、jobRanking、commonRequirements、resumeStrategy、projectBoosters、learningPlan、assumptions、questions、riskNotes、nextSteps。",
    "",
    "jobRanking 要按 matchScore 从高到低排序；每个岗位必须给出：matchScore、结论、理由、风险。",
    "jobRanking 必须覆盖岗位列表中的全部岗位：数量必须等于输入岗位数组长度；每个 encrypt_job_id 必须与输入一致且不重复；不得遗漏任何岗位。",
    "排序和风险判断必须参考每个岗位摘要里的采后规则命中、评分理由、来源平台和沟通/人工审核状态，但最终判断仍需基于岗位事实与当前情况说明。",
    "",
    "禁止输出：meta、status、message、required_inputs 等字段；不要要求用户再次提供信息。",
    "",
    `输出示例结构（值可变）：${JSON.stringify(schemaHint)}`,
    "",
    "【当前情况说明】",
    contextText.trim() || "（无）",
    "",
    "【岗位列表（摘要 JSON）】",
    JSON.stringify(jobs),
  ]);

  return { system, user };
}

export function buildGreetingPrompts(args: {
  resumeText?: string;
  contextText?: string;
  resumeFiles?: string;
  greetingPromptExtra?: string;
  jobDetail: unknown;
  matchReport?: unknown;
  filterReason?: unknown;
  scoreReason?: unknown;
  sourceContext?: unknown;
  reviewContext?: unknown;
}): { system: string; user: string } {
  const system = withGreetingPromptExtra(
    withPromptExtra([
      "你是一名谨慎、具体的求职沟通文案助手。",
      "你必须输出严格 JSON（不要 Markdown，不要代码块，不要额外文本）。",
      "你不能编造经历，候选人经历只能来自简历、当前情况说明、匹配报告或评分理由。",
      "你不能输出自动发送动作，只能生成供用户编辑复制的短文案。",
      "避免泛化模板，尤其不要使用“您好，我对贵司岗位/这个岗位/该职位很感兴趣”这类空话开头。",
    ]),
    args.greetingPromptExtra ?? "",
  );

  const schemaHint = {
    message: "...",
    jobEvidence: ["岗位要求中的具体点"],
    candidateEvidence: ["候选人材料中的具体点"],
    overlapKeywords: ["Go", "Kubernetes"],
    editNotes: ["如需更稳妥，可补充具体项目名称"],
  };

  const user = withSchemaExtra([
    "任务：为 Boss 直聘类技术岗位生成一段短、具体、可复制但必须由用户人工编辑后使用的打招呼文案。",
    "",
    "硬性要求：",
    "1. message 控制在 80-140 个中文字符。",
    "2. message 必须引用岗位需求和候选人技术栈/经历的交集。",
    "3. message 必须直接包含 overlapKeywords 中至少一个词，不能只把交集写在数组里。",
    "4. 不得夸大或编造候选人没提供的经历。",
    "5. 不要承诺自动发送、不要包含群发口吻。",
    "6. 优先使用匹配报告或评分理由中的 resume.matched_stack、resume.matched_direction、matched_resume_evidence 作为技术交集和候选人证据。",
    "7. candidateEvidence 必须来自简历原文、当前情况说明、匹配报告或评分理由，不能把岗位要求当成候选人经历。",
    "8. 只输出 JSON 对象，字段必须包含 message、jobEvidence、candidateEvidence、overlapKeywords、editNotes。",
    "",
    `输出示例结构（值可变）：${JSON.stringify(schemaHint)}`,
    "",
    "【当前情况说明】",
    (args.contextText ?? "").trim() || "（无）",
    "",
    "【简历文件说明】",
    (args.resumeFiles ?? "").trim() || "（无）",
    "",
    "【简历原文】",
    (args.resumeText ?? "").trim() || "（未提供，必须更保守，只能基于匹配报告和当前情况说明）",
    "",
    "【打招呼补充提示】",
    (args.greetingPromptExtra ?? "").trim() || "（无）",
    "",
    "【匹配报告 JSON】",
    args.matchReport ? JSON.stringify(args.matchReport) : "（无）",
    "",
    "【筛选理由 JSON】",
    args.filterReason ? JSON.stringify(args.filterReason) : "（无）",
    "",
    "【评分理由 JSON】",
    args.scoreReason ? JSON.stringify(args.scoreReason) : "（无）",
    "",
    "【来源与审核上下文 JSON】",
    buildJobAiContextJson({
      sourceContext: args.sourceContext,
      reviewContext: args.reviewContext,
    }),
    "",
    "【岗位 JSON】",
    JSON.stringify(args.jobDetail),
  ]);

  return { system, user };
}

export function buildCompanyScoreBatchPrompts(companies: unknown): { system: string; user: string } {
  const system = withPromptExtra([
    "你是一名谨慎的公司与岗位风险分析助手。",
    "你必须输出严格 JSON（不要 Markdown，不要代码块，不要额外文本）。",
    "你不能编造事实；只能基于输入的公司、岗位摘要和 JD / 原始字段判断。",
    "Company Score 用于人工审核排序，不是自动投递或自动联系动作。",
    "风险标签只在有证据时使用；可用标签包括 outsourcing_risk、training_risk、sales_like_risk、low_info_risk、onsite_risk、agency_risk。",
  ]);

  const schemaHint = {
    companies: [
      {
        company_name: "...",
        company_score: 83,
        risk_flags: ["outsourcing_risk"],
        evidence: ["JD 中出现外包交付相关描述"],
        confidence: 0.82,
      },
    ],
  };

  const user = withSchemaExtra([
    "任务：对【公司批次】中的每家公司生成 Company Score。",
    "",
    "评分要求：",
    "1. company_score 为 0-100 数字，分数越高代表公司/岗位风险越低、信息越可信。",
    "2. risk_flags 只输出有证据的风险标签；没有明确风险时输出空数组。",
    "3. evidence 必须给出至少 1 条基于输入文本的证据；信息不足时用 low_info_risk，并说明缺少哪些信息。",
    "4. confidence 为 0-1 数字，表示判断置信度。",
    "5. 输出 companies 数组必须覆盖输入中的每一个 company_name，名称必须原样返回，不得遗漏、合并或改名。",
    "",
    "只输出一个 JSON 对象，字段必须完全符合示例结构：",
    JSON.stringify(schemaHint),
    "",
    "【公司批次 JSON】",
    JSON.stringify(companies),
  ]);

  return { system, user };
}

export function buildPostCollectionJudgePrompts(args: {
  profile?: unknown;
  job: unknown;
  filterReason?: unknown;
}): { system: string; user: string } {
  const aiUncertainStrategy = readAiUncertainStrategy(args.profile);
  const system = withPromptExtra([
    "你是一名谨慎的技术岗位采后判断助手。",
    "你必须输出严格 JSON（不要 Markdown，不要代码块，不要额外文本）。",
    "你不能编造事实；只能基于岗位字段、JD、原始正文、公司信息和采后规则配置判断。",
    "确定性的黑名单、人工审核状态、沟通状态由 Job Sync 系统处理；你只判断岗位内容本身是否值得进入候选视图。",
    "不确定时必须选择 pending_confirmation，不要因为信息不足直接 filtered。",
    "采后规则配置中的 AI 软排除是判断偏好，不是关键词硬黑名单；只有岗位字段或正文提供清晰证据时才可以 filtered。",
  ]);

  const schemaHint = {
    bucket: "recommended",
    confidence: 0.82,
    summary: "岗位内容与目标方向匹配，JD 有明确技术栈证据。",
    evidence: ["JD 中出现 Go / Kubernetes / 云原生相关职责"],
    risks: ["公司规模或业务信息不足"],
  };

  const user = withSchemaExtra([
    "任务：根据【采后规则配置】、【系统采后理由】和【岗位 JSON】判断岗位内容是否进入职位库候选分区。",
    "",
    "bucket 选择规则：",
    "1. recommended：岗位方向、职责、技术栈或公司信息整体值得查看。",
    "2. pending_confirmation：证据不足、信息矛盾、职位可能相关但无法稳定判断。",
    "3. filtered：岗位内容明确不符合目标方向，或存在明确岗位内容风险。",
    `4. 用户设置的不确定策略是 ${aiUncertainStrategy}；但当证据不足、软排除只是隐约迹象或 confidence 低于 0.65 时，仍优先 pending_confirmation。`,
    "",
    "硬性要求：",
    "1. confidence 为 0-1 数字；低于 0.65 时应优先 pending_confirmation。",
    "2. summary 用一句中文说明结论。",
    "3. evidence 至少 1 条，必须来自输入字段或正文的可追溯信息。",
    "4. risks 可以为空数组，但有外包、培训、销售化、信息过少等风险时必须写出。",
    "5. 不要输出推荐投递、自动沟通或自动操作建议。",
    "6. 命中【AI 软排除】且证据清晰时，bucket 应倾向 filtered；命中不完整或上下文暧昧时，bucket 应为 pending_confirmation，并在 risks 说明待人工确认点。",
    "",
    "只输出一个 JSON 对象，字段必须完全符合示例结构：",
    JSON.stringify(schemaHint),
    "",
    "【AI 想看的岗位】",
    readProfileText(args.profile, "aiPreferredText"),
    "",
    "【AI 软排除】",
    readProfileText(args.profile, "aiRejectedText"),
    "",
    "【AI 风险关注点】",
    readProfileText(args.profile, "aiRiskText"),
    "",
    "【不确定策略】",
    aiUncertainStrategy,
    "",
    "【采后规则配置 JSON】",
    args.profile ? JSON.stringify(args.profile) : "（无）",
    "",
    "【系统采后理由 JSON】",
    args.filterReason ? JSON.stringify(args.filterReason) : "（无）",
    "",
    "【岗位 JSON】",
    JSON.stringify(args.job),
  ]);

  return { system, user };
}
