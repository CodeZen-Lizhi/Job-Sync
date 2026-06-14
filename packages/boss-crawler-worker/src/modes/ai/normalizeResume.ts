import { asRecord, clampScore, pickFirstString, toNumber, toStringArray } from "./normalizeShared.js";

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function joinEvidence(label: string, value: unknown): string[] {
  const items = toStringArray(value);
  return items.length ? [`${label}：${items.join("、")}`] : [];
}

export function normalizeAiResult(raw: unknown): unknown {
  const obj = asRecord(raw) ?? {};

  const resume = asRecord((obj as any).resumeRewrite ?? (obj as any).resume_rewrite ?? (obj as any).rewrite ?? (obj as any).resume) ?? {};

  const summaryRewrite =
    pickFirstString((resume as any).summaryRewrite, (resume as any).summary_rewrite, (resume as any).summary, (resume as any).positioning) ??
    undefined;
  const experienceBulletsRewrite = toStringArray(
    (resume as any).experienceBulletsRewrite ?? (resume as any).experience_bullets_rewrite ?? (resume as any).bullets ?? (resume as any).bulletTemplates,
  );

  const resumeRewrite =
    summaryRewrite || experienceBulletsRewrite.length
      ? {
          summaryRewrite,
          experienceBulletsRewrite: experienceBulletsRewrite.length ? experienceBulletsRewrite : undefined,
        }
      : undefined;
  const resumeMatchScore = clampScore((obj as any).resume_match_score ?? (obj as any).matchScore ?? (obj as any).match_score ?? (obj as any).score, 50);
  const matchedStack = uniqueStrings(toStringArray((obj as any).matched_stack ?? (obj as any).matchedStack));
  const matchedDirection = uniqueStrings(toStringArray((obj as any).matched_direction ?? (obj as any).matchedDirection));
  const matchedResumeEvidence = uniqueStrings(toStringArray((obj as any).matched_resume_evidence ?? (obj as any).matchedResumeEvidence ?? (obj as any).resume_evidence));
  const experienceFit = pickFirstString((obj as any).experience_fit, (obj as any).experienceFit) ?? undefined;
  const missingPoints = uniqueStrings(toStringArray((obj as any).missing_points ?? (obj as any).missingPoints));
  const confidenceValue = toNumber((obj as any).confidence ?? (obj as any).confidence_score ?? (obj as any).confidenceScore);
  const confidence = confidenceValue === null ? undefined : Math.min(1, Math.max(0, confidenceValue));

  return {
    resume_match_score: resumeMatchScore,
    matched_stack: matchedStack,
    matched_direction: matchedDirection,
    matched_resume_evidence: matchedResumeEvidence,
    experience_fit: experienceFit,
    missing_points: missingPoints,
    confidence,
    matchScore: resumeMatchScore,
    strengths: uniqueStrings([
      ...toStringArray((obj as any).strengths ?? (obj as any).pros ?? (obj as any).advantages ?? (obj as any).highlights),
      ...matchedResumeEvidence,
      ...joinEvidence("匹配技术栈", matchedStack),
      ...joinEvidence("匹配岗位方向", matchedDirection),
      ...joinEvidence("经验匹配", experienceFit),
    ]),
    gaps: uniqueStrings([
      ...toStringArray((obj as any).gaps ?? (obj as any).cons ?? (obj as any).weaknesses ?? (obj as any).missing),
      ...missingPoints,
    ]),
    keywordSuggestions: uniqueStrings(
      toStringArray((obj as any).keywordSuggestions ?? (obj as any).keyword_suggestions ?? (obj as any).keywords ?? (obj as any).keyword),
    ),
    resumeRewrite,
    riskNotes: toStringArray((obj as any).riskNotes ?? (obj as any).risk_notes ?? (obj as any).risks ?? (obj as any).warnings),
  };
}
