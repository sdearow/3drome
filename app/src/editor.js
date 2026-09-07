/**
 * Interaction.
 *
 * The editor owns what a click means at any moment. There are three states: browsing,
 * drawing the corridor axis, and placing an element. Each one is entered deliberately
 * and leaves on its own once it has what it needs, so the map never silently changes
 * meaning under the cursor.
 *
 * Placement is by chainage and offset, because that is how a road design is
 * dimensioned. A click is converted to those two numbers immediately and the raw
 * coordinate is not kept.
 */

import { makeElement, CATALOG } from "./elements.js";
import { makeCorridor, defaultSection, takeId } from "./project.js";

const C = window.Cesium;

export class Editor {
  /**
   * @param {import("./scene.js").Scene} scene
   * @param {(project: object, options?: {rebuild?: boolean}) => void} onChange
   */
  constructor(scene, onChange) {
    this.scene = scene;
    this.onChange = onChange;
    this.state = { kind: "browse" };
    this.pendingPoints = [];

    this.handler = new C.ScreenSpaceEventHandler(scene.viewer.scene.canvas);
    this.handler.setInputAction((e) => this._onClick(e.position), C.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e) => this._onMove(e.endPosition), C.ScreenSpaceEventType.MOUSE_MOVE);

    this.listeners = { state: [], readout: [], select: [] };
  }

  on(event, fn) {
    this.listeners[event].push(fn);
    return this;
  }

  _emit(event, payload) {
    for (const fn of this.listeners[event]) fn(payload);
  }

  get project() {
    return this.scene.project;
  }

  /* -------------------------------------------------------------------- states */

  browse() {
    this._setState({ kind: "browse" });
  }

  /** Start drawing the corridor axis. Two clicks: start of the road, then the end. */
  drawAxis() {
    this.pendingPoints = [];
    this._setState({ kind: "draw-axis", need: 2 });
  }

  /** Start placing an element. Point types take one click, runs take two. */
  place(type) {
    if (!this.project?.corridor) return;
    this.pendingPoints = [];
    this._setState({ kind: "place", type, need: CATALOG[type].placement === "run" ? 2 : 1 });
  }

  cancel() {
    this.pendingPoints = [];
    this.scene.overlay.entities.removeAll();
    this.browse();
  }

  _setState(state) {
    this.state = state;
    this.scene.viewer.canvas.style.cursor = state.kind === "browse" ? "" : "crosshair";
    this._emit("state", state);
  }

  /* -------------------------------------------------------------------- events */

  _onMove(position) {
    if (this.state.kind === "browse") {
      const coord = this.scene.pickCorridorCoordinate(position);
      this._emit("readout", coord);
      return;
    }
    // While drawing, show the run being defined so its length is visible before it
    // is committed rather than after.
    if (this.pendingPoints.length === 1) {
      const point = this.scene.pickGround(position);
      if (point) this._drawGuide(this.pendingPoints[0], point);
    }
  }

  _onClick(position) {
    if (this.state.kind === "browse") {
      this._emit("select", this.scene.pickElementId(position));
      return;
    }

    const point = this.scene.pickGround(position);
    if (!point) return;

    this.pendingPoints.push(point);
    if (this.pendingPoints.length < this.state.need) {
      this._markPoint(point);
      return;
    }

    if (this.state.kind === "draw-axis") this._commitAxis();
    else this._commitElement();

    this.scene.overlay.entities.removeAll();
    this.pendingPoints = [];
    this.browse();
  }

  /* ------------------------------------------------------------------- commits */

  _commitAxis() {
    const [a, b] = this.pendingPoints.map((p) => C.Cartographic.fromCartesian(p));
    const toDeg = (c) => ({
      longitude: C.Math.toDegrees(c.longitude),
      latitude: C.Math.toDegrees(c.latitude),
    });

    const project = this.project;
    // Ground height comes from the clicked surface, so the design sits on the city
    // rather than at a guessed elevation.
    project.corridor = makeCorridor(toDeg(a), toDeg(b), (a.height + b.height) / 2);

    if (project.sections.existing.length === 0) {
      project.sections.existing = defaultSection().map((band) => ({
        ...band,
        id: takeId(project, "b"),
      }));
      project.sections.proposed = project.sections.existing.map((band) => ({
        ...band,
        id: takeId(project, "b"),
      }));
    }
    this.onChange(project, { rebuild: true, frame: true });
  }

  _commitElement() {
    const project = this.project;
    const frame = this.scene.frame;
    const coords = this.pendingPoints.map((p) => frame.fromCartesian(p));
    const type = this.state.type;

    const placement = CATALOG[type].placement === "run"
      ? {
          fromStation: round(coords[0].station),
          toStation: round(coords[1].station),
          offset: round((coords[0].offset + coords[1].offset) / 2),
        }
      : { station: round(coords[0].station), offset: round(coords[0].offset) };

    const element = makeElement(type, takeId(project, type), placement);
    project.elements.push(element);
    this.onChange(project, { rebuild: true, select: element.id });
  }

  /* ------------------------------------------------------------------ overlays */

  _markPoint(point) {
    this.scene.overlay.entities.add({
      position: point,
      point: {
        pixelSize: 10,
        color: C.Color.fromCssColorString("#f0c040"),
        outlineColor: C.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  _drawGuide(from, to) {
    this.scene.overlay.entities.removeAll();
    this._markPoint(from);

    const metres = C.Cartesian3.distance(from, to);
    this.scene.overlay.entities.add({
      polyline: {
        positions: [from, to],
        width: 3,
        material: C.Color.fromCssColorString("#f0c040"),
        clampToGround: false,
        depthFailMaterial: C.Color.fromCssColorString("#f0c040").withAlpha(0.5),
      },
    });
    this.scene.overlay.entities.add({
      position: to,
      label: {
        text: `${metres.toFixed(1)} m`,
        font: "600 13px sans-serif",
        fillColor: C.Color.WHITE,
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString("#12151a").withAlpha(0.85),
        pixelOffset: new C.Cartesian2(0, -22),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

function round(value) {
  return Math.round(value * 10) / 10;
}

export default Editor;
