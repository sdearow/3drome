#!/usr/bin/env node
/**
 * Vendor the CesiumJS build into app/vendor/cesium.
 *
 * The library is vendored rather than loaded from a CDN because the machines this
 * runs on sit behind a corporate proxy that blocks public CDNs, and because a
 * vendored copy means the application keeps working with no network at all except
 * for the streamed tiles themselves.
 *
 *   node tools/setup_cesium.mjs
 *
 * If npm is unavailable, download the CesiumJS release zip from
 * https://github.com/CesiumGS/cesium/releases, unzip it, and copy its
 * Build/Cesium directory to app/vendor/cesium. The result is identical.
 */

import { cp, mkdir, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/cesium/Build/Cesium");
const target = resolve(root, "app/vendor/cesium");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(source))) {
  console.log("Cesium not found in node_modules — installing…");
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit" });
}

if (!(await exists(source))) {
  console.error(`Could not find ${source}. See the header of this file for the manual route.`);
  process.exit(1);
}

await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Vendored CesiumJS into ${target}`);
