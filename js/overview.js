/* overview.js: the "All five views" page.
   Draws a small map for each tab. Tabs that are switched on (ready: true in
   config.js) show their real colors; the rest show the outline of the state
   under a "Coming soon" label. */

(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = Charts.esc;
  const d = (x, k = 1) => (x == null ? "n/a" : (+x).toFixed(k));
  const n = (x) => (x == null ? "n/a" : Math.round(x).toLocaleString("en-US"));
  const get = (name) => fetch(CONFIG.dataDir + name).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  $("#o-foot").innerHTML = `<p>${CONFIG.credit}</p>`;

  const [geo, spots, faults] = await Promise.all([get("districts.geojson"), get("spotlights.json"), get("fault_lines.geojson")]);
  if (!geo) {
    $("#o-lenses").innerHTML = `<p class="empty">The map data didn't load. Open the site through a local web server (see the README).</p>`;
    return;
  }
  const byId = new Map(geo.features.map((ft) => [ft.properties.id, ft.properties]));

  /* ---- Simple projection: longitude scaled by cos(latitude) ---- */
  const W = 260, H = 230, PAD = 6;
  const rings = (g) => (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  geo.features.forEach((ft) => rings(ft.geometry).forEach((poly) => poly[0].forEach(([x, y]) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  })));
  const K = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
  const s = Math.min((W - 2 * PAD) / ((x1 - x0) * K), (H - 2 * PAD) / (y1 - y0));
  const ox = (W - (x1 - x0) * K * s) / 2, oy = (H - (y1 - y0) * s) / 2;
  const P = ([x, y]) => `${(ox + (x - x0) * K * s).toFixed(1)},${(oy + (y1 - y) * s).toFixed(1)}`;
  const paths = geo.features.map((ft) => ({
    p: ft.properties,
    d: rings(ft.geometry).map((poly) => poly.map((ring) => "M" + ring.map(P).join("L") + "Z").join("")).join(""),
  }));

  function colorer(L) {
    const vals = paths.map((x) => x.p[L.metric]).filter((v) => v != null && v > 0).sort((a, b) => a - b);
    if (!vals.length) return () => "#E2E5E2";
    const q = (t) => vals[Math.min(vals.length - 1, Math.floor(t * vals.length))];
    const b = [...new Set([q(0.2), q(0.4), q(0.6), q(0.8), vals.at(-1)])];
    return (p) => {
      const v = p[L.metric];
      if (v == null) return "#C6CBC9";
      if (v === 0) return "#E2E5E2";
      let i = b.findIndex((t) => v <= t); if (i < 0) i = b.length - 1;
      return L.ramp[b.length <= 1 ? 4 : Math.round((i / (b.length - 1)) * 4)];
    };
  }

  function miniMap(key, L) {
    const fill = L.ready ? colorer(L) : () => L.ramp[1];
    const body = paths.map(({ p, d }) => `<path d="${d}" fill="${fill(p)}"/>`).join("");
    const lines = L.ready && key === "complaints" && faults
      ? faults.features.slice(0, 40).map((ft) => {
          const g = ft.geometry, parts = g.type === "LineString" ? [g.coordinates] : g.coordinates;
          return parts.map((c) => `<path d="M${c.map(P).join("L")}" class="o-fault"/>`).join("");
        }).join("") : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="o-map" role="img" aria-label="${esc(L.label)} map">
      <g stroke="#fff" stroke-width="0.3">${body}</g>${lines}</svg>`;
  }

  $("#o-lenses").innerHTML = Object.entries(CONFIG.lenses).map(([k, L]) => `
    <a class="o-card${L.ready ? "" : " is-soon"}" href="./#lens=${k}">
      <div class="o-mapwrap">${miniMap(k, L)}${L.ready ? "" : `<span class="o-soon">Coming soon</span>`}</div>
      <p class="o-title">${esc(L.label)}</p>
    </a>`).join("");

  /* ---- Sharpest divide ---- */
  const top = faults?.features?.slice().sort((a, b) => b.properties.gap - a.properties.gap)[0];
  if (top) {
    const fp = top.properties, A = byId.get(fp.a_id), B = byId.get(fp.b_id);
    const side = (p) => `<div><p class="d-kicker">${esc(p.nces)}, ${esc((p.majority || "").toLowerCase())}</p>
      <h3>${esc(p.name)}</h3><table class="compare">${Object.entries(CONFIG.lenses).map(([k, L]) =>
        `<tr class="${L.ready ? "" : "is-soon"}"><th scope="row">${esc(k === "complaints" ? "Complaints per 10k" : L.metricLabel)}</th>
         <td>${!L.ready ? `${soonCellHTML}` : k === "complaints" ? d(p.rate) : n(p[L.metric])}</td></tr>`).join("")}</table></div>`;
    $("#o-pair").innerHTML = `<div class="o-box"><p class="d-kicker">A sharp divide</p>
      <h3 class="o-pairname">${esc(A.name)} and ${esc(B.name)}</h3>
      <p class="d-meta">Neighbors that share a border, ${d(fp.gap)} complaints per 10,000 students apart.</p>
      <div class="o-pair">${side(A)}${side(B)}</div>
      <a class="btn-primary" href="./#a=${encodeURIComponent(fp.a_id)}&b=${encodeURIComponent(fp.b_id)}">See them on the map</a></div>`;
  } else {
    $("#o-pair").innerHTML = `<p class="empty">No divides in the data yet.</p>`;
  }

  /* ---- Testimony pages ---- */
  $("#o-testimonies").innerHTML = `<div class="o-box o-tlist">${CONFIG.regions.map((r) => `
    <div><p class="o-region">${r}</p><ol>${(spots?.[r] || []).map((sp) =>
      `<li><a href="testimony.html?id=${encodeURIComponent(sp.id)}">${esc(sp.name)}</a>
       <span>${d(sp.obs_exp)} times the expected complaints</span></li>`).join("") || `<li class="empty">None yet</li>`}</ol></div>`).join("")}</div>`;
})();
