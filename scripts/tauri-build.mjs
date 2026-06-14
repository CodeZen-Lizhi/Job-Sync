import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseRuntimeDir = path.join(projectRoot, "src-tauri", "target", "release", "bin");
const appOnly = process.argv.includes("--app-only");
const staleBundledRuntimeResources = [
  path.join(releaseRuntimeDir, "node"),
  path.join(releaseRuntimeDir, "node.exe"),
  path.join(releaseRuntimeDir, "boss-crawler-worker"),
];

async function removeStaleBundledRuntimeResources() {
  await Promise.all(
    staleBundledRuntimeResources.map((resourcePath) =>
      fs.rm(resourcePath, { force: true, recursive: true }),
    ),
  );
}

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
  await removeStaleBundledRuntimeResources();
  await runCommand("tauri", [
    "build",
    ...(appOnly ? ["--bundles", "app"] : []),
    "--config",
    "src-tauri/tauri.conf.release.json",
  ]);
  await runCommand(process.execPath, [
    "scripts/verify-release-bundle.mjs",
    ...(appOnly ? ["--app-only"] : []),
  ]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
