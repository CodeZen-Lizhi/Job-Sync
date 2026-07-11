# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

(To be filled by the team)

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

(To be filled by the team)

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

### Convention: Use the Shadcn-Neutral Workbench Baseline

**What**: Application shell, page headers, cards, forms, menus, dialogs, and empty states follow a shadcn-style neutral workbench: white or zinc-like surfaces, near-black primary actions, subtle muted backgrounds, 8–10px radii, one-pixel borders, and minimal shadows.

**Why**: This desktop app is a repeated-use operational tool. Decorative gradients, glow effects, oversized title cards, dark feature panels, and heavy shadows make dense pages feel like concept mockups and create a second visual language that is difficult to maintain.

**Example**:
```css
.ui-panel {
  @apply rounded-lg border border-border bg-white;
  box-shadow: 0 1px 2px rgb(24 24 27 / 0.04);
}

.ui-btn-primary {
  @apply rounded-md border border-slate-950 bg-slate-950 text-white hover:bg-slate-800;
}
```

**Related**: Do not add mesh/grid backgrounds, gradient sidebars, colored glow blobs, decorative English eyebrow labels, hover lift transforms, or page-level hero cards. Status colors remain valid for success, warning, danger, and source-specific evidence, but they are not brand surfaces.

### Convention: Responsive App Shell Navigation

**What**: The app shell uses a compact top navigation on small viewports and switches to a fixed left sidebar only at the `lg` breakpoint.

**Why**: The desktop sidebar is too wide for mobile widths and can create page-level horizontal overflow if the grouped navigation keeps fixed minimum widths.

**Example**:
```vue
<div class="flex h-full flex-col lg:flex-row">
  <aside class="flex shrink-0 flex-col border-b lg:w-64 lg:border-b-0 lg:border-r">
    <nav class="grid grid-cols-3 gap-2 lg:flex lg:flex-1 lg:flex-col">
      <section class="min-w-0">...</section>
    </nav>
  </aside>
  <main class="min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
    ...
  </main>
</div>
```

**Related**: After changing shell navigation or page-level panels, smoke test `/jobs` at desktop width and a mobile viewport around `390x844`. The navigation should have `scrollWidth <= clientWidth`, visible text should not extend past the viewport, and the page should have no console errors.

### Convention: Split Setup Pages from Execution Pages

**What**: Workflow configuration pages should own dense setup forms, while execution pages should stay focused on the action controls, current selection, and runtime feedback. When the setup page and execution page need the same draft state, expose that state through one shared composable instance instead of creating independent page-local refs.

**Why**: Users can maintain collection intent, platform settings, and filter profiles once, then switch profiles during collection without re-entering form data. This also prevents route switches from resetting unsaved collection settings.

**Example**:
```ts
let crawlPageState: CrawlPageState | null = null;

export function useCrawlPage(): CrawlPageState {
  const state = crawlPageState ?? createCrawlPageState();
  crawlPageState = state;
  return state;
}
```

**Related**: After splitting a setup page from an execution page, browser-smoke both routes and verify that editing setup state on one route is visible to the execution route.

### Convention: Keep Configuration Copy Short

**What**: Dense setup pages should keep helper text to short, task-oriented phrases instead of multi-sentence explanations or stacked callouts.

**Why**: Long explanatory blocks make configuration pages feel heavier than their job and tend to duplicate the same contract in several places. Short labels and one-line hints keep the page closer to a tool surface.

**Example**:
```vue
<div class="ui-field-label">关键词</div>
<div class="text-[11px] text-content-muted">一行一个关键词。</div>
```

**Related**: Use this with the setup/execution split so the setup page stays compact and the execution page stays focused on runtime feedback.

### Convention: Prefer Compact Setup Panels

**What**: Setup pages should use one clear section per concern, with short labels, short helper lines, and lighter panel chrome.

**Why**: Dense configuration screens get hard to scan when they mix long explanatory blocks, nested cards, and repeated emphasis. A flatter layout keeps the page readable without turning it into a documentation wall.

**Example**:
```vue
<section class="ui-panel overflow-hidden">
  <div class="ui-section-header">
    <h2 class="ui-section-title">范围与来源</h2>
  </div>
  <div class="space-y-4 p-4">...</div>
</section>
```

**Related**: Apply this when simplifying crawl setup, filter profile setup, or any page that mainly edits persisted configuration.

### Convention: Keep Runtime Workspaces Viewport-Efficient

**What**: Execution pages should place source context, the single authoritative run status, runtime parameters, and primary actions in one compact control surface. Group peer metrics into one segmented summary and let the runtime log consume the remaining viewport height with internal scrolling.

**Why**: Tall control cards, duplicated status badges, independent metric cards, and fixed-height logs push the most useful feedback below the fold. A compact command surface keeps the current action understandable while preserving first-viewport space for live output.

**Example**:
```vue
<section class="flex min-h-[calc(100vh-5.25rem)] flex-col gap-3">
  <div class="ui-crawl-panel shrink-0 p-4">...</div>
  <div class="ui-crawl-metrics shrink-0">...</div>
  <div class="ui-log-panel">...</div>
</section>
```

**Related**: Keep status ownership in the action surface rather than repeating it in the log header. Smoke test at `1280x720` and `390x844`; assert the page and its main scroll container have no horizontal overflow, controls do not wrap incoherently, and the log header/body enter the desktop first viewport.

### Convention: Keep Resume Settings Text-Only

**What**: Resume-related settings panels should only expose pasted text input for the editable resume source. Do not keep a separate "current situation" note field or a file-picker path mode in the settings page.

**Why**: The settings page should stay a narrow configuration surface. Extra resume modes add friction without improving the saved settings contract for this app.

**Example**:
```vue
<AiProfileInputs v-model:resumeText="resumeText" />
```

**Related**: If resume file import is needed elsewhere, keep it in the dedicated resume workspace instead of reintroducing it into settings.

### Convention: Keep In-Page Navigation Inside Hash Routes

**What**: On pages rendered by `createWebHashHistory`, use buttons that call `scrollIntoView` for page-local section navigation. Do not use bare links such as `href="#section-id"` inside a route.

**Why**: The URL hash is already owned by Vue Router (`#/settings`). A bare fragment replaces that route hash with `#section-id`, navigates away from the active route, and can leave the app on an unmatched path.

**Example**:
```vue
<button type="button" @click="scrollToSection('settings-model')">模型服务</button>
```

```ts
function scrollToSection(sectionId: string): void {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  document.getElementById(sectionId)?.scrollIntoView({ behavior, block: "start" });
}
```

**Related**: Browser-smoke the interaction and assert the URL remains on the current route after scrolling. Keep section ids unique and add `scroll-margin` when a sticky local navigation bar is present.

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- Keeping mobile navigation as horizontally scrolling fixed-width groups. This can push labels such as `设置` outside the viewport even when the main content is responsive.
- Treating a Chrome headless `--window-size=390,...` screenshot as proof that the CSS viewport is 390px. Chrome may use a larger minimum layout viewport and crop the screenshot, which can make wrapped text look clipped or hide the real overflow source. For mobile shell checks, verify `document.documentElement.scrollWidth <= document.documentElement.clientWidth` with browser/device emulation and only use screenshots as visual confirmation.
- Using `<a href="#section-id">` for settings-page section navigation while the app uses Vue Router hash history. This replaces `#/settings` instead of scrolling within the route; use a button plus `scrollIntoView` and verify the route URL does not change.
