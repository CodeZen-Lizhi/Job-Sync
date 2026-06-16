<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Download, FileJson2, FileSpreadsheet, Loader2 } from "lucide-vue-next";

import { invoke, isTauri } from "../../lib/tauri.ts";
import { useCopy } from "../../lib/useCopy.ts";

type ExportFormat = "csv" | "json";

const tauri = isTauri();
const loading = ref(false);
const loadingFormat = ref<ExportFormat | null>(null);
const lastFormat = ref<ExportFormat | null>(null);
const lastPath = ref<string | null>(null);
const error = ref<string | null>(null);
const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const { copy, copyLabel } = useCopy();

const canExport = computed(() => tauri && !loading.value);

function formatLabel(format: ExportFormat): string {
  return format === "csv" ? "CSV" : "JSON";
}

async function runExport(format: ExportFormat): Promise<void> {
  if (!tauri) return;
  if (loading.value) return;

  open.value = false;
  error.value = null;
  loading.value = true;
  loadingFormat.value = format;

  try {
    const cmd = format === "csv" ? "export_jobs_csv" : "export_jobs_json";
    const path = await invoke<string>(cmd);
    lastPath.value = path;
    lastFormat.value = format;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
    loadingFormat.value = null;
  }
}

async function copyExportPath(): Promise<void> {
  if (!lastPath.value) return;
  await copy("export_path", lastPath.value);
}

function toggleMenu(): void {
  if (!tauri || loading.value) return;
  open.value = !open.value;
}

function onDocumentMouseDown(e: MouseEvent): void {
  if (!open.value) return;
  if (!(e.target instanceof Node)) return;
  if (rootEl.value?.contains(e.target)) return;
  open.value = false;
}

onMounted(() => {
  document.addEventListener("mousedown", onDocumentMouseDown);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocumentMouseDown);
});
</script>

<template>
  <div id="jobs-export" ref="rootEl" class="relative">
    <button
      type="button"
      class="ui-btn-secondary inline-flex items-center gap-2 px-3 py-1.5 text-xs"
      :disabled="!canExport"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggleMenu"
    >
      <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      <Download v-else class="h-3.5 w-3.5" aria-hidden="true" />
      {{ loading ? "导出中" : "导出" }}
      <ChevronDown class="h-3.5 w-3.5 text-content-muted" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      class="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-72 overflow-hidden rounded-2xl border border-border/10 bg-surface-elevated/95 p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
      role="menu"
    >
      <button
        type="button"
        class="group flex w-full items-start justify-between gap-3 rounded-xl p-3 text-left transition-colors hover:bg-card-hover/75 focus:outline-none focus-visible:ring-4 focus-visible:ring-border-glow/10 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!canExport"
        @click="runExport('csv')"
      >
        <div class="flex min-w-0 items-start gap-3">
          <div class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20" aria-hidden="true">
            <FileSpreadsheet class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 text-sm font-semibold text-content-primary">
              <span>CSV（表格）</span>
              <span class="ui-badge">推荐</span>
            </div>
            <div class="mt-1 text-xs leading-relaxed text-content-muted">适合 Excel、表格筛选和统计。</div>
          </div>
        </div>
        <Loader2 v-if="loading && loadingFormat === 'csv'" class="mt-2 h-4 w-4 shrink-0 animate-spin text-content-secondary" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="group flex w-full items-start justify-between gap-3 rounded-xl p-3 text-left transition-colors hover:bg-card-hover/75 focus:outline-none focus-visible:ring-4 focus-visible:ring-border-glow/10 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="!canExport"
        @click="runExport('json')"
      >
        <div class="flex min-w-0 items-start gap-3">
          <div class="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-sky-500/20" aria-hidden="true">
            <FileJson2 class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-content-primary">JSON（原始）</div>
            <div class="mt-1 text-xs leading-relaxed text-content-muted">适合备份、脚本处理和二次同步。</div>
          </div>
        </div>
        <Loader2 v-if="loading && loadingFormat === 'json'" class="mt-2 h-4 w-4 shrink-0 animate-spin text-content-secondary" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="lastPath && !open"
      class="ui-status-success absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(26rem,calc(100vw-2rem))] p-3"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="flex items-center gap-2 text-xs font-semibold text-accent-success">
          <CheckCircle2 class="h-4 w-4" aria-hidden="true" />
          <span>已导出 {{ lastFormat ? formatLabel(lastFormat) : "" }}</span>
        </div>
        <button
          type="button"
          class="ui-btn-secondary px-3 py-1.5 text-xs"
          @click="copyExportPath"
        >
          <Copy class="h-4 w-4" aria-hidden="true" />
          {{ copyLabel("export_path", "复制路径") }}
        </button>
      </div>
      <div class="mt-2 break-all font-mono text-xs text-content-secondary">{{ lastPath }}</div>
    </div>

    <div
      v-if="error && !open"
      class="ui-status-danger absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(24rem,calc(100vw-2rem))] p-3 text-sm"
      role="alert"
    >
      <div class="flex items-start gap-2">
        <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div class="min-w-0">
          <div class="text-xs font-semibold">导出失败</div>
          <div class="mt-1 break-words text-xs text-content-secondary">{{ error }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
