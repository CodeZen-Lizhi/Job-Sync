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
        <aside class="app-sidebar hidden w-full max-w-full shrink-0 flex-col border-border lg:flex lg:w-64 lg:border-r">
          <header class="flex h-16 items-center border-b border-border px-4">
            <div class="flex items-center gap-3">
              <div class="app-brand-mark" aria-hidden="true">
                <Bot class="h-4 w-4" />
              </div>
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <div class="truncate text-sm font-semibold tracking-tight text-content-primary">JobPilot</div>
                  <div class="shrink-0 rounded-md bg-surface-alt px-1.5 py-0.5 text-[10px] font-medium leading-none text-content-muted">
                    v{{ appVersion }}
                  </div>
                </div>
                <div class="mt-0.5 truncate text-[11px] text-content-muted">精准求职工作台</div>
              </div>
            </div>
          </header>

          <nav class="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4" aria-label="导航">
            <section v-for="g in navGroups" :key="g.label" class="min-w-0 space-y-2">
              <div class="px-2.5 text-[11px] font-medium text-content-muted">
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
                  <component :is="it.icon" class="nav-icon h-4 w-4 shrink-0 text-content-muted transition-colors group-hover:text-content-primary" aria-hidden="true" />
                  <span class="nav-label min-w-0 truncate">{{ it.label }}</span>
                </RouterLink>
              </div>
            </section>
          </nav>

        </aside>

        <header class="app-sidebar border-b border-border px-3 py-3 lg:hidden">
          <div class="flex items-center gap-3">
            <div class="app-brand-mark" aria-hidden="true">
              <Bot class="h-4 w-4" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-2">
                <div class="truncate text-sm font-semibold text-content-primary">JobPilot</div>
                <div class="shrink-0 rounded-md bg-surface-alt px-1.5 py-0.5 text-[10px] font-medium leading-none text-content-muted">
                  v{{ appVersion }}
                </div>
              </div>
              <div class="mt-0.5 truncate text-[11px] text-content-muted">精准求职工作台</div>
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
              <component :is="it.icon" class="nav-icon h-3.5 w-3.5 shrink-0 text-content-muted transition-colors group-hover:text-content-primary" aria-hidden="true" />
              <span class="whitespace-nowrap">{{ it.label }}</span>
            </RouterLink>
          </nav>
        </header>

        <!-- Main content -->
        <main class="w-full min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto bg-white px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
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
