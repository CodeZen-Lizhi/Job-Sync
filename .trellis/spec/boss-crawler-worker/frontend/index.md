# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains guidelines for frontend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | To fill |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, data fetching patterns | To fill |
| [State Management](./state-management.md) | Local state, global state, server state | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Performance Boundary Contracts](./performance-boundary-contracts.md) | Jobs/resume list-detail payload and projection contracts | Active |
| [Type Safety](./type-safety.md) | Type patterns, validation | To fill |
| [External Dependency Diagnostics](./external-dependency-diagnostics.md) | Settings IPC contract for local dependency diagnostics | Active |
| [Collection Source Contracts](./collection-source-contracts.md) | Cross-layer automatic collection source contracts | Active |
| [AI Prompt Contracts](./ai-prompt-contracts.md) | User-owned prompt sources and worker injection boundaries | Active |
| [Scheduled Crawl Contracts](./scheduled-crawl-contracts.md) | Tauri background wake-up and due-event contract | Active |

---

## Pre-Development Checklist

- For collection source selection, platform capabilities, `crawl_auto_start`, worker collection events, or unified job writes, read [Collection Source Contracts](./collection-source-contracts.md).
- For AI settings, prompt assembly, structured output contracts, or post-collection judgement, read [AI Prompt Contracts](./ai-prompt-contracts.md).
- For Jobs/Resume library list payloads, large JSON movement, projection refresh,
  cursor pagination, or resume body-on-demand work, read
  [Performance Boundary Contracts](./performance-boundary-contracts.md).

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
