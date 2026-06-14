import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.release.json");
const bundleRootDir = path.join(projectRoot, "src-tauri", "target", "release", "bundle");
const appOnly = process.argv.includes("--app-only");

function runCommand(command, args, options = {}) {
  const { cwd = projectRoot, env = process.env } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: "inherit",
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

async function readReleaseConfig() {
  const raw = await fs.readFile(releaseConfigPath, "utf8");
  return JSON.parse(raw);
}

async function ensureFileExists(filePath, label) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`${label} is not a file: ${filePath}`);
    }
  } catch {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

async function ensureDirectoryExists(dirPath, label) {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`${label} is not a directory: ${dirPath}`);
    }
  } catch {
    throw new Error(`${label} not found: ${dirPath}`);
  }
}

async function listDmgFiles() {
  const dmgDir = path.join(bundleRootDir, "dmg");

  try {
    const entries = await fs.readdir(dmgDir);
    return entries.filter((entry) => entry.endsWith(".dmg")).map((entry) => path.join(dmgDir, entry));
  } catch {
    return [];
  }
}

async function verifyMacOsBundle() {
  const config = await readReleaseConfig();
  const productName = config.productName;

  if (typeof productName !== "string" || productName.length === 0) {
    throw new Error("missing productName in src-tauri/tauri.conf.release.json");
  }

  const appPath = path.join(bundleRootDir, "macos", `${productName}.app`);
  const resourcesBinDir = path.join(appPath, "Contents", "Resources", "bin");
  const bundledNodePath = path.join(resourcesBinDir, "node");
  const bundledWorkerEntryPath = path.join(resourcesBinDir, "boss-crawler-worker", "dist", "main.js");
  const dmgFiles = await listDmgFiles();

  await ensureDirectoryExists(appPath, "macOS app bundle");
  await ensureDirectoryExists(resourcesBinDir, "bundled worker runtime directory");
  await ensureFileExists(bundledNodePath, "bundled node runtime");
  await ensureFileExists(bundledWorkerEntryPath, "bundled worker entry file");

  await runCommand("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
  await runCommand(process.execPath, ["scripts/verify-worker-runtime.mjs", resourcesBinDir]);

  if (appOnly) {
    process.stdout.write("Skipping DMG verification for app-only macOS bundle.\n");
    return;
  }

  if (dmgFiles.length === 0) {
    throw new Error(`No macOS DMG found in ${path.join(bundleRootDir, "dmg")}`);
  }

  for (const dmgPath of dmgFiles) {
    await runCommand("hdiutil", ["verify", dmgPath]);
  }
}

async function main() {
  if (process.platform !== "darwin") {
    process.stdout.write("Skipping macOS release bundle verification on this platform.\n");
    return;
  }

  await verifyMacOsBundle();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
