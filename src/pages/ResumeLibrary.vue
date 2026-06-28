<script setup lang="ts">
import { computed, onMounted } from "vue";
import { Check, FilePenLine, FileText, Link2, Pencil, Plus, Save, Star, Trash2, X } from "lucide-vue-next";
import { RouterLink } from "vue-router";

import { useResumeLibraryPage } from "../lib/useResumeLibraryPage";

const {
  tauri,
  loading,
  saving,
  error,
  resumes,
  selectedResume,
  linkedJobs,
  formTitle,
  formBody,
  isCreating,
  isEditing,
  hasResumes,
  isDirty,
  highlightedResumeId,
  pendingJobId,
  pendingJobSummary,
  linkModalOpen,
  linkJobsLoading,
  linkJobs,
  selectedJobIds,
  load,
  selectResume,
  startCreate,
  startEdit,
  cancelEdit,
  saveResume,
  removeSelectedResume,
  makeSelectedDefault,
  openLinkModal,
  toggleLinkJob,
  saveJobLinks,
  unlinkJob,
  jobLabel,
  jobScoreLabel,
  formatDate,
} = useResumeLibraryPage();

const canSave = computed(() => formTitle.value.trim().length > 0 && formBody.value.trim().length > 0 && !saving.value);
const previewTitle = computed(() => formTitle.value.trim() || selectedResume.value?.title || "未命名简历");
const previewBody = computed(() => formBody.value || selectedResume.value?.body || "");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>");
}

function renderMarkdown(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  let paragraph: string[] = [];

  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${paragraph.join("<br />")}</p>`);
    paragraph = [];
  };

  const closeList = () => {
    if (!inList) return;
    html.push("</ul>");
    inList = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      closeParagraph();
      closeList();
      if (inCode) {
        html.push("</code></pre>");
      } else {
        html.push("<pre><code>");
      }
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      html.push(`${escapeHtml(rawLine)}\n`);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.*)$/);
    if (listItem) {
      closeParagraph();
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(renderInlineMarkdown(line));
  }

  closeParagraph();
  closeList();
  if (inCode) html.push("</code></pre>");
  return html.join("");
}

const renderedResumeHtml = computed(() => renderMarkdown(previewBody.value));

onMounted(() => {
  void load();
});
</script>

<template>
  <section class="space-y-5">
    <header class="space-y-2">
      <div class="ui-section-kicker">Resume Library</div>
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold text-content-primary">简历库</h1>
          <p class="mt-1 max-w-3xl text-sm leading-6 text-content-secondary">
            维护 Markdown 简历、默认简历和岗位关联。
          </p>
        </div>
        <button class="ui-btn-primary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!tauri" @click="startCreate">
          <Plus class="h-3.5 w-3.5" aria-hidden="true" />
          新建简历
        </button>
      </div>
    </header>

    <div v-if="!tauri" class="ui-status-warning p-4 text-sm">当前是浏览器模式（非 Tauri）。简历库命令不可用。</div>
    <div v-if="error" class="ui-status-danger p-4 text-sm">{{ error }}</div>
    <div v-if="pendingJobId" class="ui-status-warning flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
      <span>
        待关联岗位：{{ pendingJobSummary ? jobLabel(pendingJobSummary) : pendingJobId }}
      </span>
      <button class="ui-btn-secondary px-2.5 py-1 text-xs" :disabled="!selectedResume" @click="openLinkModal">
        关联到当前简历
      </button>
    </div>

    <div v-if="loading" class="px-4 py-8 text-sm text-content-muted">正在加载简历库…</div>
    <div v-else-if="!hasResumes && !isCreating" class="ui-panel-muted p-8 text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white text-content-primary ring-1 ring-border/90">
        <FileText class="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 class="mt-4 text-base font-semibold text-content-primary">暂无简历</h2>
      <p class="mt-2 text-sm text-content-muted">创建第一份 Markdown 简历后，就可以设为默认或关联岗位。</p>
      <button class="ui-btn-primary mt-5 inline-flex items-center gap-2 px-3 py-1.5 text-xs" @click="startCreate">
        <Plus class="h-3.5 w-3.5" aria-hidden="true" />
        新建简历
      </button>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside class="ui-panel overflow-hidden">
        <div class="ui-section-header">
          <div>
            <h2 class="ui-section-title">简历列表</h2>
            <p class="ui-section-copy">{{ resumes.length }} 份简历</p>
          </div>
        </div>
        <div class="divide-y divide-border/10">
          <button
            v-for="resume in resumes"
            :key="resume.id"
            type="button"
            class="block w-full px-4 py-3 text-left transition-colors hover:bg-slate-50"
            :class="[
              selectedResume?.id === resume.id ? 'bg-slate-50' : '',
              highlightedResumeId === resume.id ? 'ring-2 ring-inset ring-slate-900/20' : '',
            ]"
            @click="selectResume(resume.id)"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-sm font-semibold text-content-primary">{{ resume.title }}</div>
                <div class="mt-1 text-[11px] text-content-muted">更新 {{ formatDate(resume.updated_at) }}</div>
              </div>
              <span v-if="resume.is_default" class="ui-badge shrink-0 !bg-white !text-amber-700 !ring-amber-200">默认</span>
            </div>
            <div class="mt-2 text-[11px] text-content-muted">关联 {{ resume.linked_job_count }} 个岗位</div>
          </button>
        </div>
      </aside>

      <main class="ui-panel overflow-hidden">
        <div class="ui-section-header">
          <div>
            <h2 class="ui-section-title">{{ isCreating ? "新建简历" : selectedResume?.title ?? "简历详情" }}</h2>
            <p class="ui-section-copy">
              {{ selectedResume?.is_default ? "默认简历" : isCreating ? "Markdown 简历" : isEditing ? "编辑模式" : "详情模式" }}
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!selectedResume || selectedResume.is_default || saving" @click="makeSelectedDefault">
              <Star class="h-3.5 w-3.5" aria-hidden="true" />
              设为默认
            </button>
            <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!selectedResume || saving" @click="openLinkModal">
              <Link2 class="h-3.5 w-3.5" aria-hidden="true" />
              关联岗位
            </button>
            <button
              v-if="!isCreating && !isEditing"
              class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs"
              :disabled="!selectedResume || saving"
              @click="startEdit"
            >
              <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
              编辑
            </button>
            <button
              v-if="isEditing || isCreating"
              class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs"
              :disabled="saving"
              @click="cancelEdit"
            >
              <X class="h-3.5 w-3.5" aria-hidden="true" />
              取消
            </button>
            <button v-if="isEditing || isCreating" class="ui-btn-primary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!canSave || (!isCreating && !isDirty)" @click="saveResume">
              <Save class="h-3.5 w-3.5" aria-hidden="true" />
              {{ saving ? "保存中…" : "保存" }}
            </button>
            <button class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs" :disabled="!selectedResume || saving" @click="removeSelectedResume">
              <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
              删除
            </button>
          </div>
        </div>

        <div class="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div class="space-y-3">
            <template v-if="isEditing || isCreating">
              <label class="block space-y-1 text-xs text-content-muted">
                <span>标题</span>
                <input v-model="formTitle" class="ui-input w-full" placeholder="例如：后端工程师基础版" />
              </label>
              <label class="block space-y-1 text-xs text-content-muted">
                <span>Markdown 简历</span>
                <textarea
                  v-model="formBody"
                  class="ui-input min-h-[520px] w-full resize-y font-mono text-xs leading-5"
                  placeholder="# 姓名&#10;&#10;## 技能&#10;- ..."
                />
              </label>
            </template>
            <section v-else class="ui-panel-muted overflow-hidden">
              <div class="border-b border-border/80 px-5 py-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div class="text-lg font-semibold text-content-primary">{{ previewTitle }}</div>
                    <div class="mt-1 text-xs text-content-muted">Markdown 已格式化展示</div>
                  </div>
                  <div class="ui-badge !bg-blue-50 !text-blue-700 !ring-blue-200">
                    <FilePenLine class="h-3.5 w-3.5" aria-hidden="true" />
                    详情
                  </div>
                </div>
              </div>
              <div class="resume-markdown px-5 py-5" v-html="renderedResumeHtml" />
            </section>
          </div>

          <aside class="space-y-3">
            <section class="ui-panel-muted p-4">
              <div class="flex items-center justify-between gap-2">
              <div>
                  <div class="text-sm font-semibold text-content-primary">关联岗位</div>
                  <div class="mt-1 text-xs text-content-muted">{{ linkedJobs.length }} 个岗位</div>
                </div>
              </div>
              <div v-if="linkedJobs.length === 0" class="mt-4 text-sm text-content-muted">暂无关联岗位。</div>
              <div v-else class="mt-4 space-y-2">
                <div v-for="job in linkedJobs" :key="job.encrypt_job_id" class="rounded-md border border-border/90 bg-white p-3">
                  <div class="text-sm font-medium text-content-primary">{{ jobLabel(job) }}</div>
                  <div class="mt-1 text-[11px] text-content-muted">{{ job.salary_desc ?? "薪资未知" }} / {{ job.review_status ?? "pending" }}</div>
                  <div class="mt-3 flex flex-wrap gap-2">
                    <RouterLink class="ui-btn-secondary px-2.5 py-1 text-xs" :to="{ path: '/jobs', query: { jobId: job.encrypt_job_id } }">职位库</RouterLink>
                    <button class="ui-btn-secondary px-2.5 py-1 text-xs" :disabled="saving" @click="unlinkJob(job.encrypt_job_id)">解除</button>
                  </div>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>

    <div v-if="linkModalOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div class="w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-border/90">
        <div class="flex items-center justify-between gap-3 border-b border-border/90 px-4 py-3">
          <div>
            <div class="text-sm font-semibold text-content-primary">关联岗位</div>
            <div class="mt-1 text-xs text-content-muted">已有关联的岗位会切换到当前简历。</div>
          </div>
          <button class="ui-btn-secondary inline-flex h-8 w-8 items-center justify-center p-0" @click="linkModalOpen = false">
            <X class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto p-4">
          <div v-if="linkJobsLoading" class="py-8 text-sm text-content-muted">正在加载推荐岗位…</div>
          <div v-else-if="linkJobs.length === 0" class="py-8 text-center text-sm text-content-muted">暂无推荐查看岗位。</div>
          <div v-else class="space-y-2">
            <button
              v-for="job in linkJobs"
              :key="job.encrypt_job_id"
              type="button"
              class="flex w-full items-start gap-3 rounded-md border border-border/90 p-3 text-left transition-colors hover:bg-slate-50"
              :class="selectedJobIds.has(job.encrypt_job_id) ? 'bg-slate-50 ring-1 ring-slate-900/20' : 'bg-white'"
              @click="toggleLinkJob(job.encrypt_job_id)"
            >
              <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/90 bg-white">
                <Check v-if="selectedJobIds.has(job.encrypt_job_id)" class="h-3.5 w-3.5 text-slate-900" aria-hidden="true" />
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-content-primary">{{ jobLabel(job) }}</span>
                <span class="mt-1 block text-xs text-content-muted">{{ job.salary_desc ?? "薪资未知" }} / {{ jobScoreLabel(job) }}</span>
              </span>
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border/90 px-4 py-3">
          <div class="text-xs text-content-muted">已选择 {{ selectedJobIds.size }} 个岗位</div>
          <div class="flex gap-2">
            <button class="ui-btn-secondary px-3 py-1.5 text-xs" @click="linkModalOpen = false">取消</button>
            <button class="ui-btn-primary px-3 py-1.5 text-xs" :disabled="selectedJobIds.size === 0 || saving" @click="saveJobLinks">
              保存关联
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.resume-markdown {
  color: rgb(var(--color-content-primary));
  font-size: 14px;
  line-height: 1.8;
}

.resume-markdown :deep(h1),
.resume-markdown :deep(h2),
.resume-markdown :deep(h3),
.resume-markdown :deep(h4) {
  margin: 0 0 12px;
  font-weight: 600;
  line-height: 1.35;
  color: rgb(var(--color-content-primary));
}

.resume-markdown :deep(h1) {
  font-size: 28px;
}

.resume-markdown :deep(h2) {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid rgb(var(--color-border) / 0.7);
  font-size: 18px;
}

.resume-markdown :deep(h3) {
  margin-top: 22px;
  font-size: 15px;
}

.resume-markdown :deep(p) {
  margin: 0 0 14px;
  color: rgb(var(--color-content-secondary));
}

.resume-markdown :deep(ul) {
  margin: 0 0 16px;
  padding-left: 20px;
  color: rgb(var(--color-content-secondary));
}

.resume-markdown :deep(li) {
  margin: 0 0 8px;
}

.resume-markdown :deep(code) {
  border-radius: 6px;
  background: rgb(var(--color-card-hover) / 1);
  padding: 0.1rem 0.35rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: rgb(var(--color-content-primary));
}

.resume-markdown :deep(pre) {
  overflow-x: auto;
  border: 1px solid rgb(var(--color-border) / 0.8);
  border-radius: 10px;
  background: rgb(var(--color-card-hover) / 1);
  padding: 14px 16px;
  margin: 0 0 16px;
}

.resume-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}
</style>
