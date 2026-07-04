import {
  BOSS_SOURCE_PLATFORM,
  COLLECTABLE_SOURCE_PLATFORMS,
  DEFAULT_LINUXDO_CATEGORY_URL,
  DEFAULT_LINUXDO_MAX_PAGES,
  DEFAULT_LIEPIN_MAX_PAGES,
  DEFAULT_MAIMAI_MAX_PAGES,
  DEFAULT_V2EX_MAX_PAGES,
  DEFAULT_ZHILIAN_MAX_PAGES,
  LIEPIN_SOURCE_PLATFORM,
  LINUXDO_SOURCE_PLATFORM,
  MAIMAI_SOURCE_PLATFORM,
  V2EX_SOURCE_PLATFORM,
  ZHILIAN_SOURCE_PLATFORM,
  type JobSourcePlatform,
} from "./crawl";

export type CrawlAutoTaskPayload = {
  keywords: string[];
  source_platform: JobSourcePlatform;
  filters: Record<string, unknown>;
  limits: Record<string, unknown>;
  mode: "auto";
};

export type BuildCrawlTaskContext = {
  profile: unknown;
  delayMs: number;
  boss: {
    keywords: string[];
    filters: Record<string, unknown>;
    lowRiskMode: boolean;
    jitterMs?: number;
    maxPages: number;
    maxJobs: number | null;
    effectiveDelayMs: number;
  };
  v2ex: {
    keywords: string[];
    taskKeywords: string[];
    feedUrl: string;
    sortBy: string;
    recentDays: number | null;
    maxPages: number | null;
  };
  maimai: {
    keywords: string[];
    taskKeywords: string[];
    feedUrl: string;
    sortBy: string;
    recentDays: number | null;
    maxPages: number | null;
    maxJobs: number | null;
  };
  linuxdo: {
    keywords: string[];
    taskKeywords: string[];
    categoryUrl: string;
    sortBy: string;
    recentDays: number | null;
    maxPages: number | null;
    maxJobs: number | null;
  };
  liepin: {
    keywords: string[];
    cities: string[];
    salary: string;
    experience: string;
    degree: string;
    industry: string;
    companyType: string;
    companyScale: string;
    jobType: string;
    publishDate: string;
    sortBy: string;
    rawParams: string;
    maxPages: number | null;
    maxJobs: number | null;
  };
  zhilian: {
    keywords: string[];
    cities: string[];
    salary: string;
    experience: string;
    degree: string;
    industry: string;
    companyType: string;
    companyScale: string;
    jobType: string;
    publishDate: string;
    sortBy: string;
    rawParams: string;
    maxPages: number | null;
    maxJobs: number | null;
  };
};

export type ValidateCollectionSourceContext = {
  sourceLabel: (source: JobSourcePlatform) => string;
  bossKeywords: string[];
  bossMaxPages: number | null;
  bossMaxJobs: number | null;
  v2exFeedUrl: string;
  maimaiFeedUrl: string;
  maimaiMaxPages: number | null;
  maimaiMaxJobs: number | null;
  linuxdoCategoryUrl: string;
  linuxdoMaxPages: number | null;
  liepinKeywords: string[];
  liepinMaxPages: number | null;
  liepinMaxJobs: number | null;
  zhilianKeywords: string[];
  zhilianMaxPages: number | null;
  zhilianMaxJobs: number | null;
};

export function splitUrlList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n,，、]+/g)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function uniqueList(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function buildCrawlTaskForSource(
  sourcePlatform: JobSourcePlatform,
  context: BuildCrawlTaskContext,
): CrawlAutoTaskPayload {
  if (sourcePlatform === LIEPIN_SOURCE_PLATFORM) {
    return {
      keywords: context.liepin.keywords,
      source_platform: LIEPIN_SOURCE_PLATFORM,
      filters: {
        city: context.liepin.cities,
        salary: context.liepin.salary.trim(),
        experience: context.liepin.experience.trim(),
        degree: context.liepin.degree.trim(),
        industry: context.liepin.industry.trim(),
        company_type: context.liepin.companyType.trim(),
        company_scale: context.liepin.companyScale.trim(),
        job_type: context.liepin.jobType.trim(),
        publish_date: context.liepin.publishDate.trim(),
        sort_by: context.liepin.sortBy.trim(),
        raw_params: context.liepin.rawParams.trim(),
        keywords: context.liepin.keywords,
        profile: context.profile,
      },
      limits: {
        delayMs: context.delayMs,
        maxPages: context.liepin.maxPages ?? DEFAULT_LIEPIN_MAX_PAGES,
        maxJobs: context.liepin.maxJobs,
      },
      mode: "auto",
    };
  }

  if (sourcePlatform === ZHILIAN_SOURCE_PLATFORM) {
    return {
      keywords: context.zhilian.keywords,
      source_platform: ZHILIAN_SOURCE_PLATFORM,
      filters: {
        city: context.zhilian.cities,
        salary: context.zhilian.salary.trim(),
        experience: context.zhilian.experience.trim(),
        degree: context.zhilian.degree.trim(),
        industry: context.zhilian.industry.trim(),
        company_type: context.zhilian.companyType.trim(),
        company_scale: context.zhilian.companyScale.trim(),
        job_type: context.zhilian.jobType.trim(),
        publish_date: context.zhilian.publishDate.trim(),
        sort_by: context.zhilian.sortBy.trim(),
        raw_params: context.zhilian.rawParams.trim(),
        keywords: context.zhilian.keywords,
        profile: context.profile,
      },
      limits: {
        delayMs: context.delayMs,
        maxPages: context.zhilian.maxPages ?? DEFAULT_ZHILIAN_MAX_PAGES,
        maxJobs: context.zhilian.maxJobs,
      },
      mode: "auto",
    };
  }

  if (sourcePlatform === LINUXDO_SOURCE_PLATFORM) {
    return {
      keywords: context.linuxdo.taskKeywords,
      source_platform: LINUXDO_SOURCE_PLATFORM,
      filters: {
        category_url: context.linuxdo.categoryUrl.trim() || DEFAULT_LINUXDO_CATEGORY_URL,
        sort_by: context.linuxdo.sortBy,
        recent_days: context.linuxdo.recentDays,
        keywords: context.linuxdo.keywords,
        profile: context.profile,
      },
      limits: {
        delayMs: context.delayMs,
        maxPages: context.linuxdo.maxPages ?? DEFAULT_LINUXDO_MAX_PAGES,
        maxJobs: context.linuxdo.maxJobs,
      },
      mode: "auto",
    };
  }

  if (sourcePlatform === MAIMAI_SOURCE_PLATFORM) {
    return {
      keywords: context.maimai.taskKeywords,
      source_platform: MAIMAI_SOURCE_PLATFORM,
      filters: {
        feed_urls: splitUrlList(context.maimai.feedUrl),
        sort_by: context.maimai.sortBy,
        recent_days: context.maimai.recentDays,
        keywords: context.maimai.keywords,
        profile: context.profile,
      },
      limits: {
        delayMs: context.delayMs,
        maxPages: context.maimai.maxPages ?? DEFAULT_MAIMAI_MAX_PAGES,
        maxJobs: context.maimai.maxJobs,
      },
      mode: "auto",
    };
  }

  if (sourcePlatform === V2EX_SOURCE_PLATFORM) {
    return {
      keywords: context.v2ex.taskKeywords,
      source_platform: V2EX_SOURCE_PLATFORM,
      filters: {
        feed_urls: splitUrlList(context.v2ex.feedUrl),
        sort_by: context.v2ex.sortBy,
        recent_days: context.v2ex.recentDays,
        profile: context.profile,
      },
      limits: {
        delayMs: context.delayMs,
        maxPages: context.v2ex.maxPages ?? DEFAULT_V2EX_MAX_PAGES,
      },
      mode: "auto",
    };
  }

  return {
    keywords: context.boss.keywords,
    source_platform: BOSS_SOURCE_PLATFORM,
    filters: context.boss.filters,
    limits: {
      delayMs: context.boss.effectiveDelayMs,
      jitterMs: context.boss.lowRiskMode ? context.boss.jitterMs : undefined,
      lowRiskMode: context.boss.lowRiskMode,
      maxPages: context.boss.maxPages,
      maxJobs: context.boss.maxJobs,
      bossDetailFetchLimit: 0,
    },
    mode: "auto",
  };
}

export function validateCollectionSourceConfig(
  source: JobSourcePlatform,
  context: ValidateCollectionSourceContext,
): string | null {
  if (!(COLLECTABLE_SOURCE_PLATFORMS as readonly string[]).includes(source)) {
    return `${context.sourceLabel(source)} 当前只作为职位来源和采后筛选来源，暂未接入自动采集适配器。`;
  }
  if (source === BOSS_SOURCE_PLATFORM && context.bossKeywords.length === 0) {
    return "Boss 搜索关键词为空。请在 Boss 配置中输入至少 1 个关键词。";
  }
  if (source === BOSS_SOURCE_PLATFORM) {
    if ((context.bossMaxPages ?? 0) <= 0) {
      return "Boss 页数上限必须大于 0。";
    }
    if (context.bossMaxJobs !== null && context.bossMaxJobs <= 0) {
      return "Boss 岗位上限必须大于 0，或留空不限。";
    }
  }
  if (source === V2EX_SOURCE_PLATFORM && splitUrlList(context.v2exFeedUrl).length === 0) {
    return "V2EX URL 为空。请填写至少 1 个 feed 或节点 URL。";
  }
  if (source === MAIMAI_SOURCE_PLATFORM) {
    const urls = splitUrlList(context.maimaiFeedUrl);
    if (urls.length === 0) {
      return "脉脉 URL 为空。请填写至少 1 个公开文章或搜索页 URL。";
    }
    for (const url of urls) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== "maimai.cn" && !parsed.hostname.endsWith(".maimai.cn")) {
          return "脉脉 URL 必须是 maimai.cn 域名。";
        }
      } catch {
        return "脉脉 URL 格式不正确。";
      }
    }
    if ((context.maimaiMaxPages ?? 0) <= 0) {
      return "脉脉页数上限必须大于 0。";
    }
    if (context.maimaiMaxJobs !== null && context.maimaiMaxJobs <= 0) {
      return "脉脉入库上限必须大于 0，或留空不限。";
    }
  }
  if (source === LINUXDO_SOURCE_PLATFORM) {
    const url = context.linuxdoCategoryUrl.trim();
    if (!url) return "LinuxDo 分类 URL 为空。";
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "linux.do" && !parsed.hostname.endsWith(".linux.do")) {
        return "LinuxDo 分类 URL 必须是 linux.do 域名。";
      }
    } catch {
      return "LinuxDo 分类 URL 格式不正确。";
    }
    if ((context.linuxdoMaxPages ?? 0) <= 0) {
      return "LinuxDo 页数上限必须大于 0。";
    }
  }
  if (source === LIEPIN_SOURCE_PLATFORM) {
    if (context.liepinKeywords.length === 0) {
      return "猎聘搜索关键词为空。请在猎聘配置中输入至少 1 个关键词。";
    }
    if ((context.liepinMaxPages ?? 0) <= 0) {
      return "猎聘页数上限必须大于 0。";
    }
    if (context.liepinMaxJobs !== null && context.liepinMaxJobs <= 0) {
      return "猎聘岗位上限必须大于 0，或留空不限。";
    }
  }
  if (source === ZHILIAN_SOURCE_PLATFORM) {
    if (context.zhilianKeywords.length === 0) {
      return "智联搜索关键词为空。请在智联配置中输入至少 1 个关键词。";
    }
    if ((context.zhilianMaxPages ?? 0) <= 0) {
      return "智联页数上限必须大于 0。";
    }
    if (context.zhilianMaxJobs !== null && context.zhilianMaxJobs <= 0) {
      return "智联岗位上限必须大于 0，或留空不限。";
    }
  }
  return null;
}
