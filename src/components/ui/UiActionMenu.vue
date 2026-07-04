<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onMounted, onUnmounted, ref, shallowRef, useAttrs, useSlots } from "vue";
import { ChevronDown } from "lucide-vue-next";

import { parseSelectItems, type SelectItem, type SelectOptionItem } from "./uiSelectItems.ts";
import { measureMenuLayout, type MenuStyle } from "./uiSelectMenu.ts";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    label: string;
    summary?: string;
    placeholder?: string;
  }>(),
  {
    summary: "",
    placeholder: "选择操作",
  },
);

const emit = defineEmits<{
  (e: "select", value: string): void;
}>();

const attrs = useAttrs();
const slots = useSlots();

const items = shallowRef<SelectItem[]>([]);
const open = ref(false);
const menuMaxHeight = ref<number | null>(null);
const menuStyle = ref<MenuStyle>({ left: "0px", top: "0px", width: "0px" });
const rootEl = ref<HTMLElement | null>(null);
const buttonEl = ref<HTMLButtonElement | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const menuId = `ui-action-menu-${Math.random().toString(16).slice(2)}-menu`;

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
const summaryText = computed(() => props.summary.trim() || props.placeholder);

function refreshItems(): void {
  items.value = parseSelectItems(slots.default?.() ?? []);
}

onMounted(refreshItems);
onBeforeUpdate(refreshItems);

async function syncMenuPosition(): Promise<void> {
  if (!open.value) return;
  await nextTick();
  const button = buttonEl.value;
  const menu = menuEl.value;
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

function close(): void {
  open.value = false;
}

function selectOption(value: string): void {
  const item = optionItems.value.find((option) => option.value === value);
  if (!item || item.disabled) return;
  emit("select", value);
  close();
}

function onDocumentMouseDown(e: MouseEvent): void {
  if (!open.value) return;
  if (!(e.target instanceof Node)) return;
  if (rootEl.value?.contains(e.target)) return;
  if (menuEl.value?.contains(e.target)) return;
  close();
}

function onWindowScrollOrResize(e: Event): void {
  if (!open.value) return;
  if (e.target instanceof Node && menuEl.value?.contains(e.target)) return;
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
      class="group relative flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border/90 bg-white px-3 py-2 text-left transition-colors duration-150 hover:border-border-strong hover:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      :class="open ? 'border-border-glow bg-white ring-4 ring-border-glow/10' : ''"
      :disabled="isDisabled"
      :aria-expanded="open"
      :aria-controls="menuId"
      aria-haspopup="menu"
      @click="toggleOpen"
      @keydown="onKeydown"
    >
      <span class="min-w-0 flex-1">
        <span class="block text-[11px] font-semibold text-content-muted">{{ label }}</span>
        <span class="mt-0.5 block truncate text-sm font-medium text-content-primary">{{ summaryText }}</span>
      </span>
      <ChevronDown
        class="h-4 w-4 shrink-0 text-content-muted transition-transform duration-200 motion-reduce:transition-none group-hover:text-content-secondary"
        :class="open ? 'rotate-180 text-content-secondary' : ''"
        aria-hidden="true"
      />
      <span class="pointer-events-none absolute inset-0 rounded-md border border-transparent transition-colors group-hover:border-border/20" aria-hidden="true" />
      <span class="pointer-events-none absolute -inset-0.5 hidden rounded-lg border-2 border-border-glow/30 opacity-0 transition-opacity group-focus-visible:block group-focus-visible:opacity-100" aria-hidden="true" />
    </button>

    <Teleport to="body">
      <div
        v-if="open"
        ref="menuEl"
        :id="menuId"
        class="fixed z-[120] overflow-hidden rounded-md border border-border/90 bg-white shadow-lg shadow-slate-200/70"
        :style="menuStyle"
        role="menu"
        @keydown="onKeydown"
      >
        <div class="overflow-auto p-1" :style="menuMaxHeight ? { maxHeight: `${menuMaxHeight}px` } : undefined">
          <template v-for="it in items" :key="it.key">
            <div v-if="it.kind === 'group'" class="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">
              {{ it.label }}
            </div>
            <button
              v-else
              type="button"
              class="flex w-full items-center rounded-sm px-3 py-2 text-left text-sm text-content-secondary transition-colors duration-150 hover:bg-slate-50 hover:text-content-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-content-secondary"
              :disabled="it.disabled"
              role="menuitem"
              @click="selectOption(it.value)"
            >
              <span class="min-w-0 flex-1 truncate">{{ it.label }}</span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>
