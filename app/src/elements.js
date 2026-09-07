/**
 * The catalogue of things that can be placed on a corridor.
 *
 * Each entry pairs a geometry generator with a description of its editable fields.
 * The properties panel is built from that description rather than hand-written per
 * type, so adding a new kind of intervention means adding one entry here and nothing
 * else. The fields carry units, ranges and defaults because those are what make an
 * entered number checkable.
 *
 * Dimensions stay data all the way through: a raised crossing is 4.00 m wide because
 * its `width` field says so, and that number reaches the schedule and the exports
 * unchanged.
 */

const C = window.Cesium;

export const PALETTE = {
  carriageway: C.Color.fromCssColorString("#3a3f45").withAlpha(0.92),
  footway: C.Color.fromCssColorString("#b9b3a7").withAlpha(0.95),
  cycletrack: C.Color.fromCssColorString("#9c4a34").withAlpha(0.95),
  separator: C.Color.fromCssColorString("#d8d3c8"),
  median: C.Color.fromCssColorString("#6f7f5c"),
  parking: C.Color.fromCssColorString("#6a6f75").withAlpha(0.92),
  bus: C.Color.fromCssColorString("#7a5230").withAlpha(0.92),
  raisedCrossing: C.Color.fromCssColorString("#c8c2b4"),
  stripe: C.Color.WHITE.withAlpha(0.95),
  planter: C.Color.fromCssColorString("#5f6f4d"),
  planterRim: C.Color.fromCssColorString("#9a9488"),
  bollard: C.Color.fromCssColorString("#e8e3d8"),
  island: C.Color.fromCssColorString("#c3bdb0"),
  outline: C.Color.BLACK.withAlpha(0.35),
  selected: C.Color.fromCssColorString("#f0c040"),
};

/** The band kinds a cross-section can be built from. */
export const BAND_KINDS = [
  { key: "footway", label: "Footway", raised: true },
  { key: "cycletrack", label: "Cycle track", raised: true },
  { key: "carriageway", label: "Carriageway", raised: false, lanes: true },
  { key: "median", label: "Median", raised: true },
  { key: "separator", label: "Separator", raised: true },
  { key: "parking", label: "Parking", raised: false },
  { key: "bus", label: "Bus lane", raised: false },
];

export const BAND_KIND_LABEL = Object.fromEntries(BAND_KINDS.map((k) => [k.key, k.label]));

/* --------------------------------------------------------------- primitives */

/** A rectangular slab in corridor coordinates, extruded down from `top`. */
function slab(frame, { fromStation, toStation, fromOffset, toOffset, top = 0, thickness = 0.02 }) {
  const corners = [
    frame.toCartesian(fromStation, fromOffset, top),
    frame.toCartesian(toStation, fromOffset, top),
    frame.toCartesian(toStation, toOffset, top),
    frame.toCartesian(fromStation, toOffset, top),
  ];
  return {
    hierarchy: new C.PolygonHierarchy(corners),
    perPositionHeight: true,
    extrudedHeight: frame.originHeight + top - thickness,
    closeTop: true,
    closeBottom: true,
  };
}

/** Outer kerb-to-kerb extent of the carriageway, across however many bands it uses. */
export function carriagewayExtent(bandsWithOffsets) {
  const parts = bandsWithOffsets.filter((b) => b.kind === "carriageway");
  if (parts.length === 0) return { from: -7, to: 7 };
  return {
    from: Math.min(...parts.map((b) => b.from)),
    to: Math.max(...parts.map((b) => b.to)),
  };
}

/* ------------------------------------------------------------------ sections */

/** Continuous surfaces for one cross-section: the deck the design stands on. */
export function crossSectionBands(frame, bandsWithOffsets, corridor, scenario) {
  const from = corridor.treatedFrom;
  const to = corridor.treatedTo ?? frame.length;
  const out = [];

  for (const band of bandsWithOffsets) {
    const spec = BAND_KINDS.find((k) => k.key === band.kind);
    const raised = spec?.raised ?? false;
    const top = raised ? 0.15 : 0.0;

    out.push({
      id: `${scenario}-band-${band.id}`,
      name: `${BAND_KIND_LABEL[band.kind] ?? band.kind} · ${band.width.toFixed(2)} m`,
      polygon: {
        ...slab(frame, {
          fromStation: from,
          toStation: to,
          fromOffset: band.from,
          toOffset: band.to,
          top,
          thickness: raised ? 0.15 : 0.05,
        }),
        material: PALETTE[band.kind] ?? PALETTE.carriageway,
        outline: true,
        outlineColor: PALETTE.outline,
      },
    });

    if (band.kind === "carriageway" && (band.lanes ?? 0) > 1) {
      const laneWidth = band.width / band.lanes;
      for (let i = 1; i < band.lanes; i += 1) {
        const at = band.from + laneWidth * i;
        out.push({
          id: `${scenario}-lane-${band.id}-${i}`,
          polygon: {
            ...slab(frame, {
              fromStation: from,
              toStation: to,
              fromOffset: at - 0.06,
              toOffset: at + 0.06,
              top: 0.01,
              thickness: 0.01,
            }),
            material: PALETTE.stripe,
          },
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ catalogue */

function raisedCrossing(frame, el, ctx) {
  const { from, to } = carriagewayExtent(ctx.bands);
  const half = el.width / 2;
  const h = el.rise;

  const out = [{
    id: el.id,
    polygon: {
      ...slab(frame, {
        fromStation: el.station - half,
        toStation: el.station + half,
        fromOffset: from,
        toOffset: to,
        top: h,
        thickness: h,
      }),
      material: PALETTE.raisedCrossing,
      outline: true,
      outlineColor: PALETTE.outline,
    },
  }];

  const stripes = Math.floor((to - from) / 1.2);
  for (let i = 0; i < stripes; i += 1) {
    const o = from + 0.6 + i * 1.2;
    out.push({
      id: `${el.id}-s${i}`,
      polygon: {
        ...slab(frame, {
          fromStation: el.station - half + 0.3,
          toStation: el.station + half - 0.3,
          fromOffset: o,
          toOffset: o + 0.55,
          top: h + 0.01,
          thickness: 0.01,
        }),
        material: PALETTE.stripe,
      },
    });
  }
  return out;
}

function refugeIsland(frame, el) {
  const half = el.width / 2;
  return [{
    id: el.id,
    polygon: {
      ...slab(frame, {
        fromStation: el.station - el.length / 2,
        toStation: el.station + el.length / 2,
        fromOffset: el.offset - half,
        toOffset: el.offset + half,
        top: 0.15,
        thickness: 0.15,
      }),
      material: PALETTE.island,
      outline: true,
      outlineColor: PALETTE.outline,
    },
  }];
}

function kerbBuildOut(frame, el) {
  const sign = el.offset >= 0 ? 1 : -1;
  return [{
    id: el.id,
    polygon: {
      ...slab(frame, {
        fromStation: el.station - el.length / 2,
        toStation: el.station + el.length / 2,
        fromOffset: el.offset,
        toOffset: el.offset - sign * el.depth,
        top: 0.15,
        thickness: 0.15,
      }),
      material: PALETTE.footway,
      outline: true,
      outlineColor: PALETTE.outline,
    },
  }];
}

function separatorRun(frame, el) {
  const out = [{
    id: el.id,
    polygon: {
      ...slab(frame, {
        fromStation: el.fromStation,
        toStation: el.toStation,
        fromOffset: el.offset - el.width / 2,
        toOffset: el.offset + el.width / 2,
        top: 0.12,
        thickness: 0.12,
      }),
      material: PALETTE.separator,
      outline: true,
      outlineColor: PALETTE.outline,
    },
  }];

  if (el.spacing > 0) {
    const n = Math.floor(Math.abs(el.toStation - el.fromStation) / el.spacing);
    const dir = el.toStation >= el.fromStation ? 1 : -1;
    for (let i = 0; i <= n; i += 1) {
      const s = el.fromStation + dir * i * el.spacing;
      out.push({
        id: `${el.id}-b${i}`,
        position: frame.toCartesian(s, el.offset, 0.45),
        cylinder: { length: 0.9, topRadius: 0.05, bottomRadius: 0.05, material: PALETTE.bollard },
      });
    }
  }
  return out;
}

function bollardRow(frame, el) {
  const out = [];
  const n = Math.floor(Math.abs(el.toStation - el.fromStation) / el.spacing);
  const dir = el.toStation >= el.fromStation ? 1 : -1;
  for (let i = 0; i <= n; i += 1) {
    const s = el.fromStation + dir * i * el.spacing;
    out.push({
      id: `${el.id}-b${i}`,
      position: frame.toCartesian(s, el.offset, el.height / 2),
      cylinder: {
        length: el.height,
        topRadius: el.radius,
        bottomRadius: el.radius,
        material: PALETTE.bollard,
      },
    });
  }
  return out;
}

function planter(frame, el) {
  const half = el.width / 2;
  return [
    {
      id: `${el.id}-rim`,
      polygon: {
        ...slab(frame, {
          fromStation: el.station - el.length / 2,
          toStation: el.station + el.length / 2,
          fromOffset: el.offset - half,
          toOffset: el.offset + half,
          top: 0.25,
          thickness: 0.25,
        }),
        material: PALETTE.planterRim,
        outline: true,
        outlineColor: PALETTE.outline,
      },
    },
    {
      id: `${el.id}-fill`,
      polygon: {
        ...slab(frame, {
          fromStation: el.station - el.length / 2 + 0.15,
          toStation: el.station + el.length / 2 - 0.15,
          fromOffset: el.offset - half + 0.15,
          toOffset: el.offset + half - 0.15,
          top: 0.45,
          thickness: 0.2,
        }),
        material: PALETTE.planter,
      },
    },
  ];
}

function model(frame, el) {
  const position = frame.toCartesian(el.station, el.offset, el.height ?? 0);
  const hpr = new C.HeadingPitchRoll(frame.heading + C.Math.toRadians(el.heading ?? 0), 0, 0);
  return [{
    id: el.id,
    position,
    orientation: C.Transforms.headingPitchRollQuaternion(position, hpr),
    model: { uri: el.url, scale: el.scale ?? 1, minimumPixelSize: 0 },
  }];
}

/**
 * `placement` says how an element is put down: "point" takes one click, "run" takes
 * two — a start and an end along the corridor.
 */
export const CATALOG = {
  raisedCrossing: {
    label: "Raised crossing",
    hint: "Spans the carriageway kerb to kerb. Rise governs the speed effect.",
    placement: "point",
    build: raisedCrossing,
    fields: [
      { key: "width", label: "Width", unit: "m", value: 4.0, min: 2, max: 15, step: 0.1 },
      { key: "rise", label: "Rise", unit: "m", value: 0.12, min: 0.05, max: 0.2, step: 0.01 },
    ],
  },
  refugeIsland: {
    label: "Refuge island",
    hint: "Splits a crossing into two stages.",
    placement: "point",
    build: refugeIsland,
    fields: [
      { key: "length", label: "Length", unit: "m", value: 6.0, min: 2, max: 40, step: 0.5 },
      { key: "width", label: "Width", unit: "m", value: 2.0, min: 1.2, max: 6, step: 0.1 },
    ],
  },
  kerbBuildOut: {
    label: "Kerb build-out",
    hint: "Extends the footway into the carriageway, shortening the crossing.",
    placement: "point",
    build: kerbBuildOut,
    fields: [
      { key: "length", label: "Length", unit: "m", value: 12.0, min: 2, max: 60, step: 0.5 },
      { key: "depth", label: "Depth", unit: "m", value: 2.2, min: 0.5, max: 6, step: 0.1 },
    ],
  },
  separatorRun: {
    label: "Segregation kerb",
    hint: "Continuous kerb with bollards. Set spacing to 0 for kerb only.",
    placement: "run",
    build: separatorRun,
    fields: [
      { key: "width", label: "Kerb width", unit: "m", value: 0.8, min: 0.2, max: 3, step: 0.1 },
      { key: "spacing", label: "Bollard spacing", unit: "m", value: 12, min: 0, max: 50, step: 1 },
    ],
  },
  bollardRow: {
    label: "Bollard row",
    hint: "Vertical deterrent without a kerb.",
    placement: "run",
    build: bollardRow,
    fields: [
      { key: "spacing", label: "Spacing", unit: "m", value: 1.5, min: 0.5, max: 20, step: 0.1 },
      { key: "height", label: "Height", unit: "m", value: 0.9, min: 0.4, max: 1.5, step: 0.05 },
      { key: "radius", label: "Radius", unit: "m", value: 0.05, min: 0.02, max: 0.3, step: 0.01 },
    ],
  },
  planter: {
    label: "Planter",
    hint: "Planted build-out or median planting.",
    placement: "point",
    build: planter,
    fields: [
      { key: "length", label: "Length", unit: "m", value: 6.0, min: 1, max: 40, step: 0.5 },
      { key: "width", label: "Width", unit: "m", value: 1.5, min: 0.5, max: 8, step: 0.1 },
    ],
  },
  model: {
    label: "Blender model",
    hint: "A .glb authored in metres, origin on the ground, +Y forward.",
    placement: "point",
    build: model,
    fields: [
      { key: "url", label: "File", type: "text", value: "assets/models/example.glb" },
      { key: "scale", label: "Scale", unit: "x", value: 1, min: 0.01, max: 100, step: 0.01 },
      { key: "heading", label: "Rotation", unit: "°", value: 0, min: -180, max: 180, step: 1 },
      { key: "height", label: "Raise", unit: "m", value: 0, min: -5, max: 20, step: 0.1 },
    ],
  },
};

/** A new element of the given type, with its catalogue defaults filled in. */
export function makeElement(type, id, placement) {
  const entry = CATALOG[type];
  const element = { id, type, ...placement };
  for (const field of entry.fields) element[field.key] = field.value;
  return element;
}

/** Build the Cesium descriptors for one element. */
export function buildElement(frame, element, ctx) {
  const entry = CATALOG[element.type];
  if (!entry) {
    console.warn(`Unknown element type "${element.type}"`);
    return [];
  }
  return entry.build(frame, element, ctx);
}
