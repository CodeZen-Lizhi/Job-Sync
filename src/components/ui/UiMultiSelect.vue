<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onMounted, onUnmounted, ref, shallowRef, useAttrs, useSlots } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";

import { parseSelectItems, type SelectItem, type SelectOptionItem } from "./uiSelectItems.ts";
import { measureMenuLayout, type MenuStyle } from "./uiSelectMenu.ts";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    emptyLabel?: string;
    emptyBadgeLabel?: string;
    variant?: "default" | "filter";
  }>(),
  {
    emptyLabel: "请选择",
    emptyBadgeLabel: "0",
    variant: "default",
  },
);

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
const isFilter = computed(() => props.variant === "filter");
const triggerClass = computed(() =>
  isFilter.value
    ? "group relative flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-sm text-content-primary shadow-sm shadow-slate-200/60 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
    : "group relative flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-border/90 bg-white px-3 py-1.5 text-sm text-content-primary transition-colors duration-150 hover:border-border-strong hover:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
);
const triggerOpenClass = computed(() =>
  isFilter.value
    ? "border-cyan-300 bg-white ring-4 ring-cyan-100/70"
    : "border-border-glow bg-white ring-4 ring-border-glow/10",
);
const triggerOverlayClass = computed(() =>
  isFilter.value
    ? "pointer-events-none absolute inset-0 rounded-lg border border-transparent transition-colors group-hover:border-slate-200"
    : "pointer-events-none absolute inset-0 rounded-md border border-transparent transition-colors group-hover:border-border/20",
);
const triggerFocusRingClass = computed(() =>
  isFilter.value
    ? "pointer-events-none absolute -inset-0.5 hidden rounded-[0.7rem] border-2 border-cyan-200/80 opacity-0 transition-opacity group-focus-visible:block group-focus-visible:opacity-100"
    : "pointer-events-none absolute -inset-0.5 hidden rounded-lg border-2 border-border-glow/30 opacity-0 transition-opacity group-focus-visible:block group-focus-visible:opacity-100",
);
const countBadgeClass = computed(() =>
  isFilter.value
    ? "shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-content-muted ring-1 ring-inset ring-slate-200"
    : "ui-badge shrink-0",
);
const menuClass = computed(() =>
  isFilter.value
    ? "fixed z-[120] overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xl shadow-slate-200/80"
    : "fixed z-[120] overflow-hidden rounded-md border border-border/90 bg-white shadow-lg shadow-slate-200/70",
);
const optionClass = computed(() =>
  isFilter.value
    ? "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150"
    : "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm transition-colors duration-150",
);
const optionStateClass = computed(() => ({
  disabled: isFilter.value ? "cursor-not-allowed opacity-40" : "cursor-not-allowed opacity-50",
  hover: isFilter.value ? "hover:bg-slate-50" : "hover:bg-slate-50",
  selected: isFilter.value
    ? "bg-cyan-50 text-cyan-900 ring-1 ring-inset ring-cyan-100"
    : "bg-border-glow/10 text-content-primary ring-1 ring-inset ring-border-glow/20",
  inactive: "text-content-secondary",
}));
const optionItems = computed(() => items.value.filter((it): it is SelectOptionItem => it.kind === "option"));
const selectedSet = computed(() => new Set(model.value.map((item) => String(item))));
const selectedLabels = computed(() =>
  optionItems.value.filter((item) => selectedSet.value.has(item.value)).map((item) => item.label),
);
const triggerLabel = computed(() => {
  if (selectedLabels.value.length === 0) return props.emptyLabel;
  if (selectedLabels.value.length <= 2) return selectedLabels.value.join("、");
  return `${selectedLabels.value.slice(0, 2).join("、")} 等 ${selectedLabels.value.length} 项`;
});
const selectedCountLabel = computed(() => (selectedLabels.value.length === 0 ? props.emptyBadgeLabel : String(selectedLabels.value.length)));

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
      :class="[triggerClass, open ? triggerOpenClass : '']"
      :disabled="isDisabled"
      :aria-expanded="open"
      :aria-controls="listboxId"
      aria-haspopup="listbox"
      @click="toggleOpen"
      @keydown="onKeydown"
    >
      <span class="min-w-0 flex-1 truncate text-left">{{ triggerLabel }}</span>
      <span :class="countBadgeClass">{{ selectedCountLabel }}</span>
      <ChevronDown
        class="h-4 w-4 shrink-0 text-content-muted transition-transform duration-200 motion-reduce:transition-none group-hover:text-content-secondary"
        :class="open ? 'rotate-180 text-content-secondary' : ''"
        aria-hidden="true"
      />
      <span :class="triggerOverlayClass" aria-hidden="true" />
      <span :class="triggerFocusRingClass" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="listboxEl"
        :id="listboxId"
        :class="menuClass"
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
              :class="[
                optionClass,
                it.disabled ? optionStateClass.disabled : optionStateClass.hover,
                selectedSet.has(it.value) ? optionStateClass.selected : optionStateClass.inactive,
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
