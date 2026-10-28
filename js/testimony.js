/* testimony.js: renders testimony.html?id=057905
   Stats come from data/spotlights.json; the words come from testimonies/057905.md.

   Markdown layout rules (see testimonies/_template.md):
     text before the first "## "  -> full-width introduction
     each "## " heading           -> one column (one side of the divide)
     each "### " heading          -> one testimony card inside that column        */

(async function () {
  const $ = (s) => document.querySelector(s);
  const esc = Charts.esc;
  const id = new URLSearchParams(location.search).get("id") || "";
  const n = (x) => (x == null ? "n/a" : Math.round(x).toLocaleString("en-US"));
  const d = (x, k = 1) => (x == null ? "n/a" : (+x).toFixed(k));

  $("#t-foot").innerHTML = `<p>${CONFIG.credit}</p>`;
  $("#back-link").href = `./#d=${encodeURIComponent(id)}`;

  const spots = await fetch(CONFIG.dataDir + "spotlights.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const all = Object.values(spots).flat();
  const s = all.find((x) => x.id === id);

  if (!s) {
    $("#t-head").innerHTML = `<p class="d-kicker">Divergent testimonies</p>
      <h1 class="t-title">No spotlight district with ID ${esc(id || "(none)")}</h1>
      <p class="t-lede">Testimony pages exist for the outlier spotlight districts. Pick one from the map's spotlight list.</p>`;
    return;
  }

  document.title = `${s.name}: divergent testimonies | ${CONFIG.siteTitle}`;
  $("#t-head").innerHTML = `
    <p class="d-kicker">Divergent testimonies, ${esc(s.region.toLowerCase())} spotlight</p>
    <h1 class="t-title">${esc(s.name)}</h1>
    <p class="t-lede">${n(s.complaints)} parent complaints in a district of ${n(s.enroll)} students,
      ${d(s.obs_exp)} times what the statewide rate predicts for its size.</p>
    <dl class="t-stats">
      ${Object.entries(CONFIG.lenses).map(([k, L]) => {
        const val = !L.ready ? `${soonCellHTML}`
          : k === "complaints" ? d(s.rate) : (s[L.metric] == null ? "n/a" : n(s[L.metric]));
        return `<div><dt>${esc(k === "complaints" ? "Complaints per 10k students" : L.metricLabel)}</dt><dd>${val}</dd></div>`;
      }).join("")}
      <div><dt>Student majority</dt><dd>${esc((s.majority || "").replace("Majority ", ""))}</dd></div>
    </dl>`;

  // Testimony text
  let md = null;
  try {
    const r = await fetch(`${CONFIG.testimonyDir}${encodeURIComponent(id)}.md`);
    if (r.ok) md = await r.text();
  } catch (_) { /* handled below */ }

  const body = $("#t-body");
  if (!md || !md.replace(/<!--[\s\S]*?-->/g, "").trim()) {
    body.innerHTML = `<p class="empty">Testimonies for this district haven't been added yet.
      Write them in <code>testimonies/${esc(id)}.md</code>.</p>`;
  } else {
    body.innerHTML = marked.parse(md);
    arrange(body);
  }

  // Other spotlights in the same region
  const peers = (spots[s.region] || []).filter((x) => x.id !== id);
  $("#t-more").innerHTML = peers.length ? `<h2>Other ${esc(s.region.toLowerCase())} spotlights</h2>
    <ul>${peers.map((p) => `<li><a href="testimony.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a>
      <span>${d(p.obs_exp)} times expected complaints</span></li>`).join("")}</ul>` : "";

  // Turn the flat markdown output into intro + columns + cards
  function arrange(root) {
    const nodes = [...root.childNodes];
    const intro = document.createElement("div");
    intro.className = "t-intro";
    const cols = document.createElement("div");
    cols.className = "t-columns";
    let col = null, card = null;

    nodes.forEach((node) => {
      const tag = node.nodeType === 1 ? node.tagName : null;
      if (tag === "H2") {
        col = document.createElement("section");
        col.className = "t-side";
        col.appendChild(node);
        cols.appendChild(col);
        card = null;
      } else if (tag === "H3" && col) {
        card = document.createElement("article");
        card.className = "t-voice";
        card.appendChild(node);
        col.appendChild(card);
      } else if (card) card.appendChild(node);
      else if (col) col.appendChild(node);
      else intro.appendChild(node);
    });

    root.innerHTML = "";
    if (intro.textContent.trim()) root.appendChild(intro);
    if (cols.children.length) {
      cols.style.setProperty("--cols", Math.min(cols.children.length, 3));
      root.appendChild(cols);
    }
  }
})();
