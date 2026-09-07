/**
 * The speed profile along the corridor.
 *
 * One measure over one continuous domain, so it is a line: median speed against
 * chainage, with the 15th-to-85th percentile spread as a band behind it. The band is
 * the same measure's dispersion, not a second series, so the chart carries one series
 * and needs no legend box — the title names it.
 *
 * The speed limit is drawn as a reference line rather than encoded in colour, so the
 * comparison a viewer is being invited to make is labelled rather than implied.
 */

const NS = "http://www.w3.org/2000/svg";

const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  series: "#2a78d6",
  band: "rgba(42, 120, 214, 0.18)",
  limit: "#d03b3b",
  sparse: "#898781",
};

const make = (tag, attrs = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/**
 * @param {HTMLElement} container
 * @param {Array} bins from binProfile
 * @param {{limit?:number, unit:string, onHover?:Function}} options
 */
export function renderProfile(container, bins, options = {}) {
  container.innerHTML = "";
  const withData = bins.filter((b) => b.v50 !== null);

  if (withData.length < 2) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = withData.length === 0
      ? "No speed observations fall inside the corridor."
      : "Only one bin has observations — too little to draw a profile.";
    container.append(empty);
    return;
  }

  // Build at the container's real pixel size rather than scaling a fixed viewBox up:
  // a viewBox stretched to twice its design width scales the type with it, and 8px
  // labels become 25px ones. Panels get resized, so this is re-measured on resize.
  const W = Math.max(240, Math.round(container.clientWidth || 600));
  const H = 156;
  // The right margin is reserved for the limit label, so it is drawn beside the plot
  // instead of on top of whatever the data is doing at that chainage.
  const M = { top: 12, right: 56, bottom: 22, left: 38 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const xMin = bins[0].station;
  const xMax = bins.at(-1).station;
  const speeds = withData.flatMap((b) => [b.v15, b.v85]);
  const yMax = Math.max(...speeds, options.limit ?? 0) * 1.1;
  const yMin = 0;

  const x = (v) => M.left + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const y = (v) => M.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const svg = make("svg", {
    viewBox: `0 0 ${W} ${H}`,
    width: W,
    height: H,
    role: "img",
    "aria-label": `Speed profile along the corridor in ${options.unit}`,
  });

  // Recessive gridlines and a value axis; chainage is labelled at the ends only,
  // which is all a panel this size can carry legibly.
  const ticks = niceTicks(yMax, 4);
  for (const tick of ticks) {
    svg.append(make("line", {
      x1: M.left, x2: W - M.right, y1: y(tick), y2: y(tick),
      stroke: INK.grid, "stroke-width": 1,
    }));
    const label = make("text", {
      x: M.left - 6, y: y(tick) + 3.5, "text-anchor": "end",
      fill: INK.muted, "font-size": 10,
    });
    label.textContent = String(tick);
    svg.append(label);
  }

  // The 15th-85th percentile band.
  const top = withData.map((b) => `${x(b.station)},${y(b.v85)}`);
  const bottom = [...withData].reverse().map((b) => `${x(b.station)},${y(b.v15)}`);
  svg.append(make("polygon", { points: [...top, ...bottom].join(" "), fill: INK.band }));

  // The speed limit, labelled.
  if (options.limit) {
    svg.append(make("line", {
      x1: M.left, x2: W - M.right, y1: y(options.limit), y2: y(options.limit),
      stroke: INK.limit, "stroke-width": 1.5, "stroke-dasharray": "4 3",
    }));
    const tag = make("text", {
      x: W - M.right + 6, y: y(options.limit) + 3.5, "text-anchor": "start",
      fill: INK.limit, "font-size": 10, "font-weight": 600,
    });
    tag.textContent = `limit ${Math.round(options.limit)}`;
    svg.append(tag);
  }

  // Median line, 2px, drawn over the band.
  svg.append(make("polyline", {
    points: withData.map((b) => `${x(b.station)},${y(b.v50)}`).join(" "),
    fill: "none", stroke: INK.series, "stroke-width": 2,
    "stroke-linejoin": "round", "stroke-linecap": "round",
  }));

  // Bins resting on very few observations are marked, so a dip that is really three
  // vehicles at a junction is not read as a finding.
  for (const bin of withData.filter((b) => b.sparse)) {
    svg.append(make("circle", {
      cx: x(bin.station), cy: y(bin.v50), r: 2.5,
      fill: "none", stroke: INK.sparse, "stroke-width": 1.5,
    }));
  }

  svg.append(make("line", {
    x1: M.left, x2: W - M.right, y1: M.top + plotH, y2: M.top + plotH,
    stroke: INK.axis, "stroke-width": 1,
  }));

  for (const [value, anchor] of [[xMin, "start"], [xMax, "end"]]) {
    const label = make("text", {
      x: x(value), y: H - 7, "text-anchor": anchor, fill: INK.muted, "font-size": 10,
    });
    label.textContent = `${Math.round(value)} m`;
    svg.append(label);
  }

  // Name the measure, since a single-series chart carries no legend.
  const caption = make("text", {
    x: M.left, y: M.top - 2, fill: INK.muted, "font-size": 10,
  });
  caption.textContent = `median, with 15th-85th percentile band (${options.unit})`;
  svg.append(caption);

  // Hover: a crosshair and a readout, which is what makes a small chart inspectable
  // rather than merely indicative.
  // An <svg> only receives pointer events where it is painted, so hovering a gap
  // between marks would do nothing. This transparent rect makes the whole plot a
  // target, which is what a crosshair needs.
  const capture = make("rect", {
    x: M.left, y: M.top, width: plotW, height: plotH, fill: "transparent",
  });
  svg.append(capture);

  const hoverLine = make("line", {
    y1: M.top, y2: M.top + plotH, stroke: INK.secondary,
    "stroke-width": 1, opacity: 0, "pointer-events": "none",
  });
  const hoverDot = make("circle", {
    r: 3.5, fill: INK.series, stroke: "#fff", "stroke-width": 1.5,
    opacity: 0, "pointer-events": "none",
  });
  svg.append(hoverLine, hoverDot);

  const readout = document.createElement("p");
  readout.className = "profile-readout";
  readout.textContent = " ";

  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    let nearest = withData[0];
    for (const bin of withData) {
      if (Math.abs(x(bin.station) - px) < Math.abs(x(nearest.station) - px)) nearest = bin;
    }
    hoverLine.setAttribute("x1", x(nearest.station));
    hoverLine.setAttribute("x2", x(nearest.station));
    hoverLine.setAttribute("opacity", 0.45);
    hoverDot.setAttribute("cx", x(nearest.station));
    hoverDot.setAttribute("cy", y(nearest.v50));
    hoverDot.setAttribute("opacity", 1);
    readout.textContent =
      `${Math.round(nearest.station)} m · v50 ${nearest.v50.toFixed(1)} · ` +
      `v85 ${nearest.v85.toFixed(1)} ${options.unit} · n ${nearest.n}`;
    options.onHover?.(nearest);
  });

  svg.addEventListener("pointerleave", () => {
    hoverLine.setAttribute("opacity", 0);
    hoverDot.setAttribute("opacity", 0);
    readout.textContent = " ";
    options.onHover?.(null);
  });

  container.append(svg, readout);

  // Re-render at the new width when the panel is resized, so the type never scales.
  if (typeof ResizeObserver !== "undefined" && !options.noObserve) {
    let last = container.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(container.clientWidth - last) < 8) return;
      last = container.clientWidth;
      observer.disconnect();
      renderProfile(container, bins, options);
    });
    observer.observe(container);
  }
}

/** Axis ticks on round numbers, at most `count` of them. */
function niceTicks(max, count) {
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const ticks = [];
  for (let v = 0; v <= max; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}
