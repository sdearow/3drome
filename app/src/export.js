/**
 * Handing the design back to the tools it has to survive in.
 *
 * A 3D view is where a proposal is discussed; it is not where it is checked. These
 * exports exist so the same numbers open in QGIS and in a spreadsheet without being
 * retyped, which is the only way figures quoted in a report stay reconciled with what
 * is on screen.
 */

import { CATALOG } from "./elements.js";
import { bandOffsets, sectionWidth } from "./project.js";

/** Placed elements as GeoJSON in EPSG:4326, one feature each, dimensions attached. */
export function elementsToGeoJson(frame, project) {
  const features = project.elements.map((element) => {
    const entry = CATALOG[element.type];
    const run = entry?.placement === "run";
    const station = run ? (element.fromStation + element.toStation) / 2 : element.station;
    const point = frame.toDegrees(station, element.offset ?? 0);

    const properties = {
      id: element.id,
      type: element.type,
      label: entry?.label ?? element.type,
      station_m: round(station),
      offset_m: round(element.offset ?? 0),
    };
    if (run) {
      properties.from_station_m = round(element.fromStation);
      properties.to_station_m = round(element.toStation);
      properties.length_m = round(Math.abs(element.toStation - element.fromStation));
    }
    for (const field of entry?.fields ?? []) {
      properties[field.unit === "m" ? `${field.key}_m` : field.key] = element[field.key];
    }

    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [round(point.longitude, 8), round(point.latitude, 8)] },
      properties,
    };
  });

  const axis = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [round(project.corridor.start.longitude, 8), round(project.corridor.start.latitude, 8)],
        [round(project.corridor.end.longitude, 8), round(project.corridor.end.latitude, 8)],
      ],
    },
    properties: { id: "corridor-axis", type: "axis", length_m: round(frame.length) },
  };

  return {
    type: "FeatureCollection",
    name: project.name,
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    metadata: {
      ...project.provenance,
      corridorLength_m: round(frame.length),
      generated: new Date().toISOString(),
    },
    features: [axis, ...features],
  };
}

/** The cross-section as a comparison table, generated from the widths being drawn. */
export function crossSectionCsv(project) {
  const rows = [["scenario", "order", "band_id", "kind", "from_m", "to_m", "width_m", "lanes", "lane_width_m"]];

  for (const scenario of ["existing", "proposed"]) {
    bandOffsets(project.sections[scenario]).forEach((band, index) => {
      rows.push([
        scenario,
        index + 1,
        band.id,
        band.kind,
        band.from.toFixed(2),
        band.to.toFixed(2),
        band.width.toFixed(2),
        band.lanes ?? "",
        band.lanes ? (band.width / band.lanes).toFixed(2) : "",
      ]);
    });
    rows.push([scenario, "", "TOTAL", "", "", "", sectionWidth(project.sections[scenario]).toFixed(2), "", ""]);
  }
  return rows.map((r) => r.join(",")).join("\n");
}

export function download(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function round(value, places = 2) {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
