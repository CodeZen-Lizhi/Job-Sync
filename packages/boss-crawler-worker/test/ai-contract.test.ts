import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAiGroupPrompts,
  buildAiPrompts,
  buildCompanyScoreBatchPrompts,
  buildGreetingPrompts,
  buildPostCollectionJudgePrompts,
} from "../src/ai/prompt.js";
import { normalizeAiResult } from "../src/modes/ai/normalizeResume.js";
import { normalizeAiGroupResult } from "../src/modes/ai/normalizeGroup.js";
import { normalizeAiCompanyScoreBatchResult } from "../src/modes/ai/normalizeCompanyScore.js";
import { AiCompanyScoreBatchResultSchema, AiGreetingResultSchema, AiGroupResultSchema, AiResultSchema } from "../src/modes/ai/schemas.js";

const fixtureJob = {
  encrypt_job_id: "boss-go-sre-001",
  position_name: "Go SRE 工程师",
  brand_name: "云原生科技",
  salary_desc: "35-55K",
  jobInfo: {
    postDescription: "负责 Go 后端平台、Kubernetes 集群稳定性、Prometheus 监控和 CI/CD 自动化。",
    skills: ["Go", "Kubernetes", "Prometheus", "Docker"],
    jobLabels: ["云原生", "SRE"],
  },
};

const fixtureResume = [
  "候选人：Go / Infra 工程师",
  "经历：建设过 Kubernetes 多集群发布平台，维护 Prometheus 监控与告警，熟悉 Linux 和 CI/CD。",
].join("\n");

const fixtureJobContext = {
  filterReason: {
    eligible: true,
    matched_preferences: ["Go", "云原生"],
    missing_preferences: ["长期远程"],
  },
  scoreReason: {
    weights: { resume: 0.6, preference: 0.25, company: 0.15 },
    resume_match_score: 88,
    resume: {
      resume_match_score: 88,
      matched_stack: ["Go", "Kubernetes", "Prometheus"],
      matched_direction: ["Infra", "SRE"],
      matched_resume_evidence: ["候选人建设过 Kubernetes 多集群发布平台", "维护 Prometheus 监控与告警"],
      experience_fit: "3-5年",
      missing_points: ["AWS 未明确"],
      confidence: 0.86,
    },
    company: { company_score: 82, risk_flags: [], evidence: ["公司信息较完整"] },
  },
  sourceContext: {
    source_platform: "boss",
    source_url: "https://www.zhipin.com/job_detail/sec-001.html",
    dedup_key: "sec-001",
    default_profile: { allowed_source_platforms: ["boss"] },
  },
  reviewContext: {
    review_status: "pending",
    communication_status: "greeted_unread",
    last_greeted_at: "2026-06-13T00:00:00Z",
  },
};

describe("AI fixture contract", () => {
  it("appends user schema extras while keeping required structured fields", () => {
    const previous = process.env.OPENAI_SCHEMA_EXTRA;
    process.env.OPENAI_SCHEMA_EXTRA = "额外输出 evidenceLevel 字段，取值 low / medium / high。";
    try {
      const prompts = buildAiPrompts(fixtureResume, fixtureJob, "目标：国内 Go / Infra / SRE 岗位", "");

      assert.match(prompts.user, /用户结构化输出 Schema 补充/);
      assert.match(prompts.user, /evidenceLevel/);
      assert.match(prompts.user, /不能删除内置必填字段/);
      assert.match(prompts.user, /matchScore/);
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_SCHEMA_EXTRA;
      } else {
        process.env.OPENAI_SCHEMA_EXTRA = previous;
      }
    }

    const parsed = AiResultSchema.parse({
      matchScore: 88,
      strengths: ["Go 平台经验匹配"],
      gaps: ["AWS 经验未明确"],
      keywordSuggestions: ["Go", "Kubernetes"],
      resumeRewrite: {
        summaryRewrite: "Go / Infra 工程师，具备 Kubernetes 平台建设经验。",
        evidenceLevel: "high",
      },
      riskNotes: ["薪资和城市需人工确认"],
      evidenceLevel: "medium",
    }) as Record<string, unknown>;

    assert.equal(parsed.evidenceLevel, "medium");
    assert.equal((parsed.resumeRewrite as Record<string, unknown>).evidenceLevel, "high");
  });

  it("builds resume-match prompts with fixture JD facts and required JSON schema", () => {
    const prompts = buildAiPrompts(fixtureResume, fixtureJob, "目标：国内 Go / Infra / SRE 岗位", "", fixtureJobContext);

    assert.match(prompts.system, /严格 JSON/);
    assert.match(prompts.system, /不能编造事实/);
    assert.match(prompts.system, /筛选\/排序\/来源上下文/);
    assert.match(prompts.user, /matchScore/);
    assert.match(prompts.user, /resume_match_score/);
    assert.match(prompts.user, /matched_stack/);
    assert.match(prompts.user, /matched_direction/);
    assert.match(prompts.user, /matched_resume_evidence/);
    assert.match(prompts.user, /experience_fit/);
    assert.match(prompts.user, /missing_points/);
    assert.match(prompts.user, /confidence/);
    assert.match(prompts.user, /strengths/);
    assert.match(prompts.user, /keywordSuggestions/);
    assert.match(prompts.user, /Go SRE 工程师/);
    assert.match(prompts.user, /Kubernetes/);
    assert.match(prompts.user, /Prometheus/);
    assert.match(prompts.user, /国内 Go \/ Infra \/ SRE 岗位/);
    assert.match(prompts.user, /筛选\/排序\/来源上下文 JSON/);
    assert.match(prompts.user, /source_context/);
    assert.match(prompts.user, /filter_reason/);
    assert.match(prompts.user, /score_reason/);
    assert.match(prompts.user, /review_context/);
    assert.match(prompts.user, /greeted_unread/);
    assert.match(prompts.user, /sec-001/);
  });

  it("builds post-collection judge prompts with AI preference and soft rejection guidance", () => {
    const prompts = buildPostCollectionJudgePrompts({
      profile: {
        aiPreferredText: "优先 Go / Infra / SRE，有 Kubernetes 和平台工程证据。",
        aiRejectedText: "软排除：外包、驻场、招转培、销售导向、纯实施交付。",
        aiRiskText: "信息太少或软排除证据暧昧时，放入待确认。",
        aiUncertainStrategy: "pending_confirmation",
      },
      job: fixtureJob,
      filterReason: fixtureJobContext.filterReason,
    });

    assert.match(prompts.system, /AI 软排除是判断偏好/);
    assert.match(prompts.user, /AI 想看的岗位/);
    assert.match(prompts.user, /AI 软排除/);
    assert.match(prompts.user, /AI 风险关注点/);
    assert.match(prompts.user, /不确定策略/);
    assert.match(prompts.user, /招转培/);
    assert.match(prompts.user, /证据不足、软排除只是隐约迹象/);
    assert.match(prompts.user, /pending_confirmation/);
    assert.match(prompts.user, /Go SRE 工程师/);
  });

  it("normalizes compatible resume-match model output into the strict schema", () => {
    const normalized = normalizeAiResult({
      match_score: 88,
      pros: ["Go 平台经验匹配", "Kubernetes 经历匹配"],
      cons: "AWS 经验未明确",
      keywords: "Go, Kubernetes, Prometheus",
      resume_rewrite: {
        summary: "Go / Infra 工程师，具备 Kubernetes 平台建设经验。",
        bullets: ["建设多集群发布平台，提升交付稳定性。"],
      },
      risks: ["薪资和城市需人工确认"],
    });

    const parsed = AiResultSchema.parse(normalized);
    assert.equal(parsed.matchScore, 88);
    assert.deepEqual(parsed.strengths, ["Go 平台经验匹配", "Kubernetes 经历匹配"]);
    assert.deepEqual(parsed.gaps, ["AWS 经验未明确"]);
    assert.deepEqual(parsed.keywordSuggestions, ["Go", "Kubernetes", "Prometheus"]);
    assert.equal(parsed.resumeRewrite?.summaryRewrite, "Go / Infra 工程师，具备 Kubernetes 平台建设经验。");
    assert.deepEqual(parsed.riskNotes, ["薪资和城市需人工确认"]);
  });

  it("normalizes requirement-doc resume-match fields into the strict schema", () => {
    const normalized = normalizeAiResult({
      resume_match_score: 91,
      matched_stack: ["Go", "Kubernetes", "Docker", "Prometheus"],
      matched_direction: ["Infra", "SRE"],
      matched_resume_evidence: ["简历项目中包含 Kubernetes 平台建设经历"],
      experience_fit: "3-5年",
      missing_points: ["AWS 经验未明确"],
      confidence: 0.87,
    });

    const parsed = AiResultSchema.parse(normalized);
    assert.equal(parsed.matchScore, 91);
    assert.equal(parsed.resume_match_score, 91);
    assert.deepEqual(parsed.matched_stack, ["Go", "Kubernetes", "Docker", "Prometheus"]);
    assert.deepEqual(parsed.matched_direction, ["Infra", "SRE"]);
    assert.deepEqual(parsed.matched_resume_evidence, ["简历项目中包含 Kubernetes 平台建设经历"]);
    assert.equal(parsed.experience_fit, "3-5年");
    assert.deepEqual(parsed.missing_points, ["AWS 经验未明确"]);
    assert.equal(parsed.confidence, 0.87);
    assert.deepEqual(parsed.gaps, ["AWS 经验未明确"]);
    assert.ok(parsed.strengths.includes("简历项目中包含 Kubernetes 平台建设经历"));
    assert.ok(parsed.strengths.includes("匹配技术栈：Go、Kubernetes、Docker、Prometheus"));
    assert.ok(parsed.strengths.includes("匹配岗位方向：Infra、SRE"));
    assert.ok(parsed.strengths.includes("经验匹配：3-5年"));
  });

  it("normalizes group analysis output while preserving every fixture job id", () => {
    const jobs = [
      fixtureJob,
      { encrypt_job_id: "boss-ai-infra-002", position_name: "AI Infra 工程师", brand_name: "模型平台团队" },
    ];
    const normalized = normalizeAiGroupResult(
      {
        summary: "Go SRE 岗位优先。",
        ranking: [
          {
            jobId: "boss-go-sre-001",
            score: 92,
            recommendation: "优先投递",
            why: ["Go、Kubernetes、Prometheus 匹配"],
            risks: ["需要确认远程政策"],
          },
        ],
        common: {
          must_have: ["Go", "Kubernetes"],
          nice_to_have: ["Prometheus"],
          duties: ["平台稳定性"],
          keywords: ["SRE"],
        },
        resume_strategy: {
          positioning: "Go / Infra / SRE",
          must_highlight: ["Kubernetes 平台建设"],
          bulletTemplates: ["突出多集群治理成果"],
        },
        project_boosters: [{ title: "可观测性项目", why: "匹配监控要求", deliverables: ["告警策略"], bullets: ["补充 Prometheus 指标治理"] }],
        learning_plan: { p0: ["补齐岗位关键词"], p1: [], p2: [] },
        assumptions: ["基于已提供岗位摘要"],
        questions: ["是否接受 Hybrid"],
        risk_notes: ["不要夸大 AWS 经历"],
        next_steps: ["人工确认 Top 20"],
      },
      jobs,
    );

    const parsed = AiGroupResultSchema.parse(normalized);
    assert.equal(parsed.jobRanking.length, 2);
    assert.deepEqual(
      parsed.jobRanking.map((item) => item.encrypt_job_id).sort(),
      ["boss-ai-infra-002", "boss-go-sre-001"],
    );
    assert.equal(parsed.jobRanking.find((item) => item.encrypt_job_id === "boss-ai-infra-002")?.placeholder, true);
    assert.deepEqual(parsed.commonRequirements.mustHave, ["Go", "Kubernetes"]);
    assert.equal(parsed.resumeStrategy.positioning, "Go / Infra / SRE");
  });

  it("builds group prompts with per-job filter, score, source and review context", () => {
    const prompts = buildAiGroupPrompts("目标：优先远程 Go / Infra 岗位", [
      {
        ...fixtureJob,
        filter_reason: fixtureJobContext.filterReason,
        score_reason: fixtureJobContext.scoreReason,
        source_context: fixtureJobContext.sourceContext,
        review_context: fixtureJobContext.reviewContext,
      },
    ]);

    assert.match(prompts.system, /filter_reason、score_reason、source_context、review_context/);
    assert.match(prompts.user, /岗位列表（摘要 JSON）/);
    assert.match(prompts.user, /source_context/);
    assert.match(prompts.user, /filter_reason/);
    assert.match(prompts.user, /score_reason/);
    assert.match(prompts.user, /review_context/);
    assert.match(prompts.user, /allowed_source_platforms/);
    assert.match(prompts.user, /greeted_unread/);
  });

  it("builds greeting prompts from JD, match report, filter reason and score reason", () => {
    const prompts = buildGreetingPrompts({
      resumeText: fixtureResume,
      contextText: "候选人偏 Go / Infra，不接受外包。",
      jobDetail: fixtureJob,
      matchReport: {
        resume_match_score: 88,
        matched_stack: ["Go", "Kubernetes", "Prometheus"],
        matched_direction: ["Infra", "SRE"],
        matched_resume_evidence: ["候选人建设过 Kubernetes 多集群发布平台", "维护 Prometheus 监控与告警"],
        experience_fit: "3-5年",
        missing_points: ["AWS 未明确"],
        confidence: 0.86,
        matchScore: 88,
        strengths: ["Go 后端平台", "Kubernetes"],
        gaps: ["AWS 未明确"],
      },
      filterReason: {
        matched_preferences: ["Go", "云原生"],
        missing_preferences: ["长期远程"],
      },
      scoreReason: fixtureJobContext.scoreReason,
      sourceContext: fixtureJobContext.sourceContext,
      reviewContext: fixtureJobContext.reviewContext,
    });

    assert.match(prompts.system, /不能输出自动发送动作/);
    assert.match(prompts.user, /80-140/);
    assert.match(prompts.user, /优先使用匹配报告或评分理由中的 resume\.matched_stack/);
    assert.match(prompts.user, /candidateEvidence 必须来自简历原文、当前情况说明、匹配报告或评分理由/);
    assert.match(prompts.user, /Go SRE 工程师/);
    assert.match(prompts.user, /Kubernetes/);
    assert.match(prompts.user, /matched_stack/);
    assert.match(prompts.user, /matched_direction/);
    assert.match(prompts.user, /matched_resume_evidence/);
    assert.match(prompts.user, /候选人建设过 Kubernetes 多集群发布平台/);
    assert.match(prompts.user, /matched_preferences/);
    assert.match(prompts.user, /company/);
    assert.match(prompts.user, /来源与审核上下文 JSON/);
    assert.match(prompts.user, /source_context/);
    assert.match(prompts.user, /review_context/);
    assert.match(prompts.user, /greeted_unread/);

    const parsed = AiGreetingResultSchema.parse({
      message:
        "看到岗位重点在 Go 后端平台和 Kubernetes 稳定性，我过往做过多集群发布与 Prometheus 监控治理，也熟悉 CI/CD 自动化落地，想进一步了解团队的平台建设方向。",
      jobEvidence: ["Go 后端平台", "Kubernetes 稳定性"],
      candidateEvidence: ["Kubernetes 多集群发布平台", "Prometheus 监控"],
      overlapKeywords: ["Go", "Kubernetes", "Prometheus"],
      editNotes: ["发送前补充具体项目名称"],
    });
    assert.ok(Array.from(parsed.message).length >= 80);
    assert.ok(Array.from(parsed.message).length <= 140);
    assert.deepEqual(parsed.overlapKeywords, ["Go", "Kubernetes", "Prometheus"]);

    assert.throws(
      () =>
        AiGreetingResultSchema.parse({
          message: "看到岗位重点在 Go 后端平台，我做过 Kubernetes 多集群发布，想进一步了解团队方向。",
          jobEvidence: ["Go 后端平台"],
          candidateEvidence: ["Kubernetes 多集群发布平台"],
          overlapKeywords: ["Go", "Kubernetes"],
          editNotes: ["发送前补充具体项目名称"],
        }),
      /message must be 80-140 characters/,
    );
    assert.throws(
      () =>
        AiGreetingResultSchema.parse({
          message:
            "看到岗位重点在 Go 后端平台，我过往做过 Kubernetes 多集群发布，想进一步了解团队方向。",
          jobEvidence: [],
          candidateEvidence: ["Kubernetes 多集群发布平台"],
          overlapKeywords: ["Go", "Kubernetes"],
          editNotes: ["发送前补充具体项目名称"],
        }),
      /Array must contain at least 1 element/,
    );
    assert.throws(
      () =>
        AiGreetingResultSchema.parse({
          message:
            "看到岗位重点在平台稳定性和复杂系统治理，我过往做过多集群发布与监控告警，也熟悉 CI/CD 自动化协作，想进一步了解团队平台建设方向、当前技术挑战和跨团队协作方式。",
          jobEvidence: ["Go 后端平台", "Kubernetes 稳定性"],
          candidateEvidence: ["Kubernetes 多集群发布平台", "Prometheus 监控"],
          overlapKeywords: ["Go", "Kubernetes", "Prometheus"],
          editNotes: ["发送前补充具体项目名称"],
        }),
      /message must cite at least one overlapKeywords item/,
    );
    const genericMessages = [
      "您好，我对贵司岗位很感兴趣。看到岗位还包含 Go 和 Kubernetes 方向，我也想进一步了解团队情况、业务背景、技术栈规划、平台稳定性目标以及后续沟通机会。",
      "您好，我对这个岗位很感兴趣。看到岗位包含 Go 和 Kubernetes，我也想进一步了解团队情况、业务背景、技术栈规划、平台稳定性目标以及后续沟通机会。",
      "你好，我对该职位非常感兴趣。看到岗位包含 Go 和 Kubernetes，我也想进一步了解团队情况、业务背景、技术栈规划、平台稳定性目标以及后续沟通机会。",
    ];
    for (const message of genericMessages) {
      assert.throws(
        () =>
          AiGreetingResultSchema.parse({
            message,
            jobEvidence: ["Go 后端平台"],
            candidateEvidence: ["Kubernetes 多集群发布平台"],
            overlapKeywords: ["Go", "Kubernetes"],
            editNotes: ["发送前补充具体项目名称"],
          }),
        /message must avoid generic greeting templates/,
      );
    }
  });

  it("builds and normalizes AI company score batch output", () => {
    const companies = [
      {
        company_name: "风险科技",
        jobs_count: 2,
        source_text: "Go 工程师 JD 明确写到外包交付、客户现场驻场和电话销售配合。",
        jobs: [fixtureJob],
      },
    ];
    const prompts = buildCompanyScoreBatchPrompts(companies);

    assert.match(prompts.system, /公司与岗位风险分析/);
    assert.match(prompts.system, /严格 JSON/);
    assert.match(prompts.user, /company_score/);
    assert.match(prompts.user, /risk_flags/);
    assert.match(prompts.user, /风险科技/);
    assert.match(prompts.user, /outsourcing_risk/);

    const normalized = normalizeAiCompanyScoreBatchResult(
      {
        company_scores: [
          {
            companyName: "风险科技",
            score: "42",
            risks: "outsourcing_risk, onsite_risk, sales_like_risk",
            reasons: ["JD 出现外包交付", "JD 出现客户现场驻场"],
            confidence_score: "0.84",
          },
        ],
      },
      companies,
    );

    const parsed = AiCompanyScoreBatchResultSchema.parse(normalized);
    assert.equal(parsed.companies[0].company_name, "风险科技");
    assert.equal(parsed.companies[0].company_score, 42);
    assert.deepEqual(parsed.companies[0].risk_flags, ["outsourcing_risk", "onsite_risk", "sales_like_risk"]);
    assert.deepEqual(parsed.companies[0].evidence, ["JD 出现外包交付", "JD 出现客户现场驻场"]);
    assert.equal(parsed.companies[0].confidence, 0.84);
  });
});
