/* =============================================================================
   main.js: map, tabs, filters, district drawer, sharpest divides, spotlights.
   Reads the files export_site_data.R writes to /data.
   Tabs whose `ready` flag is false in config.js show "Data coming soon".
   ============================================================================= */

(async function () {
  const $ = (sel) => document.querySelector(sel);
  const esc = Charts.esc;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const f = {
    n: (x) => (x == null ? "n/a" : Math.round(x).toLocaleString("en-US")),
    pct: (x) => (x == null ? "n/a" : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`),
    pct1: (x) => (x == null ? "NA" : `${+(x * 100).toFixed(1)}%`),   // same as fmt_pct() in the Rmd
    d: (x, k = 1) => (x == null ? "n/a" : (+x).toFixed(k)),
  };
  const soonCell = soonCellHTML;

  /* ---------------- State ---------------- */
  const state = {
    lens: "complaints",
    colorBy: "metric",
    nces: new Set(),
    majority: new Set(),
    selected: null,       // district id, or {a, b, info} for a divide
    spotRegion: CONFIG.regions[0],
  };
  const breakCache = {};
  const lensKeys = Object.keys(CONFIG.lenses);
  const isReady = (k) => !!CONFIG.lenses[k]?.ready;

  /* ---------------- Tabs ---------------- */
  $("#lens-nav").innerHTML = lensKeys.map((k) => {
    const L = CONFIG.lenses[k];
    return `<button type="button" data-lens="${k}" aria-pressed="false">${esc(L.label)}${L.ready ? "" : ` <span class="tab-soon">soon</span>`}</button>`;
  }).join("");

  /* ---------------- Load data ---------------- */
  async function load(name, optional = false) {
    try {
      const r = await fetch(CONFIG.dataDir + name);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return await r.json();
    } catch (err) {
      if (optional) return null;
      throw new Error(`Could not load data/${name} (${err.message}).`);
    }
  }

  let geo, S, spots, details, faults;
  try {
    [geo, S, spots, details, faults] = await Promise.all([
      load("districts.geojson"), load("summary.json"), load("spotlights.json", true),
      load("district_details.json", true), load("fault_lines.geojson", true),
    ]);
  } catch (err) {
    $("#lens-intro").innerHTML = `<h1>The map data didn't load</h1>
      <p class="empty">${esc(err.message)} Open the site through a local web server
      (see README, "Launch the site on your computer") rather than by double-clicking
      index.html, and check that export_site_data.R has run.</p>`;
    $("#splash").hidden = true;
    return;
  }
  spots = spots || {};
  details = details || {};

  // Point layers only for tabs that are switched on
  const pointData = {};
  await Promise.all(lensKeys.filter((k) => isReady(k) && CONFIG.lenses[k].points).map(async (k) => {
    pointData[k] = await load(CONFIG.lenses[k].points, true);
  }));

  const byId = new Map(geo.features.map((ft) => [ft.properties.id, ft.properties]));
  const groupStats = {
    nces: Object.fromEntries((S.by_nces || []).map((r) => [r.group, r])),
    majority: Object.fromEntries((S.by_majority || []).map((r) => [r.group, r])),
  };
  if (S.demo) $("#splash-demo").hidden = false;

  /* ---------------- Map ---------------- */
  const map = L.map("map", { zoomSnap: 0.25, preferCanvas: true }).setView(CONFIG.mapCenter, CONFIG.mapZoom);
  const canvas = L.canvas({ tolerance: 5 });

  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  let tiles;
  function setTiles() {
    if (tiles) map.removeLayer(tiles);
    const style = dark.matches ? "dark_nolabels" : "light_nolabels";
    tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd", maxZoom: 14,
    }).addTo(map);
    tiles.bringToBack();
  }
  setTiles();

  const layerById = new Map();
  const districtLayer = L.geoJSON(geo, {
    renderer: canvas,
    style: (ft) => styleFor(ft.properties),
    onEachFeature: (ft, layer) => {
      layerById.set(ft.properties.id, layer);
      layer.on("click", () => selectDistrict(ft.properties.id));
      layer.on("mouseover", () => layer.setStyle({ weight: 1.6, color: css("--ink") }));
      layer.on("mouseout", () => layer.setStyle(styleFor(ft.properties)));
      layer.bindTooltip(() => tooltipFor(ft.properties), { sticky: true, className: "tip", direction: "top" });
    },
  }).addTo(map);

  // Sharpest divides: a pale casing under a red line, thicker for bigger gaps
  let faultLayer = null;
  if (faults && faults.features.length) {
    const gaps = faults.features.map((x) => x.properties.gap);
    const gMax = Math.max(...gaps), gMin = Math.min(...gaps);
    const w = (g) => 2.5 + 4 * ((g - gMin) / Math.max(1e-6, gMax - gMin));
    const casing = L.geoJSON(faults, {
      renderer: canvas, interactive: false,
      style: (ft) => ({ color: css("--paper"), weight: w(ft.properties.gap) + 3, opacity: 0.9, lineCap: "round" }),
    });
    const line = L.geoJSON(faults, {
      renderer: canvas,
      style: (ft) => ({ color: css("--fault"), weight: w(ft.properties.gap), opacity: 1, lineCap: "round" }),
      onEachFeature: (ft, layer) => {
        const p = ft.properties;
        layer.bindTooltip(`<b>${esc(p.a_name)}</b> and <b>${esc(p.b_name)}</b><br>
          ${f.d(p.a_rate)} vs ${f.d(p.b_rate)} complaints per 10k`, { sticky: true, className: "tip" });
        layer.on("click", (e) => { L.DomEvent.stop(e); selectBorder(p.a_id, p.b_id, p); });
      },
    });
    faultLayer = L.layerGroup([casing, line]);
  } else {
    $("#fault-toggle-wrap").hidden = true;
  }

  const pointLayers = {};
  Object.entries(pointData).forEach(([k, data]) => {
    if (!data) return;
    pointLayers[k] = L.geoJSON(data, {
      pointToLayer: (ft, ll) => L.circleMarker(ll, {
        renderer: canvas, radius: 3, weight: 0.8, color: css("--paper"),
        fillColor: CONFIG.lenses[k].ramp[4], fillOpacity: 0.9,
      }).bindTooltip(esc(ft.properties.name || ft.properties.campus_name || ""), { className: "tip" }),
    });
  });

  const spotMarkers = L.layerGroup().addTo(map);

  /* ---------------- Colors and legend ---------------- */
  function lens() { return CONFIG.lenses[state.lens]; }
  function ready() { return isReady(state.lens); }
  // The measure used for coloring. Unready tabs fall back to nothing.
  function metricOf(p, key = state.lens) { return isReady(key) ? p[CONFIG.lenses[key].metric] : null; }

  function breaks() {
    if (breakCache[state.lens]) return breakCache[state.lens];
    const vals = geo.features.map((x) => metricOf(x.properties))
      .filter((v) => v != null && v > 0).sort((a, b) => a - b);
    let b = [];
    if (vals.length) {
      const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
      b = [...new Set([0.2, 0.4, 0.6, 0.8].map(q))];
      b.push(vals.at(-1));
      b = [...new Set(b)];
    }
    return (breakCache[state.lens] = b);
  }
  function rampColor(v) {
    const b = breaks();
    const ramp = dark.matches ? [...lens().ramp].reverse() : lens().ramp;
    let i = b.findIndex((x) => v <= x);
    if (i < 0) i = b.length - 1;
    const idx = b.length <= 1 ? ramp.length - 1 : Math.round((i / (b.length - 1)) * (ramp.length - 1));
    return ramp[idx];
  }
  function fillFor(p) {
    if (state.colorBy === "region") return CONFIG.regionColors[p.nces] || CONFIG.regionColors.Unknown;
    if (state.colorBy === "majority") return CONFIG.majorityColors[p.majority] || CONFIG.majorityColors.Unknown;
    if (!ready()) return css("--soon-fill");
    const v = metricOf(p);
    if (v == null) return p.small ? css("--small") : css("--nodata");
    if (v === 0) return css("--zero");
    return rampColor(v);
  }
  function matches(p) {
    return (!state.nces.size || state.nces.has(p.nces)) && (!state.majority.size || state.majority.has(p.majority));
  }
  function isSelected(id) {
    const s = state.selected;
    return s && (s === id || s.a === id || s.b === id);
  }
  function styleFor(p) {
    const on = matches(p), sel = isSelected(p.id);
    return {
      fillColor: fillFor(p),
      fillOpacity: on ? 0.88 : 0.12,
      color: sel ? css("--ink") : css("--edge"),
      weight: sel ? 2.4 : p.charter ? 1.1 : 0.45,
      dashArray: p.charter && !sel ? "3 3" : null,
      opacity: on ? 1 : 0.35,
    };
  }
  function restyle() {
    districtLayer.eachLayer((l) => l.setStyle(styleFor(l.feature.properties)));
    if (state.selected) {
      [state.selected, state.selected.a, state.selected.b].forEach((id) => layerById.get(id)?.bringToFront());
    }
    if (faultLayer && map.hasLayer(faultLayer)) faultLayer.eachLayer((g) => g.bringToFront());
  }

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => L.DomUtil.create("div", "legend");
  legend.addTo(map);
  function renderLegend() {
    const el = document.querySelector(".legend");
    const sw = (c, label) => `<li><span class="sw" style="background:${c}"></span>${esc(label)}</li>`;
    let items = "", title;
    if (state.colorBy === "region") {
      title = "Region";
      items = CONFIG.regions.map((r) => sw(CONFIG.regionColors[r], r)).join("");
    } else if (state.colorBy === "majority") {
      title = "Student majority";
      items = CONFIG.majorities.map((m) => sw(CONFIG.majorityColors[m], m)).join("");
    } else if (!ready()) {
      el.hidden = true;
      return;
    } else {
      title = lens().metricLabel;
      const b = breaks();
      const dec = state.lens === "complaints" ? 1 : 0;
      if (!b.length) items = `<li class="empty">No data loaded</li>`;
      else {
        items = sw(css("--zero"), "None");
        let lo = 0;
        b.forEach((hi) => {
          const label = dec ? (lo === 0 ? `Up to ${f.d(hi, 1)}` : `${f.d(lo, 1)} to ${f.d(hi, 1)}`)
            : (lo + 1 >= hi ? f.n(hi) : `${f.n(lo + 1)} to ${f.n(hi)}`);
          items += sw(rampColor(hi), label);
          lo = hi;
        });
      }
      if (state.lens === "complaints") items += sw(css("--small"), `Under ${S.min_enroll} students`);
    }
    if (faultLayer && map.hasLayer(faultLayer))
      items += `<li><span class="sw sw-fault"></span>Sharpest complaint divide</li>`;
    if (geo.features.some((x) => x.properties.charter))
      items += `<li><span class="sw sw-charter"></span>Charter district</li>`;
    el.hidden = false;
    el.innerHTML = `<p class="legend-title">${esc(title)}</p><ul>${items}</ul>`;
  }

  function tooltipFor(p) {
    let val;
    if (!ready()) val = `${esc(lens().label)}: ${SOON.toLowerCase()}`;
    else if (state.lens === "complaints")
      val = p.rate == null ? `${f.n(p.complaints)} complaints (too small to rate)` : `${f.d(p.rate)} complaints per 10k students`;
    else {
      const v = metricOf(p);
      val = v == null ? "No data" : `${f.n(v)} ${lens().metricLabel.toLowerCase()}`;
    }
    return `<b>${esc(p.name)}</b><br>${val}<br><span class="tip-sub">${esc(p.nces || "")}, ${esc((p.majority || "").toLowerCase())}</span>`;
  }

  /* ---------------- Panel: intro, controls, charts ---------------- */
  function renderIntro() {
    const L = lens();
    $("#lens-intro").innerHTML = L.ready
      ? `<h1>${esc(L.title)}</h1>${L.intro(S, f)}`
      : `<h1>${esc(L.title)}</h1><p class="soon-badge">Data coming soon</p><p>${esc(L.soon)}</p>
         <p class="muted">Until then, the map shows district boundaries only. You can still color it by
         region or student majority, and open any district.</p>`;
  }

  function renderColorBy() {
    const opts = [["metric", ready() ? lens().short : "Outline"], ["region", "Region"], ["majority", "Race"]];
    $("#colorby").innerHTML = opts.map(([k, label]) => `
      <label><input type="radio" name="colorby" value="${k}" ${state.colorBy === k ? "checked" : ""}><span>${label}</span></label>`).join("");
  }
  $("#colorby").addEventListener("change", (e) => {
    state.colorBy = e.target.value;
    restyle(); renderLegend(); syncSoonOverlay();
  });

  function renderChips() {
    const chip = (set, value, color) => `<button type="button" class="chip" data-value="${esc(value)}"
      aria-pressed="${set.has(value)}"><span class="dot" style="background:${color}"></span>${esc(value.replace("Majority ", ""))}</button>`;
    $("#filter-nces").innerHTML = CONFIG.regions.map((r) => chip(state.nces, r, CONFIG.regionColors[r])).join("");
    $("#filter-majority").innerHTML = CONFIG.majorities.map((m) => chip(state.majority, m, CONFIG.majorityColors[m])).join("");
  }
  function onChip(set) {
    return (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      const v = btn.dataset.value;
      set.has(v) ? set.delete(v) : set.add(v);
      renderChips(); restyle(); renderCharts();
    };
  }
  $("#filter-nces").addEventListener("click", onChip(state.nces));
  $("#filter-majority").addEventListener("click", onChip(state.majority));

  function groupBars(kind, valueFn, displayFn) {
    const keys = kind === "nces" ? CONFIG.regions : CONFIG.majorities;
    const colors = kind === "nces" ? CONFIG.regionColors : CONFIG.majorityColors;
    const set = kind === "nces" ? state.nces : state.majority;
    return Charts.bars(keys.map((k) => {
      const r = groupStats[kind][k];
      const v = r ? valueFn(r) : null;
      return { label: k.replace("Majority ", ""), value: v, display: v == null ? "n/a" : displayFn(v), color: colors[k], highlight: set.has(k) };
    }));
  }
  const chart = (title, body, note = "") =>
    `<div class="chart"><h2>${esc(title)}</h2>${body}${note ? `<p class="chart-note">${note}</p>` : ""}</div>`;

  function renderCharts() {
    if (!ready()) {
      $("#charts").innerHTML = `<div class="chart soon-chart" aria-hidden="true">
        <div class="soon-ghost"><span></span><span></span><span></span><span></span></div>
        <p class="soon-over">Charts coming soon</p></div>`;
      return;
    }
    const months = S.months || [];
    let cats = S.categories, scope = "statewide";
    if (state.nces.size === 1) { const r = [...state.nces][0]; cats = S.cats_by_nces?.[r]; scope = `in ${r.toLowerCase()} districts`; }
    else if (state.majority.size === 1) { const m = [...state.majority][0]; cats = S.cats_by_majority?.[m]; scope = `in ${m.toLowerCase()} districts`; }
    let html = chart(`What complaints were about, ${scope}`,
      Charts.bars((cats || []).map((c) => ({ label: c.cat, value: c.n, display: f.n(c.n), color: lens().ramp[3] }))),
      "Pick a single region or majority above to see its own mix.");
    html += chart("Complaints per 10,000 students, by region", groupBars("nces", (r) => r.rate, (v) => f.d(v)));
    html += chart("Complaints per 10,000 students, by student majority", groupBars("majority", (r) => r.rate, (v) => f.d(v)));
    html += chart("Monthly complaints per 10,000 students",
      Charts.lines(CONFIG.regions.filter((r) => S.trend_nces?.[r]).map((r) => ({ label: r, values: S.trend_nces[r], color: CONFIG.regionColors[r] })), months, { yLabel: "Complaints per 10,000 students" }));
    $("#charts").innerHTML = html;
  }

  $("#fault-toggle").addEventListener("change", syncOverlays);
  function syncOverlays() {
    const showFaults = faultLayer && state.lens === "complaints" && $("#fault-toggle").checked;
    if (faultLayer) showFaults ? faultLayer.addTo(map) : map.removeLayer(faultLayer);
    $("#fault-toggle-wrap").hidden = !faultLayer || state.lens !== "complaints";
    Object.entries(pointLayers).forEach(([k, layer]) => (state.lens === k ? layer.addTo(map) : map.removeLayer(layer)));
    renderLegend();
    syncSoonOverlay();
  }
  function syncSoonOverlay() {
    const show = !ready() && state.colorBy === "metric";
    $("#map-soon").hidden = !show;
    if (show) $("#map-soon-text").textContent = lens().soon;
  }
  $("#map-soon").addEventListener("click", (e) => {
    if (e.target.closest("[data-lens-go]")) setLens("complaints");
  });

  function setLens(name) {
    state.lens = name;
    document.querySelectorAll(".lenses button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lens === name));
    renderIntro(); renderColorBy(); renderCharts(); restyle(); syncOverlays();
    if (state.selected) renderDrawer();
    writeHash();
  }
  $("#lens-nav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-lens]");
    if (b) setLens(b.dataset.lens);
  });

  /* ---------------- Spotlights ---------------- */
  function renderSpotTabs() {
    $("#spot-tabs").innerHTML = CONFIG.regions.map((r) => `
      <button type="button" role="tab" data-region="${r}" aria-selected="${state.spotRegion === r}">${r}</button>`).join("");
  }
  function renderSpotList() {
    const list = spots[state.spotRegion] || [];
    $("#spot-list").innerHTML = list.length ? list.map((s) => `
      <li>
        <button type="button" class="spot-go" data-id="${s.id}">
          <span class="spot-name">${esc(s.name)}</span>
          <span class="spot-stat">${f.n(s.complaints)} complaints, ${f.d(s.obs_exp)} times the expected ${f.d(s.expected)}</span>
        </button>
        <a class="spot-read" href="testimony.html?id=${encodeURIComponent(s.id)}">Read divergent testimonies</a>
      </li>`).join("")
      : `<li class="empty">No spotlight districts for this region.</li>`;

    spotMarkers.clearLayers();
    list.forEach((s, i) => {
      const p = byId.get(s.id);
      if (!p || p.lat == null) return;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: "spot-pin", html: `<span>${i + 1}</span>`, iconSize: [24, 24] }),
        keyboard: false, title: s.name,
      }).on("click", () => selectDistrict(s.id, true)).addTo(spotMarkers);
    });
  }
  $("#spot-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-region]");
    if (!b) return;
    state.spotRegion = b.dataset.region;
    renderSpotTabs(); renderSpotList();
    const bounds = L.latLngBounds([]);
    (spots[state.spotRegion] || []).forEach((s) => layerById.get(s.id) && bounds.extend(layerById.get(s.id).getBounds()));
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 9, duration: 0.8 });
  });
  $("#spot-list").addEventListener("click", (e) => {
    const b = e.target.closest(".spot-go");
    if (b) selectDistrict(b.dataset.id, true);
  });

  /* ---------------- District drawer ---------------- */
  // One row per tab. Tabs that aren't ready show "Coming soon" in both columns.
  function compareRows(p) {
    const g = groupStats.nces[p.nces];
    return lensKeys.map((k) => {
      const L = CONFIG.lenses[k];
      if (!L.ready) return [k, L.metricLabel, soonCell, soonCell];
      if (k === "complaints") return [k, "Complaints per 10k students", p.rate == null ? "too small" : f.d(p.rate), g ? f.d(g.rate) : "n/a"];
      const v = p[L.metric];
      return [k, L.metricLabel, v == null ? "n/a" : f.n(v), "n/a"];
    });
  }

  function sharpestNeighbor(p) {
    const key = ready() ? state.lens : "complaints";
    const nbrs = (details[p.id]?.nbrs || []).map((id) => byId.get(id)).filter(Boolean);
    const v0 = metricOf(p, key);
    if (v0 == null) return null;
    let best = null;
    nbrs.forEach((q) => {
      const v = metricOf(q, key);
      if (v == null) return;
      const gap = Math.abs(v - v0);
      if (!best || gap > best.gap) best = { q, v, v0, gap, key };
    });
    return best;
  }

  // Same fields, order and formatting as popup_text in the Rmd's map-prep chunk
  function profileHTML(p) {
    const det = details[p.id] || {};
    const demo = det.demo?.length ? det.demo
      : [{ label: "% Black", value: p.black }, { label: "% White", value: p.white }, { label: "% Hispanic", value: p.hisp }];
    const order = ["% Black", "% White", "% Hispanic"];
    const sorted = [...demo].sort((a, b) => {
      const ia = order.indexOf(a.label), ib = order.indexOf(b.label);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const rows = [
      ["District Type", det.type || (p.charter ? "Charter" : "Traditional ISD/CSD")],
      ["Majority Group", p.majority || "Unknown"],
      ["NCES Type", p.nces || "Unknown"],
      ...sorted.map((x) => [x.label, f.pct1(x.value)]),
      ["Total Enrollment", p.enroll == null ? "NA" : f.n(p.enroll)],
    ];
    return `<table class="profile">${rows.map(([k, v]) =>
      `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
  }

  function districtHTML(p, { compact = false } = {}) {
    const spot = Object.values(spots).flat().find((s) => s.id === p.id);
    const rows = compareRows(p).map(([k, label, v, avg]) =>
      `<tr class="${k === state.lens ? "is-lens" : ""}${isReady(k) ? "" : " is-soon"}"><th scope="row">${esc(label)}</th><td>${v}</td><td>${avg}</td></tr>`).join("");

    let html = `
      <p class="d-kicker">${esc(p.nces)} district, ${esc((p.majority || "").toLowerCase())}${p.charter ? ", charter" : ""}</p>
      <h2 class="d-name">${esc(p.name)}</h2>`;

    if (spot) {
      html += `<div class="d-spot">
        <p><b>Outlier spotlight.</b> ${f.n(spot.complaints)} complaints against ${f.d(spot.expected)} expected for its size,
        ${f.d(spot.obs_exp)} times the statewide rate${spot.significant ? "" : " (not statistically significant)"}.</p>
        <a class="btn-primary" href="testimony.html?id=${encodeURIComponent(p.id)}">Read divergent testimonies</a>
      </div>`;
    }

    html += `<table class="compare">
        <thead><tr><th scope="col"></th><th scope="col">Here</th><th scope="col">${esc(p.nces)} avg.</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <h3>District profile</h3>${profileHTML(p)}`;

    if (compact) return html;

    const det = details[p.id];
    if (det?.monthly?.length) html += `<h3>Complaints by month</h3>${Charts.spark(det.monthly, S.months || [])}`;
    if (det?.cats?.length) {
      html += `<h3>What parents complained about</h3><ul class="d-cats">${det.cats.map((c) =>
        `<li><span>${esc(c.cat)}</span><span>${f.n(c.n)}</span></li>`).join("")}</ul>`;
    }
    const nb = sharpestNeighbor(p);
    if (nb && nb.gap > 0) {
      html += `<h3>Across the border</h3>
        <p class="d-nbr">The widest complaint gap next door is with
        <button type="button" class="link" data-open="${nb.q.id}">${esc(nb.q.name)}</button>:
        ${f.d(nb.v)} complaints per 10k there, ${f.d(nb.v0)} here.</p>`;
    }
    return html;
  }

  function renderDrawer() {
    const s = state.selected;
    const body = $("#drawer-body");
    if (!s) { $("#drawer").hidden = true; return; }
    if (typeof s === "string") {
      const p = byId.get(s);
      if (!p) return;
      body.innerHTML = districtHTML(p);
    } else {
      const a = byId.get(s.a), b = byId.get(s.b);
      body.innerHTML = `
        <p class="d-kicker">A sharp divide</p>
        <h2 class="d-name">${esc(a.name)} and ${esc(b.name)}</h2>
        <p class="d-meta">Neighbors that share a border, ${f.d(s.info.gap)} complaints per 10,000 students apart.</p>
        <div class="pair">
          <section>${districtHTML(a, { compact: true })}<button type="button" class="link" data-open="${a.id}">Open ${esc(a.name)}</button></section>
          <section>${districtHTML(b, { compact: true })}<button type="button" class="link" data-open="${b.id}">Open ${esc(b.name)}</button></section>
        </div>`;
    }
    $("#drawer").hidden = false;
    $("#drawer").scrollTop = 0;
  }
  $("#drawer-body").addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) selectDistrict(b.dataset.open, true);
  });
  function closeDrawer() { state.selected = null; renderDrawer(); restyle(); writeHash(); }
  $("#drawer-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  function selectDistrict(id, fly = false) {
    if (!byId.has(id)) return;
    state.selected = id;
    renderDrawer(); restyle(); writeHash();
    if (fly) {
      const l = layerById.get(id);
      const wide = window.innerWidth > 860;
      if (l) map.flyToBounds(l.getBounds(), { paddingTopLeft: [60, 60], paddingBottomRight: [wide ? 420 : 60, 60], maxZoom: 10, duration: 0.8 });
    }
  }
  function selectBorder(a, b, info) {
    state.selected = { a, b, info };
    renderDrawer(); restyle(); writeHash();
  }

  /* ---------------- Search ---------------- */
  const names = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  $("#district-names").innerHTML = names.map((p) => `<option value="${esc(p.name)}"></option>`).join("");
  const byName = new Map(names.map((p) => [p.name.toLowerCase(), p.id]));
  $("#search-input").addEventListener("change", (e) => {
    const id = byName.get(e.target.value.trim().toLowerCase());
    if (id) { selectDistrict(id, true); e.target.blur(); }
  });

  /* ---------------- Links: #lens=bans&d=057905 or #a=..&b=.. ---------------- */
  function writeHash() {
    const h = new URLSearchParams();
    if (state.lens !== "complaints") h.set("lens", state.lens);
    if (typeof state.selected === "string") h.set("d", state.selected);
    const str = h.toString();
    history.replaceState(null, "", str ? `#${str}` : location.pathname + location.search);
  }
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    return { lens: h.get("lens"), d: h.get("d"), a: h.get("a"), b: h.get("b") };
  }

  /* ---------------- Splash ---------------- */
  const splash = $("#splash");
  function hideSplash() { splash.classList.add("is-gone"); setTimeout(() => (splash.hidden = true), 400); }
  $("#splash-go").addEventListener("click", hideSplash);

  /* ---------------- Start ---------------- */
  $("#notes").innerHTML = `<p>${CONFIG.notes}</p><p class="credit">${CONFIG.credit}</p>
    ${S.demo ? `<p class="demo-flag">These are demo numbers, not real districts.</p>` : ""}`;
  const start = readHash();
  renderChips(); renderSpotTabs(); renderSpotList();
  setLens(CONFIG.lenses[start.lens] ? start.lens : "complaints");
  if (start.d && byId.has(start.d)) { splash.hidden = true; selectDistrict(start.d, true); }
  else if (start.a && start.b && byId.has(start.a) && byId.has(start.b)) {
    splash.hidden = true;
    const ft = faults?.features.find((x) => x.properties.a_id === start.a && x.properties.b_id === start.b);
    selectBorder(start.a, start.b, ft ? ft.properties : { gap: Math.abs((byId.get(start.a).rate || 0) - (byId.get(start.b).rate || 0)) });
    const bounds = layerById.get(start.a).getBounds().extend(layerById.get(start.b).getBounds());
    map.fitBounds(bounds, { paddingBottomRight: [window.innerWidth > 860 ? 660 : 40, 40], paddingTopLeft: [40, 40], maxZoom: 10 });
  } else splash.querySelector("button").focus();

  dark.addEventListener("change", () => {
    setTiles(); restyle(); renderLegend(); renderCharts();
    if (faultLayer) faultLayer.eachLayer((g) => g.setStyle(() => ({
      color: g.options.interactive === false ? css("--paper") : css("--fault"),
    })));
  });
})();
