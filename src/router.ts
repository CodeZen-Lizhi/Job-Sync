import { createRouter, createWebHashHistory } from "vue-router";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/crawl" },
    { path: "/crawl", component: () => import("./pages/Crawl.vue") },
    { path: "/crawl-config", component: () => import("./pages/CrawlConfig.vue") },
    { path: "/jobs", component: () => import("./pages/Jobs.vue") },
    { path: "/resume-library", component: () => import("./pages/ResumeLibrary.vue") },
    { path: "/export", redirect: "/jobs" },
    { path: "/settings", component: () => import("./pages/Settings.vue") },
  ],
});
