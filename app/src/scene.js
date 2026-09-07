/**
 * Scene assembly.
 *
 * The scene is built in two zones with deliberately different accuracy claims:
 *
 *   Context zone      streamed photorealistic 3D tiles. Legible, recognisable, and
 *                     dimensionally unwarranted — it is a photogrammetric mesh, not
 *                     a survey. Nothing is measured off it.
 *
 *   Intervention zone the tiles are clipped away and replaced by geometry built from
 *                     the configured cross-section. Every dimension here is a number
 *                     someone chose and can defend.
 *
 * Keeping the boundary between the two explicit, and visible in the interface, is
 * the point of the whole application.
 */

import { CorridorFrame } from "./geo.js";
import { buildElements, crossSectionBands, PALETTE, validateSection } from "./elements.js";

const C = window.Cesium;

export class Scene {
  constructor(containerId, cfg) {
    this.cfg = cfg;
    this.frame = new CorridorFrame(
      cfg.corridor.axis.start,
      cfg.corridor.axis.end,
      cfg.corridor.originHeight,
    );

    this.hasToken = Boolean(cfg.view.ionToken);
    if (this.hasToken) C.Ion.defaultAccessToken = cfg.view.ionToken;

    this.viewer = new C.Viewer(containerId, {
      // Without a token there is no ion imagery or terrain to fall back on, so the
      // scene is built explicitly rather than relying on Cesium's defaults.
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
    this.viewer.cesiumWidget.creditContainer.style.display = "";

    clock.shouldAnimate = false;

    this.entities = { existing: [], proposed: [] };
    this.mode = "proposed";
    this.contextTileset = null;

    this._buildInterventionZone();
    this._setDaylight("day");
    this.setMode("proposed");
    this.resetCamera();
  }

  /* ------------------------------------------------------------------ context */

  /**
   * Stream photorealistic tiles and cut the intervention zone out of them.
   *
   * The clip is what makes the two zones coexist: without it the proposal would be
   * drawn on top of a photogrammetric road surface that is still visibly there,
   * with the old kerb lines showing through the new ones.
   */
  async loadContext() {
    if (!this.cfg.view.photorealisticContext) {
      return { loaded: false, code: "disabled", reason: "Context is switched off in the configuration." };
    }
    if (!this.hasToken) {
      return {
        loaded: false,
        code: "no-token",
        reason: "No Cesium ion token yet.",
        fix: "Sign up free at cesium.com/ion, copy your access token, and paste it into view.ionToken in app/src/config.js.",
      };
    }

    try {
      const tileset = await C.createGooglePhotorealistic3DTileset();
      tileset.clippingPolygons = this._clippingPolygons();
      this.viewer.scene.primitives.add(tileset);
      this.contextTileset = tileset;
      return { loaded: true };
    } catch (error) {
      console.error("Photorealistic context failed to load:", error);
      return { ...(await this._diagnose()), detail: String(error?.message ?? error) };
    }
  }

  /**
   * Work out why the context did not load.
   *
   * A rejected token and a proxy that blocks the request fail in much the same way
   * from inside the page, and the two need completely different responses — one is
   * a copy-paste, the other is a conversation with whoever runs the network. Asking
   * the ion API directly separates them.
   */
  async _diagnose() {
    const token = this.cfg.view.ionToken;
    try {
      const response = await fetch("https://api.cesium.com/v1/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status === 401 || response.status === 403) {
        return {
          loaded: false,
          code: "token-rejected",
          reason: "Cesium ion rejected the token.",
          fix: "Check it was copied whole, and that it has not been revoked or expired.",
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
      // The account is fine, so the tiles themselves are what could not be reached.
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
        fix: "A proxy or firewall is almost certainly blocking it. See docs/NETWORK.md for the hosts to allow.",
      };
    }
  }

  _clippingPolygons() {
    const { halfWidth, treatedFrom, treatedTo } = this.cfg.corridor;
    // A small margin beyond the treated length so the cut edge is hidden under the
    // design deck rather than landing exactly on it.
    const ring = this.frame.boundaryDegrees(halfWidth, treatedFrom - 6, treatedTo + 6);
    return new C.ClippingPolygonCollection({
      polygons: [
        new C.ClippingPolygon({ positions: C.Cartesian3.fromDegreesArray(ring) }),
      ],
    });
  }

  /* -------------------------------------------------------- intervention zone */

  _buildInterventionZone() {
    const { cfg, frame, viewer } = this;

    this.sectionProblems = [
      ...validateSection(cfg.crossSection.existing, "existing section"),
      ...validateSection(cfg.crossSection.proposed, "proposed section"),
    ];

    const add = (descriptors, bucket) => {
      for (const d of descriptors) {
        const entity = viewer.entities.add({ ...d, show: false });
        this.entities[bucket].push(entity);
      }
    };

    add(crossSectionBands(frame, cfg.crossSection.existing, cfg, "existing"), "existing");
    add(crossSectionBands(frame, cfg.crossSection.proposed, cfg, "proposed"), "proposed");
    add(buildElements(frame, cfg), "proposed");

    // Outline of the intervention zone, always visible, so the boundary of the
    // measured area is never ambiguous.
    const ring = frame.boundaryDegrees(
      cfg.corridor.halfWidth,
      cfg.corridor.treatedFrom - 6,
      cfg.corridor.treatedTo + 6,
    );
    this.zoneOutline = viewer.entities.add({
      id: "intervention-zone",
      name: "Intervention zone",
      polyline: {
        positions: C.Cartesian3.fromDegreesArrayHeights(
          ringWithHeight(ring, cfg.corridor.originHeight + 0.6),
        ),
        width: 2,
        material: new C.PolylineDashMaterialProperty({
          color: C.Color.fromCssColorString("#f0c040"),
        }),
        clampToGround: false,
      },
    });
  }

  /* ------------------------------------------------------------------ controls */

  /** Switch between the existing and the proposed cross-section. */
  setMode(mode) {
    this.mode = mode;
    for (const e of this.entities.existing) e.show = mode === "existing";
    for (const e of this.entities.proposed) e.show = mode === "proposed";
  }

  toggleMode() {
    this.setMode(this.mode === "proposed" ? "existing" : "proposed");
    return this.mode;
  }

  /**
   * Day and night. This drives the sun position, which is what actually matters for
   * a safety proposal: night is when lighting and conspicuity are argued about, so
   * it is a working view rather than a presentation flourish.
   */
  _setDaylight(which) {
    const hour = which === "night"
      ? this.cfg.view.daylight.nightHour
      : this.cfg.view.daylight.dayHour;
    // Rome is UTC+2 in summer time; the demonstration uses a fixed midsummer date.
    const iso = `2026-06-21T${String(hour - 2).padStart(2, "0")}:00:00Z`;
    this.viewer.clock.currentTime = C.JulianDate.fromIso8601(iso);
    this.daylight = which;

    const night = which === "night";
    this.viewer.scene.globe.baseColor = C.Color.fromCssColorString(night ? "#14171a" : "#2b2f33");
    if (this.contextTileset) {
      this.contextTileset.imageBasedLighting.imageBasedLightingFactor = night
        ? new C.Cartesian2(0.2, 0.2)
        : new C.Cartesian2(1.0, 1.0);
    }
  }

  toggleDaylight() {
    this._setDaylight(this.daylight === "day" ? "night" : "day");
    return this.daylight;
  }

  /** Show or hide the photorealistic context without unloading it. */
  setContextVisible(visible) {
    if (this.contextTileset) this.contextTileset.show = visible;
  }

  /**
   * Frame the treated length obliquely.
   *
   * The framing is derived from the corridor rather than stored as absolute angles,
   * so moving the study to another street — or lengthening this one — still opens on
   * a usable view instead of pointing at empty ground.
   */
  resetCamera() {
    const { treatedFrom, treatedTo } = this.cfg.corridor;
    const c = this.cfg.view.camera;
    const midpoint = this.frame.toCartesian((treatedFrom + treatedTo) / 2, 0, 0);
    const treatedLength = treatedTo - treatedFrom;

    this.viewer.camera.lookAt(
      midpoint,
      new C.HeadingPitchRange(
        this.frame.heading + C.Math.toRadians(c.skewDeg),
        C.Math.toRadians(c.pitchDeg),
        treatedLength * c.rangeFactor,
      ),
    );
    // Release the lookAt reference frame so the user keeps free navigation.
    this.viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  }

  /**
   * Report the corridor coordinate under a screen position. Click-to-place and the
   * cursor readout both use this, so a user reads chainage and offset rather than a
   * decimal coordinate they would have to convert before it meant anything.
   */
  pickCorridorCoordinate(windowPosition) {
    const scene = this.viewer.scene;
    const cartesian = scene.pickPosition
      ? scene.pickPosition(windowPosition)
      : undefined;
    const fallback = cartesian ?? this.viewer.camera.pickEllipsoid(windowPosition);
    if (!C.defined(fallback)) return null;
    return this.frame.fromCartesian(fallback);
  }
}

/** Interleave a flat [lon, lat, ...] ring with a constant height. */
function ringWithHeight(ring, height) {
  const out = [];
  for (let i = 0; i < ring.length; i += 2) out.push(ring[i], ring[i + 1], height);
  return out;
}

export { PALETTE };
export default Scene;
