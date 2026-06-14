import { spawn } from "node:child_process";
import process from "node:process";

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

async function main() {
  await runCommand("npm", ["run", "tauri:build"]);

  if (process.platform === "win32") {
    await runCommand("npm", ["run", "tauri:build:portable:only"]);
  } else {
    process.stdout.write("Skipping Windows portable ZIP packaging on this platform.\n");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
