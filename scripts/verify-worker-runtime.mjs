import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const projectRoot = process.cwd();
const runtimeDir = path.resolve(projectRoot, process.argv[2] ?? "src-tauri/bin");
const workerExe = path.join(runtimeDir, "boss-crawler-worker.exe");
const nodeRuntime = path.join(runtimeDir, process.platform === "win32" ? "node.exe" : "node");
const workerDir = path.join(runtimeDir, "boss-crawler-worker");
const workerEntry = path.join(workerDir, "dist", "main.js");
const lifecycleTimeoutMs = Number.parseInt(process.env.JOB_SYNC_WORKER_VERIFY_TIMEOUT_MS ?? "15000", 10);

function runtimeCommand() {
  if (process.platform === "win32" && process.env.ComSpec) {
    if (exists(workerExe)) {
      return { command: workerExe, args: [], cwd: runtimeDir };
    }
  }

  if (exists(nodeRuntime) && exists(workerEntry)) {
    return { command: nodeRuntime, args: [workerEntry], cwd: workerDir };
  }

  throw new Error(`No runnable staged worker runtime found in ${runtimeDir}`);
}

function exists(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

function isStartupEvent(event) {
  return event?.type === "LOG" && event?.payload?.message === "boss-crawler-worker started";
}

function isStopAckEvent(event) {
  return event?.type === "LOG" && event?.payload?.message === "STOP received";
}

function verifyLifecycle() {
  const { command, args, cwd } = runtimeCommand();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    // Keep the worker stdin pipe open until the startup log has been observed.
    // The worker ignores blank lines, and the real STOP handshake below proves commands are accepted.
    child.stdin.write("\n");

    const events = [];
    let stderr = "";
    let settled = false;
    let stopSent = false;
    let stdinClosed = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `Timed out waiting for worker runtime lifecycle.\nEVENTS:\n${JSON.stringify(events, null, 2)}\nSTDERR:\n${stderr}`,
        ),
      );
    }, Number.isFinite(lifecycleTimeoutMs) && lifecycleTimeoutMs > 0 ? lifecycleTimeoutMs : 15000);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdout.on("line", (line) => {
      try {
        const event = JSON.parse(line);
        events.push(event);

        if (!stopSent && isStartupEvent(event)) {
          stopSent = true;
          setTimeout(() => {
            if (settled) return;
            child.stdin.write(`${JSON.stringify({ type: "STOP" })}\n`);
          }, 100);
          return;
        }

        if (!stdinClosed && isStopAckEvent(event)) {
          stdinClosed = true;
          setTimeout(() => {
            if (settled) return;
            child.stdin.end();
          }, 50);
        }
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

    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.close();

      const sawStartup = events.some(isStartupEvent);
      const sawStopAck = events.some(isStopAckEvent);
      const sawFinished = events.some((event) => event?.type === "FINISHED");
      const parseErrors = events.filter((event) => event?.type === "__PARSE_ERROR__");

      if (code === 0 && sawStartup && sawStopAck && sawFinished && parseErrors.length === 0) {
        resolve({ events, stderr, command, args, cwd });
        return;
      }

      reject(
        new Error(
          [
            `Worker runtime lifecycle check failed. code=${code} signal=${signal ?? "none"}`,
            `startup=${sawStartup} stop_ack=${sawStopAck} finished=${sawFinished} parse_errors=${parseErrors.length}`,
            `EVENTS:\n${JSON.stringify(events, null, 2)}`,
            `STDERR:\n${stderr}`,
          ].join("\n"),
        ),
      );
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

verifyLifecycle()
  .then(({ command, args, cwd }) => {
    console.log(`Worker runtime OK: ${command} ${args.join(" ")} (cwd=${cwd})`);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
