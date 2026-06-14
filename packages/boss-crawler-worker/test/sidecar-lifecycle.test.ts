import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

type WorkerEvent = {
  type: string;
  payload?: {
    level?: string;
    message?: string;
    stack?: string;
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function waitForEvent(
  events: WorkerEvent[],
  predicate: (event: WorkerEvent) => boolean,
  label: string,
  timeoutMs = 3_000,
): Promise<WorkerEvent> {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolvePromise, reject) => {
    const interval = setInterval(() => {
      const event = events.find(predicate);
      if (!event) return;
      cleanup();
      resolvePromise(event);
    }, 20);

    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Timed out waiting for worker event: ${label}. Seen events: ${JSON.stringify(events)}`,
        ),
      );
    }, timeoutMs);

    function cleanup(): void {
      clearInterval(interval);
      clearTimeout(timeout);
    }
  });
}

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 3_000): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolvePromise(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function isLogMessage(message: RegExp): (event: WorkerEvent) => boolean {
  return (event) => event.type === "LOG" && message.test(event.payload?.message ?? "");
}

describe("worker stdio lifecycle", () => {
  it("starts with local Node, receives STOP, and emits lifecycle events", async () => {
    const workerEntry = resolve(__dirname, "../../dist/main.js");
    const workerRoot = resolve(__dirname, "../..");
    const events: WorkerEvent[] = [];
    let stderr = "";
    let exited = false;

    const child = spawn(process.execPath, [workerEntry], {
      cwd: workerRoot,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolvePromise) => {
        child.once("exit", (code, signal) => {
          resolvePromise({ code, signal });
        });
      },
    );

    exitPromise.then(() => {
      exited = true;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdout.on("line", (line) => {
      try {
        events.push(JSON.parse(line) as WorkerEvent);
      } catch (error) {
        events.push({
          type: "__PARSE_ERROR__",
          payload: {
            message: line,
            stack: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });

    try {
      await waitForEvent(events, isLogMessage(/boss-crawler-worker started/), "worker started");

      child.stdin.write(`${JSON.stringify({ type: "STOP" })}\n`);
      await waitForEvent(events, isLogMessage(/STOP received/), "STOP acknowledgement");

      child.stdin.end();
      await waitForEvent(events, (event) => event.type === "FINISHED", "FINISHED");

      const exit = await withTimeout(exitPromise, "worker process exit");
      assert.equal(exit.code, 0, stderr);
      assert.equal(exit.signal, null, stderr);
      assert.deepEqual(
        events.filter((event) => event.type === "__PARSE_ERROR__"),
        [],
      );
    } finally {
      stdout.close();
      if (!exited) child.kill("SIGINT");
    }
  });
});
