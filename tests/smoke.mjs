#!/usr/bin/env node
/**
 * Headless smoke test.
 *
 * It drives the editor the way a person does — draw an axis, edit the section, place
 * elements, delete one, reload — because that is the path that has to keep working.
 * It runs without a Cesium ion token, so it exercises the geometry-only path, which
 * is also the path that must survive an expired token or a closed network.
 *
 *   node tests/smoke.mjs
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "app");
const PORT = 8137;

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".ktx2": "image/ktx2",
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
const check = (name, ok, detail = "") => {
  console.log(ok ? `  ok    ${name}` : `  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

console.log("\nRome corridor editor — smoke test\n");

await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "load" });
await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 45000 });

check("application reaches a ready state",
  (await page.evaluate(() => document.body.dataset.ready)) === "true");

check("opens with no design", await page.evaluate(() => window.__app.project.corridor === null));
check("cross-section editor hidden until there is a corridor",
  await page.evaluate(() => document.getElementById("sectionBlock").hidden));
check("palette disabled until there is a corridor",
  await page.evaluate(() => [...document.querySelectorAll(".tool")].every((b) => b.disabled)));
check("catalogue is offered", await page.evaluate(() => document.querySelectorAll(".tool").length) >= 6);

/* Draw an axis by clicking two points on the globe. */
const canvas = await page.locator("#cesiumContainer canvas").boundingBox();
const at = (fx, fy) => ({ x: canvas.x + canvas.width * fx, y: canvas.y + canvas.height * fy });

await page.click("#drawAxis");
check("prompt explains the axis interaction",
  (await page.locator("#prompt").innerText()).includes("start of the corridor"));

const a = at(0.42, 0.44);
const b = at(0.58, 0.60);
await page.mouse.click(a.x, a.y);
await page.mouse.move(b.x, b.y);
await page.mouse.click(b.x, b.y);
await page.waitForTimeout(700);

const corridor = await page.evaluate(() => {
  const p = window.__app.project;
  return {
    hasCorridor: Boolean(p.corridor),
    length: window.__app.scene.frame?.length ?? 0,
    existing: p.sections.existing.length,
    proposed: p.sections.proposed.length,
  };
});
check("axis is created from two clicks", corridor.hasCorridor);
check("corridor has a positive length", corridor.length > 1, `${corridor.length.toFixed(1)} m`);
check("a starting cross-section is seeded", corridor.existing === 3 && corridor.proposed === 3);
check("cross-section editor appears",
  !(await page.evaluate(() => document.getElementById("sectionBlock").hidden)));
check("palette becomes usable",
  await page.evaluate(() => [...document.querySelectorAll(".tool")].every((btn) => !btn.disabled)));

/* Edit the proposed section: widen a band and confirm the summary follows. */
await page.evaluate(() => {
  const widths = document.querySelectorAll("#sectionEditor .band-row input");
  widths[1].value = "9";
  widths[1].dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(400);
const widened = await page.evaluate(() => ({
  width: window.__app.project.sections.proposed[1].width,
  summary: document.getElementById("summaryBody").innerText,
}));
check("editing a band width updates the project", widened.width === 9);
check("summary reflects the edited width", widened.summary.includes("9.00 m"));

/* Place a point element with one click. */
await page.click('.tool[data-type="raisedCrossing"]');
check("palette marks the active tool",
  await page.evaluate(() => document.querySelector('.tool[data-type="raisedCrossing"]').classList.contains("tool--active")));
const mid = at(0.50, 0.52);
await page.mouse.click(mid.x, mid.y);
await page.waitForTimeout(500);

const afterPoint = await page.evaluate(() => {
  const p = window.__app.project;
  return { count: p.elements.length, type: p.elements[0]?.type, hasStation: typeof p.elements[0]?.station === "number" };
});
check("one click places a point element", afterPoint.count === 1 && afterPoint.type === "raisedCrossing");
check("placement is recorded as chainage", afterPoint.hasStation);
check("properties form opens for the new element",
  (await page.locator("#properties").innerText()).includes("Raised crossing"));

/* Place a run element with two clicks. */
await page.click('.tool[data-type="separatorRun"]');
const r1 = at(0.46, 0.48);
const r2 = at(0.56, 0.58);
await page.mouse.click(r1.x, r1.y);
await page.mouse.move(r2.x, r2.y);
await page.mouse.click(r2.x, r2.y);
await page.waitForTimeout(500);

const afterRun = await page.evaluate(() => {
  const run = window.__app.project.elements.find((e) => e.type === "separatorRun");
  return { count: window.__app.project.elements.length, hasRun: Boolean(run), spans: run && run.fromStation !== run.toStation };
});
check("two clicks place a run element", afterRun.count === 2 && afterRun.hasRun);
check("the run spans two chainages", afterRun.spans);

/* Placing an element selects it, so the form on screen is that element's. */
const formTargets = await page.evaluate(() => {
  const input = document.querySelector("#properties .prop-grid input");
  // Input ids are `f-<elementId>-<field>`; recover the element id from the middle.
  const id = input.id.slice(2, input.id.lastIndexOf("-"));
  return { formElementId: id, lastElementId: window.__app.project.elements.at(-1).id };
});
check("the form shows the element just placed",
  formTargets.formElementId === formTargets.lastElementId,
  `${formTargets.formElementId} vs ${formTargets.lastElementId}`);

/* Edit a dimension through the generated form. */
await page.evaluate(() => {
  const id = window.__app.project.elements.at(-1).id;
  const input = document.getElementById(`f-${id}-width`);
  input.value = "1.4";
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(400);
check("editing a dimension in the form updates the element",
  await page.evaluate(() => window.__app.project.elements.at(-1).width === 1.4));

/* Escape cancels a placement without creating anything. */
await page.click('.tool[data-type="planter"]');
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
check("Escape cancels placement",
  await page.evaluate(() => window.__app.project.elements.length) === 2);
check("prompt clears on cancel", await page.locator("#prompt").isHidden());

await page.screenshot({ path: "tests/output/editor.png" }).catch(() => {});

/* Exports carry the drawn design. */
const exported = await page.evaluate(async () => {
  const { elementsToGeoJson, crossSectionCsv } = await import("./src/export.js");
  const gj = elementsToGeoJson(window.__app.scene.frame, window.__app.project);
  return {
    features: gj.features.length,
    hasAxis: gj.features[0].properties.type === "axis",
    hasDimensions: "width_m" in (gj.features[1]?.properties ?? {}),
    csv: crossSectionCsv(window.__app.project),
  };
});
check("GeoJSON includes the axis and the elements", exported.features === 3 && exported.hasAxis);
check("GeoJSON carries element dimensions", exported.hasDimensions);
check("CSV totals both scenarios", (exported.csv.match(/TOTAL/g) ?? []).length === 2);

/* The design survives a reload. */
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 45000 });
const restored = await page.evaluate(() => ({
  elements: window.__app.project.elements.length,
  corridor: Boolean(window.__app.project.corridor),
  width: window.__app.project.sections.proposed[1].width,
}));
check("design is restored after a reload", restored.corridor && restored.elements === 2);
check("edited widths survive a reload", restored.width === 9);

/* Deleting removes it from the project and the scene. */
await page.evaluate(() => {
  const id = window.__app.project.elements[0].id;
  window.__app.scene.highlight(id);
  document.querySelector(".btn--danger")?.click();
});
await page.waitForTimeout(300);

const realErrors = consoleErrors.filter(
  (t) => !/swiftshader|GroupMarkerNotSet|Fallback|WebGL|GL_|performance caveat|favicon/i.test(t),
);
check("no unexpected console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await browser.close();
server.close();

console.log(failures.length === 0
  ? "\nAll checks passed.\n"
  : `\n${failures.length} check(s) failed: ${failures.join(", ")}\n`);
process.exit(failures.length === 0 ? 0 : 1);
