import { asRecord, clampScore, pickFirstString, toNumber, toStringArray } from "./normalizeShared.js";

type RequestedCompany = {
  company_name: string;
};

function confidence(v: unknown): number {
  const n = toNumber(v);
  if (n === null) return 0.6;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase();
}

function resultItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const obj = asRecord(raw);
  if (!obj) return [];
  const companies = obj.companies ?? obj.company_scores ?? obj.companyScores ?? obj.results ?? obj.items;
  if (Array.isArray(companies)) return companies;

  const keyedItems = Object.entries(obj)
    .filter(([, value]) => asRecord(value) !== null)
    .map(([companyName, value]) => ({ company_name: companyName, ...(value as Record<string, unknown>) }));
  return keyedItems;
}

function companyNameFromItem(item: Record<string, unknown>, requested: RequestedCompany[], index: number): string | null {
  return (
    pickFirstString(
      item.company_name,
      item.companyName,
      item.brand_name,
      item.brandName,
      item.name,
      item.company,
    ) ?? requested[index]?.company_name ?? null
  );
}

export function normalizeAiCompanyScoreBatchResult(raw: unknown, requested: RequestedCompany[]): unknown {
  const items = resultItems(raw);
  const requestedNames = new Map(requested.map((item) => [normalizeCompanyName(item.company_name), item.company_name]));
  const companies = items
    .map((item, index) => {
      const obj = asRecord(item);
      if (!obj) return null;
      const rawCompanyName = companyNameFromItem(obj, requested, index);
      if (!rawCompanyName) return null;
      const exactCompanyName = requestedNames.get(normalizeCompanyName(rawCompanyName)) ?? rawCompanyName.trim();
      return {
        company_name: exactCompanyName,
        company_score: clampScore(obj.company_score ?? obj.companyScore ?? obj.score, 50),
        risk_flags: toStringArray(obj.risk_flags ?? obj.riskFlags ?? obj.risks ?? obj.flags),
        evidence: toStringArray(obj.evidence ?? obj.reasons ?? obj.reason ?? obj.analysis ?? obj.notes),
        confidence: confidence(obj.confidence ?? obj.confidence_score ?? obj.confidenceScore),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { companies };
}
