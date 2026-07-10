<script setup lang="ts">
import { Play, Square } from "lucide-vue-next";

defineProps<{
  tauri: boolean;
  actionBusy: boolean;
  sidecarRunning: boolean;
}>();

defineEmits<{
  (e: "start"): void;
  (e: "stop"): void;
}>();
</script>

<template>
  <div class="flex w-full flex-wrap items-center justify-between gap-3 lg:w-auto lg:justify-end">
    <span class="ui-badge min-h-7 px-2.5" aria-live="polite">
      <span
        class="inline-block h-1.5 w-1.5 rounded-full"
        :class="sidecarRunning ? 'animate-pulse bg-emerald-500' : actionBusy ? 'bg-amber-500' : 'bg-slate-400'"
        aria-hidden="true"
      />
      {{ sidecarRunning ? '运行中' : actionBusy ? '准备中' : '空闲' }}
    </span>
    <div class="flex items-center gap-2">
      <button type="button" class="ui-btn-primary w-24 whitespace-nowrap" :disabled="!tauri || actionBusy || sidecarRunning" @click="$emit('start')">
        <Play class="h-4 w-4" aria-hidden="true" />
        {{ actionBusy ? '执行中…' : sidecarRunning ? '运行中' : '开始' }}
      </button>
      <button type="button" class="ui-btn-secondary w-24 whitespace-nowrap" :disabled="!tauri || (!actionBusy && !sidecarRunning)" @click="$emit('stop')">
        <Square class="h-4 w-4" aria-hidden="true" />
        停止
      </button>
    </div>
  </div>
</template>
