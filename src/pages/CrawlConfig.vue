<script setup lang="ts">
import { Check, Plus } from "lucide-vue-next";

import UiMultiSelect from "../components/ui/UiMultiSelect.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import type { JobSourcePlatform } from "../lib/crawl";
import { useCrawlPage } from "../lib/useCrawlPage";

const {
  tauri,
  collectionKeywordsText,
  collectionTargetCitiesText,
  collectionWorkModesText,
  collectionTechStackText,
  collectionExcludedKeywordsText,
  collectionDegreesText,
  collectionMinimumSalaryK,
  collectionMaximumSalaryK,
  collectionMinimumExperienceYears,
  collectionMaximumExperienceYears,
  selectedCollectionSources,
  selectedCollectionSourceLabel,
  collectionIntentSyncLabel,
  v2exSelected,
  collectableSourceOptions,
  v2exFeedSettingsOpen,
  v2exFeedUrl,
  v2exKeywordsText,
  v2exFeedSortBy,
  v2exRecentDays,
  v2exKeywords,
  bossKeywordsText,
  cityText,
  salaryText,
  experienceText,
  degreeText,
  industryText,
  scaleText,
  selectedCities,
  selectedSalary,
  selectedExperience,
  selectedDegree,
  selectedIndustry,
  selectedScale,
  error,
  bossMetaLoading,
  bossMetaSyncing,
  bossMetaError,
  filterRecomputing,
  filterRecomputeMessage,
  collectionConfigSaving,
  collectionConfigMessage,
  bossSettingsOpen,
  filterProfileOpen,
  bossSyncMappedFields,
  bossSyncUnmappedFields,
  bossSyncMessage,
  aiPreferredText,
  aiRejectedText,
  aiRiskText,
  aiUncertainStrategy,
  bossMetaSyncedAt,
  bossCityGroups,
  bossHotCities,
  bossSalaryOptions,
  bossExperienceOptions,
  bossDegreeOptions,
  bossScaleOptions,
  bossAdditionalFilterGroups,
  bossIndustryGroups,
  bossFilterConditionCount,
  bossMetaReady,
  selectedBossFilterConditions,
  sidecarRunning,
  loadBossMeta,
  syncBossMeta,
  saveActiveFilterProfile,
  recomputeDefaultFilterProfile,
  saveCollectionConfig,
  syncCollectionIntentToPlatforms,
  setBossAdditionalFilter,
} = useCrawlPage();

function isCollectionSourceSelected(value: JobSourcePlatform): boolean {
  return selectedCollectionSources.value.includes(value);
}

function toggleCollectionSource(value: JobSourcePlatform): void {
  if (collectableSourceOptions.value.length === 0) return;
  if (isCollectionSourceSelected(value)) {
    selectedCollectionSources.value = selectedCollectionSources.value.filter((source) => source !== value);
    return;
  }
  selectedCollectionSources.value = [...selectedCollectionSources.value, value];
}
</script>

<template>
  <section class="space-y-4">
    <header class="space-y-2">
      <div class="ui-section-kicker">Collection Pipeline</div>
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-content-primary">采集到职位库</h1>
          <p class="mt-1 max-w-3xl text-sm leading-6 text-content-secondary">
            先用采集意图扩大来源，再用采后判断规则基于 JD、帖子正文和岗位详情生成候选结果；被过滤岗位仍保留在职位库中。
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <span v-if="collectionConfigMessage" class="text-xs text-emerald-300">{{ collectionConfigMessage }}</span>
          <button
            class="ui-btn-secondary px-3 py-1.5 text-xs"
            type="button"
            :disabled="!tauri || collectionConfigSaving || sidecarRunning"
            @click="saveCollectionConfig"
          >
            {{ collectionConfigSaving ? "保存中…" : "保存采集配置" }}
          </button>
          <button
            class="ui-btn-primary px-3 py-1.5 text-xs"
            type="button"
            :disabled="sidecarRunning"
            @click="syncCollectionIntentToPlatforms"
          >
            {{ collectionIntentSyncLabel }}
          </button>
        </div>
      </div>
    </header>

    <div v-if="!tauri" class="ui-status-warning p-4 text-sm">
      当前是浏览器模式（非 Tauri）。配置可以预览，保存和平台字典同步不可用。
    </div>

    <div v-if="error" class="ui-status-danger p-3 text-sm">{{ error }}</div>

    <div class="grid gap-3 md:grid-cols-3">
      <div class="ui-card-soft p-4">
        <div class="text-xs font-semibold text-content-primary">1. 采集意图</div>
        <p class="mt-2 text-xs leading-5 text-content-muted">关键词、城市、技术栈用于扩大平台搜索，不代表最终必须命中。</p>
      </div>
      <div class="ui-card-soft p-4">
        <div class="text-xs font-semibold text-content-primary">2. 平台适配器</div>
        <p class="mt-2 text-xs leading-5 text-content-muted">Boss、V2EX 等平台保持各自配置；同步动作只在你点击时发生。</p>
      </div>
      <div class="ui-card-soft p-4">
        <div class="text-xs font-semibold text-content-primary">3. 采后判断</div>
        <p class="mt-2 text-xs leading-5 text-content-muted">岗位先入库，再基于 JD/正文/状态规则进入推荐、待确认或已过滤。</p>
      </div>
    </div>

    <div class="space-y-5">
      <section class="ui-panel overflow-hidden">
        <div class="ui-section-header">
          <div>
            <div class="ui-section-kicker">Collection Intent</div>
            <h2 class="ui-section-title mt-1">我要找什么范围</h2>
            <p class="ui-section-copy">这里决定去平台上怎么搜。多值字段默认是 OR 扩样本，真正的硬限制交给下方采后判断规则。</p>
          </div>
        </div>

        <div class="grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
          <label class="space-y-1 lg:col-span-2">
            <div class="ui-field-label">平台搜索关键词（多行或逗号分隔）</div>
            <textarea v-model="collectionKeywordsText" class="ui-textarea h-24 w-full" placeholder="Go&#10;后端&#10;平台工程" />
            <div class="text-[11px] leading-5 text-content-muted">用于扩大采集样本，不是最终职位库过滤条件。</div>
          </label>
          <fieldset class="space-y-2">
            <legend class="ui-field-label">本次采集来源</legend>
            <div class="grid gap-2 sm:grid-cols-2">
              <button
                v-for="option in collectableSourceOptions"
                :key="option.value"
                class="group flex min-h-12 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-border-glow/10"
                :class="isCollectionSourceSelected(option.value)
                  ? 'border-border-glow/35 bg-border-glow/10 text-content-primary shadow-inner'
                  : 'border-border/10 bg-input/75 text-content-secondary hover:border-border/20 hover:bg-card-hover/75 hover:text-content-primary'"
                type="button"
                :aria-pressed="isCollectionSourceSelected(option.value)"
                @click="toggleCollectionSource(option.value)"
              >
                <span class="min-w-0">
                  <span class="block truncate text-sm font-semibold">{{ option.label }}</span>
                  <span class="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.18em]" :class="isCollectionSourceSelected(option.value) ? 'text-cyan-200/80' : 'text-content-muted'">
                    {{ isCollectionSourceSelected(option.value) ? "已选" : "可用" }}
                  </span>
                </span>
                <span
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold transition-colors"
                  :class="isCollectionSourceSelected(option.value)
                    ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-100'
                    : 'border-border/20 text-content-muted group-hover:border-border/30 group-hover:text-content-secondary'"
                  aria-hidden="true"
                >
                  <Check v-if="isCollectionSourceSelected(option.value)" class="h-3.5 w-3.5" />
                  <Plus v-else class="h-3.5 w-3.5" />
                </span>
              </button>
              <div v-if="collectableSourceOptions.length === 0" class="rounded-xl border border-border/10 bg-input/60 px-3.5 py-3 text-sm text-content-muted">
                暂无可自动采集的平台
              </div>
            </div>
            <div class="text-[11px] text-content-muted">来自设置中已启用且支持自动采集的平台；当前选择 {{ selectedCollectionSourceLabel }}。</div>
          </fieldset>
          <label class="space-y-1">
            <div class="ui-field-label">目标城市（多选意图）</div>
            <textarea v-model="collectionTargetCitiesText" class="ui-textarea h-20 w-full" placeholder="上海&#10;深圳&#10;远程" />
          </label>
          <label class="space-y-1">
            <div class="ui-field-label">工作方式</div>
            <textarea v-model="collectionWorkModesText" class="ui-textarea h-20 w-full" placeholder="远程&#10;混合&#10;到岗" />
          </label>
          <label class="space-y-1">
            <div class="ui-field-label">技术栈</div>
            <textarea v-model="collectionTechStackText" class="ui-textarea h-20 w-full" placeholder="Go&#10;Kubernetes&#10;Docker" />
          </label>
          <label class="space-y-1">
            <div class="ui-field-label">采集阶段排除词</div>
            <textarea v-model="collectionExcludedKeywordsText" class="ui-textarea h-20 w-full" placeholder="外包&#10;驻场&#10;培训" />
            <div class="text-[11px] leading-5 text-content-muted">仅用于减少明显噪音；最终排除仍以采后规则为准。</div>
          </label>
          <label class="space-y-1">
            <div class="ui-field-label">学历</div>
            <textarea v-model="collectionDegreesText" class="ui-textarea h-20 w-full" placeholder="学历不限&#10;本科" />
          </label>
          <div class="grid gap-3 md:col-span-2 md:grid-cols-4">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最低薪资 K</div>
              <input v-model.number="collectionMinimumSalaryK" type="number" min="0" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最高薪资 K</div>
              <input v-model.number="collectionMaximumSalaryK" type="number" min="0" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最低经验年限</div>
              <input v-model.number="collectionMinimumExperienceYears" type="number" min="0" step="0.5" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最高经验年限</div>
              <input v-model.number="collectionMaximumExperienceYears" type="number" min="0" step="0.5" class="ui-input w-full" />
            </label>
          </div>
        </div>

        <div v-if="bossSyncMessage" class="mx-4 mb-4 rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3 text-xs">
          <div class="font-medium text-content-secondary">{{ bossSyncMessage }}</div>
          <div v-if="bossSyncMappedFields.length > 0" class="mt-2 text-emerald-300">
            已映射：{{ bossSyncMappedFields.join("；") }}
          </div>
          <div v-if="bossSyncUnmappedFields.length > 0" class="mt-2 text-amber-300">
            未映射：{{ bossSyncUnmappedFields.join("；") }}
          </div>
        </div>
      </section>

      <section class="ui-panel overflow-hidden">
        <button class="ui-section-header w-full text-left" type="button" @click="bossSettingsOpen = !bossSettingsOpen">
          <span>
            <span class="ui-section-kicker">Platform Adapter</span>
            <span class="ui-section-title mt-1 block">Boss 平台配置</span>
            <span class="ui-section-copy block">浏览器登录型采集；采集意图同步后可在这里微调 Boss 专属搜索参数。</span>
          </span>
          <span class="ui-badge">{{ bossSettingsOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="bossSettingsOpen" class="space-y-3 p-4">
          <div class="ui-crawl-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-3">
            <div class="text-xs text-content-muted">
              Boss 平台筛选：
              <span class="text-content-secondary">{{ bossMetaReady ? `${bossMetaSyncedAt ?? "已加载"} · ${bossFilterConditionCount} 类筛选项` : "未同步，请先同步后使用完整 Boss 筛选项" }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || bossMetaLoading" @click="loadBossMeta">
                {{ bossMetaLoading ? "读取中…" : "读取缓存" }}
              </button>
              <button class="ui-btn-primary px-3 py-1.5 text-xs" :disabled="!tauri || bossMetaSyncing || sidecarRunning" @click="syncBossMeta">
                {{ bossMetaSyncing ? "同步中…" : "同步城市、行业与筛选项" }}
              </button>
            </div>
          </div>
          <div v-if="bossMetaError" class="ui-status-danger p-3 text-xs">{{ bossMetaError }}</div>

          <label class="block space-y-1">
            <div class="text-xs font-medium text-content-muted">Boss 搜索关键词（每行一轮搜索）</div>
            <textarea v-model="bossKeywordsText" class="ui-textarea h-24 w-full" placeholder="Go 远程&#10;SRE 远程&#10;Kubernetes 平台" />
            <div class="text-[11px] leading-5 text-content-muted">
              一行会作为一个完整 query 传给 Boss；要找远程岗位，把「远程」和岗位词写在同一行。
            </div>
          </label>

          <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss 城市</div>
              <UiMultiSelect v-if="bossCityGroups.length > 0" v-model="selectedCities">
                <optgroup v-if="bossHotCities.length > 0" label="热门">
                  <option v-for="c in bossHotCities" :key="c.code" :value="String(c.code)">{{ c.name }}</option>
                </optgroup>
                <optgroup v-for="g in bossCityGroups" :key="g.firstChar" :label="g.firstChar">
                  <option v-for="c in g.cityList" :key="c.code" :value="String(c.code)">{{ c.name }}</option>
                </optgroup>
              </UiMultiSelect>
              <input v-else v-model="cityText" class="ui-input w-full" placeholder="请先同步 Boss 城市字典后选择" />
              <div class="text-[11px] text-content-muted">多选城市会按城市拆成多轮 Boss 采集，并用职位 ID 去重；未同步字典时不能用城市名代替 Boss code。</div>
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss 薪资</div>
              <UiSelect v-if="bossSalaryOptions.length > 0" v-model="selectedSalary">
                <option value="">不限</option>
                <option v-for="opt in bossSalaryOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input v-else v-model="salaryText" class="ui-input w-full" placeholder="例如：10-20K" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss 经验</div>
              <UiSelect v-if="bossExperienceOptions.length > 0" v-model="selectedExperience">
                <option value="">不限</option>
                <option v-for="opt in bossExperienceOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input v-else v-model="experienceText" class="ui-input w-full" placeholder="例如：3-5 年" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss 学历</div>
              <UiSelect v-if="bossDegreeOptions.length > 0" v-model="selectedDegree">
                <option value="">不限</option>
                <option v-for="opt in bossDegreeOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input v-else v-model="degreeText" class="ui-input w-full" placeholder="例如：本科" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss 行业</div>
              <UiSelect v-if="bossIndustryGroups.length > 0" v-model="selectedIndustry">
                <option value="">不限</option>
                <optgroup v-for="g in bossIndustryGroups" :key="g.name" :label="g.name">
                  <option v-for="opt in g.options" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
                </optgroup>
              </UiSelect>
              <input v-else v-model="industryText" class="ui-input w-full" placeholder="例如：互联网" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss 公司规模</div>
              <UiSelect v-if="bossScaleOptions.length > 0" v-model="selectedScale">
                <option value="">不限</option>
                <option v-for="opt in bossScaleOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input v-else v-model="scaleText" class="ui-input w-full" placeholder="例如：20-99 人" />
            </label>
            <label v-for="group in bossAdditionalFilterGroups" :key="group.field" class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss {{ group.label }}</div>
              <UiSelect
                :model-value="selectedBossFilterConditions[group.field] ?? ''"
                @update:model-value="setBossAdditionalFilter(group.field, String($event))"
              >
                <option value="">不限</option>
                <option v-for="opt in group.options" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
            </label>
          </div>
          <div v-if="bossMetaReady && bossAdditionalFilterGroups.length === 0" class="rounded-md border border-border/10 bg-surface-secondary/50 p-3 text-xs text-content-muted">
            当前 Boss 字典没有返回融资阶段或职位类型筛选项。
          </div>
        </div>
      </section>

      <section v-if="v2exSelected" class="ui-panel overflow-hidden">
        <button class="ui-section-header w-full text-left" type="button" @click="v2exFeedSettingsOpen = !v2exFeedSettingsOpen">
          <span>
            <span class="ui-section-kicker">Platform Adapter</span>
            <span class="ui-section-title mt-1 block">V2EX Feed 配置</span>
            <span class="ui-section-copy block">公开 Atom Feed 采集，无需平台登录；明确招聘帖入库后仍会走采后判断。</span>
          </span>
          <span class="ui-badge">{{ v2exFeedSettingsOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="v2exFeedSettingsOpen" class="grid gap-3 p-4 md:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">Feed URL</div>
            <input v-model="v2exFeedUrl" class="ui-input w-full" placeholder="https://www.v2ex.com/feed/tab/jobs.xml" />
          </label>
          <label class="space-y-1">
            <div class="font-medium text-content-secondary">本次 Feed 关键词</div>
            <textarea v-model="v2exKeywordsText" class="ui-textarea h-20 w-full" placeholder="Go&#10;远程&#10;Kubernetes" />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">排序</div>
            <UiSelect v-model="v2exFeedSortBy">
              <option value="published_desc">发布时间倒序</option>
              <option value="updated_desc">更新时间倒序</option>
            </UiSelect>
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">最近天数</div>
            <input v-model.number="v2exRecentDays" type="number" min="0" step="1" class="ui-input w-full" placeholder="不限" />
          </label>
          <div class="md:col-span-2 rounded-md border border-border/10 bg-surface-secondary/50 p-3 text-xs text-content-muted">
            <span class="font-medium text-content-secondary">当前关键词：</span>
            <span>{{ v2exKeywords.length > 0 ? v2exKeywords.join("、") : "未填写关键词时只使用招聘帖识别规则" }}</span>
          </div>
          <div class="md:col-span-2 text-xs text-content-muted">
            V2EX 会先按所选时间字段排序并应用最近天数，再用这里的关键词做 OR 匹配；排除词仍来自采集意图和采后判断规则，城市、薪资、经验、学历继续交给采后判断规则。
          </div>
        </div>
      </section>

      <section class="ui-panel overflow-hidden">
        <button class="ui-section-header w-full text-left" type="button" @click="filterProfileOpen = !filterProfileOpen">
          <span>
            <span class="ui-section-kicker">Post-Collection Rules</span>
            <span class="ui-section-title mt-1 block">采后判断规则</span>
            <span class="ui-section-copy block">岗位先进入职位库，再用这些规则基于标题、列表字段、JD 和帖子正文判断是否进入候选结果。</span>
          </span>
          <span class="ui-badge">{{ filterProfileOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="filterProfileOpen" class="space-y-4 p-4">
          <div class="border-y border-border/10 py-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="ui-section-kicker">Default Rules</div>
                <div class="mt-1 text-sm font-semibold text-content-primary">默认采后规则</div>
                <div class="mt-1 text-xs text-content-muted">全应用只使用这一套采后判断配置；修改后保存，重算后对已有职位生效。</div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning" @click="saveActiveFilterProfile">保存配置</button>
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filterRecomputing || sidecarRunning" @click="recomputeDefaultFilterProfile">
                  {{ filterRecomputing ? "重算中…" : "保存并重算已有职位" }}
                </button>
              </div>
            </div>
          </div>

          <div class="ui-rule-group">
            <div class="ui-rule-group-title">AI 判断偏好</div>
            <p class="ui-rule-group-copy">这里用自然语言告诉 AI 什么值得看、什么应软排除；证据明确时会影响采后分区，证据不足时默认进入待确认。</p>
          </div>

          <div class="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_minmax(11rem,14rem)]">
            <label class="space-y-1">
              <div class="ui-field-label">我想看的岗位</div>
              <textarea
                v-model="aiPreferredText"
                class="ui-textarea h-28 w-full"
                placeholder="例如：Go / Infra / SRE / 平台工程；JD 有真实工程建设和云原生证据"
              />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">AI 软排除</div>
              <textarea
                v-model="aiRejectedText"
                class="ui-textarea h-28 w-full"
                placeholder="例如：明显外包、驻场、招转培、销售导向、纯实施交付"
              />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">风险关注点</div>
              <textarea
                v-model="aiRiskText"
                class="ui-textarea h-28 w-full"
                placeholder="例如：信息太少、职责含糊、公司业务不清楚时放待确认"
              />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">不确定时</div>
              <select v-model="aiUncertainStrategy" class="ui-input w-full">
                <option value="pending_confirmation">放入待确认</option>
                <option value="filtered">倾向过滤</option>
                <option value="recommended">倾向推荐</option>
              </select>
              <div class="text-[11px] leading-5 text-content-muted">低置信度仍会优先待确认，避免把可疑但不确定的岗位误杀。</div>
            </label>
          </div>
          <div class="rounded-md border border-border/10 bg-surface-secondary/50 p-3 text-xs leading-5 text-content-muted">
            黑名单、沟通状态、公司状态和历史兼容规则仍在底层生效；这里先只保留需要人工维护的 AI 判断偏好。
          </div>
          <div v-if="filterRecomputeMessage" class="text-xs text-emerald-300">{{ filterRecomputeMessage }}</div>
        </div>
      </section>
    </div>
  </section>
</template>
