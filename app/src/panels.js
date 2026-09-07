/**
 * The editing panels.
 *
 * Forms are generated from the catalogue's field descriptions rather than written per
 * type, so a new kind of intervention appears in the interface as soon as it exists
 * in the catalogue. Every numeric input carries its unit and its range, because a
 * dimension without a unit is the thing that later turns into a disputed figure.
 */

import { BAND_KINDS, BAND_KIND_LABEL, CATALOG } from "./elements.js";
import { carriagewayTotals, sectionWidth, widthOfKind } from "./project.js";

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/* ------------------------------------------------------------------- palette */

export function renderPalette(container, { onPlace, enabled }) {
  container.innerHTML = "";

  for (const [type, entry] of Object.entries(CATALOG)) {
    const button = el("button", "tool", entry.label);
    button.type = "button";
    button.disabled = !enabled;
    button.title = entry.hint;
    button.dataset.type = type;
    button.addEventListener("click", () => onPlace(type));
    container.append(button);
  }
}

export function setPaletteActive(container, type) {
  for (const button of container.querySelectorAll(".tool")) {
    button.classList.toggle("tool--active", button.dataset.type === type);
  }
}

/* ---------------------------------------------------------------- properties */

/**
 * The form for one element. Placement fields come first because they are what a
 * person adjusts most, then the catalogue's own fields.
 */
export function renderProperties(container, element, { onEdit, onDelete, onRecentre }) {
  container.innerHTML = "";

  if (!element) {
    container.append(el("p", "muted", "Select an element to edit it, or place a new one."));
    return;
  }

  const entry = CATALOG[element.type];
  const header = el("div", "prop-head");
  header.append(el("h3", null, entry.label));
  const del = el("button", "btn btn--small btn--danger", "Delete");
  del.type = "button";
  del.addEventListener("click", () => onDelete(element.id));
  header.append(del);
  container.append(header);

  if (entry.hint) container.append(el("p", "muted", entry.hint));

  const placementFields = entry.placement === "run"
    ? [
        { key: "fromStation", label: "From chainage", unit: "m", step: 0.5 },
        { key: "toStation", label: "To chainage", unit: "m", step: 0.5 },
        { key: "offset", label: "Offset", unit: "m", step: 0.1 },
      ]
    : [
        { key: "station", label: "Chainage", unit: "m", step: 0.5 },
        { key: "offset", label: "Offset", unit: "m", step: 0.1 },
      ];

  const grid = el("div", "prop-grid");
  for (const field of [...placementFields, ...entry.fields]) {
    grid.append(...numberRow(element, field, onEdit));
  }
  container.append(grid);

  const recentre = el("button", "btn btn--small", "Centre view on this");
  recentre.type = "button";
  recentre.addEventListener("click", () => onRecentre(element));
  container.append(recentre);
}

function numberRow(element, field, onEdit) {
  const label = el("label", "prop-label", field.unit ? `${field.label} (${field.unit})` : field.label);
  const input = document.createElement("input");
  const id = `f-${element.id}-${field.key}`;
  label.htmlFor = id;
  input.id = id;

  if (field.type === "text") {
    input.type = "text";
    input.value = element[field.key] ?? "";
  } else {
    input.type = "number";
    input.step = field.step ?? 0.1;
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
    input.value = element[field.key] ?? 0;
  }

  const commit = () => {
    const raw = field.type === "text" ? input.value : Number(input.value);
    if (field.type !== "text" && Number.isNaN(raw)) return;
    onEdit(element.id, field.key, raw);
  };
  input.addEventListener("change", commit);

  return [label, input];
}

/* ------------------------------------------------------------- cross-section */

/**
 * The band editor.
 *
 * Bands are edited as widths, in order across the corridor. Offsets are derived, so
 * the section always tiles and the two scenarios can be compared without either being
 * checked for gaps first.
 */
export function renderSection(container, project, scenario, { onChange }) {
  container.innerHTML = "";
  const bands = project.sections[scenario];

  const list = el("div", "band-list");
  bands.forEach((band, index) => {
    const row = el("div", "band-row");

    const kind = document.createElement("select");
    kind.setAttribute("aria-label", "Band type");
    for (const option of BAND_KINDS) {
      const opt = document.createElement("option");
      opt.value = option.key;
      opt.textContent = option.label;
      opt.selected = option.key === band.kind;
      kind.append(opt);
    }
    kind.addEventListener("change", () => {
      band.kind = kind.value;
      if (band.kind !== "carriageway") delete band.lanes;
      else band.lanes ??= 2;
      onChange();
    });

    const width = document.createElement("input");
    width.type = "number";
    width.step = "0.1";
    width.min = "0.1";
    width.value = band.width;
    width.setAttribute("aria-label", "Width in metres");
    width.addEventListener("change", () => {
      const v = Number(width.value);
      if (v > 0) {
        band.width = v;
        onChange();
      }
    });

    row.append(kind, width);

    if (band.kind === "carriageway") {
      const lanes = document.createElement("input");
      lanes.type = "number";
      lanes.step = "1";
      lanes.min = "1";
      lanes.value = band.lanes ?? 2;
      lanes.title = "Lanes";
      lanes.setAttribute("aria-label", "Number of lanes");
      lanes.addEventListener("change", () => {
        const v = Math.round(Number(lanes.value));
        if (v >= 1) {
          band.lanes = v;
          onChange();
        }
      });
      row.append(lanes);
    } else {
      row.append(el("span", "band-spacer"));
    }

    const remove = el("button", "btn-icon", "×");
    remove.type = "button";
    remove.title = "Remove band";
    remove.addEventListener("click", () => {
      bands.splice(index, 1);
      onChange();
    });
    row.append(remove);
    list.append(row);
  });
  container.append(list);

  const add = el("button", "btn btn--small", "Add band");
  add.type = "button";
  add.addEventListener("click", () => {
    bands.push({ id: `b${Date.now()}`, kind: "footway", width: 2.0 });
    onChange();
  });

  const total = el("p", "muted", `Total width ${sectionWidth(bands).toFixed(2)} m`);
  container.append(add, total);
}

/* -------------------------------------------------------------------- summary */

/** The comparison table, computed from the same widths the geometry is drawn from. */
export function renderSummary(tbody, project) {
  const { existing, proposed } = project.sections;
  const a = carriagewayTotals(existing);
  const b = carriagewayTotals(proposed);
  const m = (v) => (v > 0 ? `${v.toFixed(2)} m` : "—");

  const counts = new Map();
  for (const element of project.elements) {
    counts.set(element.type, (counts.get(element.type) ?? 0) + 1);
  }

  const rows = [
    ["Corridor width", m(sectionWidth(existing)), m(sectionWidth(proposed))],
    ["Carriageway", m(a.width), m(b.width)],
    ["Traffic lanes", a.lanes || "—", b.lanes || "—"],
    ["Lane width", m(a.laneWidth), m(b.laneWidth)],
    ["Footway", m(widthOfKind(existing, "footway")), m(widthOfKind(proposed, "footway"))],
    ["Cycle track", m(widthOfKind(existing, "cycletrack")), m(widthOfKind(proposed, "cycletrack"))],
    ...[...counts].map(([type, n]) => [CATALOG[type]?.label ?? type, "—", String(n)]),
  ];

  tbody.innerHTML = "";
  for (const [name, before, after] of rows) {
    const tr = document.createElement("tr");
    const th = el("th", null, name);
    th.scope = "row";
    tr.append(th, el("td", null, String(before)), el("td", null, String(after)));
    tbody.append(tr);
  }
}

export { BAND_KIND_LABEL };
