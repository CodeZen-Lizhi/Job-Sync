import type { CommandIn, EventOut } from "./protocol.js";
import { emitEvent, readCommands } from "./stdio.js";
import {
  runAiMode,
  runAiGroupMode,
  runAiGreetingMode,
  runAiOptimizeResumeForJobMode,
  runAiCompanyScoreBatchMode,
  runAiPostCollectionJudgeBatchMode,
  runAiPostCollectionJudgeMode,
} from "./modes/ai.js";
import { runAutoMode } from "./modes/auto.js";
import { runRefreshJobEvidenceMode } from "./modes/evidenceRefresh.js";
import { runBossChatSyncMode } from "./modes/chatSync.js";
import { runLoginMode } from "./modes/login.js";
import { runBossMetaSyncMode } from "./modes/meta.js";

type Running = {
  controller: AbortController;
  done: Promise<void>;
};

function safeError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

function createContext(controller: AbortController): { emit: (e: EventOut) => void; signal: AbortSignal } {
  return {
    emit: emitWorkerEvent,
    signal: controller.signal,
  };
}

let running: Running | null = null;
let finishedEmitted = false;

function emitWorkerEvent(event: EventOut): void {
  if (event.type === "FINISHED") finishedEmitted = true;
  emitEvent(event);
}

function stopRunning(): Promise<void> | null {
  const current = running;
  if (!current) return null;
  current.controller.abort();
  running = null;
  return current.done;
}

async function stopRunningAndWait(): Promise<void> {
  const done = stopRunning();
  if (!done) return;
  await done.catch((err) => {
    emitWorkerEvent({ type: "ERROR", payload: safeError(err) });
  });
}

function finishIfNeeded(): void {
  if (finishedEmitted) return;
  emitWorkerEvent({ type: "FINISHED" });
}

async function startMode(run: (payload: any, ctx: any) => Promise<void>, payload: any): Promise<void> {
  await stopRunningAndWait();
  finishedEmitted = false;
  const controller = new AbortController();
  const ctx = createContext(controller);
  const done = run(payload, ctx).catch((err) => {
    emitWorkerEvent({ type: "ERROR", payload: safeError(err) });
  });
  running = { controller, done };
  await done;
  if (running?.done === done) running = null;
  finishIfNeeded();
}

emitWorkerEvent({ type: "LOG", payload: { level: "info", message: "boss-crawler-worker started" } });

readCommands((cmd: CommandIn) => {
  void (async () => {
    switch (cmd.type) {
      case "LOGIN_START":
        await startMode(runLoginMode, cmd.payload);
        return;
      case "CRAWL_AUTO_START":
        await startMode(runAutoMode, cmd.payload);
        return;
      case "REFRESH_JOB_EVIDENCE":
        await startMode(runRefreshJobEvidenceMode, cmd.payload);
        return;
      case "BOSS_META_SYNC":
        await startMode(runBossMetaSyncMode, cmd.payload);
        return;
      case "BOSS_CHAT_SYNC":
        await startMode(runBossChatSyncMode, cmd.payload);
        return;
      case "AI_ANALYZE":
        await startMode(runAiMode, cmd.payload);
        return;
      case "AI_ANALYZE_GROUP":
        await startMode(runAiGroupMode, cmd.payload);
        return;
      case "AI_GREETING":
        await startMode(runAiGreetingMode, cmd.payload);
        return;
      case "AI_OPTIMIZE_RESUME_FOR_JOB":
        await startMode(runAiOptimizeResumeForJobMode, cmd.payload);
        return;
      case "AI_COMPANY_SCORE_BATCH":
        await startMode(runAiCompanyScoreBatchMode, cmd.payload);
        return;
      case "AI_POST_COLLECTION_JUDGE":
        await startMode(runAiPostCollectionJudgeMode, cmd.payload);
        return;
      case "AI_POST_COLLECTION_JUDGE_BATCH":
        await startMode(runAiPostCollectionJudgeBatchMode, cmd.payload);
        return;
      case "STOP":
        stopRunning();
        emitWorkerEvent({ type: "LOG", payload: { level: "info", message: "STOP received" } });
        return;
      case "PAUSE":
        emitWorkerEvent({ type: "LOG", payload: { level: "warn", message: "PAUSE not implemented in V1" } });
        return;
      case "RESUME":
        emitWorkerEvent({ type: "LOG", payload: { level: "warn", message: "RESUME not implemented in V1" } });
        return;
      default:
        emitWorkerEvent({ type: "ERROR", payload: { message: `Unknown command type: ${(cmd as any).type}` } });
    }
  })();
}, () => {
  void (async () => {
    await stopRunningAndWait();
    finishIfNeeded();
  })();
});

process.on("SIGINT", () => {
  stopRunning();
  finishIfNeeded();
  process.exit(0);
});
