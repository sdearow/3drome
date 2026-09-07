/**
 * Placement of design geometry on the globe.
 *
 * The design is authored in a local East-North-Up frame in metres and converted to
 * globe coordinates once, here. Nothing upstream of this module deals in longitude
 * and latitude, which keeps the design dimensioned the way it is drawn and reviewed
 * — chainage and lateral offset — and confines reprojection to a single boundary.
 */

const C = window.Cesium;

/**
 * A corridor frame: a local metric coordinate system aligned to a road axis.
 *
 * Coordinates within it are (station, offset, up):
 *   station - metres along the axis from its start
 *   offset  - metres perpendicular to the axis, positive to the right of the
 *             direction of travel
 *   up      - metres above the origin's ground height
 */
export class CorridorFrame {
  /**
   * @param {{longitude:number, latitude:number}} start axis start, degrees
   * @param {{longitude:number, latitude:number}} end axis end, degrees
   * @param {number} originHeight ground height at the origin, metres above the ellipsoid
   */
  constructor(start, end, originHeight) {
    this.origin = C.Cartesian3.fromDegrees(start.longitude, start.latitude, originHeight);
    this.originHeight = originHeight;

    // ENU -> ECEF at the axis start. Applied once, at the end of every placement.
    this.enuToFixed = C.Transforms.eastNorthUpToFixedFrame(this.origin);

    // Express the axis end in the same ENU frame to recover bearing and length.
    const endFixed = C.Cartesian3.fromDegrees(end.longitude, end.latitude, originHeight);
    const fixedToEnu = C.Matrix4.inverse(this.enuToFixed, new C.Matrix4());
    const endEnu = C.Matrix4.multiplyByPoint(fixedToEnu, endFixed, new C.Cartesian3());

    this.length = Math.hypot(endEnu.x, endEnu.y);

    // Unit vector along the axis, in ENU (x = east, y = north).
    this.axisEast = endEnu.x / this.length;
    this.axisNorth = endEnu.y / this.length;

    // Compass heading of the axis, radians clockwise from north.
    this.heading = Math.atan2(this.axisEast, this.axisNorth);
  }

  /**
   * Convert a corridor coordinate to ENU metres.
   * @returns {{east:number, north:number, up:number}}
   */
  toEnu(station, offset, up = 0) {
    // The right-hand normal of (axisEast, axisNorth) is (axisNorth, -axisEast).
    return {
      east: this.axisEast * station + this.axisNorth * offset,
      north: this.axisNorth * station - this.axisEast * offset,
      up,
    };
  }

  /** Convert a corridor coordinate to an ECEF position on the globe. */
  toCartesian(station, offset, up = 0) {
    const { east, north, up: u } = this.toEnu(station, offset, up);
    return C.Matrix4.multiplyByPoint(
      this.enuToFixed,
      new C.Cartesian3(east, north, u),
      new C.Cartesian3(),
    );
  }

  /** Convert a corridor coordinate to geodetic degrees, for export and readout. */
  toDegrees(station, offset, up = 0) {
    const carto = C.Cartographic.fromCartesian(this.toCartesian(station, offset, up));
    return {
      longitude: C.Math.toDegrees(carto.longitude),
      latitude: C.Math.toDegrees(carto.latitude),
      height: carto.height,
    };
  }

  /**
   * Invert a globe position back into corridor coordinates. Used by click-to-place,
   * so a user picking a point on the ground gets back a station and an offset rather
   * than a decimal coordinate they would have to interpret.
   * @returns {{station:number, offset:number, up:number}}
   */
  fromCartesian(cartesian) {
    const fixedToEnu = C.Matrix4.inverse(this.enuToFixed, new C.Matrix4());
    const enu = C.Matrix4.multiplyByPoint(fixedToEnu, cartesian, new C.Cartesian3());
    return {
      station: this.axisEast * enu.x + this.axisNorth * enu.y,
      offset: this.axisNorth * enu.x - this.axisEast * enu.y,
      up: enu.z,
    };
  }

  /**
   * Model matrix that places an object at a corridor coordinate, rotated to face
   * along the axis. This is what a Blender export is anchored with: the model is
   * authored around its own origin with +Y forward, and lands aligned to the road.
   * @param {number} headingOffset extra rotation in radians, clockwise
   */
  modelMatrix(station, offset, up = 0, headingOffset = 0) {
    const position = this.toCartesian(station, offset, up);
    const hpr = new C.HeadingPitchRoll(this.heading + headingOffset, 0, 0);
    return C.Transforms.headingPitchRollToFixedFrame(position, hpr);
  }

  /**
   * Polygon of the corridor edge as a flat array of degrees [lon, lat, ...],
   * in the order Cesium wants for a boundary ring.
   */
  boundaryDegrees(halfWidth, fromStation = 0, toStation = this.length, densify = 12) {
    const ring = [];
    const step = (toStation - fromStation) / densify;

    for (let i = 0; i <= densify; i += 1) {
      const s = fromStation + step * i;
      const p = this.toDegrees(s, -halfWidth);
      ring.push(p.longitude, p.latitude);
    }
    for (let i = densify; i >= 0; i -= 1) {
      const s = fromStation + step * i;
      const p = this.toDegrees(s, halfWidth);
      ring.push(p.longitude, p.latitude);
    }
    return ring;
  }
}

export default CorridorFrame;
