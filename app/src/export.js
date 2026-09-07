/**
 * Handing the design back to the tools it has to survive in.
 *
 * A 3D view is where a proposal is discussed; it is not where it is checked. These
 * exports exist so the same numbers can be opened in QGIS and in a spreadsheet
 * without being retyped, which is the only way the figures quoted in a report stay
 * reconciled with the figures in the scene.
 */

/**
 * Placed elements as GeoJSON in EPSG:4326, one feature per element, carrying its
 * corridor coordinate and its dimensions as properties.
 */
export function elementsToGeoJson(frame, cfg) {
  const features = [];

  for (const spec of cfg.elements) {
    if (spec.enabled === false) continue;

    const station = spec.station ?? (spec.fromStation + spec.toStation) / 2;
    const offset = spec.offset ?? 0;
    const p = frame.toDegrees(station, offset);

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [+p.longitude.toFixed(8), +p.latitude.toFixed(8)],
      },
      properties: {
        id: spec.id,
        type: spec.type,
        station_m: +station.toFixed(2),
        offset_m: +offset.toFixed(2),
        ...dimensionsOf(spec),
      },
    });
  }

  return {
    type: "FeatureCollection",
    name: cfg.corridor.name,
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    metadata: {
      status: cfg.provenance.status,
      axisSource: cfg.provenance.axisSource,
      sectionSource: cfg.provenance.sectionSource,
      note: cfg.provenance.note,
      workingCrs: cfg.crs.workingCrs,
      generated: new Date().toISOString(),
    },
    features,
  };
}

function dimensionsOf(spec) {
  const keys = ["width", "height", "length", "depth", "spacing", "scale", "url"];
  const out = {};
  for (const k of keys) if (spec[k] !== undefined) out[`${k}_m`] = spec[k];
  if (spec.url) {
    delete out.url_m;
    out.model_uri = spec.url;
  }
  return out;
}

/**
 * The cross-section as a comparison table: existing against proposed, band by band.
 * This is the artefact a reviewer actually argues with, so it is generated from the
 * same configuration the scene is drawn from rather than maintained alongside it.
 */
export function crossSectionCsv(cfg) {
  const rows = [["scenario", "band_id", "kind", "from_m", "to_m", "width_m", "lanes", "lane_width_m"]];

  const emit = (scenario, bands) => {
    for (const b of bands) {
      const width = b.to - b.from;
      rows.push([
        scenario,
        b.id,
        b.kind,
        b.from.toFixed(2),
        b.to.toFixed(2),
        width.toFixed(2),
        b.lanes ?? "",
        b.lanes ? (width / b.lanes).toFixed(2) : "",
      ]);
    }
  };

  emit("existing", cfg.crossSection.existing);
  emit("proposed", cfg.crossSection.proposed);

  return rows.map((r) => r.join(",")).join("\n");
}

/** Trigger a download of a generated file. */
export function download(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
