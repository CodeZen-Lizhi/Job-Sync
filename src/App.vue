<script setup lang="ts">
import { getVersion } from "@tauri-apps/api/app";
import { computed, onMounted, ref } from "vue";
import type { Component } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import { Bot, Database, FileSliders, FileText, Scan, Settings } from "lucide-vue-next";

import { useCrawlPage } from "./lib/useCrawlPage";

interface NavItem {
  to: string;
  label: string;
  icon: Component;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "数据",
    items: [
      { to: "/crawl", label: "采集", icon: Scan },
      { to: "/crawl-config", label: "采集配置", icon: FileSliders },
      { to: "/jobs", label: "职位库", icon: Database },
      { to: "/resume-library", label: "简历库", icon: FileText },
    ],
  },
  {
    label: "系统",
    items: [{ to: "/settings", label: "设置", icon: Settings }],
  },
];

const navItems = navGroups.flatMap((group) => group.items);

const navItemClass =
  "group relative flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-sm font-medium text-content-secondary transition-colors duration-150 hover:border-border/90 hover:bg-white/90 hover:text-content-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-border-glow/15 before:content-[''] before:absolute before:left-1.5 before:top-1/2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-border-glow before:opacity-0 before:transition-opacity";

const navItemExactActiveClass =
  "border-slate-950 bg-slate-950 !text-white shadow-sm shadow-slate-900/20 hover:!border-slate-950 hover:!bg-slate-950 hover:!text-white before:!opacity-100 [&_.nav-icon]:!text-white [&_.nav-label]:font-semibold";

const mobileNavItemClass =
  "group inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-border/80 bg-white/90 px-3.5 py-2 text-sm font-semibold text-content-secondary shadow-sm shadow-slate-200/50 transition-colors duration-150 hover:border-border-strong hover:bg-white hover:text-content-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-border-glow/15";

const mobileNavItemExactActiveClass =
  "!border-slate-950 !bg-slate-950 !text-white shadow-md shadow-slate-900/20 [&_.nav-icon]:!text-white";

const route = useRoute();
const appVersion = ref(__APP_VERSION__);
const contentMaxWidthClass = computed(() => (route.path === "/jobs" || route.path === "/crawl-config" || route.path === "/resume-library" ? "max-w-6xl" : "max-w-5xl"));

onMounted(() => {
  getVersion()
    .then((version) => {
      appVersion.value = version;
    })
    .catch(() => {
      appVersion.value = __APP_VERSION__;
    });
});

void useCrawlPage({ initialize: "schedule" });
</script>

<template>
  <div class="flex h-screen flex-col bg-surface-secondary">
    <div class="relative flex-1 overflow-hidden">
      <!-- Content -->
      <div class="relative z-10 flex h-full w-full max-w-full flex-col gap-0 lg:flex-row">
        <!-- Sidebar -->
        <aside
          class="hidden w-full max-w-full shrink-0 flex-col border-b border-border/90 bg-white/95 shadow-sm shadow-slate-200/70 backdrop-blur lg:flex lg:w-64 lg:border-b-0 lg:border-r"
        >
          <header class="px-4 pb-3 pt-4 lg:pb-4 lg:pt-5">
            <div class="ui-panel-muted flex items-center gap-3 px-3 py-3">
              <div class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm shadow-slate-900/20 ring-1 ring-slate-950/10" aria-hidden="true">
                <Bot class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="truncate text-sm font-semibold tracking-wide text-content-primary">JobPilot</div>
                  <div class="shrink-0 rounded-md border border-border/80 bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-content-muted">
                    v{{ appVersion }}
                  </div>
                </div>
                <div class="mt-1 truncate text-xs text-content-muted">精准求职工作台</div>
              </div>
            </div>
          </header>

          <nav class="grid grid-cols-1 gap-2 px-3 pb-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:flex lg:flex-1 lg:flex-col lg:gap-5 lg:overflow-y-auto lg:pb-5" aria-label="导航">
            <section v-for="g in navGroups" :key="g.label" class="min-w-0 space-y-2">
              <div class="px-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-content-muted">
                {{ g.label }}
              </div>
              <div class="space-y-1">
                <RouterLink
                  v-for="it in g.items"
                  :key="it.to"
                  :to="it.to"
                  :class="navItemClass"
                  :exact-active-class="navItemExactActiveClass"
                >
                  <component :is="it.icon" class="nav-icon h-4 w-4 shrink-0 text-content-muted transition-colors group-hover:text-content-secondary" aria-hidden="true" />
                  <span class="nav-label min-w-0 truncate">{{ it.label }}</span>
                </RouterLink>
              </div>
            </section>
          </nav>
        </aside>

        <header class="border-b border-border/90 bg-white/95 px-3 py-3 shadow-sm shadow-slate-200/70 backdrop-blur lg:hidden">
          <div class="flex items-center gap-3">
            <div class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm shadow-slate-900/20 ring-1 ring-slate-950/10" aria-hidden="true">
              <Bot class="h-5 w-5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <div class="truncate text-base font-semibold text-content-primary">JobPilot</div>
                <div class="shrink-0 rounded-md border border-border/80 bg-surface-secondary px-1.5 py-0.5 text-[11px] font-semibold leading-none text-content-muted">
                  v{{ appVersion }}
                </div>
              </div>
              <div class="mt-0.5 truncate text-xs text-content-muted">精准求职工作台</div>
            </div>
          </div>

          <nav class="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="移动导航">
            <RouterLink
              v-for="it in navItems"
              :key="it.to"
              :to="it.to"
              :class="mobileNavItemClass"
              :exact-active-class="mobileNavItemExactActiveClass"
            >
              <component :is="it.icon" class="nav-icon h-4 w-4 shrink-0 text-content-muted transition-colors group-hover:text-content-secondary" aria-hidden="true" />
              <span class="whitespace-nowrap">{{ it.label }}</span>
            </RouterLink>
          </nav>
        </header>

        <!-- Main content -->
        <main class="w-full min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto bg-surface-secondary px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
          <div :class="['mx-auto w-full', contentMaxWidthClass]">
            <RouterView v-slot="{ Component }">
              <component :is="Component" />
            </RouterView>
          </div>
        </main>
      </div>
    </div>
  </div>
</template>
