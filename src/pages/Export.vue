<script setup lang="ts">
import { ref } from "vue";
import { Download, FileJson, Table } from "lucide-vue-next";

import { invoke, isTauri } from "../lib/tauri";

const tauri = isTauri();
const loading = ref(false);
const error = ref<string | null>(null);
const lastPath = ref<string | null>(null);

async function exportCsv(): Promise<void> {
  error.value = null;
  if (!tauri) return;
  loading.value = true;
  try {
    lastPath.value = await invoke<string>("export_jobs_csv");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function exportJson(): Promise<void> {
  error.value = null;
  if (!tauri) return;
  loading.value = true;
  try {
    lastPath.value = await invoke<string>("export_jobs_json");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="space-y-5">
    <header class="space-y-2">
      <div class="ui-section-kicker">Export</div>
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div class="min-w-0">
          <h1 class="text-xl font-semibold text-content-primary">导出</h1>
          <p class="mt-1 text-sm text-content-secondary [overflow-wrap:anywhere]">导出本地职位库数据到 CSV / JSON。</p>
        </div>
      </div>
    </header>

    <div
      v-if="!tauri"
      class="ui-status-warning p-4 text-sm"
    >
      当前是浏览器模式（非 Tauri）。导出命令不可用。
    </div>

    <section class="ui-panel overflow-hidden">
      <div class="ui-section-header">
        <div class="flex items-center gap-2">
          <Download class="h-4 w-4 text-content-muted" aria-hidden="true" />
          <div>
            <h2 class="ui-section-title">职位库导出</h2>
            <p class="ui-section-copy">生成文件保存在本机，由桌面端命令返回路径。</p>
          </div>
        </div>
      </div>

      <div class="grid gap-3 p-4 sm:grid-cols-2">
        <button
          class="ui-btn-primary justify-start px-4 py-3"
          :disabled="!tauri || loading"
          @click="exportCsv"
        >
          <Table class="h-4 w-4" aria-hidden="true" />
          {{ loading ? "导出中…" : "导出 CSV" }}
        </button>
        <button
          class="ui-btn-secondary justify-start px-4 py-3"
          :disabled="!tauri || loading"
          @click="exportJson"
        >
          <FileJson class="h-4 w-4" aria-hidden="true" />
          {{ loading ? "导出中…" : "导出 JSON" }}
        </button>
      </div>
    </section>

    <div
      v-if="lastPath"
      class="ui-status-success p-4 text-sm"
    >
      已生成文件：<span class="font-mono text-content-primary">{{ lastPath }}</span>
    </div>

    <div
      v-if="error"
      class="ui-status-danger p-4 text-sm"
    >
      {{ error }}
    </div>
  </section>
</template>
