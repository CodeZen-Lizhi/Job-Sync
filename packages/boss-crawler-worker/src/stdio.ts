import { stdin, stdout } from "node:process";

import { CommandInSchema, type CommandIn, type EventOut } from "./protocol.js";

export function emitEvent(event: EventOut): void {
  stdout.write(`${JSON.stringify(event)}\n`);
}

export function readCommands(onCommand: (cmd: CommandIn) => void, onClose?: () => void): void {
  let buffer = "";
  let finished = false;

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed = CommandInSchema.safeParse(JSON.parse(trimmed));
      if (!parsed.success) {
        emitEvent({
          type: "ERROR",
          payload: {
            message: "Invalid command schema",
            stack: parsed.error.toString(),
          },
        });
        return;
      }
      onCommand(parsed.data);
    } catch (err) {
      emitEvent({
        type: "ERROR",
        payload: {
          message: "Failed to parse command JSON",
          stack: err instanceof Error ? err.stack : String(err),
        },
      });
    }
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    if (buffer) {
      handleLine(buffer.replace(/\r$/, ""));
      buffer = "";
    }
    onClose?.();
  }

  stdin.setEncoding("utf8");

  stdin.on("data", (chunk: string) => {
    buffer += chunk;
    // Split only on LF; node:readline also treats U+2028/U+2029 as line breaks.
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  stdin.on("end", finish);
  stdin.on("close", finish);
}
