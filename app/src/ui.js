/**
 * Interface wiring.
 *
 * The controls are deliberately few. A reviewer needs to compare the two sections,
 * see the site at night, know where the measured zone ends, and take the numbers
 * away — everything else is decoration that invites the wrong conversation.
 */

import { Scene } from "./scene.js";
import { carriagewayExtent } from "./elements.js";
import { crossSectionCsv, download, elementsToGeoJson } from "./export.js";

const C = window.Cesium;

export async function start(cfg) {
  const scene = new Scene("cesiumContainer", cfg);
  window.__scene = scene; // exposed for the smoke test and console inspection

  wireProvenance(cfg);
  wireControls(scene, cfg);
  wireReadout(scene);
  wireSchedule(scene, cfg);

  const status = document.getElementById("contextStatus");
  status.textContent = "Loading photorealistic context…";

  const result = await scene.loadContext();
  if (result.loaded) {
    status.textContent = "Photorealistic context: on";
    status.dataset.state = "ok";
  } else {
    status.textContent = `Context off — ${result.reason}. Geometry-only mode.`;
    status.dataset.state = "warn";
  }

  document.body.dataset.ready = "true";
  return scene;
}

function wireProvenance(cfg) {
  document.getElementById("siteName").textContent = cfg.corridor.name;
  document.getElementById("provenanceNote").textContent = cfg.provenance.note;
  document.getElementById("provenanceDetail").textContent =
    `Axis: ${cfg.provenance.axisSource}. Section: ${cfg.provenance.sectionSource}.`;
}

function wireControls(scene, cfg) {
  const modeBtn = document.getElementById("modeToggle");
  const dayBtn = document.getElementById("daylightToggle");
  const ctxBtn = document.getElementById("contextToggle");

  const paintMode = () => {
    const proposed = scene.mode === "proposed";
    modeBtn.textContent = proposed ? "Showing: proposed" : "Showing: existing";
    modeBtn.dataset.state = proposed ? "proposed" : "existing";
  };

  modeBtn.addEventListener("click", () => {
    scene.toggleMode();
    paintMode();
  });
  paintMode();

  dayBtn.addEventListener("click", () => {
    const which = scene.toggleDaylight();
    dayBtn.textContent = which === "day" ? "Daylight" : "Night";
  });

  let contextVisible = true;
  ctxBtn.addEventListener("click", () => {
    contextVisible = !contextVisible;
    scene.setContextVisible(contextVisible);
    ctxBtn.textContent = contextVisible ? "Context: shown" : "Context: hidden";
  });

  document.getElementById("resetView").addEventListener("click", () => scene.resetCamera());

  // Holding a key to compare is faster than clicking, and it is how these
  // before/after comparisons actually get used in a meeting.
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.key === "e" || e.key === "E") {
      scene.setMode("existing");
      paintMode();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "e" || e.key === "E") {
      scene.setMode("proposed");
      paintMode();
    }
  });

  document.getElementById("exportGeoJson").addEventListener("click", () => {
    download("elements.geojson", JSON.stringify(elementsToGeoJson(scene.frame, cfg), null, 2));
  });
  document.getElementById("exportCsv").addEventListener("click", () => {
    download("cross_section.csv", crossSectionCsv(cfg), "text/csv");
  });
}

/**
 * Cursor readout in corridor coordinates. Chainage and offset are the terms the
 * design is dimensioned in, so that is what the cursor reports.
 */
function wireReadout(scene) {
  const readout = document.getElementById("readout");
  const handler = new C.ScreenSpaceEventHandler(scene.viewer.scene.canvas);

  handler.setInputAction((movement) => {
    const coord = scene.pickCorridorCoordinate(movement.endPosition);
    if (!coord) {
      readout.textContent = "—";
      return;
    }
    readout.textContent =
      `chainage ${coord.station.toFixed(1)} m · offset ${coord.offset >= 0 ? "+" : ""}${coord.offset.toFixed(1)} m`;
  }, C.ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction((click) => {
    const coord = scene.pickCorridorCoordinate(click.position);
    if (!coord) return;
    const line = `{ station: ${coord.station.toFixed(1)}, offset: ${coord.offset.toFixed(1)} }`;
    navigator.clipboard?.writeText(line).catch(() => {});
    readout.textContent = `copied  ${line}`;
  }, C.ScreenSpaceEventType.LEFT_CLICK);
}

/** A compact schedule of what changes, generated from the configuration. */
function wireSchedule(scene, cfg) {
  const body = document.getElementById("scheduleBody");
  const byKind = new Map();

  for (const spec of cfg.elements) {
    if (spec.enabled === false) continue;
    byKind.set(spec.type, (byKind.get(spec.type) ?? 0) + 1);
  }

  // Both figures come from the same function the geometry is built with, so the
  // table cannot drift away from what is drawn on screen.
  const before = carriagewayExtent(cfg.crossSection.existing);
  const after = carriagewayExtent(cfg.crossSection.proposed);

  const widthOf = (section, kind) =>
    section
      .filter((b) => b.kind === kind)
      .reduce((sum, b) => sum + (b.to - b.from), 0);

  const footway = (section) => widthOf(section, "footway");
  const cycle = (section) => widthOf(section, "cycletrack");

  const metres = (v) => (v > 0 ? `${v.toFixed(2)} m` : "—");

  const rows = [
    ["Carriageway width", metres(before.width), metres(after.width)],
    ["Traffic lanes", `${before.lanes}`, `${after.lanes}`],
    ["Lane width", metres(before.laneWidth), metres(after.laneWidth)],
    ["Footway total", metres(footway(cfg.crossSection.existing)), metres(footway(cfg.crossSection.proposed))],
    ["Cycle track", metres(cycle(cfg.crossSection.existing)), metres(cycle(cfg.crossSection.proposed))],
    ...[...byKind].map(([k, n]) => [camelToWords(k), "—", `${n}`]),
  ];

  body.innerHTML = rows
    .map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td></tr>`)
    .join("");
}

function camelToWords(s) {
  const t = s.replace(/([A-Z])/g, " $1").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
