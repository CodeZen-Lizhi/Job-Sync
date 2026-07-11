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

const navItemClass = "group app-nav-link";
const navItemExactActiveClass = "app-nav-link-active";
const mobileNavItemClass = "group app-mobile-nav-link";
const mobileNavItemExactActiveClass = "app-mobile-nav-link-active";

const route = useRoute();
const appVersion = ref(__APP_VERSION__);
const contentMaxWidthClass = computed(() => (route.path === "/crawl" ? "max-w-6xl" : "max-w-7xl"));

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
        <aside class="app-sidebar hidden w-full max-w-full shrink-0 flex-col border-white/10 lg:flex lg:w-72 lg:border-r">
          <header class="px-5 pb-5 pt-6">
            <div class="flex items-center gap-3">
              <div class="app-brand-mark" aria-hidden="true">
                <Bot class="h-5 w-5" />
              </div>
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="truncate text-base font-semibold tracking-tight text-white">JobPilot</div>
                  <div class="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold leading-none text-slate-400">
                    v{{ appVersion }}
                  </div>
                </div>
                <div class="mt-1 truncate text-xs text-slate-400">精准求职工作台</div>
              </div>
            </div>
          </header>

          <nav class="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6" aria-label="导航">
            <section v-for="g in navGroups" :key="g.label" class="min-w-0 space-y-2">
              <div class="px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">
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
                  <component :is="it.icon" class="nav-icon h-4 w-4 shrink-0 text-slate-500 transition-colors group-hover:text-white" aria-hidden="true" />
                  <span class="nav-label min-w-0 truncate">{{ it.label }}</span>
                </RouterLink>
              </div>
            </section>
          </nav>

          <div class="mx-4 mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div class="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-300">Workspace</div>
            <div class="mt-2 text-xs leading-5 text-slate-400">把采集、判断与简历维护收拢在一个安静的工作流里。</div>
          </div>
        </aside>

        <header class="app-sidebar border-b border-white/10 px-3 py-3 shadow-lg shadow-slate-950/10 lg:hidden">
          <div class="flex items-center gap-3">
            <div class="app-brand-mark !h-11 !w-11" aria-hidden="true">
              <Bot class="h-5 w-5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <div class="truncate text-base font-semibold text-white">JobPilot</div>
                <div class="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold leading-none text-slate-400">
                  v{{ appVersion }}
                </div>
              </div>
              <div class="mt-0.5 truncate text-xs text-slate-400">精准求职工作台</div>
            </div>
          </div>

          <nav class="mt-3 grid grid-cols-5 gap-1" aria-label="移动导航">
            <RouterLink
              v-for="it in navItems"
              :key="it.to"
              :to="it.to"
              :class="mobileNavItemClass"
              :exact-active-class="mobileNavItemExactActiveClass"
            >
              <component :is="it.icon" class="nav-icon h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors group-hover:text-white" aria-hidden="true" />
              <span class="whitespace-nowrap">{{ it.label }}</span>
            </RouterLink>
          </nav>
        </header>

        <!-- Main content -->
        <main class="ui-soft-grid w-full min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto bg-surface-secondary px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-7">
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
