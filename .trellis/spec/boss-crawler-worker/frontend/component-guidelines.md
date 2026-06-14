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

---

## Accessibility

<!-- A11y requirements and patterns -->

(To be filled by the team)

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- Keeping mobile navigation as horizontally scrolling fixed-width groups. This can push labels such as `设置` outside the viewport even when the main content is responsive.
