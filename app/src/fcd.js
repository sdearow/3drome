/**
 * Floating car data.
 *
 * FCD is what turns "this lane is too wide" into "vehicles do 52 km/h along it".
 * The corridor makes that tractable: once an axis exists, every GPS fix has a
 * chainage and an offset, and a scatter of points becomes a speed profile along the
 * road — which is the form the argument is actually made in.
 *
 * Nothing here touches Cesium or the DOM, so it can be tested on its own. Projection
 * is passed in as a function rather than imported, for the same reason.
 */

/** The 85th percentile speed and its relatives, the standard speed-management metrics. */
export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return NaN;
  if (sortedValues.length === 1) return sortedValues[0];
  const rank = (p / 100) * (sortedValues.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sortedValues[low];
  return sortedValues[low] + (rank - low) * (sortedValues[high] - sortedValues[low]);
}

export function summarise(speeds, limit) {
  const sorted = [...speeds].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0 };
  return {
    n,
    mean: sorted.reduce((a, b) => a + b, 0) / n,
    v15: percentile(sorted, 15),
    v50: percentile(sorted, 50),
    v85: percentile(sorted, 85),
    min: sorted[0],
    max: sorted[n - 1],
    overLimit: limit ? sorted.filter((v) => v > limit).length / n : null,
  };
}

/* ------------------------------------------------------------------- parsing */

/**
 * Work out how a delimited file is punctuated before reading it.
 *
 * Italian exports are commonly semicolon-separated with a decimal comma, and a
 * parser that assumes otherwise turns 12,4864 into two columns and a wrong number
 * rather than failing outright — which is worse than failing.
 */
export function sniffFormat(text) {
  const firstLines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  const counts = { ";": 0, ",": 0, "\t": 0 };
  for (const line of firstLines) {
    for (const d of Object.keys(counts)) counts[d] += line.split(d).length - 1;
  }
  const delimiter = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  // A decimal comma only makes sense when the comma is not the separator, and shows
  // up as digit,digit inside fields.
  const decimalComma =
    delimiter !== "," && /\d+,\d+/.test(firstLines.slice(1).join("\n"));

  return { delimiter, decimalComma };
}

const COLUMN_PATTERNS = {
  latitude: /^(lat|latitude|latitudine|y|lat_?deg|gps_?lat)$/i,
  longitude: /^(lon|lng|long|longitude|longitudine|x|lon_?deg|gps_?lon)$/i,
  speed: /^(speed|spd|velocita|velocità|vel|kmh|km_?h|speed_?kmh|v)$/i,
  time: /^(time|timestamp|datetime|data_?ora|datahora|ts|date|instante?)$/i,
  id: /^(id|vehicle_?id|veh_?id|trip_?id|track_?id|device_?id|mezzo)$/i,
  heading: /^(heading|bearing|dir|direzione|course)$/i,
};

/** Match header names to the roles the visualisation needs. */
export function detectColumns(headers) {
  const mapping = {};
  for (const [role, pattern] of Object.entries(COLUMN_PATTERNS)) {
    const index = headers.findIndex((h) => pattern.test(h.trim()));
    if (index >= 0) mapping[role] = index;
  }
  return mapping;
}

function toNumber(raw, decimalComma) {
  if (raw === undefined || raw === null) return NaN;
  let s = String(raw).trim().replace(/^"|"$/g, "");
  if (s === "") return NaN;
  if (decimalComma) s = s.replace(/\./g, "").replace(",", ".");
  return Number(s);
}

/**
 * Read a delimited FCD file into points.
 *
 * Returns warnings rather than throwing on the recoverable problems, because a file
 * with some unparseable rows is still worth looking at as long as the count is
 * visible.
 */
export function parseDelimited(text, overrides = {}) {
  const format = { ...sniffFormat(text), ...overrides };
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    return { points: [], warnings: ["The file has no data rows."], format };
  }

  const headers = splitRow(lines[0], format.delimiter);
  const mapping = { ...detectColumns(headers), ...(overrides.mapping ?? {}) };
  const warnings = [];

  if (mapping.latitude === undefined || mapping.longitude === undefined) {
    return {
      points: [],
      headers,
      mapping,
      format,
      warnings: [
        `Could not find latitude and longitude columns among: ${headers.join(", ")}.`,
      ],
    };
  }

  const points = [];
  let skipped = 0;
  let projectedLooking = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitRow(lines[i], format.delimiter);
    const lat = toNumber(cells[mapping.latitude], format.decimalComma);
    const lon = toNumber(cells[mapping.longitude], format.decimalComma);

    if (Number.isNaN(lat) || Number.isNaN(lon)) {
      skipped += 1;
      continue;
    }
    // Values this large are metres in a projected CRS, not degrees. Counting them
    // lets the caller say so plainly instead of plotting the file into the ocean.
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      projectedLooking += 1;
      continue;
    }

    const point = { lon, lat };
    if (mapping.speed !== undefined) {
      const speed = toNumber(cells[mapping.speed], format.decimalComma);
      if (!Number.isNaN(speed)) point.speed = speed;
    }
    if (mapping.time !== undefined) point.time = cells[mapping.time]?.trim();
    if (mapping.id !== undefined) point.id = cells[mapping.id]?.trim();
    points.push(point);
  }

  if (projectedLooking > 0) {
    warnings.push(
      `${projectedLooking.toLocaleString()} rows have coordinates outside the range of ` +
        `degrees — they look like a projected CRS (EPSG:3004, 25833, 32633). ` +
        `Reproject to EPSG:4326 before loading.`,
    );
  }
  if (skipped > 0) warnings.push(`${skipped.toLocaleString()} rows had unreadable coordinates.`);
  if (mapping.speed === undefined) warnings.push("No speed column found — points will show position only.");

  return { points, headers, mapping, format, warnings };
}

/** Split one row, honouring simple double-quoted fields. */
function splitRow(line, delimiter) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/** GeoJSON input, for data already prepared in QGIS. */
export function parseGeoJson(text) {
  const data = JSON.parse(text);
  const features = data.type === "FeatureCollection" ? data.features : [data];
  const points = [];
  const warnings = [];

  for (const feature of features) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    const props = feature.properties ?? {};
    const speedKey = Object.keys(props).find((k) => COLUMN_PATTERNS.speed.test(k));

    const push = ([lon, lat]) => {
      const point = { lon, lat };
      if (speedKey !== undefined) {
        const v = Number(props[speedKey]);
        if (!Number.isNaN(v)) point.speed = v;
      }
      points.push(point);
    };

    if (geometry.type === "Point") push(geometry.coordinates);
    else if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
      geometry.coordinates.forEach(push);
    } else if (geometry.type === "MultiLineString") {
      geometry.coordinates.flat().forEach(push);
    }
  }
  if (points.length === 0) warnings.push("No point or line geometries found.");
  return { points, warnings, format: { delimiter: null, decimalComma: false } };
}

/* ---------------------------------------------------------------- speed units */

/**
 * Guess whether speeds are m/s or km/h.
 *
 * Urban FCD in km/h tops out somewhere in the tens; the same data in m/s rarely
 * passes 30. The guess is offered to the user rather than applied silently, because
 * getting it wrong scales every figure by 3.6.
 */
export function guessSpeedUnit(speeds) {
  const sorted = [...speeds].sort((a, b) => a - b);
  if (sorted.length === 0) return { unit: "kmh", confident: false };
  const p95 = percentile(sorted, 95);
  if (p95 <= 35) return { unit: "ms", confident: p95 < 25, p95 };
  return { unit: "kmh", confident: p95 > 45, p95 };
}

/* ------------------------------------------------------------------ profiling */

/**
 * Attach chainage and offset to each point and drop those outside the corridor.
 * @param {(lon:number, lat:number) => {station:number, offset:number}} project
 */
export function projectToCorridor(points, project, { halfWidth, from, to }) {
  const inside = [];
  for (const point of points) {
    const { station, offset } = project(point.lon, point.lat);
    if (Math.abs(offset) > halfWidth) continue;
    if (station < from || station > to) continue;
    inside.push({ ...point, station, offset });
  }
  return inside;
}

/**
 * Speed percentiles in chainage bins — the profile itself.
 *
 * Bins with too few observations are kept but flagged, so a dip in the line that is
 * really three vehicles at a junction can be seen for what it is rather than read as
 * a finding.
 */
export function binProfile(points, { binSize, from, to, minSamples = 5 }) {
  const count = Math.max(1, Math.ceil((to - from) / binSize));
  const buckets = Array.from({ length: count }, () => []);

  for (const point of points) {
    if (point.speed === undefined) continue;
    const index = Math.min(count - 1, Math.floor((point.station - from) / binSize));
    if (index >= 0) buckets[index].push(point.speed);
  }

  return buckets.map((speeds, i) => {
    const sorted = speeds.sort((a, b) => a - b);
    return {
      station: from + binSize * (i + 0.5),
      n: sorted.length,
      sparse: sorted.length > 0 && sorted.length < minSamples,
      v15: sorted.length ? percentile(sorted, 15) : null,
      v50: sorted.length ? percentile(sorted, 50) : null,
      v85: sorted.length ? percentile(sorted, 85) : null,
    };
  });
}

/** Reduce a very large set to something a browser can draw, without bias. */
export function sampleEvenly(points, cap) {
  if (points.length <= cap) return { sample: points, sampled: false };
  const stride = points.length / cap;
  const sample = [];
  for (let i = 0; i < cap; i += 1) sample.push(points[Math.floor(i * stride)]);
  return { sample, sampled: true };
}
