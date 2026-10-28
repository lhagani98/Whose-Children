/* Small chart helpers. Plain HTML/SVG so the charts pick up the page's colors
   in both light and dark mode. */

const Charts = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* rows: [{label, value, color?, display?, highlight?}] */
  function bars(rows, { max } = {}) {
    const valid = rows.filter((r) => r.value != null && !Number.isNaN(r.value));
    if (!valid.length) return `<p class="empty">No data for this view.</p>`;
    const top = max ?? Math.max(...valid.map((r) => r.value), 0.0001);
    return `<div class="bars">${rows.map((r) => {
      const w = r.value == null ? 0 : Math.max(0.5, (r.value / top) * 100);
      return `<div class="bar-row${r.highlight ? " is-hl" : ""}">
        <span class="bar-label">${esc(r.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${w}%;${r.color ? `background:${r.color}` : ""}"></span></span>
        <span class="bar-value">${esc(r.display ?? r.value ?? "n/a")}</span>
      </div>`;
    }).join("")}</div>`;
  }

  /* series: [{label, values:[...], color}], months: ["2025-08", ...] */
  function lines(series, months, { height = 170, yLabel = "" } = {}) {
    const W = 340, H = height, pad = { l: 34, r: 10, t: 10, b: 24 };
    const all = series.flatMap((s) => s.values).filter((v) => v != null);
    if (!all.length) return `<p class="empty">No data for this view.</p>`;
    const yMax = niceMax(Math.max(...all));
    const x = (i) => pad.l + (i / Math.max(1, months.length - 1)) * (W - pad.l - pad.r);
    const y = (v) => H - pad.b - (v / yMax) * (H - pad.t - pad.b);
    const ticks = [0, yMax / 2, yMax];
    const monthName = (m) => new Date(m + "-15").toLocaleString("en-US", { month: "short" });

    const grid = ticks.map((t) => `
      <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
      <text x="${pad.l - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${fmtTick(t)}</text>`).join("");
    const xt = months.map((m, i) => (i % 3 === 0 || i === months.length - 1)
      ? `<text x="${x(i)}" y="${H - 6}" class="tick" text-anchor="middle">${monthName(m)}</text>` : "").join("");
    const paths = series.map((s) => {
      const d = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(" L");
      return `<path d="M${d}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linejoin="round"/>`;
    }).join("");
    const legend = series.map((s) =>
      `<span class="key"><span class="swatch-line" style="background:${s.color}"></span>${esc(s.label)}</span>`).join("");

    return `<figure class="line-chart">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} by month">${grid}${xt}${paths}</svg>
      <figcaption class="legend-row">${legend}</figcaption>
    </figure>`;
  }

  /* Tiny monthly column chart for the district drawer */
  function spark(values, months) {
    const W = 300, H = 56, n = values.length || 1, gap = 2;
    const bw = (W - gap * (n - 1)) / n;
    const top = Math.max(1, ...values);
    const cols = values.map((v, i) => {
      const h = (v / top) * (H - 14);
      return `<rect x="${i * (bw + gap)}" y="${H - 12 - h}" width="${bw}" height="${Math.max(h, v > 0 ? 1.5 : 0)}" rx="1"><title>${months[i]}: ${v}</title></rect>`;
    }).join("");
    const first = months[0] ? new Date(months[0] + "-15").toLocaleString("en-US", { month: "short", year: "numeric" }) : "";
    const last = months.at(-1) ? new Date(months.at(-1) + "-15").toLocaleString("en-US", { month: "short", year: "numeric" }) : "";
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Complaints by month, peak ${top}">
      ${cols}
      <text x="0" y="${H - 1}" class="tick">${first}</text>
      <text x="${W}" y="${H - 1}" class="tick" text-anchor="end">${last}</text>
    </svg>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
  }
  function fmtTick(t) { return t >= 10 ? Math.round(t) : +t.toFixed(t < 1 ? 2 : 1); }

  return { bars, lines, spark, esc };
})();
