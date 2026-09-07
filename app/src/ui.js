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
import { clearToken, looksLikeIonToken, readStored, resolveIonToken, storeToken } from "./token.js";

const C = window.Cesium;

export async function start(cfg) {
  // Resolve the token before the scene is built: it decides whether there is a
  // context to load at all.
  cfg.view.ionToken = resolveIonToken(cfg);

  const scene = new Scene("cesiumContainer", cfg);
  window.__scene = scene; // exposed for the smoke test and console inspection

  wireProvenance(cfg);
  wireControls(scene, cfg);
  wireReadout(scene);
  wireSchedule(scene, cfg);
  wireTokenReset();

  const status = document.getElementById("contextStatus");
  status.textContent = "Loading photorealistic context…";

  const result = await scene.loadContext();
  if (result.loaded) {
    status.textContent = "Photorealistic context: on";
    status.dataset.state = "ok";
  } else {
    // When the context is missing, the panel has to say what to do about it. The
    // difference between a missing token and a blocked proxy is the difference
    // between a copy-paste and a conversation with IT, and it is not guessable
    // from an empty sky.
    status.dataset.state = "warn";
    status.innerHTML = "";

    const headline = document.createElement("strong");
    headline.textContent = `Geometry-only mode — ${result.reason}`;
    status.append(headline);

    if (result.fix) {
      const fix = document.createElement("span");
      fix.className = "status-fix";
      fix.textContent = result.fix;
      status.append(fix);
    }
    // The two cases a person can actually resolve from here get the input; a blocked
    // proxy does not, and offering a box to retype a working token into would only
    // send them round the loop again.
    if (result.code === "no-token" || result.code === "token-rejected") {
      status.append(tokenForm());
    }
    if (result.detail) {
      console.info(`Context diagnosis [${result.code}]: ${result.detail}`);
    }
  }

  document.body.dataset.ready = "true";
  return scene;
}

/**
 * Paste-a-token form, shown inside the status panel.
 *
 * It is here rather than in a config file because a token in a tracked file ends up
 * in the repository. Stored in the browser, it stays on this machine.
 */
function tokenForm() {
  const form = document.createElement("form");
  form.className = "token-form";

  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "Paste Cesium ion token";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", "Cesium ion access token");

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "btn btn--small";
  button.textContent = "Save and reload";

  const message = document.createElement("span");
  message.className = "token-message";

  form.append(input, button, message);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const token = input.value.trim();

    if (!token) {
      message.textContent = "Paste a token first.";
      return;
    }
    if (!looksLikeIonToken(token)) {
      message.textContent = "That does not look like an ion token — they start with eyJ and have three parts separated by dots. Check the whole thing was copied.";
      return;
    }
    if (!storeToken(token)) {
      message.textContent = "This browser refused to store it. A private window or a browser policy will do that.";
      return;
    }
    message.textContent = "Saved. Reloading…";
    window.location.reload();
  });

  return form;
}

/** Let someone remove a stored token without opening developer tools. */
function wireTokenReset() {
  if (!readStored()) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--small btn--quiet";
  button.textContent = "Forget stored token";
  button.addEventListener("click", () => {
    clearToken();
    window.location.reload();
  });
  document.querySelector(".panel--controls").append(button);
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
