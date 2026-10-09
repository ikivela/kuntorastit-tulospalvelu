// Builds the Tauri app with VITE_API_BASE_URL (environment variable, or the
// repo root .env.production) as the default API address. Users can change
// the address afterwards in the app's Asetukset, so the CSP allows any
// http(s) origin and needs no build-time override.
//
//   npm run tauri:build               # extra args go to `tauri build`
//   npm run tauri:build -- --dry-run  # only print the default API address
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(clientDir, "..", "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

const apiBase = (process.env.VITE_API_BASE_URL || loadEnv("production", repoRoot, "VITE_").VITE_API_BASE_URL || "").trim();
if (!apiBase) {
  const message = "VITE_API_BASE_URL is not set (environment or .env.production): the client defaults to http://localhost:3001.";
  if (process.env.CI) { console.error(`Error: ${message} Set the repository variable VITE_API_BASE_URL.`); process.exit(1); }
  console.warn(`Warning: ${message}`);
}
if (apiBase) {
  try { new URL(apiBase); } catch { console.error(`Error: VITE_API_BASE_URL "${apiBase}" is not a valid URL.`); process.exit(1); }
}

console.log(`Default API: ${apiBase || "http://localhost:3001/api/v1"}`);
if (dryRun) process.exit(0);

const result = spawnSync("npx", ["tauri", "build", ...args], {
  cwd: clientDir,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: apiBase ? { ...process.env, VITE_API_BASE_URL: apiBase } : process.env,
});
process.exit(result.status ?? 1);
