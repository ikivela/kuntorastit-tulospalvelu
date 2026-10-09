// Builds the Tauri app for the API in VITE_API_BASE_URL (environment
// variable, or the repo root .env.production) and allows that API origin in
// the app's Content-Security-Policy, which otherwise only permits
// localhost:3001. tauri.conf.json itself is not modified: the CSP is passed
// as a `tauri build --config` override.
//
//   npm run tauri:build               # extra args go to `tauri build`
//   npm run tauri:build -- --dry-run  # only print the API URL and CSP
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(clientDir, "..", "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const apiBase = (process.env.VITE_API_BASE_URL || loadEnv("production", repoRoot, "VITE_").VITE_API_BASE_URL || "").trim();
if (!apiBase) {
  const message = "VITE_API_BASE_URL is not set (environment or .env.production): the client would talk to http://localhost:3001.";
  if (process.env.CI) { console.error(`Error: ${message} Set the repository variable VITE_API_BASE_URL.`); process.exit(1); }
  console.warn(`Warning: ${message}`);
}

let origin = "http://localhost:3001";
if (apiBase) {
  try { origin = new URL(apiBase).origin; } catch { console.error(`Error: VITE_API_BASE_URL "${apiBase}" is not a valid URL.`); process.exit(1); }
}

const config = JSON.parse(fs.readFileSync(path.join(clientDir, "src-tauri", "tauri.conf.json"), "utf8"));
const csp = String(config.app?.security?.csp ?? "").replace(/connect-src ([^;]*)/, (directive, sources) => sources.split(/\s+/).includes(origin) ? directive : `connect-src ${sources} ${origin}`);
console.log(`API: ${apiBase || "(default) http://localhost:3001/api/v1"}\nCSP: ${csp}`);
if (dryRun) process.exit(0);

const overridePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tauri-build-")), "csp.json");
fs.writeFileSync(overridePath, JSON.stringify({ app: { security: { csp } } }));
const result = spawnSync("npx", ["tauri", "build", "--config", overridePath, ...args], {
  cwd: clientDir,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: apiBase ? { ...process.env, VITE_API_BASE_URL: apiBase } : process.env,
});
process.exit(result.status ?? 1);
