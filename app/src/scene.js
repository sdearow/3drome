/**
 * Scene assembly.
 *
 * Two zones with deliberately different accuracy claims: streamed photorealistic
 * tiles for context, and an intervention zone where those tiles are clipped away and
 * replaced by geometry the user authored. Keeping that boundary explicit, and visible
 * in the interface, is the point of the application.
 *
 * The scene is rebuilt from the project whenever the design changes. Rebuilding
 * wholesale rather than patching individual entities keeps one description of the
 * design — the project — instead of a model and a scene that can disagree.
 */

import { CorridorFrame } from "./geo.js";
import { buildElement, crossSectionBands, PALETTE } from "./elements.js";
import { bandOffsets } from "./project.js";

const C = window.Cesium;

export class Scene {
  constructor(containerId, settings) {
    this.settings = settings;
    this.frame = null;
    this.project = null;
    this.mode = "proposed";
    this.contextTileset = null;
    this.selectedId = null;

    this.viewer = new C.Viewer(containerId, {
      baseLayer: false,
      baseLayerPicker: false,
      terrainProvider: new C.EllipsoidTerrainProvider(),
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
    });

    const { scene, clock } = this.viewer;
    scene.globe.show = true;
    scene.globe.baseColor = C.Color.fromCssColorString("#2b2f33");
    scene.globe.enableLighting = true;
    scene.skyAtmosphere.show = true;
    scene.fog.enabled = true;
    scene.highDynamicRange = false;
    clock.shouldAnimate = false;

    // Design entities are kept in their own collections so a rebuild can clear them
    // without disturbing anything the editor draws on top.
    this.design = new C.CustomDataSource("design");
    this.overlay = new C.CustomDataSource("overlay");
    this.viewer.dataSources.add(this.design);
    this.viewer.dataSources.add(this.overlay);

    this.entities = { existing: [], proposed: [] };
    this._setDaylight("day");
  }

  /* ------------------------------------------------------------------ context */

  async loadContext(token) {
    if (!token) {
      return {
        loaded: false,
        code: "no-token",
        reason: "No Cesium ion token yet.",
        fix: "Sign up free at cesium.com/ion, copy your access token, and paste it below.",
      };
    }
    C.Ion.defaultAccessToken = token;

    try {
      const tileset = await C.createGooglePhotorealistic3DTileset();
      this.viewer.scene.primitives.add(tileset);
      this.contextTileset = tileset;
      this.applyClipping();
      return { loaded: true };
    } catch (error) {
      console.error("Photorealistic context failed to load:", error);
      return { ...(await this._diagnose(token)), detail: String(error?.message ?? error) };
    }
  }

  async _diagnose(token) {
    try {
      const response = await fetch("https://api.cesium.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        return {
          loaded: false,
          code: "token-rejected",
          reason: "Cesium ion rejected the token.",
          fix: "Check it was copied whole, and that it has not been revoked.",
        };
      }
      if (!response.ok) {
        return {
          loaded: false,
          code: "ion-error",
          reason: `Cesium ion answered ${response.status}.`,
          fix: "Usually temporary. If it persists, check status.cesium.com.",
        };
      }
      return {
        loaded: false,
        code: "tiles-unreachable",
        reason: "The account is fine, but the tiles could not be fetched.",
        fix: "Your network may allow api.cesium.com but block the tile hosts. See docs/NETWORK.md.",
      };
    } catch {
      return {
        loaded: false,
        code: "network-blocked",
        reason: "Could not reach Cesium ion at all.",
        fix: "A proxy or firewall is blocking it. See docs/NETWORK.md for the hosts to allow.",
      };
    }
  }

  /** Cut the intervention zone out of the context, or restore it when there is none. */
  applyClipping() {
    if (!this.contextTileset) return;

    if (!this.frame || !this.project?.corridor) {
      this.contextTileset.clippingPolygons = undefined;
      return;
    }
    const { corridor } = this.project;
    const to = corridor.treatedTo ?? this.frame.length;
    const ring = this.frame.boundaryDegrees(
      corridor.halfWidth,
      corridor.treatedFrom - 6,
      to + 6,
    );
    this.contextTileset.clippingPolygons = new C.ClippingPolygonCollection({
      polygons: [new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray(ring) })],
    });
  }

  setContextVisible(visible) {
    if (this.contextTileset) this.contextTileset.show = visible;
  }

  /* -------------------------------------------------------------------- design */

  /** Adopt a project and draw it. Called on load and after every edit. */
  setProject(project) {
    this.project = project;
    this.frame = project.corridor
      ? new CorridorFrame(
          project.corridor.start,
          project.corridor.end,
          project.corridor.originHeight,
        )
      : null;
    this.rebuild();
    this.applyClipping();
  }

  rebuild() {
    this.design.entities.removeAll();
    this.entities = { existing: [], proposed: [] };

    const { project, frame } = this;
    if (!project || !frame || !project.corridor) return;

    const add = (descriptors, bucket) => {
      for (const d of descriptors) {
        this.entities[bucket].push(this.design.entities.add({ ...d, show: false }));
      }
    };

    const existingBands = bandOffsets(project.sections.existing);
    const proposedBands = bandOffsets(project.sections.proposed);

    add(crossSectionBands(frame, existingBands, project.corridor, "existing"), "existing");
    add(crossSectionBands(frame, proposedBands, project.corridor, "proposed"), "proposed");

    // Elements belong to the proposal: they are what is being added.
    const ctx = { bands: proposedBands, corridor: project.corridor };
    for (const element of project.elements) {
      const descriptors = buildElement(frame, element, ctx).map((d) => ({
        ...d,
        properties: { elementId: element.id },
      }));
      add(descriptors, "proposed");
    }

    this._drawZoneOutline();
    this.setMode(this.mode);
    this.highlight(this.selectedId);
  }

  _drawZoneOutline() {
    const { corridor } = this.project;
    const to = corridor.treatedTo ?? this.frame.length;
    const ring = this.frame.boundaryDegrees(corridor.halfWidth, corridor.treatedFrom - 6, to + 6);
    const positions = [];
    for (let i = 0; i < ring.length; i += 2) {
      positions.push(ring[i], ring[i + 1], this.frame.originHeight + 0.6);
    }
    this.design.entities.add({
      id: "intervention-zone",
      polyline: {
        positions: C.Cartesian3.fromDegreesArrayHeights(positions),
        width: 2,
        material: new C.PolylineDashMaterialProperty({
          color: C.Color.fromCssColorString("#f0c040"),
        }),
      },
    });
  }

  setMode(mode) {
    this.mode = mode;
    for (const e of this.entities.existing) e.show = mode === "existing";
    for (const e of this.entities.proposed) e.show = mode === "proposed";
  }

  toggleMode() {
    this.setMode(this.mode === "proposed" ? "existing" : "proposed");
    return this.mode;
  }

  /** Outline whichever entities belong to the selected element. */
  highlight(elementId) {
    this.selectedId = elementId;
    for (const entity of this.design.entities.values) {
      const owner = entity.properties?.elementId?.getValue?.();
      const selected = Boolean(elementId) && owner === elementId;
      if (entity.polygon) {
        entity.polygon.outlineColor = selected ? PALETTE.selected : PALETTE.outline;
        entity.polygon.outlineWidth = selected ? 3 : 1;
      }
      if (entity.cylinder) {
        entity.cylinder.material = selected ? PALETTE.selected : PALETTE.bollard;
      }
    }
  }

  /** The element id under a screen position, if any. */
  pickElementId(windowPosition) {
    const picked = this.viewer.scene.pick(windowPosition);
    return picked?.id?.properties?.elementId?.getValue?.() ?? null;
  }


  /* ---------------------------------------------------------------------- fcd */

  /**
   * Draw floating car data as points on the corridor.
   *
   * Colour is diverging around the speed limit rather than a plain magnitude ramp:
   * in a safety context the question is not how fast, it is how fast relative to what
   * is posted, and that is a polarity with a meaningful midpoint. Below the limit
   * reads cool, above it reads warm, and at it the colour falls away to neutral.
   *
   * Points are drawn as a primitive collection rather than entities — entities cost
   * far too much per item at these counts.
   */
  showFcd(points, { limit, spread = 20 }) {
    this.clearFcd();
    if (!this.frame || points.length === 0) return;

    const collection = this.viewer.scene.primitives.add(new C.PointPrimitiveCollection());
    for (const point of points) {
      collection.add({
        position: this.frame.toCartesian(point.station, point.offset, 1.2),
        color: speedColor(point.speed, limit, spread),
        pixelSize: 5,
        outlineWidth: 0,
      });
    }
    this.fcdPoints = collection;
  }

  clearFcd() {
    if (this.fcdPoints) {
      this.viewer.scene.primitives.remove(this.fcdPoints);
      this.fcdPoints = null;
    }
    this.clearFcdMarker();
  }

  setFcdVisible(visible) {
    if (this.fcdPoints) this.fcdPoints.show = visible;
  }

  /** Mark the chainage the profile chart is hovering, so the two views are linked. */
  markChainage(station) {
    this.clearFcdMarker();
    if (station === null || !this.frame) return;

    const halfWidth = this.project?.corridor?.halfWidth ?? 20;
    this.fcdMarker = this.overlay.entities.add({
      polyline: {
        positions: [
          this.frame.toCartesian(station, -halfWidth, 1),
          this.frame.toCartesian(station, halfWidth, 1),
        ],
        width: 4,
        material: C.Color.fromCssColorString("#2a78d6"),
        depthFailMaterial: C.Color.fromCssColorString("#2a78d6").withAlpha(0.6),
      },
    });
  }

  clearFcdMarker() {
    if (this.fcdMarker) {
      this.overlay.entities.remove(this.fcdMarker);
      this.fcdMarker = null;
    }
  }

  /* ------------------------------------------------------------------ controls */

  _setDaylight(which) {
    const hour = which === "night"
      ? this.settings.daylight.nightHour
      : this.settings.daylight.dayHour;
    const iso = `2026-06-21T${String(hour - 2).padStart(2, "0")}:00:00Z`;
    this.viewer.clock.currentTime = C.JulianDate.fromIso8601(iso);
    this.daylight = which;
    this.viewer.scene.globe.baseColor = C.Color.fromCssColorString(
      which === "night" ? "#14171a" : "#2b2f33",
    );
  }

  toggleDaylight() {
    this._setDaylight(this.daylight === "day" ? "night" : "day");
    return this.daylight;
  }

  /** Frame the corridor obliquely, derived from its own length. */
  resetCamera() {
    if (!this.frame || !this.project?.corridor) return false;
    const { corridor } = this.project;
    const to = corridor.treatedTo ?? this.frame.length;
    const midpoint = this.frame.toCartesian((corridor.treatedFrom + to) / 2, 0, 0);
    const length = Math.max(to - corridor.treatedFrom, 30);
    const cam = this.settings.camera;

    this.viewer.camera.lookAt(
      midpoint,
      new C.HeadingPitchRange(
        this.frame.heading + C.Math.toRadians(cam.skewDeg),
        C.Math.toRadians(cam.pitchDeg),
        length * cam.rangeFactor,
      ),
    );
    this.viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
    return true;
  }

  /** Fly to a geodetic point, used when a project is opened or a place searched. */
  flyToPoint(longitude, latitude, height = 400) {
    this.viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(longitude, latitude, height),
      orientation: { heading: 0, pitch: C.Math.toRadians(-45), roll: 0 },
      duration: 1.5,
    });
  }

  /**
   * The ground point under a screen position.
   * Picks against rendered geometry first, so a click lands on the photorealistic
   * surface at its real height rather than on the ellipsoid far below it.
   */
  pickGround(windowPosition) {
    const scene = this.viewer.scene;
    const picked = scene.pickPosition(windowPosition);
    if (C.defined(picked)) return picked;
    return this.viewer.camera.pickEllipsoid(windowPosition) ?? null;
  }

  /** Corridor coordinates under a screen position, once an axis exists. */
  pickCorridorCoordinate(windowPosition) {
    if (!this.frame) return null;
    const point = this.pickGround(windowPosition);
    return point ? this.frame.fromCartesian(point) : null;
  }
}

/**
 * Diverging colour around the speed limit: cool below, neutral at, warm above.
 *
 * A plain magnitude ramp would answer "how fast", but the question a safety case
 * asks is "how fast relative to what is posted" — a polarity with a meaningful
 * midpoint, which is what diverging encoding is for. `spread` is how far from the
 * limit, in the data's own units, the ramp reaches full saturation.
 */
function speedColor(speed, limit, spread) {
  if (speed === undefined || speed === null || Number.isNaN(speed)) {
    return C.Color.fromCssColorString("#898781").withAlpha(0.75);
  }
  if (!limit) {
    // With no limit to compare against, fall back to a single-hue magnitude ramp.
    const t = Math.min(1, Math.max(0, speed / (spread * 3)));
    return C.Color.lerp(
      C.Color.fromCssColorString("#cde2fb"),
      C.Color.fromCssColorString("#0d366b"),
      t,
      new C.Color(),
    );
  }
  const t = Math.max(-1, Math.min(1, (speed - limit) / spread));
  const neutral = C.Color.fromCssColorString("#b9b6ae");
  const pole = t >= 0
    ? C.Color.fromCssColorString("#d03b3b")
    : C.Color.fromCssColorString("#2a78d6");
  return C.Color.lerp(neutral, pole, Math.abs(t), new C.Color()).withAlpha(0.95);
}

export default Scene;
