/**
 * Application wiring.
 *
 * Holds the project, hands it to the scene when it changes, and keeps the panels in
 * step. Every edit goes through `commit`, which is also where the autosave happens —
 * one path in, so a change cannot reach the scene without also reaching storage.
 */

import { Editor } from "./editor.js";
import { Scene } from "./scene.js";
import { CATALOG } from "./elements.js";
import { crossSectionCsv, download, elementsToGeoJson } from "./export.js";
import { renderPalette, renderProperties, renderSection, renderSummary, setPaletteActive } from "./panels.js";
import {
  clearLocal,
  emptyProject,
  loadLocal,
  migrate,
  saveLocal,
  serialise,
} from "./project.js";
import { clearToken, looksLikeIonToken, readStored, resolveIonToken, storeToken } from "./token.js";
import {
  binProfile,
  guessSpeedUnit,
  parseDelimited,
  parseGeoJson,
  projectToCorridor,
  sampleEvenly,
  summarise,
} from "./fcd.js";
import { renderProfile } from "./profile.js";

const $ = (id) => document.getElementById(id);

export async function start(settings) {
  const token = resolveIonToken({ view: settings });
  const scene = new Scene("cesiumContainer", settings);

  let project = loadLocal() ?? emptyProject();
  let editing = "proposed"; // which cross-section the editor shows
  let selectedId = null;

  // Floating car data is session state, not part of the design: it describes what
  // the road does today, and it is not something the project owns or exports.
  const fcd = {
    raw: [],           // every parsed point
    inside: [],        // those falling within the corridor
    unit: "kmh",
    limit: 50,
    binSize: 25,
    visible: true,
    warnings: [],
    fileName: null,
  };

  scene.setProject(project);
  window.__app = { scene, get project() { return project; } };

  const editor = new Editor(scene, (next, options = {}) => {
    project = next;
    if (options.frame) scene.setProject(project);
    commit({ rebuild: !options.frame, select: options.select });
    if (options.frame) scene.resetCamera();
  });

  /* ------------------------------------------------------------------ commits */

  function commit({ rebuild = true, select } = {}) {
    if (select !== undefined) selectedId = select;
    if (rebuild) scene.setProject(project);
    saveLocal(project);
    refresh();
    // The corridor decides which observations count, so any change to it re-filters.
    if (fcd.raw.length) refreshFcd();
  }

  function refresh() {
    scene.highlight(selectedId);
    renderSummary($("summaryBody"), project);
    paintCorridor();

    $("sectionBlock").hidden = !project.corridor;
    $("fcdBlock").hidden = !project.corridor;
    if (project.corridor) {
      renderSection($("sectionEditor"), project, editing, { onChange: () => commit() });
    }

    const element = project.elements.find((e) => e.id === selectedId) ?? null;
    renderProperties($("properties"), element, {
      onEdit: (id, key, value) => {
        const target = project.elements.find((e) => e.id === id);
        if (!target) return;
        target[key] = value;
        commit();
      },
      onDelete: (id) => {
        project.elements = project.elements.filter((e) => e.id !== id);
        commit({ select: null });
      },
      onRecentre: (target) => {
        const station = target.station ?? (target.fromStation + target.toStation) / 2;
        const p = scene.frame.toDegrees(station, target.offset ?? 0);
        scene.flyToPoint(p.longitude, p.latitude, scene.frame.originHeight + 90);
      },
    });

    renderPalette($("palette"), { enabled: Boolean(project.corridor), onPlace: (type) => editor.place(type) });
    $("projectName").value = project.name;
  }

  function paintCorridor() {
    const info = $("corridorInfo");
    if (!project.corridor || !scene.frame) {
      info.textContent = "No corridor yet. Draw an axis along the road you want to change.";
      $("drawAxis").textContent = "Draw corridor axis";
      $("corridorFields").hidden = true;
      return;
    }
    const to = project.corridor.treatedTo ?? scene.frame.length;
    info.textContent = `${scene.frame.length.toFixed(0)} m axis drawn`;
    $("drawAxis").textContent = "Redraw corridor axis";

    $("corridorFields").hidden = false;
    $("treatedFrom").value = round1(project.corridor.treatedFrom);
    $("treatedTo").value = round1(to);
    $("zoneHalfWidth").value = round1(project.corridor.halfWidth);
  }

  /* ------------------------------------------------------------------ editor */

  editor.on("state", (state) => {
    setPaletteActive($("palette"), state.kind === "place" ? state.type : null);
    const prompt = $("prompt");

    if (state.kind === "draw-axis") {
      showPrompt("Click the start of the corridor, then the end. Press Esc to cancel.");
    } else if (state.kind === "place") {
      const entry = CATALOG[state.type];
      showPrompt(
        entry.placement === "run"
          ? `${entry.label}: click the start, then the end. Esc to cancel.`
          : `${entry.label}: click where it goes. Esc to cancel.`,
      );
    } else {
      prompt.hidden = true;
    }
  });

  editor.on("readout", (coord) => {
    $("readout").textContent = coord
      ? `chainage ${coord.station.toFixed(1)} m · offset ${coord.offset >= 0 ? "+" : ""}${coord.offset.toFixed(1)} m`
      : "—";
  });

  editor.on("select", (id) => {
    selectedId = id;
    refresh();
  });

  function showPrompt(text) {
    const prompt = $("prompt");
    prompt.textContent = text;
    prompt.hidden = false;
  }

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") editor.cancel();
    if (event.key === "Delete" && selectedId) {
      project.elements = project.elements.filter((e) => e.id !== selectedId);
      commit({ select: null });
    }
    if ((event.key === "e" || event.key === "E") && !event.repeat && !isTyping(event)) {
      scene.setMode("existing");
      paintMode();
    }
  });
  window.addEventListener("keyup", (event) => {
    if ((event.key === "e" || event.key === "E") && !isTyping(event)) {
      scene.setMode("proposed");
      paintMode();
    }
  });

  /* ---------------------------------------------------------------- controls */

  $("drawAxis").addEventListener("click", () => editor.drawAxis());

  // The treated window and the zone width are edited in place rather than through a
  // modal prompt: prompts are disabled by some browser policies, and these are numbers
  // people nudge repeatedly while looking at the result.
  bindCorridorNumber("treatedFrom", (corridor, value) => { corridor.treatedFrom = value; });
  bindCorridorNumber("treatedTo", (corridor, value) => { corridor.treatedTo = value; });
  bindCorridorNumber("zoneHalfWidth", (corridor, value) => { corridor.halfWidth = Math.max(2, value); });

  function bindCorridorNumber(id, apply) {
    $(id).addEventListener("change", (event) => {
      if (!project.corridor) return;
      const value = Number(event.target.value);
      if (Number.isNaN(value)) return;
      apply(project.corridor, value);
      commit();
    });
  }

  $("tabExisting").addEventListener("click", () => switchSection("existing"));
  $("tabProposed").addEventListener("click", () => switchSection("proposed"));

  function switchSection(which) {
    editing = which;
    $("tabExisting").classList.toggle("seg-btn--on", which === "existing");
    $("tabProposed").classList.toggle("seg-btn--on", which === "proposed");
    scene.setMode(which);
    paintMode();
    refresh();
  }

  $("copySection").addEventListener("click", () => {
    project.sections.proposed = project.sections.existing.map((band, i) => ({
      ...band,
      id: `p${i}-${Date.now()}`,
    }));
    commit();
  });

  const modeBtn = $("modeToggle");
  function paintMode() {
    const proposed = scene.mode === "proposed";
    modeBtn.textContent = proposed ? "Showing: proposed" : "Showing: existing";
    modeBtn.dataset.state = proposed ? "proposed" : "existing";
  }
  modeBtn.addEventListener("click", () => {
    scene.toggleMode();
    paintMode();
  });
  paintMode();

  $("daylightToggle").addEventListener("click", (event) => {
    event.target.textContent = scene.toggleDaylight() === "day" ? "Daylight" : "Night";
  });

  let contextVisible = true;
  $("contextToggle").addEventListener("click", (event) => {
    contextVisible = !contextVisible;
    scene.setContextVisible(contextVisible);
    event.target.textContent = contextVisible ? "Context: on" : "Context: off";
  });

  $("resetView").addEventListener("click", () => {
    if (!scene.resetCamera()) {
      scene.flyToPoint(settings.home.longitude, settings.home.latitude, settings.home.height);
    }
  });

  $("projectName").addEventListener("change", (event) => {
    project.name = event.target.value.trim() || "Untitled corridor";
    commit({ rebuild: false });
  });

  /* ----------------------------------------------------------------- project */

  $("saveProject").addEventListener("click", () => {
    download(`${slug(project.name)}.3drome.json`, serialise(project));
  });

  $("openProject").addEventListener("click", () => $("fileInput").click());
  $("fileInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const opened = migrate(JSON.parse(await file.text()));
      if (!opened) throw new Error("not a project file");
      project = opened;
      selectedId = null;
      scene.setProject(project);
      commit();
      if (scene.frame) scene.resetCamera();
    } catch (error) {
      showPrompt(`Could not open that file: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });

  $("newProject").addEventListener("click", () => {
    if (!window.confirm("Discard the current design and start over?")) return;
    clearLocal();
    project = emptyProject();
    selectedId = null;
    scene.setProject(project);
    commit();
  });

  $("exportGeoJson").addEventListener("click", () => {
    if (!scene.frame) return;
    download(`${slug(project.name)}.geojson`, JSON.stringify(elementsToGeoJson(scene.frame, project), null, 2));
  });
  $("exportCsv").addEventListener("click", () => {
    download(`${slug(project.name)}-section.csv`, crossSectionCsv(project), "text/csv");
  });


  /* --------------------------------------------------------- floating car data */

  $("loadFcd").addEventListener("click", () => $("fcdInput").click());

  $("fcdInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    $("fcdStatus").textContent = `Reading ${file.name}…`;

    try {
      const text = await file.text();
      const isJson = /\.(json|geojson)$/i.test(file.name) || text.trimStart().startsWith("{");
      const result = isJson ? parseGeoJson(text) : parseDelimited(text);

      fcd.raw = result.points;
      fcd.warnings = result.warnings ?? [];
      fcd.fileName = file.name;

      const speeds = fcd.raw.map((p) => p.speed).filter((v) => v !== undefined);
      if (speeds.length) {
        const guess = guessSpeedUnit(speeds);
        fcd.unit = guess.unit;
        if (!guess.confident) {
          fcd.warnings.push(
            `Speed units were guessed as ${guess.unit === "ms" ? "m/s" : "km/h"} ` +
              `from a 95th percentile of ${guess.p95.toFixed(1)}. Check the toggle.`,
          );
        }
      }
      // A limit in m/s is a different number; keep the default sensible either way.
      fcd.limit = fcd.unit === "ms" ? 14 : 50;
      $("fcdControls").hidden = false;
      $("clearFcd").hidden = false;
      $("profilePanel").hidden = false;
      paintUnitToggle();
      refreshFcd();
    } catch (error) {
      $("fcdStatus").textContent = `Could not read that file: ${error.message}`;
    } finally {
      event.target.value = "";
    }
  });

  $("clearFcd").addEventListener("click", () => {
    fcd.raw = [];
    fcd.inside = [];
    fcd.warnings = [];
    fcd.fileName = null;
    scene.clearFcd();
    $("fcdControls").hidden = true;
    $("clearFcd").hidden = true;
    $("profilePanel").hidden = true;
    $("fcdStatus").textContent = "CSV or GeoJSON with latitude, longitude and speed.";
  });

  $("speedLimit").addEventListener("change", (event) => {
    fcd.limit = Number(event.target.value) || 0;
    refreshFcd();
  });
  $("binSize").addEventListener("change", (event) => {
    fcd.binSize = Math.max(5, Number(event.target.value) || 25);
    refreshFcd();
  });
  $("unitKmh").addEventListener("click", () => setUnit("kmh"));
  $("unitMs").addEventListener("click", () => setUnit("ms"));

  $("toggleFcd").addEventListener("click", (event) => {
    fcd.visible = !fcd.visible;
    scene.setFcdVisible(fcd.visible);
    event.target.textContent = fcd.visible ? "Points: on" : "Points: off";
  });

  $("exportProfile").addEventListener("click", () => {
    const bins = currentBins();
    const rows = [["station_m", "n", `v15_${fcd.unit}`, `v50_${fcd.unit}`, `v85_${fcd.unit}`, "sparse"]];
    for (const bin of bins) {
      rows.push([
        bin.station.toFixed(1), bin.n,
        bin.v15?.toFixed(2) ?? "", bin.v50?.toFixed(2) ?? "", bin.v85?.toFixed(2) ?? "",
        bin.sparse ? "yes" : "",
      ]);
    }
    download(`${slug(project.name)}-speed-profile.csv`, rows.map((r) => r.join(",")).join("\n"), "text/csv");
  });

  function setUnit(unit) {
    if (fcd.unit === unit) return;
    // Converting the limit too keeps the reference line where the user put it.
    fcd.limit = unit === "ms" ? fcd.limit / 3.6 : fcd.limit * 3.6;
    fcd.unit = unit;
    paintUnitToggle();
    refreshFcd();
  }

  function paintUnitToggle() {
    $("unitKmh").classList.toggle("seg-btn--on", fcd.unit === "kmh");
    $("unitMs").classList.toggle("seg-btn--on", fcd.unit === "ms");
  }

  function corridorWindow() {
    const to = project.corridor.treatedTo ?? scene.frame.length;
    return { from: project.corridor.treatedFrom, to, halfWidth: project.corridor.halfWidth };
  }

  function currentBins() {
    const { from, to } = corridorWindow();
    return binProfile(fcd.inside, { binSize: fcd.binSize, from, to });
  }

  /** Reproject, redraw and restate the data. Called on load and on every setting. */
  function refreshFcd() {
    if (!scene.frame || !project.corridor) return;

    // A file that parsed to nothing is exactly when the warnings matter most, so
    // report before returning rather than after.
    if (fcd.raw.length === 0) {
      scene.clearFcd();
      renderProfile($("profileChart"), [], { unit: fcd.unit === "ms" ? "m/s" : "km/h" });
      $("fcdStats").innerHTML = "<dt>Observations</dt><dd>none</dd>";
      $("fcdStatus").textContent = fcd.fileName
        ? `${fcd.fileName}: no usable points.`
        : "CSV or GeoJSON with latitude, longitude and speed.";
      renderFcdWarnings();
      return;
    }

    const window_ = corridorWindow();
    fcd.inside = projectToCorridor(
      fcd.raw,
      (lon, lat) => scene.frame.fromCartesian(window.Cesium.Cartesian3.fromDegrees(lon, lat, scene.frame.originHeight)),
      window_,
    );

    $("speedLimit").value = round1(fcd.limit);
    $("binSize").value = fcd.binSize;

    const speeds = fcd.inside.map((p) => p.speed).filter((v) => v !== undefined);
    const stats = summarise(speeds, fcd.limit);
    renderFcdStats(stats);

    const { sample, sampled } = sampleEvenly(fcd.inside, 40000);
    scene.showFcd(sample, { limit: fcd.limit, spread: fcd.unit === "ms" ? 6 : 20 });
    scene.setFcdVisible(fcd.visible);

    renderProfile($("profileChart"), currentBins(), {
      limit: fcd.limit,
      unit: fcd.unit === "ms" ? "m/s" : "km/h",
      onHover: (bin) => scene.markChainage(bin ? bin.station : null),
    });

    const parts = [`${fcd.raw.length.toLocaleString()} points read`];
    parts.push(`${fcd.inside.length.toLocaleString()} inside the corridor`);
    if (sampled) parts.push(`${sample.length.toLocaleString()} drawn`);
    $("fcdStatus").textContent = `${fcd.fileName}: ${parts.join(", ")}.`;

    renderFcdWarnings();
  }

  function renderFcdStats(stats) {
    const list = $("fcdStats");
    list.innerHTML = "";
    if (!stats.n) {
      list.innerHTML = "<dt>Observations</dt><dd>none in corridor</dd>";
      return;
    }
    const u = fcd.unit === "ms" ? "m/s" : "km/h";
    const rows = [
      ["Observations", stats.n.toLocaleString(), false],
      ["Mean", `${stats.mean.toFixed(1)} ${u}`, false],
      ["v50", `${stats.v50.toFixed(1)} ${u}`, false],
      // v85 is the metric speed management is argued in, so it is stated plainly.
      ["v85", `${stats.v85.toFixed(1)} ${u}`, fcd.limit > 0 && stats.v85 > fcd.limit],
    ];
    if (stats.overLimit !== null) {
      rows.push(["Over limit", `${(stats.overLimit * 100).toFixed(0)}%`, stats.overLimit > 0.15]);
    }
    for (const [label, value, alert] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      if (alert) dd.className = "stat--alert";
      list.append(dt, dd);
    }
  }

  function renderFcdWarnings() {
    for (const node of document.querySelectorAll(".fcd-warning")) node.remove();
    for (const warning of fcd.warnings) {
      const p = document.createElement("p");
      p.className = "fcd-warning";
      p.textContent = warning;
      $("fcdStatus").after(p);
    }
  }


  /* ----------------------------------------------------------------- context */

  refresh();
  if (scene.frame) scene.resetCamera();
  else scene.flyToPoint(settings.home.longitude, settings.home.latitude, settings.home.height);

  const status = $("contextStatus");
  status.textContent = "Loading photorealistic context…";
  const result = await scene.loadContext(token);

  if (result.loaded) {
    status.textContent = "Photorealistic context: on";
    status.dataset.state = "ok";
    wireTokenReset();
  } else {
    status.dataset.state = "warn";
    status.innerHTML = "";
    const headline = document.createElement("strong");
    headline.textContent = result.reason;
    status.append(headline);
    if (result.fix) {
      const fix = document.createElement("span");
      fix.className = "status-fix";
      fix.textContent = result.fix;
      status.append(fix);
    }
    if (result.code === "no-token" || result.code === "token-rejected") {
      status.append(tokenForm());
    }
    if (result.detail) console.info(`Context diagnosis [${result.code}]: ${result.detail}`);
  }

  document.body.dataset.ready = "true";
  return { scene, editor };
}

/* --------------------------------------------------------------------- token */

function tokenForm() {
  const form = document.createElement("form");
  form.className = "token-form";

  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "Paste Cesium ion token";
  input.autocomplete = "off";
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
    const value = input.value.trim();
    if (!value) {
      message.textContent = "Paste a token first.";
      return;
    }
    if (!looksLikeIonToken(value)) {
      message.textContent = "That does not look like an ion token — they start with eyJ and have three dot-separated parts.";
      return;
    }
    if (!storeToken(value)) {
      message.textContent = "This browser refused to store it.";
      return;
    }
    window.location.reload();
  });
  return form;
}

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
  document.querySelector(".panel--right .block").append(button);
}

/* --------------------------------------------------------------------- utils */

function isTyping(event) {
  const tag = event.target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "corridor";
}
