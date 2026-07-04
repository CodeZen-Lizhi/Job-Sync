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

### Convention: Keep Resume Settings Text-Only

**What**: Resume-related settings panels should only expose pasted text input for the editable resume source. Do not keep a separate "current situation" note field or a file-picker path mode in the settings page.

**Why**: The settings page should stay a narrow configuration surface. Extra resume modes add friction without improving the saved settings contract for this app.

**Example**:
```vue
<AiProfileInputs v-model:resumeText="resumeText" />
```

**Related**: If resume file import is needed elsewhere, keep it in the dedicated resume workspace instead of reintroducing it into settings.

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- Keeping mobile navigation as horizontally scrolling fixed-width groups. This can push labels such as `设置` outside the viewport even when the main content is responsive.
- Treating a Chrome headless `--window-size=390,...` screenshot as proof that the CSS viewport is 390px. Chrome may use a larger minimum layout viewport and crop the screenshot, which can make wrapped text look clipped or hide the real overflow source. For mobile shell checks, verify `document.documentElement.scrollWidth <= document.documentElement.clientWidth` with browser/device emulation and only use screenshots as visual confirmation.
