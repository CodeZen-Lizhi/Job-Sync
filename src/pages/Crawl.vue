<script setup lang="ts">
import CrawlActionBar from "../components/crawl/CrawlActionBar.vue";
import CrawlLoginStatusPanel from "../components/crawl/CrawlLoginStatusPanel.vue";
import CrawlRuntimePanel from "../components/crawl/CrawlRuntimePanel.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import { useCrawlPage } from "../lib/useCrawlPage";
const {
  tauri,
  runtime,
  clearLogs,
  mode,
  keywordsText,
  cityText,
  salaryText,
  experienceText,
  degreeText,
  industryText,
  scaleText,
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
  targetCitiesText,
  excludedCitiesText,
  sourcePlatformsText,
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
  selectedCity,
  selectedSalary,
  selectedExperience,
  selectedDegree,
  selectedIndustry,
  selectedScale,
  maxPages,
  maxJobs,
  delayMs,
  actionBusy,
  error,
  loginExists,
  loginLoading,
  loginError,
  bossMetaLoading,
  bossMetaSyncing,
  bossMetaError,
  filterRecomputing,
  filterRecomputeMessage,
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
  refreshLogin,
  startLogin,
  loadBossMeta,
  syncBossMeta,
  selectFilterProfile,
  saveActiveFilterProfile,
  createFilterProfile,
  setActiveFilterProfileAsDefault,
  recomputeDefaultFilterProfile,
  start,
  stop,
} = useCrawlPage();
</script>
<template>
  <section class="flex min-h-[calc(100vh-5.25rem)] flex-col gap-4">
    <header class="shrink-0 space-y-1">
      <h1 class="text-xl font-semibold text-content-primary">岗位采集</h1>
      <p class="text-sm text-content-secondary">为精准求职补充岗位样本；自动模式只采集和筛选，不执行投递或开聊。</p>
    </header>
    <div
      v-if="!tauri"
      class="ui-status-warning shrink-0 p-4 text-sm"
    >
      当前是浏览器模式（非 Tauri）。采集命令不可用。
    </div>
    <CrawlLoginStatusPanel
      :tauri="tauri"
      :login-exists="loginExists"
      :login-loading="loginLoading"
      :sidecar-running="sidecarRunning"
      :login-status="runtime.login.status"
      :login-message="runtime.login.message"
      :login-error="loginError"
      @start-login="startLogin"
      @refresh-login="refreshLogin"
    />
    <div class="ui-crawl-panel shrink-0 space-y-4 p-5">
      <div class="inline-flex rounded-xl bg-card/80 p-1 ring-1 ring-border/10">
        <button
          class="rounded-md px-4 py-1.5 text-sm font-medium transition-all"
          :class="
            mode === 'manual'
              ? 'bg-accent/90 text-white shadow-sm'
              : 'text-content-secondary hover:bg-card-hover/60 hover:text-content-primary'
          "
          @click="mode = 'manual'"
        >
          手动采集
        </button>
        <button
          class="rounded-md px-4 py-1.5 text-sm font-medium transition-all"
          :class="
            mode === 'auto'
              ? 'bg-accent/90 text-white shadow-sm'
              : 'text-content-secondary hover:bg-card-hover/60 hover:text-content-primary'
          "
          @click="mode = 'auto'"
        >
          自动采集
        </button>
      </div>
      <div v-if="mode === 'auto'" class="space-y-4">
        <div class="space-y-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">搜索条件</div>
	          <div class="ui-crawl-toolbar flex flex-wrap items-center justify-between gap-2 px-3 py-3">
	            <div class="text-xs text-content-muted">
	              筛选项字典：
	              <span class="text-content-secondary">
	                {{ bossMetaReady ? (bossMetaSyncedAt ?? "已加载") : "未同步" }}
	              </span>
	            </div>
	            <div class="flex items-center gap-2">
	              <button
	                class="ui-btn-secondary px-3 py-1.5 text-xs"
	                :disabled="!tauri || bossMetaLoading"
	                @click="loadBossMeta"
	              >
	                {{ bossMetaLoading ? "读取中…" : "读取缓存" }}
	              </button>
	              <button
	                class="ui-btn-primary px-3 py-1.5 text-xs"
	                :disabled="!tauri || bossMetaSyncing || sidecarRunning"
	                @click="syncBossMeta"
	              >
	                {{ bossMetaSyncing ? "同步中…" : "同步城市、行业与筛选项" }}
	              </button>
	            </div>
	          </div>
	          <div v-if="bossMetaError" class="ui-status-danger p-3 text-xs">
	            {{ bossMetaError }}
	          </div>
          <div class="space-y-2 border-y border-border/10 py-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">筛选画像</div>
                <div class="mt-1 text-xs text-content-muted">自动采集前会保存当前画像并作为默认策略执行。</div>
              </div>
              <span v-if="activeFilterProfileIsDefault" class="ui-badge">默认策略</span>
            </div>
            <div class="grid gap-2 lg:grid-cols-[minmax(10rem,12rem)_minmax(10rem,12rem)_minmax(10rem,12rem)_auto]">
              <label class="space-y-1">
                <div class="text-xs font-medium text-content-muted">当前画像</div>
                <select
                  v-model="activeFilterProfileId"
                  class="ui-input w-full"
                  :disabled="!tauri || sidecarRunning"
                  @change="selectFilterProfile(activeFilterProfileId)"
                >
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
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning || !newFilterProfileName.trim()" @click="createFilterProfile">
                  新建
                </button>
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning" @click="saveActiveFilterProfile">
                  保存画像
                </button>
                <button class="ui-btn-secondary px-3 py-1.5 text-xs" :disabled="!tauri || sidecarRunning || activeFilterProfileIsDefault" @click="setActiveFilterProfileAsDefault">
                  设为默认
                </button>
              </div>
            </div>
          </div>
          <label class="block space-y-1">
            <div class="text-xs font-medium text-content-muted">关键词（每行一个）</div>
            <textarea
              v-model="keywordsText"
              class="ui-textarea h-24 w-full"
              placeholder="例如：Rust&#10;后端&#10;Tauri"
            />
          </label>
          <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">城市</div>
              <UiSelect v-if="bossCityGroups.length > 0" v-model="selectedCity">
                <option value="">不限（保持当前）</option>
                <optgroup v-if="bossHotCities.length > 0" label="热门">
                  <option v-for="c in bossHotCities" :key="c.code" :value="String(c.code)">
                    {{ c.name }}
                  </option>
                </optgroup>
                <optgroup v-for="g in bossCityGroups" :key="g.firstChar" :label="g.firstChar">
                  <option v-for="c in g.cityList" :key="c.code" :value="String(c.code)">
                    {{ c.name }}
                  </option>
                </optgroup>
              </UiSelect>
              <input
                v-else
                v-model="cityText"
                class="ui-input w-full"
                placeholder="例如：北京"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">薪资</div>
              <UiSelect v-if="bossSalaryOptions.length > 0" v-model="selectedSalary">
                <option value="">不限</option>
                <option v-for="opt in bossSalaryOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input
                v-else
                v-model="salaryText"
                class="ui-input w-full"
                placeholder="例如：10-20K"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">经验</div>
              <UiSelect v-if="bossExperienceOptions.length > 0" v-model="selectedExperience">
                <option value="">不限</option>
                <option v-for="opt in bossExperienceOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input
                v-else
                v-model="experienceText"
                class="ui-input w-full"
                placeholder="例如：3-5 年"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">学历</div>
              <UiSelect v-if="bossDegreeOptions.length > 0" v-model="selectedDegree">
                <option value="">不限</option>
                <option v-for="opt in bossDegreeOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input
                v-else
                v-model="degreeText"
                class="ui-input w-full"
                placeholder="例如：本科"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">行业</div>
              <UiSelect v-if="bossIndustryGroups.length > 0" v-model="selectedIndustry">
                <option value="">不限</option>
                <optgroup v-for="g in bossIndustryGroups" :key="g.name" :label="g.name">
                  <option v-for="opt in g.options" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
                </optgroup>
              </UiSelect>
              <input
                v-else
                v-model="industryText"
                class="ui-input w-full"
                placeholder="例如：互联网"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">规模</div>
              <UiSelect v-if="bossScaleOptions.length > 0" v-model="selectedScale">
                <option value="">不限</option>
                <option v-for="opt in bossScaleOptions" :key="opt.code" :value="String(opt.code)">{{ opt.name }}</option>
              </UiSelect>
              <input
                v-else
                v-model="scaleText"
                class="ui-input w-full"
                placeholder="例如：20-99 人"
              />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须包含关键词</div>
              <textarea
                v-model="mustKeywordsText"
                class="ui-textarea h-20 w-full"
                placeholder="例如：Go&#10;Kubernetes&#10;SRE"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须排除关键词</div>
              <textarea
                v-model="mustNotKeywordsText"
                class="ui-textarea h-20 w-full"
                placeholder="例如：外包&#10;驻场&#10;培训"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好关键词</div>
              <textarea
                v-model="preferenceKeywordsText"
                class="ui-textarea h-20 w-full"
                placeholder="例如：远程&#10;云原生&#10;AI Infra"
              />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须岗位方向</div>
              <textarea
                v-model="requiredDirectionsText"
                class="ui-textarea h-20 w-full"
                placeholder="Go&#10;Infra&#10;云原生"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除岗位方向</div>
              <textarea
                v-model="excludedDirectionsText"
                class="ui-textarea h-20 w-full"
                placeholder="前端&#10;销售型售前"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好岗位方向</div>
              <textarea
                v-model="preferenceDirectionsText"
                class="ui-textarea h-20 w-full"
                placeholder="AI Infra&#10;平台工程"
              />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须技术标签</div>
              <textarea
                v-model="requiredTechTagsText"
                class="ui-textarea h-20 w-full"
                placeholder="Kubernetes&#10;Docker"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除技术标签</div>
              <textarea
                v-model="excludedTechTagsText"
                class="ui-textarea h-20 w-full"
                placeholder="Java&#10;PHP&#10;Windows 运维"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好技术标签</div>
              <textarea
                v-model="preferenceTechTagsText"
                class="ui-textarea h-20 w-full"
                placeholder="Prometheus&#10;Terraform&#10;CI/CD"
              />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须工作方式</div>
              <textarea
                v-model="requiredWorkModesText"
                class="ui-textarea h-20 w-full"
                placeholder="remote&#10;hybrid"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除工作方式</div>
              <textarea
                v-model="excludedWorkModesText"
                class="ui-textarea h-20 w-full"
                placeholder="on_site&#10;office"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好工作方式</div>
              <textarea
                v-model="preferenceWorkModesText"
                class="ui-textarea h-20 w-full"
                placeholder="remote&#10;long_remote"
              />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-4">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">可接受城市</div>
              <textarea
                v-model="targetCitiesText"
                class="ui-textarea h-20 w-full"
                placeholder="北京&#10;上海&#10;深圳"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除城市</div>
              <textarea
                v-model="excludedCitiesText"
                class="ui-textarea h-20 w-full"
                placeholder="杭州&#10;广州"
              />
            </label>
            <label class="space-y-1">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-medium text-content-muted">来源平台</span>
                <span class="text-[11px] text-content-muted">控制推荐来源</span>
              </div>
              <div class="mb-1 flex flex-wrap gap-1.5">
                <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setBossOnlySourcePlatforms">Boss-only</button>
                <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setManualImportSourcePlatforms">手动导入来源</button>
                <button type="button" class="ui-btn-secondary px-2 py-1 text-[11px]" @click="setAllSourcePlatforms">全来源</button>
              </div>
              <div class="mb-2 rounded-md border border-border/10 bg-surface-secondary/60 px-2.5 py-2 text-[11px] leading-5 text-content-muted">
                <span class="font-semibold text-content-secondary">{{ sourcePlatformModeLabel }}</span>
                <span class="ml-1">{{ sourcePlatformModeHint }}</span>
              </div>
              <textarea
                v-model="sourcePlatformsText"
                class="ui-textarea h-20 w-full"
                placeholder="boss&#10;liepin&#10;zhilian&#10;maimai&#10;v2ex&#10;linuxdo"
              />
              <div class="flex flex-wrap gap-1.5 text-[11px] text-content-muted">
                <span v-for="option in sourcePlatformOptions" :key="option.value" class="ui-badge">
                  {{ option.value }} · {{ option.label }}
                </span>
              </div>
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">允许沟通状态</div>
              <textarea
                v-model="communicationStatusesText"
                class="ui-textarea h-20 w-full"
                placeholder="not_contacted&#10;greeted_unread"
              />
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
              <textarea
                v-model="allowedDegreesText"
                class="ui-textarea h-16 w-full"
                placeholder="学历不限&#10;本科"
              />
            </label>
            <label class="flex items-center gap-2 self-end rounded-md border border-border/10 bg-surface-secondary/50 px-3 py-2 text-xs text-content-muted">
              <input v-model="acceptUnknownExperience" type="checkbox" class="h-4 w-4 accent-accent" />
              接受未知经验
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-4">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除学历要求</div>
              <textarea
                v-model="excludedDegreesText"
                class="ui-textarea h-20 w-full"
                placeholder="硕士&#10;博士"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">公司必须条件</div>
              <textarea
                v-model="companyMustKeywordsText"
                class="ui-textarea h-20 w-full"
                placeholder="云计算&#10;B轮"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">公司排除条件</div>
              <textarea
                v-model="companyMustNotKeywordsText"
                class="ui-textarea h-20 w-full"
                placeholder="外包&#10;培训机构"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">公司偏好条件</div>
              <textarea
                v-model="companyPreferenceKeywordsText"
                class="ui-textarea h-20 w-full"
                placeholder="上市&#10;1000人以上"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须公司规模</div>
              <textarea
                v-model="companyRequiredScalesText"
                class="ui-textarea h-20 w-full"
                placeholder="1000人以上&#10;500-999人"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除公司规模</div>
              <textarea
                v-model="companyExcludedScalesText"
                class="ui-textarea h-20 w-full"
                placeholder="20人以下"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好公司规模</div>
              <textarea
                v-model="companyPreferenceScalesText"
                class="ui-textarea h-20 w-full"
                placeholder="1000人以上"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须融资阶段</div>
              <textarea
                v-model="companyRequiredFinancingStagesText"
                class="ui-textarea h-20 w-full"
                placeholder="B轮&#10;上市"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除融资阶段</div>
              <textarea
                v-model="companyExcludedFinancingStagesText"
                class="ui-textarea h-20 w-full"
                placeholder="未融资"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好融资阶段</div>
              <textarea
                v-model="companyPreferenceFinancingStagesText"
                class="ui-textarea h-20 w-full"
                placeholder="C轮&#10;上市"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">必须行业</div>
              <textarea
                v-model="companyRequiredIndustriesText"
                class="ui-textarea h-20 w-full"
                placeholder="云计算&#10;企业服务"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">排除行业</div>
              <textarea
                v-model="companyExcludedIndustriesText"
                class="ui-textarea h-20 w-full"
                placeholder="培训&#10;外包服务"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">偏好行业</div>
              <textarea
                v-model="companyPreferenceIndustriesText"
                class="ui-textarea h-20 w-full"
                placeholder="AI Infra&#10;SaaS"
              />
            </label>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Resume 权重</div>
              <input
                v-model.number="resumeWeight"
                type="number"
                min="0"
                step="0.05"
                class="ui-input w-full"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Preference 权重</div>
              <input
                v-model.number="preferenceWeight"
                type="number"
                min="0"
                step="0.05"
                class="ui-input w-full"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">Company 权重</div>
              <input
                v-model.number="companyWeight"
                type="number"
                min="0"
                step="0.05"
                class="ui-input w-full"
              />
            </label>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button
              class="ui-btn-secondary px-3 py-1.5 text-xs"
              :disabled="!tauri || filterRecomputing || sidecarRunning"
              @click="recomputeDefaultFilterProfile"
            >
              {{ filterRecomputing ? "重算中…" : "保存画像并重算已有职位" }}
            </button>
            <span v-if="filterRecomputeMessage" class="text-xs text-emerald-300">{{ filterRecomputeMessage }}</span>
          </div>
        </div>
        <div class="space-y-3">
          <div class="text-xs font-semibold uppercase tracking-wider text-content-muted">限流参数</div>
          <div class="grid grid-cols-3 gap-3">
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最大页数</div>
              <input
                v-model.number="maxPages"
                type="number"
                min="1"
                class="ui-input w-full"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">最大职位数</div>
              <input
                v-model.number="maxJobs"
                type="number"
                min="1"
                class="ui-input w-full"
              />
            </label>
            <label class="space-y-1">
              <div class="text-xs font-medium text-content-muted">延迟 (ms)</div>
              <input
                v-model.number="delayMs"
                type="number"
                min="0"
                class="ui-input w-full"
              />
            </label>
          </div>
        </div>
      </div>
        <CrawlActionBar
          :tauri="tauri"
          :action-busy="actionBusy"
          :sidecar-running="sidecarRunning"
          @start="start"
          @stop="stop"
        />
    </div>
    <CrawlRuntimePanel
      :keyword="runtime.progress.keyword"
      :current-page="runtime.progress.current_page"
      :captured-job-list="runtime.progress.captured_job_list"
      :captured-job-detail="runtime.progress.captured_job_detail"
      :filtered-job="runtime.progress.filtered_job"
      :logs="runtime.logs"
      :sidecar-running="sidecarRunning"
      :error="error"
      @clear-logs="clearLogs"
    />
  </section>
</template>
