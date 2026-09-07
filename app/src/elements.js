/**
 * Parametric library of road-safety elements.
 *
 * Each generator takes a spec in corridor coordinates (station, offset, metres) and
 * returns Cesium entity descriptors. The point of generating these rather than
 * modelling them is that every element keeps its dimensions as data: a raised
 * crossing is 4.00 m wide because `width: 4.0` says so, and that number can be read
 * back out into a schedule, a drawing note or a GeoJSON export.
 *
 * Anything that cannot be described this way — a bespoke junction, a piece of street
 * furniture with real form — belongs in Blender and arrives through the `model`
 * generator as a georeferenced glTF.
 */

const C = window.Cesium;

/** Palette. Kept muted so the design reads as a proposal drawn over a real place. */
export const PALETTE = {
  carriageway: C.Color.fromCssColorString("#3a3f45").withAlpha(0.92),
  footway: C.Color.fromCssColorString("#b9b3a7").withAlpha(0.95),
  cycletrack: C.Color.fromCssColorString("#9c4a34").withAlpha(0.95),
  separator: C.Color.fromCssColorString("#d8d3c8"),
  median: C.Color.fromCssColorString("#6f7f5c"),
  raisedCrossing: C.Color.fromCssColorString("#c8c2b4"),
  stripe: C.Color.WHITE.withAlpha(0.95),
  planter: C.Color.fromCssColorString("#5f6f4d"),
  planterRim: C.Color.fromCssColorString("#9a9488"),
  bollard: C.Color.fromCssColorString("#e8e3d8"),
  buildOut: C.Color.fromCssColorString("#b9b3a7").withAlpha(0.95),
  outline: C.Color.BLACK.withAlpha(0.35),
};

/**
 * Outer extent of the carriageway, across however many bands it is split into.
 * A section with a central median has two carriageway bands but one kerb-to-kerb
 * width, and crossings have to span the latter.
 */
export function carriagewayExtent(section) {
  const bands = section.filter((b) => b.kind === "carriageway");
  if (bands.length === 0) return { from: -9, to: 9, width: 18, lanes: 0, laneWidth: 0 };
  const from = Math.min(...bands.map((b) => b.from));
  const to = Math.max(...bands.map((b) => b.to));
  const width = bands.reduce((sum, b) => sum + (b.to - b.from), 0);
  const lanes = bands.reduce((sum, b) => sum + (b.lanes ?? 0), 0);
  return { from, to, width, lanes, laneWidth: lanes ? width / lanes : 0 };
}

/**
 * Check that a cross-section tiles its corridor without gaps or overlaps.
 *
 * A gap is not a drawing error, it is a dimension nobody has decided yet, and it
 * will show up later as a figure in a report that does not add up. Failing loudly
 * here is cheaper than reconciling it afterwards.
 */
export function validateSection(section, label) {
  const sorted = [...section].sort((a, b) => a.from - b.from);
  const problems = [];

  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i].from - sorted[i - 1].to;
    if (Math.abs(gap) > 1e-6) {
      problems.push(
        `${label}: ${gap > 0 ? "gap" : "overlap"} of ${Math.abs(gap).toFixed(2)} m ` +
          `between "${sorted[i - 1].id}" and "${sorted[i].id}"`,
      );
    }
  }
  for (const p of problems) console.warn(p);
  return problems;
}

/**
 * A rectangular slab in corridor coordinates, extruded downwards from `top`.
 * This is the primitive nearly every flat element is built from.
 */
function slab(frame, { fromStation, toStation, fromOffset, toOffset, top = 0, thickness = 0.02 }) {
  const base = frame.originHeight + top;
  const corners = [
    frame.toCartesian(fromStation, fromOffset, top),
    frame.toCartesian(toStation, fromOffset, top),
    frame.toCartesian(toStation, toOffset, top),
    frame.toCartesian(fromStation, toOffset, top),
  ];
  return {
    hierarchy: new C.PolygonHierarchy(corners),
    perPositionHeight: true,
    extrudedHeight: base - thickness,
    closeTop: true,
    closeBottom: true,
  };
}

/**
 * Continuous surfaces for one cross-section: the deck the design sits on.
 *
 * When photorealistic context is clipped away over the intervention zone this deck
 * is what replaces it, so the proposal is stood on its own measured surface rather
 * than on a photogrammetric mesh whose road width is whatever the camera saw.
 */
export function crossSectionBands(frame, section, cfg, scenario) {
  const { treatedFrom, treatedTo } = cfg.corridor;
  const entities = [];

  for (const band of section) {
    const color = PALETTE[band.kind] ?? PALETTE.carriageway;
    // Footways and cycle tracks sit on a 0.15 m kerb upstand above the carriageway.
    const raised = band.kind === "footway" || band.kind === "cycletrack" || band.kind === "median";
    const top = raised ? 0.15 : 0.0;

    entities.push({
      id: `${scenario}-band-${band.id}`,
      name: `${band.kind} (${(band.to - band.from).toFixed(2)} m)`,
      polygon: {
        ...slab(frame, {
          fromStation: treatedFrom,
          toStation: treatedTo,
          fromOffset: band.from,
          toOffset: band.to,
          top,
          thickness: raised ? 0.15 : 0.05,
        }),
        material: color,
        outline: true,
        outlineColor: PALETTE.outline,
      },
      properties: { kind: band.kind, widthM: +(band.to - band.from).toFixed(2), ...band },
    });

    // Lane lines, so a narrowed carriageway is visibly narrowed rather than just darker.
    if (band.kind === "carriageway" && band.lanes > 1) {
      const usable = band.to - band.from;
      const laneWidth = usable / band.lanes;
      for (let i = 1; i < band.lanes; i += 1) {
        const at = band.from + laneWidth * i;
        entities.push({
          id: `${scenario}-lane-${band.id}-${i}`,
          polygon: {
            ...slab(frame, {
              fromStation: treatedFrom,
              toStation: treatedTo,
              fromOffset: at - 0.06,
              toOffset: at + 0.06,
              top: 0.01,
              thickness: 0.01,
            }),
            material: PALETTE.stripe,
          },
          properties: { kind: "laneLine", laneWidthM: +laneWidth.toFixed(2) },
        });
      }
    }
  }
  return entities;
}

/** A raised pedestrian crossing (plateau rialzato) spanning the carriageway. */
function raisedCrossing(frame, spec, cfg) {
  // Span every carriageway band, so a section split by a median still gets a
  // crossing that reaches kerb to kerb.
  const { from, to } = carriagewayExtent(cfg.crossSection.proposed);
  const half = spec.width / 2;
  const h = spec.height ?? 0.12;

  const out = [
    {
      id: spec.id,
      name: `Raised crossing ${spec.width.toFixed(2)} m x ${h.toFixed(2)} m rise`,
      polygon: {
        ...slab(frame, {
          fromStation: spec.station - half,
          toStation: spec.station + half,
          fromOffset: from,
          toOffset: to,
          top: h,
          thickness: h,
        }),
        material: PALETTE.raisedCrossing,
        outline: true,
        outlineColor: PALETTE.outline,
      },
      properties: { kind: "raisedCrossing", widthM: spec.width, riseM: h, station: spec.station },
    },
  ];

  // Zebra markings, laid across the direction of travel.
  const stripeCount = Math.floor((to - from) / 1.2);
  for (let i = 0; i < stripeCount; i += 1) {
    const o = from + 0.6 + i * 1.2;
    out.push({
      id: `${spec.id}-stripe-${i}`,
      polygon: {
        ...slab(frame, {
          fromStation: spec.station - half + 0.3,
          toStation: spec.station + half - 0.3,
          fromOffset: o,
          toOffset: o + 0.55,
          top: h + 0.01,
          thickness: 0.01,
        }),
        material: PALETTE.stripe,
      },
      properties: { kind: "marking" },
    });
  }
  return out;
}

/** A kerb build-out shortening the crossing distance at a crossing point. */
function kerbBuildOut(frame, spec) {
  const sign = Math.sign(spec.offset) || 1;
  return [
    {
      id: spec.id,
      name: `Kerb build-out ${spec.depth.toFixed(2)} m deep`,
      polygon: {
        ...slab(frame, {
          fromStation: spec.station - spec.length / 2,
          toStation: spec.station + spec.length / 2,
          fromOffset: spec.offset,
          toOffset: spec.offset - sign * spec.depth,
          top: 0.15,
          thickness: 0.15,
        }),
        material: PALETTE.buildOut,
        outline: true,
        outlineColor: PALETTE.outline,
      },
      properties: {
        kind: "kerbBuildOut",
        depthM: spec.depth,
        lengthM: spec.length,
        station: spec.station,
      },
    },
  ];
}

/** A single vertical bollard. */
function bollardAt(frame, id, station, offset, height = 0.9, radius = 0.05) {
  return {
    id,
    position: frame.toCartesian(station, offset, height / 2),
    cylinder: {
      length: height,
      topRadius: radius,
      bottomRadius: radius,
      material: PALETTE.bollard,
    },
    properties: { kind: "bollard", heightM: height, station, offset },
  };
}

/** A run of segregation kerb with flexible bollards at a fixed spacing. */
function separatorRun(frame, spec) {
  const out = [
    {
      id: spec.id,
      name: "Segregation kerb",
      polygon: {
        ...slab(frame, {
          fromStation: spec.fromStation,
          toStation: spec.toStation,
          fromOffset: spec.offset - 0.4,
          toOffset: spec.offset + 0.4,
          top: 0.12,
          thickness: 0.12,
        }),
        material: PALETTE.separator,
        outline: true,
        outlineColor: PALETTE.outline,
      },
      properties: {
        kind: "separator",
        lengthM: spec.toStation - spec.fromStation,
        spacingM: spec.spacing,
      },
    },
  ];

  const n = Math.floor((spec.toStation - spec.fromStation) / spec.spacing);
  for (let i = 0; i <= n; i += 1) {
    const s = spec.fromStation + i * spec.spacing;
    out.push(bollardAt(frame, `${spec.id}-b-${i}`, s, spec.offset, 0.9, 0.05));
  }
  return out;
}

/** A planted median island. */
function planter(frame, spec) {
  const half = spec.width / 2;
  return [
    {
      id: `${spec.id}-rim`,
      polygon: {
        ...slab(frame, {
          fromStation: spec.station - spec.length / 2,
          toStation: spec.station + spec.length / 2,
          fromOffset: spec.offset - half,
          toOffset: spec.offset + half,
          top: 0.25,
          thickness: 0.25,
        }),
        material: PALETTE.planterRim,
        outline: true,
        outlineColor: PALETTE.outline,
      },
      properties: { kind: "planter", lengthM: spec.length, widthM: spec.width },
    },
    {
      id: `${spec.id}-fill`,
      polygon: {
        ...slab(frame, {
          fromStation: spec.station - spec.length / 2 + 0.15,
          toStation: spec.station + spec.length / 2 - 0.15,
          fromOffset: spec.offset - half + 0.15,
          toOffset: spec.offset + half - 0.15,
          top: 0.45,
          thickness: 0.2,
        }),
        material: PALETTE.planter,
      },
      properties: { kind: "planting" },
    },
  ];
}

/**
 * A glTF/GLB exported from Blender, anchored at a corridor coordinate and rotated
 * to sit along the road. Author the model around its own origin with +Y forward and
 * in metres, and it lands in the right place with no further alignment.
 */
function model(frame, spec) {
  const position = frame.toCartesian(spec.station, spec.offset, spec.up ?? 0);
  const hpr = new C.HeadingPitchRoll(
    frame.heading + C.Math.toRadians(spec.headingOffset ?? 0),
    0,
    0,
  );
  return [
    {
      id: spec.id,
      name: spec.label ?? spec.id,
      position,
      orientation: C.Transforms.headingPitchRollQuaternion(position, hpr),
      model: {
        uri: spec.url,
        scale: spec.scale ?? 1.0,
        minimumPixelSize: 0,
      },
      properties: { kind: "model", source: spec.url, station: spec.station, offset: spec.offset },
    },
  ];
}

const GENERATORS = { raisedCrossing, kerbBuildOut, separatorRun, planter, model };

/** Build every enabled element in the configuration. */
export function buildElements(frame, cfg) {
  const out = [];
  for (const spec of cfg.elements) {
    if (spec.enabled === false) continue;
    const gen = GENERATORS[spec.type];
    if (!gen) {
      console.warn(`Unknown element type "${spec.type}" for "${spec.id}" — skipped.`);
      continue;
    }
    out.push(...gen(frame, spec, cfg));
  }
  return out;
}

export const elementTypes = Object.keys(GENERATORS);
