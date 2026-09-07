/**
 * Site, corridor and design parameters.
 *
 * Everything the demonstration depends on lives here: no dimension is hard-coded
 * anywhere else in the application. Swap this file to move the study to another
 * corridor without touching the rendering or geometry code.
 *
 * STATUS OF THE NUMBERS BELOW: they are demonstration defaults, not survey data.
 * The corridor axis was read off a basemap to roughly half a metre and the
 * cross-section uses standard Italian design values, not the as-built section of
 * Via dei Fori Imperiali. Before any figure in this scene is shown outside a
 * technical review, replace `corridor.axis` with the surveyed centreline and
 * `crossSection` with the measured section. See docs/APPROACH.md, "Accuracy
 * contract".
 */

export const config = {
  /** Free-text provenance shown in the UI so a viewer always knows what they are looking at. */
  provenance: {
    status: "prototype",
    axisSource: "approximate, read off basemap (± ~0.5 m)",
    sectionSource: "standard design values, not surveyed",
    note: "Demonstration geometry. Not an adopted design proposal.",
  },

  /**
   * Coordinate handling.
   *
   * The design is authored in a local East-North-Up frame in metres, anchored at
   * `origin`, and transformed to the globe exactly once at render time. This is
   * deliberate: it keeps a single reprojection at the boundary instead of a chain
   * of them, and it lets the design be authored in the metric terms an engineer
   * actually works in.
   *
   * `workingCrs` records the projected CRS the source data should be delivered in
   * so that offsets stated here are directly comparable with GIS/CAD sources.
   */
  crs: {
    workingCrs: "EPSG:32633", // UTM 33N, metric working CRS
    authoringFrame: "local ENU, metres, anchored at corridor.origin",
    exportCrs: "EPSG:4326", // web/GeoJSON output only
  },

  /** The corridor under study. */
  corridor: {
    name: "Via dei Fori Imperiali (demonstration corridor)",
    /**
     * Corridor axis as two geodetic endpoints. The local frame origin is placed at
     * `start`; chainage runs from `start` towards `end`.
     */
    axis: {
      start: { longitude: 12.48462, latitude: 41.89437 },
      end: { longitude: 12.48892, latitude: 41.89122 },
    },
    /** Ground height of the origin, metres above the ellipsoid. Approximate. */
    originHeight: 60.0,
    /**
     * Half-width of the intervention zone, metres either side of the axis. This
     * also drives the clipping polygon cut into the context tileset.
     */
    halfWidth: 22.0,
    /** Chainage window actually redesigned, metres from the start of the axis. */
    treatedFrom: 40.0,
    treatedTo: 430.0,
  },

  /**
   * Existing and proposed cross-section, as offsets from the axis in metres.
   * Negative offsets are to the left of the direction of travel (start -> end).
   *
   * Normative anchors for the proposed values:
   *   - lane widths: DM 5/11/2001, urban arterial
   *   - cycle track widths: DM 557/1999, art. 7 (1.50 m one-way, 2.50 m two-way)
   * These are the defaults; the surveyed section overrides them.
   */
  crossSection: {
    // Bands must tile the full 30.00 m corridor without gaps or overlaps. Lane width
    // is never stated here: it is derived from the band width and the lane count, so
    // there is one number to be wrong about instead of two that can disagree.
    existing: [
      { id: "footway-l", kind: "footway", from: -15.0, to: -9.0 },
      { id: "carriageway", kind: "carriageway", from: -9.0, to: 9.0, lanes: 4 },
      { id: "footway-r", kind: "footway", from: 9.0, to: 15.0 },
    ],
    proposed: [
      { id: "footway-l", kind: "footway", from: -15.0, to: -10.5 },
      { id: "cycletrack", kind: "cycletrack", from: -10.5, to: -8.0, twoWay: true },
      { id: "separator", kind: "separator", from: -8.0, to: -7.2 },
      { id: "carriageway-l", kind: "carriageway", from: -7.2, to: -0.7, lanes: 2 },
      { id: "median", kind: "median", from: -0.7, to: 0.7 },
      { id: "carriageway-r", kind: "carriageway", from: 0.7, to: 7.2, lanes: 2 },
      { id: "footway-r", kind: "footway", from: 7.2, to: 15.0 },
    ],
  },

  /**
   * Discrete elements placed along the corridor.
   *
   * Placement is by (station, offset) in metres — chainage along the axis and
   * lateral offset from it — which is how a road design is dimensioned, and which
   * survives a change of basemap or CRS unchanged.
   *
   * `type` selects a generator in src/elements.js. `model` elements instead load a
   * glTF/GLB exported from Blender; see docs/APPROACH.md, "Bringing Blender work in".
   */
  elements: [
    { id: "rc-1", type: "raisedCrossing", station: 90, offset: 0, width: 4.0, height: 0.12 },
    { id: "rc-2", type: "raisedCrossing", station: 250, offset: 0, width: 4.0, height: 0.12 },
    { id: "rc-3", type: "raisedCrossing", station: 390, offset: 0, width: 4.0, height: 0.12 },

    // Build-outs sit at the kerb line (offset 7.20) and extend into the carriageway,
    // shortening the crossing. They run longer than the crossing they serve so the
    // footway reads as bulging around it.
    { id: "bo-1", type: "kerbBuildOut", station: 90, offset: 7.2, length: 12, depth: 2.2 },
    { id: "bo-2", type: "kerbBuildOut", station: 250, offset: 7.2, length: 12, depth: 2.2 },
    { id: "bo-3", type: "kerbBuildOut", station: 390, offset: 7.2, length: 12, depth: 2.2 },

    // Segregation kerb on the centre line of the 0.80 m separator band.
    { id: "sep-1", type: "separatorRun", fromStation: 40, toStation: 430, offset: -7.6, spacing: 12 },

    // Planting sits inside the 1.40 m median.
    { id: "pl-1", type: "planter", station: 140, offset: 0, length: 18, width: 1.1 },
    { id: "pl-2", type: "planter", station: 190, offset: 0, length: 18, width: 1.1 },
    { id: "pl-3", type: "planter", station: 300, offset: 0, length: 18, width: 1.1 },
    { id: "pl-4", type: "planter", station: 345, offset: 0, length: 18, width: 1.1 },

    // Placeholder for a Blender export. Drop a .glb at the given url and it appears
    // here, oriented along the corridor. Left disabled so the demo runs with no assets.
    {
      id: "blender-1",
      type: "model",
      enabled: false,
      station: 200,
      offset: 11.5,
      headingOffset: 0,
      url: "assets/models/example.glb",
      label: "Blender export slot",
    },
  ],

  /** Rendering and interaction defaults. */
  view: {
    /**
     * Cesium ion access token.
     *
     * LEAVE THIS EMPTY. This file is tracked by git, so a token written here will be
     * committed and pushed, and a pushed credential has to be rotated rather than
     * edited out. Paste the token into the application instead — the status panel
     * offers a field for it when no token is present, and it is kept in the browser
     * on that machine only.
     *
     * The field exists for pinning a token deliberately in an unattended or kiosk
     * deployment, where there is no one to paste it in and the checkout is not shared.
     */
    ionToken: "",
    /** Set true to stream photorealistic context. Requires ionToken. */
    photorealisticContext: true,
    /**
     * Opening camera, expressed relative to the corridor rather than as absolute
     * angles: `skewDeg` rotates off the corridor bearing, `rangeFactor` multiplies
     * the treated length to set the standoff distance.
     */
    camera: { skewDeg: -52, pitchDeg: -28, rangeFactor: 1.15 },
    /** Time of day used by the day/night toggle, local Rome time. */
    daylight: { dayHour: 11, nightHour: 21 },
  },
};

export default config;
