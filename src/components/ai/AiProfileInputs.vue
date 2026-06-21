<script setup lang="ts">
const resumeText = defineModel<string>("resumeText", { default: "" });
</script>

<template>
  <div class="space-y-3 rounded-2xl bg-card-alt/55 p-4 ring-1 ring-border/10">
    <div class="flex items-center gap-3">
      <div class="text-xs font-medium text-content-muted">简历输入</div>
      <div class="text-xs text-content-muted">直接粘贴文本</div>
    </div>

    <textarea
      v-model="resumeText"
      class="ui-textarea h-36 w-full"
      placeholder="粘贴简历（txt / md）"
    />
  </div>
</template>
