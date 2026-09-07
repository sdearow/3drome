/**
 * The editable design.
 *
 * Everything a person creates lives here, separate from the application's own
 * settings. A project can be started empty, drawn on top of the city, saved to the
 * browser, and written out as a file that carries its own provenance.
 *
 * Cross-sections are stored as an ordered list of band WIDTHS rather than as pairs of
 * offsets. Offsets are derived, so the bands tile the corridor by construction and a
 * gap between them is not expressible. The earlier model could state a section that
 * did not add up, and then needed a validator to catch it; this one cannot.
 */

const STORAGE_KEY = "3drome.project";
export const PROJECT_VERSION = 1;

/** A project with no design in it yet. The application opens on this. */
export function emptyProject() {
  return {
    version: PROJECT_VERSION,
    name: "Untitled corridor",
    notes: "",
    provenance: {
      status: "draft",
      axisSource: "drawn on photorealistic tiles — not surveyed",
      sectionSource: "entered by hand",
    },
    corridor: null,
    sections: { existing: [], proposed: [] },
    elements: [],
    nextId: 1,
  };
}

/**
 * The corridor, once its axis has been drawn.
 * Heights come from the point that was clicked, so the design sits on the surface
 * rather than on a guessed elevation.
 */
export function makeCorridor(start, end, originHeight) {
  return {
    start: { longitude: start.longitude, latitude: start.latitude },
    end: { longitude: end.longitude, latitude: end.latitude },
    originHeight,
    // Treated length defaults to the whole drawn axis; trimmed in the panel.
    treatedFrom: 0,
    treatedTo: null, // null means "to the end of the axis"
    halfWidth: 22,
  };
}

/** A starting cross-section, used when a corridor is first drawn. */
export function defaultSection() {
  return [
    { id: "b1", kind: "footway", width: 4.0 },
    { id: "b2", kind: "carriageway", width: 7.0, lanes: 2 },
    { id: "b3", kind: "footway", width: 4.0 },
  ];
}

/**
 * Turn band widths into offsets from the axis.
 *
 * The axis sits at the centre of the total width, which is where it lands when
 * someone draws it down the middle of a road.
 */
export function bandOffsets(bands) {
  const total = bands.reduce((sum, b) => sum + b.width, 0);
  let cursor = -total / 2;
  return bands.map((band) => {
    const from = cursor;
    cursor += band.width;
    return { ...band, from, to: cursor };
  });
}

export function sectionWidth(bands) {
  return bands.reduce((sum, b) => sum + b.width, 0);
}

/** Carriageway totals, summed across however many bands it is split into. */
export function carriagewayTotals(bands) {
  const parts = bands.filter((b) => b.kind === "carriageway");
  const width = parts.reduce((sum, b) => sum + b.width, 0);
  const lanes = parts.reduce((sum, b) => sum + (b.lanes ?? 0), 0);
  return { width, lanes, laneWidth: lanes ? width / lanes : 0 };
}

/** Total width of one kind of band, for the comparison table. */
export function widthOfKind(bands, kind) {
  return bands.filter((b) => b.kind === kind).reduce((sum, b) => sum + b.width, 0);
}

/* --------------------------------------------------------------- persistence */

export function saveLocal(project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do, and nothing that needs saying */
  }
}

/**
 * Accept a project from an older version of the format.
 * Currently only one version exists; the hook is here so that opening an old file
 * later is a code change in one place rather than a broken read.
 */
export function migrate(project) {
  if (!project || typeof project !== "object") return null;
  if (project.version !== PROJECT_VERSION) {
    console.warn(`Project version ${project.version} differs from ${PROJECT_VERSION}.`);
  }
  return { ...emptyProject(), ...project };
}

export function serialise(project) {
  return JSON.stringify(
    { ...project, exported: new Date().toISOString() },
    null,
    2,
  );
}

/** Give an element or band an id that will not collide with an existing one. */
export function takeId(project, prefix) {
  const id = `${prefix}-${project.nextId}`;
  project.nextId += 1;
  return id;
}
