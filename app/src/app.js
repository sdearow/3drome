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

const $ = (id) => document.getElementById(id);

export async function start(settings) {
  const token = resolveIonToken({ view: settings });
  const scene = new Scene("cesiumContainer", settings);

  let project = loadLocal() ?? emptyProject();
  let editing = "proposed"; // which cross-section the editor shows
  let selectedId = null;

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
  }

  function refresh() {
    scene.highlight(selectedId);
    renderSummary($("summaryBody"), project);
    paintCorridor();

    $("sectionBlock").hidden = !project.corridor;
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
