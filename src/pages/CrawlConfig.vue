<script setup lang="ts">
import UiMultiSelect from "../components/ui/UiMultiSelect.vue";
import UiSelect from "../components/ui/UiSelect.vue";
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
  v2exKeywords,
  bossKeywordsText,
  cityText,
  salaryText,
  experienceText,
  degreeText,
  industryText,
  scaleText,
  selectedCity,
  selectedSalary,
  selectedExperience,
  selectedDegree,
  selectedIndustry,
  selectedScale,
  mustKeywordsText,
  mustNotKeywordsText,
  preferenceKeywordsText,
  requiredDirectionsText,
  excludedDirectionsText,
  preferenceDirectionsText,
  requiredTechTagsText,
  excludedTechTagsText,
  preferenceTechTagsText,
  requiredWorkModesText,
  excludedWorkModesText,
  preferenceWorkModesText,
  requiredBossActiveStatusesText,
  excludedBossActiveStatusesText,
  targetCitiesText,
  excludedCitiesText,
  selectedSourcePlatforms,
  sourcePlatformModeLabel,
  sourcePlatformModeHint,
  sourcePlatformOptions,
  setBossOnlySourcePlatforms,
  setManualImportSourcePlatforms,
  setAllSourcePlatforms,
  communicationStatusesText,
  minimumSalaryK,
  maximumSalaryK,
  acceptNegotiableSalary,
  recentDays,
  minimumExperienceYears,
  maximumExperienceYears,
  acceptUnknownExperience,
  allowedDegreesText,
  excludedDegreesText,
  companyMustKeywordsText,
  companyMustNotKeywordsText,
  companyPreferenceKeywordsText,
  companyRequiredScalesText,
  companyExcludedScalesText,
  companyPreferenceScalesText,
  companyRequiredFinancingStagesText,
  companyExcludedFinancingStagesText,
  companyPreferenceFinancingStagesText,
  companyRequiredIndustriesText,
  companyExcludedIndustriesText,
  companyPreferenceIndustriesText,
  resumeWeight,
  preferenceWeight,
  companyWeight,
  error,
  bossMetaLoading,
  bossMetaSyncing,
  bossMetaError,
  filterRecomputing,
  filterRecomputeMessage,
  bossSettingsOpen,
  filterProfileOpen,
  bossSyncMappedFields,
  bossSyncUnmappedFields,
  bossSyncMessage,
  filterProfiles,
  activeFilterProfileId,
  activeFilterProfileName,
  newFilterProfileName,
  activeFilterProfileIsDefault,
  bossMetaSyncedAt,
  bossCityGroups,
  bossHotCities,
  bossSalaryOptions,
  bossExperienceOptions,
  bossDegreeOptions,
  bossScaleOptions,
  bossIndustryGroups,
  bossMetaReady,
  sidecarRunning,
  loadBossMeta,
  syncBossMeta,
  selectFilterProfile,
  saveActiveFilterProfile,
  createFilterProfile,
  setActiveFilterProfileAsDefault,
  recomputeDefaultFilterProfile,
  syncCollectionIntentToPlatforms,
} = useCrawlPage();
</script>

<template>
  <section class="space-y-4">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold text-content-primary">采集配置</h1>
      <p class="text-sm text-content-secondary">维护采集意图、平台设置和筛选画像；采集时只需要回到执行台切换画像并启动。</p>
    </header>

    <div v-if="!tauri" class="ui-status-warning p-4 text-sm">
      当前是浏览器模式（非 Tauri）。配置可以预览，保存和平台字典同步不可用。
    </div>

    <div v-if="error" class="ui-status-danger p-3 text-sm">{{ error }}</div>

    <div class="ui-crawl-panel space-y-5 p-5">
      <section class="space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">采集意图</div>
            <p class="mt-1 text-xs text-content-muted">多值字段默认用于 OR 扩样本；必须满足、排除和排序交给采后的筛选画像。</p>
          </div>
          <button
            class="ui-btn-primary px-3 py-1.5 text-xs"
            type="button"
            :disabled="sidecarRunning"
            @click="syncCollectionIntentToPlatforms"
          >
            {{ collectionIntentSyncLabel }}
          </button>
        </div>

        <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <label class="space-y-1 lg:col-span-2">
            <div class="text-xs font-medium text-content-muted">关键词（多行或逗号分隔）</div>
            <textarea v-model="collectionKeywordsText" class="ui-textarea h-24 w-full" placeholder="Go&#10;后端&#10;平台工程" />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">本次采集来源</div>
            <UiMultiSelect v-model="selectedCollectionSources" :disabled="collectableSourceOptions.length === 0">
              <option v-for="option in collectableSourceOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </UiMultiSelect>
            <div class="text-[11px] text-content-muted">下拉项来自设置中已启用且支持自动采集的平台；当前选择 {{ selectedCollectionSourceLabel }}。</div>
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">目标城市（多选意图）</div>
            <textarea v-model="collectionTargetCitiesText" class="ui-textarea h-20 w-full" placeholder="上海&#10;深圳&#10;远程" />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">工作方式</div>
            <textarea v-model="collectionWorkModesText" class="ui-textarea h-20 w-full" placeholder="远程&#10;混合&#10;到岗" />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">技术栈</div>
            <textarea v-model="collectionTechStackText" class="ui-textarea h-20 w-full" placeholder="Go&#10;Kubernetes&#10;Docker" />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">排除关键词</div>
            <textarea v-model="collectionExcludedKeywordsText" class="ui-textarea h-20 w-full" placeholder="外包&#10;驻场&#10;培训" />
          </label>
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">学历</div>
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

        <div v-if="bossSyncMessage" class="rounded-md border border-border/10 bg-surface-secondary/60 px-3 py-3 text-xs">
          <div class="font-medium text-content-secondary">{{ bossSyncMessage }}</div>
          <div v-if="bossSyncMappedFields.length > 0" class="mt-2 text-emerald-300">
            已映射：{{ bossSyncMappedFields.join("；") }}
          </div>
          <div v-if="bossSyncUnmappedFields.length > 0" class="mt-2 text-amber-300">
            未映射：{{ bossSyncUnmappedFields.join("；") }}
          </div>
        </div>
      </section>

      <section class="space-y-3 border-t border-border/10 pt-4">
        <button class="flex w-full items-center justify-between gap-3 text-left" type="button" @click="bossSettingsOpen = !bossSettingsOpen">
          <span>
            <span class="block text-xs font-semibold uppercase tracking-wider text-content-muted">Boss 平台配置</span>
            <span class="mt-1 block text-xs text-content-muted">浏览器登录型采集；采集意图同步后可在这里微调 Boss 专属筛选。</span>
          </span>
          <span class="ui-badge">{{ bossSettingsOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="bossSettingsOpen" class="space-y-3">
          <div class="ui-crawl-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-3">
            <div class="text-xs text-content-muted">
              Boss 筛选字典：
              <span class="text-content-secondary">{{ bossMetaReady ? (bossMetaSyncedAt ?? "已加载") : "未同步" }}</span>
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
            <div class="text-xs font-medium text-content-muted">Boss 搜索关键词（每行一个，OR 扩样本）</div>
            <textarea v-model="bossKeywordsText" class="ui-textarea h-24 w-full" placeholder="同步采集意图后自动生成，也可手动调整" />
          </label>

          <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Boss 城市</div>
              <UiSelect v-if="bossCityGroups.length > 0" v-model="selectedCity">
                <option value="">不限（保持当前）</option>
                <optgroup v-if="bossHotCities.length > 0" label="热门">
                  <option v-for="c in bossHotCities" :key="c.code" :value="String(c.code)">{{ c.name }}</option>
                </optgroup>
                <optgroup v-for="g in bossCityGroups" :key="g.firstChar" :label="g.firstChar">
                  <option v-for="c in g.cityList" :key="c.code" :value="String(c.code)">{{ c.name }}</option>
                </optgroup>
              </UiSelect>
              <input v-else v-model="cityText" class="ui-input w-full" placeholder="例如：北京" />
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
          </div>
        </div>
      </section>

      <section v-if="v2exSelected" class="space-y-3 border-t border-border/10 pt-4">
        <button class="flex w-full items-center justify-between gap-3 text-left" type="button" @click="v2exFeedSettingsOpen = !v2exFeedSettingsOpen">
          <span>
            <span class="block text-xs font-semibold uppercase tracking-wider text-content-muted">V2EX Feed 配置</span>
            <span class="mt-1 block text-xs text-content-muted">公开 Atom Feed 采集，无需平台登录；仅明确招聘帖会进入职位库。</span>
          </span>
          <span class="ui-badge">{{ v2exFeedSettingsOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="v2exFeedSettingsOpen" class="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)]">
          <label class="space-y-1">
            <div class="text-xs font-medium text-content-muted">Feed URL</div>
            <input v-model="v2exFeedUrl" class="ui-input w-full" placeholder="https://www.v2ex.com/feed/tab/jobs.xml" />
          </label>
          <label class="space-y-1">
            <div class="font-medium text-content-secondary">本次 Feed 关键词</div>
            <textarea v-model="v2exKeywordsText" class="ui-textarea h-20 w-full" placeholder="Go&#10;远程&#10;Kubernetes" />
          </label>
          <div class="md:col-span-2 rounded-md border border-border/10 bg-surface-secondary/50 p-3 text-xs text-content-muted">
            <span class="font-medium text-content-secondary">当前关键词：</span>
            <span>{{ v2exKeywords.length > 0 ? v2exKeywords.join("、") : "未填写关键词时只使用招聘帖识别规则" }}</span>
          </div>
          <div class="md:col-span-2 text-xs text-content-muted">
            V2EX 会用这里的关键词做 OR 匹配；“同步到平台配置”会用采集意图里的关键词和技术栈填充这里，但你可以单独调整。排除关键词仍来自采集意图和筛选画像；城市、薪资、经验、学历继续交给采后筛选画像。
          </div>
        </div>
      </section>

      <section class="space-y-3 border-t border-border/10 pt-4">
        <button class="flex w-full items-center justify-between gap-3 text-left" type="button" @click="filterProfileOpen = !filterProfileOpen">
          <span>
            <span class="block text-xs font-semibold uppercase tracking-wider text-content-muted">筛选画像（采后候选过滤）</span>
            <span class="mt-1 block text-xs text-content-muted">控制候选队列、Top 20 和排序，不阻止原始岗位进入职位库。</span>
          </span>
          <span class="ui-badge">{{ filterProfileOpen ? "收起" : "展开" }}</span>
        </button>

        <div v-if="filterProfileOpen" class="space-y-3">
          <div class="space-y-2 border-y border-border/10 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">画像管理</div>
                <div class="mt-1 text-xs text-content-muted">修改后可保存并重算已有职位的候选资格。</div>
              </div>
              <span v-if="activeFilterProfileIsDefault" class="ui-badge">默认策略</span>
            </div>
            <div class="grid gap-2 lg:grid-cols-[minmax(10rem,12rem)_minmax(10rem,12rem)_minmax(10rem,12rem)_auto]">
              <label class="space-y-1">
                <div class="text-xs font-medium text-content-muted">当前画像</div>
                <select v-model="activeFilterProfileId" class="ui-input w-full" :disabled="!tauri || sidecarRunning" @change="selectFilterProfile(activeFilterProfileId)">
                  <option v-for="profile in filterProfiles" :key="profile.id" :value="profile.id">
                    {{ profile.name }}{{ profile.is_default ? "（默认）" : "" }}
                  </option>
                </select>
              </label>
              <label class="space-y-1">
                <div class="text-xs font-medium text-content-muted">画像名称</div>
                <input v-model="activeFilterProfileName" class="ui-input w-full" :disabled="!tauri || sidecarRunning" />
              </label>
              <label class="space-y-1">
                <div class="text-xs font-medium text-content-muted">新建画像</div>
                <input v-model="newFilterProfileName" class="ui-input w-full" placeholder="例如：薪资优先" :disabled="!tauri || sidecarRunning" />
              </label>
              <div class="flex flex-wrap items-end gap-2">
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning || !newFilterProfileName.trim()" @click="createFilterProfile">新建</button>
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning" @click="saveActiveFilterProfile">保存画像</button>
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning || activeFilterProfileIsDefault" @click="setActiveFilterProfileAsDefault">设为默认</button>
              </div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须包含关键词</div>
              <textarea v-model="mustKeywordsText" class="ui-textarea h-20 w-full" placeholder="Go&#10;Kubernetes&#10;SRE" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须排除关键词</div>
              <textarea v-model="mustNotKeywordsText" class="ui-textarea h-20 w-full" placeholder="外包&#10;驻场&#10;培训" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好关键词</div>
              <textarea v-model="preferenceKeywordsText" class="ui-textarea h-20 w-full" placeholder="远程&#10;云原生&#10;AI Infra" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须岗位方向</div>
              <textarea v-model="requiredDirectionsText" class="ui-textarea h-20 w-full" placeholder="Go&#10;Infra&#10;云原生" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除岗位方向</div>
              <textarea v-model="excludedDirectionsText" class="ui-textarea h-20 w-full" placeholder="前端&#10;销售型售前" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好岗位方向</div>
              <textarea v-model="preferenceDirectionsText" class="ui-textarea h-20 w-full" placeholder="AI Infra&#10;平台工程" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须技术标签</div>
              <textarea v-model="requiredTechTagsText" class="ui-textarea h-20 w-full" placeholder="Kubernetes&#10;Docker" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除技术标签</div>
              <textarea v-model="excludedTechTagsText" class="ui-textarea h-20 w-full" placeholder="Java&#10;PHP&#10;Windows 运维" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好技术标签</div>
              <textarea v-model="preferenceTechTagsText" class="ui-textarea h-20 w-full" placeholder="Prometheus&#10;Terraform&#10;CI/CD" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须工作方式</div>
              <textarea v-model="requiredWorkModesText" class="ui-textarea h-20 w-full" placeholder="remote&#10;hybrid" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除工作方式</div>
              <textarea v-model="excludedWorkModesText" class="ui-textarea h-20 w-full" placeholder="on_site&#10;office" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好工作方式</div>
              <textarea v-model="preferenceWorkModesText" class="ui-textarea h-20 w-full" placeholder="remote&#10;long_remote" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-2">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须 Boss 活跃状态</div>
              <textarea v-model="requiredBossActiveStatusesText" class="ui-textarea h-20 w-full" placeholder="刚刚活跃&#10;今日活跃&#10;3日内活跃" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除 Boss 活跃状态</div>
              <textarea v-model="excludedBossActiveStatusesText" class="ui-textarea h-20 w-full" placeholder="半年前活跃&#10;很久未活跃" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-4">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">可接受城市</div>
              <textarea v-model="targetCitiesText" class="ui-textarea h-20 w-full" placeholder="北京&#10;上海&#10;深圳" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除城市</div>
              <textarea v-model="excludedCitiesText" class="ui-textarea h-20 w-full" placeholder="杭州&#10;广州" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">允许候选来源</div>
              <div class="mb-1 flex flex-wrap gap-1.5">
                <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setBossOnlySourcePlatforms">Boss-only</button>
                <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setManualImportSourcePlatforms">外部保留来源</button>
                <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setAllSourcePlatforms">全来源</button>
              </div>
              <UiMultiSelect v-model="selectedSourcePlatforms">
                <option v-for="option in sourcePlatformOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </UiMultiSelect>
              <div class="text-[11px] text-content-muted">{{ sourcePlatformModeLabel }} · {{ sourcePlatformModeHint }}</div>
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">允许沟通状态</div>
              <textarea v-model="communicationStatusesText" class="ui-textarea h-20 w-full" placeholder="not_contacted&#10;greeted_unread" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-4">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最低薪资 K</div>
              <input v-model.number="minimumSalaryK" type="number" min="0" step="1" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最高薪资 K</div>
              <input v-model.number="maximumSalaryK" type="number" min="0" step="1" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最近新增天数</div>
              <input v-model.number="recentDays" type="number" min="0" step="1" class="ui-input w-full" />
            </label>
            <label class="flex items-center gap-2 self-end rounded-md border border-border/10 bg-surface-secondary/50 px-3 py-2 text-xs text-content-muted">
              <input v-model="acceptNegotiableSalary" type="checkbox" class="h-4 w-4 accent-accent" />
              接受面议薪资
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-4">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最低经验年限</div>
              <input v-model.number="minimumExperienceYears" type="number" min="0" step="0.5" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最高经验年限</div>
              <input v-model.number="maximumExperienceYears" type="number" min="0" step="0.5" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">允许学历要求</div>
              <textarea v-model="allowedDegreesText" class="ui-textarea h-16 w-full" placeholder="学历不限&#10;本科" />
            </label>
            <label class="flex items-center gap-2 self-end rounded-md border border-border/10 bg-surface-secondary/50 px-3 py-2 text-xs text-content-muted">
              <input v-model="acceptUnknownExperience" type="checkbox" class="h-4 w-4 accent-accent" />
              接受未知经验
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-4">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除学历要求</div>
              <textarea v-model="excludedDegreesText" class="ui-textarea h-20 w-full" placeholder="硕士&#10;博士" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">公司必须条件</div>
              <textarea v-model="companyMustKeywordsText" class="ui-textarea h-20 w-full" placeholder="云计算&#10;B轮" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">公司排除条件</div>
              <textarea v-model="companyMustNotKeywordsText" class="ui-textarea h-20 w-full" placeholder="外包&#10;培训机构" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">公司偏好条件</div>
              <textarea v-model="companyPreferenceKeywordsText" class="ui-textarea h-20 w-full" placeholder="上市&#10;1000人以上" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须公司规模</div>
              <textarea v-model="companyRequiredScalesText" class="ui-textarea h-20 w-full" placeholder="1000人以上&#10;500-999人" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除公司规模</div>
              <textarea v-model="companyExcludedScalesText" class="ui-textarea h-20 w-full" placeholder="20人以下" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好公司规模</div>
              <textarea v-model="companyPreferenceScalesText" class="ui-textarea h-20 w-full" placeholder="1000人以上" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须融资阶段</div>
              <textarea v-model="companyRequiredFinancingStagesText" class="ui-textarea h-20 w-full" placeholder="B轮&#10;上市" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除融资阶段</div>
              <textarea v-model="companyExcludedFinancingStagesText" class="ui-textarea h-20 w-full" placeholder="未融资" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好融资阶段</div>
              <textarea v-model="companyPreferenceFinancingStagesText" class="ui-textarea h-20 w-full" placeholder="C轮&#10;上市" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须行业</div>
              <textarea v-model="companyRequiredIndustriesText" class="ui-textarea h-20 w-full" placeholder="云计算&#10;企业服务" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除行业</div>
              <textarea v-model="companyExcludedIndustriesText" class="ui-textarea h-20 w-full" placeholder="培训&#10;外包服务" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好行业</div>
              <textarea v-model="companyPreferenceIndustriesText" class="ui-textarea h-20 w-full" placeholder="AI Infra&#10;SaaS" />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Resume 权重</div>
              <input v-model.number="resumeWeight" type="number" min="0" step="0.05" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Preference 权重</div>
              <input v-model.number="preferenceWeight" type="number" min="0" step="0.05" class="ui-input w-full" />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Company 权重</div>
              <input v-model.number="companyWeight" type="number" min="0" step="0.05" class="ui-input w-full" />
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || filterRecomputing || sidecarRunning" @click="recomputeDefaultFilterProfile">
              {{ filterRecomputing ? "重算中…" : "保存画像并重算已有职位" }}
            </button>
            <span v-if="filterRecomputeMessage" class="text-xs text-emerald-300">{{ filterRecomputeMessage }}</span>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
