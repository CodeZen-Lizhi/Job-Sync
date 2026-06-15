<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onMounted, onUnmounted, ref, shallowRef, useAttrs, useSlots } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";

import { parseSelectItems, type SelectItem, type SelectOptionItem } from "./uiSelectItems.ts";
import { measureMenuLayout, type MenuStyle } from "./uiSelectMenu.ts";

defineOptions({ inheritAttrs: false });

const model = defineModel<string[]>({ default: () => [] });

const attrs = useAttrs();
const slots = useSlots();

const items = shallowRef<SelectItem[]>([]);
const open = ref(false);
const menuMaxHeight = ref<number | null>(null);
const menuStyle = ref<MenuStyle>({ left: "0px", top: "0px", width: "0px" });
const rootEl = ref<HTMLElement | null>(null);
const buttonEl = ref<HTMLButtonElement | null>(null);
const listboxEl = ref<HTMLElement | null>(null);
const listboxId = `ui-multi-select-${Math.random().toString(16).slice(2)}-listbox`;

const isDisabled = computed(() => {
  const value = (attrs as Record<string, unknown>).disabled;
  if (value === "" || value === true) return true;
  if (value === false || value === undefined || value === null) return false;
  if (typeof value === "string") return value.toLowerCase() !== "false";
  return Boolean(value);
});

const wrapperClass = computed(() => ["relative w-full", attrs.class]);
const buttonAttrs = computed(() => {
  const { class: _class, ...rest } = attrs;
  return rest;
});
const optionItems = computed(() => items.value.filter((it): it is SelectOptionItem => it.kind === "option"));
const selectedSet = computed(() => new Set(model.value.map((item) => String(item))));
const selectedLabels = computed(() =>
  optionItems.value.filter((item) => selectedSet.value.has(item.value)).map((item) => item.label),
);
const triggerLabel = computed(() => {
  if (selectedLabels.value.length === 0) return "请选择";
  if (selectedLabels.value.length <= 2) return selectedLabels.value.join("、");
  return `${selectedLabels.value.slice(0, 2).join("、")} 等 ${selectedLabels.value.length} 项`;
});

function refreshItems(): void {
  items.value = parseSelectItems(slots.default?.() ?? []);
}

onMounted(refreshItems);
onBeforeUpdate(refreshItems);

async function syncMenuPosition(): Promise<void> {
  if (!open.value) return;
  await nextTick();
  const button = buttonEl.value;
  const menu = listboxEl.value;
  if (!button || !menu) return;
  const layout = measureMenuLayout(button, menu);
  menuMaxHeight.value = layout.menuMaxHeight;
  menuStyle.value = layout.menuStyle;
}

async function toggleOpen(): Promise<void> {
  if (isDisabled.value) return;
  open.value = !open.value;
  await syncMenuPosition();
}

function toggleOption(value: string): void {
  const option = optionItems.value.find((item) => item.value === value);
  if (option?.disabled) return;
  const selected = new Set(model.value.map((item) => String(item)));
  if (selected.has(value)) selected.delete(value);
  else selected.add(value);
  model.value = Array.from(selected);
}

function close(): void {
  open.value = false;
}

function onDocumentMouseDown(e: MouseEvent): void {
  if (!open.value) return;
  if (!(e.target instanceof Node)) return;
  if (rootEl.value?.contains(e.target)) return;
  if (listboxEl.value?.contains(e.target)) return;
  close();
}

function onWindowScrollOrResize(e: Event): void {
  if (!open.value) return;
  if (e.target instanceof Node && listboxEl.value?.contains(e.target)) return;
  void syncMenuPosition();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") close();
}

onMounted(() => {
  document.addEventListener("mousedown", onDocumentMouseDown);
  window.addEventListener("resize", onWindowScrollOrResize);
  window.addEventListener("scroll", onWindowScrollOrResize, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDocumentMouseDown);
  window.removeEventListener("resize", onWindowScrollOrResize);
  window.removeEventListener("scroll", onWindowScrollOrResize, true);
});
</script>

<template>
  <div ref="rootEl" :class="wrapperClass">
    <button
      ref="buttonEl"
      v-bind="buttonAttrs"
      type="button"
      class="group relative flex w-full items-center justify-between gap-2 rounded-xl border border-border/10 bg-input/90 px-3.5 py-2.5 text-sm text-content-primary shadow-inner transition-colors duration-200 hover:border-border/20 hover:bg-card-hover/75 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      :class="open ? 'border-border-glow/35 bg-card-hover/80' : ''"
      :disabled="isDisabled"
      :aria-expanded="open"
      :aria-controls="listboxId"
      aria-haspopup="listbox"
      @click="toggleOpen"
      @keydown="onKeydown"
    >
      <span class="min-w-0 flex-1 truncate text-left">{{ triggerLabel }}</span>
      <span class="ui-badge shrink-0">{{ model.length }}</span>
      <ChevronDown
        class="h-4 w-4 shrink-0 text-content-muted transition-transform duration-200 motion-reduce:transition-none group-hover:text-content-secondary"
        :class="open ? 'rotate-180 text-content-secondary' : ''"
        aria-hidden="true"
      />
      <span class="pointer-events-none absolute inset-0 rounded-xl border border-transparent transition-colors group-hover:border-border/10" aria-hidden="true" />
      <span class="pointer-events-none absolute -inset-0.5 hidden rounded-[1rem] border-2 border-border-glow/30 opacity-0 transition-opacity group-focus-visible:block group-focus-visible:opacity-100" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="listboxEl"
        :id="listboxId"
        class="fixed z-[120] overflow-hidden rounded-2xl border border-border/10 bg-surface-elevated/95 shadow-2xl shadow-black/40 backdrop-blur-xl"
        :style="menuStyle"
        role="listbox"
        aria-multiselectable="true"
      >
        <div class="overflow-auto p-1" :style="menuMaxHeight ? { maxHeight: `${menuMaxHeight}px` } : undefined">
          <template v-for="it in items" :key="it.key">
            <div v-if="it.kind === 'group'" class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">
              {{ it.label }}
            </div>
            <button
              v-else
              type="button"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors duration-150"
              :class="[
                it.disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-card-hover/75',
                selectedSet.has(it.value) ? 'bg-border-glow/10 text-content-primary ring-1 ring-inset ring-border-glow/20' : 'text-content-secondary',
              ]"
              :disabled="it.disabled"
              :aria-selected="selectedSet.has(it.value)"
              role="option"
              @click="toggleOption(it.value)"
            >
              <Check class="h-4 w-4 shrink-0 text-accent transition-opacity" :class="selectedSet.has(it.value) ? 'opacity-100' : 'opacity-0'" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ it.label }}</span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>
