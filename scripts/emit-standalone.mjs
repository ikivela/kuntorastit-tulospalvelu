// Emits dist/standalone after `vinext build`: the built app plus only the
// packages needed at runtime (vinext's prod server and its dependencies), for
// the web Docker image. Run from the repo root: node scripts/emit-standalone.mjs
//
// Uses vinext's own standalone emitter. vinext 0.0.50 lists the server
// bundle's own "assets/…" chunks in dist/server/vinext-externals.json as if
// "assets" were an npm package, which makes the emitter fail; such entries
// (names that are directories of the server build) are dropped first.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const serverDir = path.join(root, "dist", "server");
const manifestPath = path.join(serverDir, "vinext-externals.json");
if (!fs.existsSync(manifestPath)) throw new Error("dist/server/vinext-externals.json not found. Run `vinext build` first.");

const externals = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const packages = externals.filter((name) => !fs.existsSync(path.join(serverDir, name)));
fs.writeFileSync(manifestPath, `${JSON.stringify(packages, null, 2)}\n`);

const emitterPath = path.join(root, "node_modules", "vinext", "dist", "build", "standalone.js");
if (!fs.existsSync(emitterPath)) throw new Error(`vinext standalone emitter not found at ${emitterPath} (vinext version changed?)`);
const { emitStandaloneOutput } = await import(pathToFileURL(emitterPath).href);
const { standaloneDir, copiedPackages } = emitStandaloneOutput({ root, outDir: path.join(root, "dist") });
console.log(`Standalone output in ${path.relative(root, standaloneDir)}/ with ${copiedPackages.length} runtime packages: ${copiedPackages.sort().join(", ")}`);
