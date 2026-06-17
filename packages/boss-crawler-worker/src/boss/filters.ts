import type { Page } from "puppeteer";

export type BossFilters = {
  city?: string | string[];
  salary?: string | string[];
  experience?: string | string[];
  degree?: string | string[];
  industry?: string | string[];
  scale?: string | string[];
  [key: string]: unknown;
};

const FILTER_LABELS: Record<string, string> = {
  city: "城市",
  salary: "薪资",
  experience: "经验",
  degree: "学历",
  industry: "行业",
  scale: "规模",
  stage: "融资阶段",
  financing: "融资阶段",
  jobType: "职位类型",
  jobStatus: "职位状态",
  brandStage: "融资阶段",
  brandScale: "规模",
};

const RESERVED_FILTER_KEYS = new Set([
  "profile",
  "collection_intent",
  "feed_url",
  "excluded_keywords",
]);

function asArray(v: unknown): string[] {
  if (typeof v === "string" && v.trim()) return [v.trim()];
  if (Array.isArray(v)) {
    return v
      .filter((x) => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

async function openFilterPanel(page: Page, label: string): Promise<void> {
  await page.evaluate((l) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>("a,button,span,div")).find((n) => {
      const t = n.innerText?.trim();
      return t === l;
    });
    el?.click();
  }, label);
}

async function clickByText(page: Page, text: string): Promise<boolean> {
  const ok = await page.evaluate((t) => {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("a,button,li,span,div")).filter(
      (el) => el && el.innerText && el.innerText.trim() === t,
    );
    const el = candidates[0];
    if (!el) return false;
    el.click();
    return true;
  }, text);
  return Boolean(ok);
}

async function clickByKaIncludes(page: Page, fragment: string): Promise<boolean> {
  const ok = await page.evaluate((frag) => {
    const el = document.querySelector<HTMLElement>(`[ka*="${frag}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, fragment);
  return Boolean(ok);
}

async function applyTextOrKa(page: Page, value: string): Promise<boolean> {
  const byKa = await clickByKaIncludes(page, value);
  if (byKa) return true;
  return await clickByText(page, value);
}

export async function applyFilters(page: Page, rawFilters: unknown): Promise<void> {
  const filters = (rawFilters ?? {}) as BossFilters;

  for (const [field, rawValue] of Object.entries(filters)) {
    if (RESERVED_FILTER_KEYS.has(field)) continue;
    const values = asArray(rawValue);
    if (values.length === 0) continue;

    const label = FILTER_LABELS[field] ?? field;
    await openFilterPanel(page, label).catch(() => undefined);
    for (const value of values) {
      await applyTextOrKa(page, value).catch(() => undefined);
    }
  }
}
