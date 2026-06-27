import { createRouter, createWebHashHistory } from "vue-router";

import CrawlConfig from "./pages/CrawlConfig.vue";
import Crawl from "./pages/Crawl.vue";
import Jobs from "./pages/Jobs.vue";
import Settings from "./pages/Settings.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/crawl" },
    { path: "/crawl", component: Crawl },
    { path: "/crawl-config", component: CrawlConfig },
    { path: "/jobs", component: Jobs },
    { path: "/export", redirect: "/jobs" },
    { path: "/settings", component: Settings },
  ],
});
