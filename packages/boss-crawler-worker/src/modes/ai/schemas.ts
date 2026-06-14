import { z } from "zod";

const GREETING_MESSAGE_MIN_CHARS = 80;
const GREETING_MESSAGE_MAX_CHARS = 140;
const nonEmptyEvidenceArray = z.array(z.string().trim().min(1)).min(1);

function countMessageChars(message: string): number {
  return Array.from(message).length;
}

function messageContainsOverlapKeyword(message: string, keywords: string[]): boolean {
  const normalizedMessage = message.toLowerCase();
  return keywords.some((keyword) => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return normalizedKeyword.length > 0 && normalizedMessage.includes(normalizedKeyword);
  });
}

const GENERIC_GREETING_TEMPLATE_PATTERNS = [
  /^(您好|你好|hi|hello)[，,!！]*(我)?对(贵司|贵公司|这个|该|此|当前)?(岗位|职位|机会)(很|非常|比较|挺)?(感兴趣|有兴趣)/i,
  /^(您好|你好|hi|hello)[，,!！]*(我)?看到(贵司|贵公司|这个|该|此|当前)?(岗位|职位|机会).{0,16}(感兴趣|想了解)/i,
  /(我)?对(贵司|贵公司)(岗位|职位|机会)(很|非常|比较|挺)?(感兴趣|有兴趣)/,
];

function messageUsesGenericGreetingTemplate(message: string): boolean {
  const normalizedMessage = message.replace(/\s+/g, "").toLowerCase();
  return GENERIC_GREETING_TEMPLATE_PATTERNS.some((pattern) => pattern.test(normalizedMessage));
}

export const AiResultSchema = z.object({
  resume_match_score: z.number().min(0).max(100).optional(),
  matched_stack: z.array(z.string()).optional(),
  matched_direction: z.array(z.string()).optional(),
  matched_resume_evidence: z.array(z.string()).optional(),
  experience_fit: z.string().optional(),
  missing_points: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  matchScore: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  keywordSuggestions: z.array(z.string()),
  resumeRewrite: z
    .object({
      summaryRewrite: z.string().optional(),
      experienceBulletsRewrite: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  riskNotes: z.array(z.string()),
}).passthrough();

export const AiGroupResultSchema = z.object({
  summary: z.string(),
  jobRanking: z
    .array(
      z.object({
        encrypt_job_id: z.string().min(1),
        position_name: z.string().optional(),
        brand_name: z.string().optional(),
        matchScore: z.number().min(0).max(100),
        conclusion: z.string(),
        reasons: z.array(z.string()),
        risks: z.array(z.string()),
        placeholder: z.boolean().optional(),
      }).passthrough(),
    )
    .min(1),
  commonRequirements: z.object({
    mustHave: z.array(z.string()),
    niceToHave: z.array(z.string()),
    responsibilities: z.array(z.string()),
    keywords: z.array(z.string()),
  }).passthrough(),
  resumeStrategy: z.object({
    positioning: z.string(),
    mustHighlight: z.array(z.string()),
    bullets: z.array(z.string()),
  }).passthrough(),
  projectBoosters: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      deliverables: z.array(z.string()),
      resumeBullets: z.array(z.string()),
    }).passthrough(),
  ),
  learningPlan: z.object({
    p0: z.array(z.object({ topic: z.string(), why: z.string(), expectedOutput: z.array(z.string()) })),
    p1: z.array(z.object({ topic: z.string(), why: z.string(), expectedOutput: z.array(z.string()) })),
    p2: z.array(z.object({ topic: z.string(), why: z.string(), expectedOutput: z.array(z.string()) })),
  }).passthrough(),
  assumptions: z.array(z.string()),
  questions: z.array(z.string()),
  riskNotes: z.array(z.string()),
  nextSteps: z.array(z.string()),
  placeholderCount: z.number().int().nonnegative().optional(),
}).passthrough();

export const AiGreetingResultSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1)
      .refine(
        (value) => {
          const length = countMessageChars(value);
          return length >= GREETING_MESSAGE_MIN_CHARS && length <= GREETING_MESSAGE_MAX_CHARS;
        },
        { message: "message must be 80-140 characters" },
      )
      .refine((value) => !messageUsesGenericGreetingTemplate(value), {
        message: "message must avoid generic greeting templates",
      }),
    jobEvidence: nonEmptyEvidenceArray,
    candidateEvidence: nonEmptyEvidenceArray,
    overlapKeywords: nonEmptyEvidenceArray,
    editNotes: z.array(z.string().trim().min(1)),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (messageContainsOverlapKeyword(value.message, value.overlapKeywords)) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["message"],
      message: "message must cite at least one overlapKeywords item",
    });
  });

export const AiCompanyScoreBatchResultSchema = z.object({
  companies: z
    .array(
      z.object({
        company_name: z.string().trim().min(1),
        company_score: z.number().min(0).max(100),
        risk_flags: z.array(z.string().trim().min(1)),
        evidence: nonEmptyEvidenceArray,
        confidence: z.number().min(0).max(1),
      }).passthrough(),
    )
    .min(1),
}).passthrough();
