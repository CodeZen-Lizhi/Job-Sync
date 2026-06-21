<script setup lang="ts">
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
  collectionSourcesLoaded,
  v2exFeedSettingsOpen,
  v2exFeedUrl,
  v2exKeywordsText,
  v2exFeedSortBy,
  v2exRecentDays,
  v2exMaxPages,
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
  bossSourceAvailable,
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
    <header class="space-y-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="space-y-1">
          <h1 class="text-xl font-semibold text-content-primary">采集配置</h1>
          <p class="max-w-2xl text-sm leading-6 text-content-secondary">
            配置采集范围、来源和采后规则。
          </p>
        </div>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <span v-if="collectionConfigMessage" class="text-xs font-medium text-emerald-700">{{ collectionConfigMessage }}</span>
          <button
            class="ui-btn-secondary px-3 py-1.5 text-xs"
            type="button"
            :disabled="!tauri || collectionConfigSaving || sidecarRunning"
            @click="saveCollectionConfig"
          >
            {{ collectionConfigSaving ? "保存中…" : "保存配置" }}
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
      浏览器模式下只可预览，保存和同步不可用。
    </div>

    <div v-if="error" class="ui-status-danger p-3 text-sm">{{ error }}</div>

    <div class="space-y-5">
      <section class="ui-panel overflow-hidden">
        <div class="ui-section-header">
          <div>
            <h2 class="ui-section-title">范围与来源</h2>
          </div>
          <span class="ui-badge">当前：{{ selectedCollectionSourceLabel }}</span>
        </div>

        <div class="space-y-4 p-4">
          <fieldset class="space-y-2">
            <legend class="ui-field-label">来源</legend>
            <div v-if="!collectionSourcesLoaded" class="rounded-lg border border-border/90 bg-white px-3 py-2 text-sm text-content-muted">
              来源加载中…
            </div>
            <div v-else class="flex flex-wrap gap-2">
              <button
                v-for="option in collectableSourceOptions"
                :key="option.value"
                class="inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-border-glow/10"
                :class="isCollectionSourceSelected(option.value)
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-border/90 bg-white text-content-secondary hover:border-border-strong hover:bg-slate-50 hover:text-content-primary'"
                type="button"
                :aria-pressed="isCollectionSourceSelected(option.value)"
                @click="toggleCollectionSource(option.value)"
              >
                <span>{{ option.label }}</span>
              </button>
              <div v-if="collectableSourceOptions.length === 0" class="rounded-lg border border-border/90 bg-white px-3 py-2 text-sm text-content-muted">
                暂无可自动采集的平台
              </div>
            </div>
          </fieldset>

          <div class="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label class="space-y-1">
              <div class="ui-field-label">关键词</div>
              <textarea v-model="collectionKeywordsText" class="ui-textarea h-20 w-full resize-none" placeholder="Go&#10;后端&#10;平台工程" />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">排除词</div>
              <textarea v-model="collectionExcludedKeywordsText" class="ui-textarea h-20 w-full resize-none" placeholder="外包&#10;驻场&#10;培训" />
            </label>
          </div>

          <div class="grid gap-3 lg:grid-cols-3">
            <label class="space-y-1">
              <div class="ui-field-label">城市</div>
              <textarea v-model="collectionTargetCitiesText" class="ui-textarea h-20 w-full resize-none" placeholder="上海&#10;深圳&#10;远程" />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">方式</div>
              <textarea v-model="collectionWorkModesText" class="ui-textarea h-20 w-full resize-none" placeholder="远程&#10;混合&#10;到岗" />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">技术栈</div>
              <textarea v-model="collectionTechStackText" class="ui-textarea h-20 w-full resize-none" placeholder="Go&#10;Kubernetes&#10;Docker" />
            </label>
          </div>

          <div class="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_repeat(4,minmax(0,0.7fr))]">
            <label class="space-y-1">
              <div class="ui-field-label">学历</div>
              <textarea v-model="collectionDegreesText" class="ui-textarea h-16 w-full resize-none" placeholder="学历不限&#10;本科" />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">最低薪资</div>
              <input v-model.number="collectionMinimumSalaryK" type="number" min="0" class="ui-input h-9 w-full" />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">最高薪资</div>
              <input v-model.number="collectionMaximumSalaryK" type="number" min="0" class="ui-input h-9 w-full" />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">最低经验</div>
              <input v-model.number="collectionMinimumExperienceYears" type="number" min="0" step="0.5" class="ui-input h-9 w-full" />
            </label>
            <label class="space-y-1">
              <div class="ui-field-label">最高经验</div>
              <input v-model.number="collectionMaximumExperienceYears" type="number" min="0" step="0.5" class="ui-input h-9 w-full" />
            </label>
          </div>
        </div>

        <div v-if="bossSyncMessage" class="px-4 pb-4 text-xs text-content-muted">
          <div>{{ bossSyncMessage }}</div>
          <div v-if="bossSyncMappedFields.length > 0" class="mt-1">
            已映射：{{ bossSyncMappedFields.join("；") }}
          </div>
          <div v-if="bossSyncUnmappedFields.length > 0" class="mt-1">
            未映射：{{ bossSyncUnmappedFields.join("；") }}
          </div>
        </div>
      </section>

      <section v-if="bossSourceAvailable" class="ui-panel overflow-hidden">
        <button
          class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          :class="bossSettingsOpen ? 'border-b border-border/90' : ''"
          type="button"
          @click="bossSettingsOpen = !bossSettingsOpen"
        >
          <span class="space-y-1">
            <span class="block text-sm font-semibold text-content-primary">Boss</span>
            <span class="block text-xs text-content-muted">登录采集</span>
          </span>
          <span class="text-xs text-content-muted">{{ bossSettingsOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="bossSettingsOpen" class="space-y-3 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/90 bg-white px-3 py-3">
            <div class="text-xs text-content-muted">
              Boss 字典：
              <span class="text-content-secondary">{{ bossMetaReady ? `${bossMetaSyncedAt ?? "已加载"} · ${bossFilterConditionCount} 项` : "先同步字典" }}</span>
            </div>
            <div class="flex items-center gap-2">
              <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || bossMetaLoading" @click="loadBossMeta">
                {{ bossMetaLoading ? "读取中…" : "重读" }}
              </button>
              <button class="ui-btn-primary px-3 py-1.5 text-xs" :disabled="!tauri || bossMetaSyncing || sidecarRunning" @click="syncBossMeta">
                {{ bossMetaSyncing ? "同步中…" : "同步" }}
              </button>
            </div>
          </div>
          <div v-if="bossMetaError" class="ui-status-danger p-3 text-xs">{{ bossMetaError }}</div>

          <label class="block space-y-1">
            <div class="text-xs font-medium text-content-muted">Boss 搜索关键词</div>
            <textarea v-model="bossKeywordsText" class="ui-textarea h-24 w-full" placeholder="Go 远程&#10;SRE 远程&#10;Kubernetes 平台" />
            <div class="text-[11px] leading-5 text-content-muted">一行一个关键词。</div>
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
              <div class="text-[11px] text-content-muted">多选会拆成多轮采集。</div>
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
          <div v-if="bossMetaReady && bossAdditionalFilterGroups.length === 0" class="rounded-md border border-border/90 bg-white p-3 text-xs text-content-muted">
            暂无额外 Boss 筛选项。
          </div>
        </div>
      </section>

      <section v-if="v2exSelected" class="ui-panel overflow-hidden">
        <button
          class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          :class="v2exFeedSettingsOpen ? 'border-b border-border/90' : ''"
          type="button"
          @click="v2exFeedSettingsOpen = !v2exFeedSettingsOpen"
        >
          <span class="space-y-1">
            <span class="block text-sm font-semibold text-content-primary">V2EX</span>
            <span class="block text-xs text-content-muted">公开 Feed</span>
          </span>
          <span class="text-xs text-content-muted">{{ v2exFeedSettingsOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="v2exFeedSettingsOpen" class="grid gap-3 p-4 md:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">URL</div>
            <textarea
              v-model="v2exFeedUrl"
              class="ui-textarea h-20 w-full"
              placeholder="https://www.v2ex.com/feed/jobs.json&#10;https://www.v2ex.com/go/meet"
            />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">关键词</div>
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
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">页数上限</div>
            <input v-model.number="v2exMaxPages" type="number" min="1" step="1" class="ui-input w-full" />
          </label>
          <div class="md:col-span-2 text-xs text-content-muted">关键词：{{ v2exKeywords.length > 0 ? v2exKeywords.join("、") : "仅用招聘信号识别" }}</div>
        </div>
      </section>

      <section class="ui-panel overflow-hidden">
        <button
          class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
          :class="filterProfileOpen ? 'border-b border-border/90' : ''"
          type="button"
          @click="filterProfileOpen = !filterProfileOpen"
        >
          <span class="space-y-1">
            <span class="block text-sm font-semibold text-content-primary">规则</span>
            <span class="block text-xs text-content-muted">默认采后判断</span>
          </span>
          <span class="text-xs text-content-muted">{{ filterProfileOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="filterProfileOpen" class="space-y-4 p-4">
          <div class="rounded-lg border border-border/90 bg-white px-3 py-3">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-content-primary">默认采后规则</div>
                <div class="mt-1 text-xs text-content-muted">改完保存，必要时重算。</div>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning" @click="saveActiveFilterProfile">保存配置</button>
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filterRecomputing || sidecarRunning" @click="recomputeDefaultFilterProfile">
                  {{ filterRecomputing ? "重算中…" : "保存并重算" }}
                </button>
              </div>
            </div>
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
              <div class="ui-field-label">不确定策略</div>
              <select v-model="aiUncertainStrategy" class="ui-input w-full">
                <option value="pending_confirmation">放入待确认</option>
                <option value="filtered">倾向过滤</option>
                <option value="recommended">倾向推荐</option>
              </select>
              <div class="text-[11px] leading-5 text-content-muted">按配置落点。</div>
            </label>
          </div>
          <div class="text-xs leading-5 text-content-muted">黑名单和沟通状态仍会硬拦。</div>
          <div v-if="filterRecomputeMessage" class="text-xs font-medium text-emerald-700">{{ filterRecomputeMessage }}</div>
        </div>
      </section>
    </div>
  </section>
</template>
