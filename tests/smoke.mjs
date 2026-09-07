#!/usr/bin/env node
/**
 * Headless smoke test.
 *
 * It answers one question: does the scene actually build, with the geometry in the
 * right place, when nobody is watching? It runs without a Cesium ion token, so it
 * exercises the geometry-only path — which is also the path that must keep working
 * when the token expires or the network is closed.
 *
 *   node tests/smoke.mjs
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "app");
const PORT = 8137;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".ktx2": "image/ktx2",
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, rel === "/" ? "index.html" : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise((r) => server.listen(PORT, r));

const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log("\nRome corridor explorer — smoke test\n");

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 45000 });

const ready = await page.evaluate(() => document.body.dataset.ready);
check("application reaches a ready state", ready === "true", `state was "${ready}"`);

const report = await page.evaluate(() => {
  const s = window.__scene;
  if (!s) return null;
  const f = s.frame;
  const mid = f.toDegrees(f.length / 2, 0);
  return {
    axisLength: f.length,
    headingDeg: (f.heading * 180) / Math.PI,
    midpoint: mid,
    existingCount: s.entities.existing.length,
    proposedCount: s.entities.proposed.length,
    totalEntities: s.viewer.entities.values.length,
    mode: s.mode,
    // Round-trip a known corridor coordinate through the globe and back.
    roundTrip: f.fromCartesian(f.toCartesian(123.4, -5.6, 0)),
    scheduleRows: document.querySelectorAll("#scheduleBody tr").length,
  };
});

check("scene object is exposed", report !== null);

if (report) {
  check(
    "corridor axis length is plausible for the configured endpoints",
    report.axisLength > 400 && report.axisLength < 700,
    `${report.axisLength.toFixed(1)} m`,
  );
  check(
    "corridor heading points south-east",
    report.headingDeg > 100 && report.headingDeg < 160,
    `${report.headingDeg.toFixed(1)}°`,
  );
  check(
    "corridor midpoint lands in central Rome",
    Math.abs(report.midpoint.latitude - 41.893) < 0.01 &&
      Math.abs(report.midpoint.longitude - 12.487) < 0.01,
    `${report.midpoint.latitude.toFixed(5)}, ${report.midpoint.longitude.toFixed(5)}`,
  );
  check(
    "station/offset round-trips to within a millimetre",
    Math.abs(report.roundTrip.station - 123.4) < 0.001 &&
      Math.abs(report.roundTrip.offset + 5.6) < 0.001,
    `got ${report.roundTrip.station.toFixed(4)}, ${report.roundTrip.offset.toFixed(4)}`,
  );
  check("existing cross-section built", report.existingCount > 0, `${report.existingCount}`);
  check("proposed cross-section and elements built", report.proposedCount > 20, `${report.proposedCount}`);
  check("schedule table populated", report.scheduleRows > 0, `${report.scheduleRows} rows`);
  check("proposed scenario shown by default", report.mode === "proposed");
}

// The cross-section must tile the corridor, and the headline figures must be the
// ones the design intends — this is the check that stops the table and the geometry
// drifting apart.
const section = await page.evaluate(async () => {
  const { carriagewayExtent } = await import("./src/elements.js");
  const { config } = await import("./src/config.js");
  const span = (bands) => Math.max(...bands.map((b) => b.to)) - Math.min(...bands.map((b) => b.from));
  return {
    problems: window.__scene.sectionProblems,
    existing: carriagewayExtent(config.crossSection.existing),
    proposed: carriagewayExtent(config.crossSection.proposed),
    existingSpan: span(config.crossSection.existing),
    proposedSpan: span(config.crossSection.proposed),
  };
});

check(
  "cross-sections tile without gaps or overlaps",
  section.problems.length === 0,
  section.problems.join("; "),
);
check(
  "both scenarios occupy the same corridor width",
  Math.abs(section.existingSpan - section.proposedSpan) < 1e-6,
  `${section.existingSpan} vs ${section.proposedSpan}`,
);
check(
  "carriageway narrows from 18.00 m to 13.00 m",
  Math.abs(section.existing.width - 18) < 1e-6 && Math.abs(section.proposed.width - 13) < 1e-6,
  `${section.existing.width} -> ${section.proposed.width}`,
);
check(
  "proposed lane width is 3.25 m",
  Math.abs(section.proposed.laneWidth - 3.25) < 1e-6,
  `${section.proposed.laneWidth}`,
);
check(
  "lane count is unchanged at 4",
  section.existing.lanes === 4 && section.proposed.lanes === 4,
  `${section.existing.lanes} -> ${section.proposed.lanes}`,
);

// Capture the opening view before anything is toggled: this is what a reviewer sees.
await page.waitForTimeout(2500);
await page.screenshot({ path: "tests/output/default-view.png" }).catch(() => {});

// Before/after toggle actually changes what is visible.
await page.click("#modeToggle");
const afterToggle = await page.evaluate(() => {
  const s = window.__scene;
  return {
    mode: s.mode,
    existingVisible: s.entities.existing.every((e) => e.show),
    proposedVisible: s.entities.proposed.some((e) => e.show),
  };
});
check("toggle switches to the existing layout", afterToggle.mode === "existing");
check("existing entities become visible", afterToggle.existingVisible);
check("proposed entities are hidden", !afterToggle.proposedVisible);

// Day/night toggle moves the clock.
const daylight = await page.evaluate(() => {
  const s = window.__scene;
  const before = window.Cesium.JulianDate.toIso8601(s.viewer.clock.currentTime);
  s.toggleDaylight();
  return { before, after: window.Cesium.JulianDate.toIso8601(s.viewer.clock.currentTime), mode: s.daylight };
});
check("day/night toggle moves the sun", daylight.before !== daylight.after, `${daylight.before} -> ${daylight.after}`);
check("day/night toggle reports night", daylight.mode === "night");

// Exports generate parseable output carrying the provenance.
const exports = await page.evaluate(async () => {
  const { elementsToGeoJson, crossSectionCsv } = await import("./src/export.js");
  const { config } = await import("./src/config.js");
  const gj = elementsToGeoJson(window.__scene.frame, config);
  return {
    featureCount: gj.features.length,
    hasStatus: gj.metadata.status === "prototype",
    firstCoords: gj.features[0]?.geometry?.coordinates,
    csvLines: crossSectionCsv(config).split("\n").length,
  };
});
check("GeoJSON export produces features", exports.featureCount > 5, `${exports.featureCount}`);
check("GeoJSON export carries provenance", exports.hasStatus);
check(
  "GeoJSON coordinates are in Rome",
  Math.abs(exports.firstCoords[0] - 12.487) < 0.02 && Math.abs(exports.firstCoords[1] - 41.893) < 0.02,
  JSON.stringify(exports.firstCoords),
);
check("CSV export has a row per band plus header", exports.csvLines >= 8, `${exports.csvLines}`);

// WebGL warnings from the software rasteriser are expected and not interesting.
const realErrors = consoleErrors.filter(
  (t) => !/swiftshader|GroupMarkerNotSet|Fallback|WebGL|GL_|performance caveat/i.test(t),
);
check("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await page.screenshot({ path: "tests/output/smoke.png" }).catch(() => {});

await browser.close();
server.close();

console.log(
  failures.length === 0
    ? "\nAll checks passed.\n"
    : `\n${failures.length} check(s) failed: ${failures.join(", ")}\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
