import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { invoke, isTauri } from "./tauri";

export const CRAWL_SCHEDULE_EVENT = "crawl-schedule://due";

export interface CrawlScheduleDueEvent {
  version: number;
  generation: number;
  scheduled_at_ms: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCrawlScheduleDueEvent(value: unknown): value is CrawlScheduleDueEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    isFiniteNumber(event.version) &&
    isFiniteNumber(event.generation) &&
    isFiniteNumber(event.scheduled_at_ms)
  );
}

export function updateCrawlSchedule(nextRunAtMs: number | null, requestVersion: number): Promise<void> {
  return invoke<void>("update_crawl_schedule", {
    nextRunAtMs,
    requestVersion,
  });
}

export async function listenToCrawlScheduleDue(
  onDue: (event: CrawlScheduleDueEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return await listen<unknown>(CRAWL_SCHEDULE_EVENT, (event) => {
    if (!isCrawlScheduleDueEvent(event.payload)) return;
    onDue(event.payload);
  });
}
