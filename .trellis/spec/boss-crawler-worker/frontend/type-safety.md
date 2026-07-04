# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

(To be filled by the team)

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

(To be filled by the team)

---

## Validation

- Worker event schemas are owned by `packages/boss-crawler-worker/src/protocol.ts`.
  Stable cross-layer fields must be represented with the same finite value set
  in the frontend type layer and Rust IPC layer. For example,
  `JOB_LIST_CAPTURED.payload.capture_source` is:
  - worker Zod enum: `natural | dom_fallback | api_fallback`;
  - frontend union: `"natural" | "dom_fallback" | "api_fallback"`;
  - Rust serde enum: `BossJobListCaptureSource`.
- Rust IPC must reject unknown stable enum values at deserialization time. Do
  not protect `Option<String>` with contract tests when the field has a known
  finite set.

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

(To be filled by the team)

---

## Forbidden Patterns

- Do not add new stringly typed Rust IPC fields for stable worker/frontend
  enums. Add a serde enum and a unit test that accepts known wire values and
  rejects unknown values.
