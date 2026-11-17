"use strict";
/* Icon Genius — Phase 2 engine (Nov 17, 2026).
   100% client-side: no generation API, no key, no external service.
   - Consistency normalizer: fits any SVG (library / generated / uploaded)
     onto one grid + stroke + padding system.
   - Generator: composes icons from parametric templates on that same grid,
     with a style lock (stroke / corner / fill mode / brand hex), plus
     retrieval-and-restyle: library icons normalized into the locked style.
   - 3D Look: layered gradient + gloss shading preset. Flat SVG — it is a
     3D-look style, not a 3D model, and the UI says so.
   - Credits: Appwrite `users` doc (plan/credits). Credits buy the commercial
     license on generated icons and unlock larger sets. Fulfillment of pack
     purchases is manual (claim form -> exports collection) and the UI says so. */
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const CFG = (root.IG_CONFIG && root.IG_CONFIG.generation) || { freeSetMax: 6, creditSetMax: 24, creditPerIcon: 1 };
  const $ = (s) => document.querySelector(s);

  /* ---------------- custom icon registry ---------------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage full/blocked */ } }
  let registry = {};
  try { registry = JSON.parse(lsGet("ig_custom_v1") || "{}"); } catch (e) { registry = {}; }
  function registerCustom(rec) { registry[rec.id] = rec; lsSet("ig_custom_v1", JSON.stringify(registry)); return rec.id; }
  root.IGCustom = { get: (id) => registry[id] || null, all: () => registry, register: registerCustom, bodyOf, reportLine };
  let uidCounter = 0;
  const newId = (kind) => `${kind}:${Date.now().toString(36)}${(uidCounter++).toString(36)}`;

  /* ---------------- color helpers ---------------- */
  function shade(hex, amt) {
    const n = (hex || "#888888").replace("#", "");
    if (n.length < 6) return hex;
    let r = parseInt(n.substr(0, 2), 16), g = parseInt(n.substr(2, 2), 16), b = parseInt(n.substr(4, 2), 16);
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }

  /* ---------------- consistency normalizer ---------------- */
  function measureContent(svgEl) {
    const holder = document.createElement("div");
    holder.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:240px;height:240px;visibility:hidden;overflow:hidden";
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("width", "240"); clone.setAttribute("height", "240");
    holder.appendChild(clone); document.body.appendChild(holder);
    let bb = null;
    try { bb = clone.getBBox(); } catch (e) { /* fall back to viewBox */ }
    holder.remove();
    return bb;
  }
  /* Fit an SVG's content into the target grid with uniform padding and
     (optionally) one stroke width. Returns {svg, report} — the report is
     shown to the user so the normalization is auditable, not magic. */
  function normalizeSvgText(text, opts) {
    opts = Object.assign({ grid: 24, pad: 2, stroke: null }, opts || {});
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg || doc.querySelector("parsererror")) throw new Error("That file is not a valid SVG.");
    const vbParts = (svg.getAttribute("viewBox") || "0 0 24 24").split(/[\s,]+/).map(Number);
    const vb = { x: vbParts[0] || 0, y: vbParts[1] || 0, width: vbParts[2] || 24, height: vbParts[3] || 24 };
    const bb = measureContent(svg);
    const content = (bb && bb.width > 0 && bb.height > 0) ? bb : vb;
    const avail = opts.grid - 2 * opts.pad;
    const s = Math.min(avail / content.width, avail / content.height);
    const tx = opts.pad + (avail - content.width * s) / 2 - content.x * s;
    const ty = opts.pad + (avail - content.height * s) / 2 - content.y * s;
    let strokeBefore = null;
    if (opts.stroke) {
      const widths = [];
      svg.querySelectorAll("*").forEach((el) => {
        const st = el.getAttribute("stroke");
        if (st && st !== "none") {
          const w = parseFloat(el.getAttribute("stroke-width") || "1");
          widths.push(w * s);
          el.setAttribute("stroke-width", (opts.stroke / s).toFixed(3));
        }
      });
      if (widths.length) strokeBefore = +(widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)]).toFixed(2);
    }
    const inner = svg.innerHTML;
    const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.grid}" height="${opts.grid}" viewBox="0 0 ${opts.grid} ${opts.grid}"><g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(4)})">${inner}</g></svg>`;
    return {
      svg: out,
      report: {
        fromViewBox: vbParts.join(" "),
        contentBox: [content.x, content.y, content.width, content.height].map((n) => +(+n).toFixed(2)).join(" "),
        scale: +s.toFixed(3),
        strokeBefore, strokeAfter: opts.stroke || null,
        grid: opts.grid, pad: opts.pad
      }
    };
  }
  function bodyOf(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.querySelector("svg");
    const vb = (svg.getAttribute("viewBox") || "0 0 24 24").split(/[\s,]+/).map(Number);
    return { body: svg.innerHTML, w: vb[2] || 24, h: vb[3] || 24 };
  }
  function reportLine(rep) {
    let s = `Fit content (${rep.contentBox}) onto the ${rep.grid} grid with ${rep.pad} padding · scale ${rep.scale}`;
    if (rep.strokeAfter) s += ` · stroke ${rep.strokeBefore != null ? rep.strokeBefore + " → " : ""}${rep.strokeAfter}`;
    return s;
  }

  /* ---------------- parametric templates ----------------
     Every template draws on the 24 grid. A.main = detail layer attrs,
     A.back = silhouette layer attrs, both derived from the style lock. */
  function styleAttrs(style) {
    const outline = `fill="none" stroke="currentColor" stroke-width="${style.stroke}" stroke-linecap="round" stroke-linejoin="round"`;
    const solid = `fill="currentColor" stroke="none"`;
    if (style.mode === "solid" || style.mode === "3d") return { main: solid, back: solid };
    if (style.mode === "duotone") return { main: outline, back: `fill="currentColor" opacity="0.25" stroke="none"` };
    return { main: outline, back: outline };
  }
  const T = {};
  function def(name, kw, cat, draw) { T[name] = { name, kw, cat, draw }; }

  def("arrow-right", ["arrow", "right", "next", "forward"], "arrows", (A) => `<path d="M4 12h15M13.5 6l6 6-6 6" ${A.main}/>`);
  def("arrow-up", ["arrow", "up", "upload", "top"], "arrows", (A) => `<path d="M12 20V5M6 10.5L12 4.5l6 6" ${A.main}/>`);
  def("chevron-down", ["chevron", "down", "expand", "dropdown", "more"], "arrows", (A) => `<path d="M5.5 9.5l6.5 6.5 6.5-6.5" ${A.main}/>`);
  def("plus", ["plus", "add", "new", "create"], "ui", (A) => `<path d="M12 5v14M5 12h14" ${A.main}/>`);
  def("check", ["check", "done", "tick", "ok", "success"], "ui", (A) => `<path d="M4.5 12.5l5 5L19.5 7" ${A.main}/>`);
  def("x", ["x", "close", "delete", "remove", "cancel"], "ui", (A) => `<path d="M6 6l12 12M18 6L6 18" ${A.main}/>`);
  def("heart", ["heart", "love", "like", "favorite", "health"], "shapes", (A) => `<path d="M12 20.2S3.8 15.3 3.8 9.9C3.8 6.9 6 5 8.4 5c1.5 0 2.9.8 3.6 2 .7-1.2 2.1-2 3.6-2C18 5 20.2 6.9 20.2 9.9c0 5.4-8.2 10.3-8.2 10.3z" ${A.back}/>`);
  def("star", ["star", "favorite", "rating", "featured"], "shapes", (A) => `<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z" ${A.back}/>`);
  def("shield", ["shield", "security", "protect", "safe", "trust"], "security", (A, P) => `<path d="M12 3l7 2.4v5.4c0 4.7-2.9 7.9-7 9.7-4.1-1.8-7-5-7-9.7V5.4z" ${A.back}/><path d="M9 11.6l2.2 2.2 3.8-4" ${A.main}/>`);
  def("bolt", ["bolt", "lightning", "energy", "power", "fast", "flash"], "shapes", (A) => `<path d="M13.2 2.8L5 13.6h5.2L9.4 21.2 19 10h-5.4z" ${A.back}/>`);
  def("sun", ["sun", "day", "bright", "weather", "light"], "nature", (A) => `<circle cx="12" cy="12" r="4" ${A.back}/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" ${A.main}/>`);
  def("moon", ["moon", "night", "sleep", "dark"], "nature", (A) => `<path d="M20 14.8A8.4 8.4 0 1 1 9.2 4a6.9 6.9 0 0 0 10.8 10.8z" ${A.back}/>`);
  def("cloud", ["cloud", "weather", "storage", "upload"], "nature", (A) => `<path d="M6.8 19a4.3 4.3 0 0 1-.4-8.6 6.2 6.2 0 0 1 11.9 1.3A3.7 3.7 0 0 1 17.4 19z" ${A.back}/>`);
  def("droplet", ["droplet", "water", "drop", "rain", "liquid"], "nature", (A) => `<path d="M12 3.4s6.2 6.8 6.2 11a6.2 6.2 0 0 1-12.4 0c0-4.2 6.2-11 6.2-11z" ${A.back}/>`);
  def("flame", ["flame", "fire", "hot", "trending", "burn"], "nature", (A) => `<path d="M12 3.2c.9 2.9-2.1 4.4-2.1 6.9a2.1 2.1 0 0 0 4.2 0c0-1-.5-1.9-.5-1.9s3.4 2.2 3.4 5.9a5 5 0 0 1-10 0C7 9.9 10.6 7.4 12 3.2z" ${A.back}/>`);
  def("snowflake", ["snowflake", "snow", "winter", "cold", "freeze"], "nature", (A) => `<path d="M12 2.5v19M4.2 7l15.6 10M19.8 7L4.2 17M12 2.5L9.8 4.8M12 2.5l2.2 2.3M12 21.5l-2.2-2.3M12 21.5l2.2-2.3" ${A.main}/>`);
  def("leaf", ["leaf", "nature", "eco", "green", "plant"], "nature", (A) => `<path d="M5.5 18.5C5.5 10.5 11.5 4.8 19.5 4.8c0 8-5.7 13.7-14 13.7z" ${A.back}/><path d="M5.5 18.5c2.8-5.8 6.8-9.7 11-11.5" ${A.main}/>`);
  def("lock", ["lock", "security", "password", "private", "secure"], "security", (A, P) => `<rect x="5.8" y="10.8" width="12.4" height="9.4" rx="${P.corner}" ${A.back}/><path d="M8.8 10.8V8a3.2 3.2 0 0 1 6.4 0v2.8" ${A.main}/><circle cx="12" cy="15.4" r="1.5" fill="currentColor" stroke="none"/>`);
  def("key", ["key", "access", "login", "password", "unlock"], "security", (A) => `<circle cx="8" cy="15" r="4.4" ${A.back}/><path d="M11.3 11.7L19.5 3.5M16.5 6.5l3 3M13.8 9.2l2.4 2.4" ${A.main}/>`);
  def("bell", ["bell", "notification", "alert", "reminder"], "ui", (A) => `<path d="M6.2 16.2v-5A5.8 5.8 0 0 1 12 5.4a5.8 5.8 0 0 1 5.8 5.8v5l1.4 2.8H4.8z" ${A.back}/><path d="M10.2 21a2 2 0 0 0 3.6 0" ${A.main}/>`);
  def("bookmark", ["bookmark", "save", "mark", "favorite"], "ui", (A) => `<path d="M7 3.8h10V20.5l-5-3.5-5 3.5z" ${A.back}/>`);
  def("flag", ["flag", "mark", "report", "goal"], "ui", (A) => `<path d="M5.5 21.5v-18" ${A.main}/><path d="M5.5 4.2c4.5-2.1 8 1.9 13 0v8.6c-5 1.9-8.5-2.1-13 0z" ${A.back}/>`);
  def("home", ["home", "house", "main", "start"], "ui", (A, P) => `<path d="M4 11.3L12 4l8 7.3" ${A.main}/><rect x="6.8" y="10.5" width="10.4" height="9.3" rx="${P.corner}" ${A.back}/>`);
  def("user", ["user", "person", "account", "profile", "avatar"], "ui", (A) => `<circle cx="12" cy="8" r="3.6" ${A.main}/><path d="M5 20.2c1.1-3.5 3.7-5.2 7-5.2s5.9 1.7 7 5.2" ${A.back}/>`);
  def("search", ["search", "find", "magnifier", "look", "explore"], "ui", (A) => `<circle cx="11" cy="11" r="6.4" ${A.main}/><path d="M15.8 15.8L20.5 20.5" ${A.main}/>`);
  def("chat", ["chat", "message", "comment", "talk", "bubble"], "ui", (A, P) => `<rect x="3.8" y="5" width="16.4" height="11.2" rx="${P.corner + 1}" ${A.back}/><path d="M8.5 16.2v4l4.5-4" ${A.main}/>`);
  def("calendar", ["calendar", "date", "schedule", "event", "day"], "ui", (A, P) => `<rect x="4" y="5.8" width="16" height="14.2" rx="${P.corner}" ${A.back}/><path d="M4 10.4h16M8.2 3.4v4M15.8 3.4v4" ${A.main}/>`);
  def("clock", ["clock", "time", "timer", "watch", "hour"], "ui", (A) => `<circle cx="12" cy="12" r="8.4" ${A.main}/><path d="M12 7.6V12l3 2" ${A.main}/>`);
  def("chart", ["chart", "graph", "stats", "analytics", "bars"], "data", (A, P) => `<path d="M4 4v15.5h16" ${A.main}/><rect x="7.6" y="13" width="2.8" height="5" rx="${Math.min(P.corner, 1)}" ${A.back}/><rect x="11.8" y="9.5" width="2.8" height="8.5" rx="${Math.min(P.corner, 1)}" ${A.back}/><rect x="16" y="6.8" width="2.8" height="11.2" rx="${Math.min(P.corner, 1)}" ${A.back}/>`);
  def("music", ["music", "note", "song", "audio", "sound"], "media", (A) => `<path d="M9.2 18.3V6.4L19 4.4v11.4" ${A.main}/><circle cx="6.7" cy="18.3" r="2.5" ${A.back}/><circle cx="16.5" cy="15.8" r="2.5" ${A.back}/>`);
  def("camera", ["camera", "photo", "picture", "image"], "media", (A, P) => `<rect x="3.4" y="7.4" width="17.2" height="12" rx="${P.corner}" ${A.back}/><circle cx="12" cy="13.4" r="3.3" ${A.main}/><path d="M9.2 7.4L10.7 4.8h2.6l1.5 2.6" ${A.main}/>`);
  def("play", ["play", "video", "start", "watch"], "media", (A) => `<circle cx="12" cy="12" r="8.4" ${A.main}/><path d="M10.4 8.7l5.8 3.3-5.8 3.3z" ${A.back}/>`);
  def("download", ["download", "save", "export", "get"], "arrows", (A) => `<path d="M12 4v10.5M7.2 10.8L12 15.6l4.8-4.8M5 19.8h14" ${A.main}/>`);
  def("mail", ["mail", "email", "envelope", "message", "inbox"], "ui", (A, P) => `<rect x="3.4" y="5.8" width="17.2" height="12.6" rx="${P.corner}" ${A.back}/><path d="M4.2 7.4l7.8 5.8 7.8-5.8" ${A.main}/>`);
  def("globe", ["globe", "world", "web", "internet", "earth"], "ui", (A) => `<circle cx="12" cy="12" r="8.4" ${A.main}/><path d="M3.6 12h16.8M12 3.6c2.5 2.3 3.7 5.1 3.7 8.4s-1.2 6.1-3.7 8.4c-2.5-2.3-3.7-5.1-3.7-8.4s1.2-6.1 3.7-8.4z" ${A.main}/>`);
  def("eye", ["eye", "view", "see", "visible", "watch"], "ui", (A) => `<path d="M2.8 12S6.2 5.6 12 5.6 21.2 12 21.2 12 17.8 18.4 12 18.4 2.8 12 2.8 12z" ${A.main}/><circle cx="12" cy="12" r="3" ${A.back}/>`);
  def("trash", ["trash", "delete", "bin", "remove", "garbage"], "ui", (A, P) => `<path d="M4.8 6.4h14.4M9.2 6.4V4.6A.6.6 0 0 1 9.8 4h4.4a.6.6 0 0 1 .6.6v1.8" ${A.main}/><path d="M6.8 6.4l.9 12.4a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4l.9-12.4" ${A.back}/><path d="M10 10.5v6M14 10.5v6" ${A.main}/>`);
  def("sliders", ["sliders", "settings", "adjust", "controls", "tune"], "ui", (A) => `<path d="M4.5 7.2h6.3M15.5 7.2h4M4.5 16.8h2.3M11.5 16.8h8" ${A.main}/><circle cx="13.1" cy="7.2" r="2.3" ${A.back}/><circle cx="9.1" cy="16.8" r="2.3" ${A.back}/>`);
  def("gift", ["gift", "present", "reward", "bonus"], "shapes", (A, P) => `<rect x="4.5" y="9.5" width="15" height="3.6" rx="1" ${A.main}/><rect x="6" y="13.1" width="12" height="7.4" rx="${P.corner}" ${A.back}/><path d="M12 9.5v11M12 9.5s-4.2.2-4.2-2.2c0-1.5 1.2-2.3 2.3-2C11.8 5.6 12 9.5 12 9.5zm0 0s4.2.2 4.2-2.2c0-1.5-1.2-2.3-2.3-2C12.2 5.6 12 9.5 12 9.5z" ${A.main}/>`);
  def("send", ["send", "share", "message", "paper plane", "submit"], "ui", (A) => `<path d="M20.8 3.4L11 13.2M20.8 3.4l-6.6 17.2-3.2-7.4-7.4-3.2z" ${A.back}/>`);
  def("sparkle", ["sparkle", "magic", "ai", "new", "shine"], "shapes", (A) => `<path d="M12 3.2l1.9 5.9 5.9 1.9-5.9 1.9L12 18.8l-1.9-5.9-5.9-1.9 5.9-1.9z" ${A.back}/>`);
  def("coffee", ["coffee", "cup", "drink", "cafe", "tea"], "shapes", (A, P) => `<path d="M5 9.5h11.5v5.2A5.3 5.3 0 0 1 11.2 20H10A5.3 5.3 0 0 1 5 14.7z" ${A.back}/><path d="M16.5 10.8h1.3a2.9 2.9 0 0 1 0 5.8h-1.6M8 6.2c0-1 .8-1.2.8-2.2M11.8 6.2c0-1 .8-1.2.8-2.2" ${A.main}/>`);
  def("cart", ["cart", "shop", "buy", "store", "basket"], "shapes", (A) => `<path d="M3.2 4.2h2.2l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.3L20.4 8H6" ${A.main}/><circle cx="10" cy="20.4" r="1.4" fill="currentColor" stroke="none"/><circle cx="17" cy="20.4" r="1.4" fill="currentColor" stroke="none"/>`);

  const CATEGORIES = {};
  for (const t of Object.values(T)) (CATEGORIES[t.cat] = CATEGORIES[t.cat] || []).push(t.name);

  function matchTemplates(prompt, limit) {
    const words = (prompt || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const scored = [];
    for (const t of Object.values(T)) {
      let score = 0;
      for (const w of words) {
        if (t.name === w || t.name.split("-").includes(w)) score += 3;
        else if (t.kw.includes(w)) score += 2;
        else if (t.kw.some((k) => k.includes(w) || w.includes(k)) && w.length > 2) score += 1;
      }
      if (score > 0) scored.push([score, t.name]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const picked = scored.map((s) => s[1]);
    // fill with same-category neighbours, then the whole catalog in order
    for (const n of [...picked]) for (const sib of CATEGORIES[T[n].cat] || []) if (!picked.includes(sib)) picked.push(sib);
    for (const n of Object.keys(T)) if (!picked.includes(n)) picked.push(n);
    return picked.slice(0, limit);
  }

  /* 3D-look treatment: gradient shading + gloss + soft offset depth.
     Flat SVG shading — labelled "3D Look" in the UI, never "3D model". */
  function threeDLook(inner, hex, uid) {
    const light = shade(hex, 0.5), base = hex, dark = shade(hex, -0.38);
    const gid = `g3d${uid}`;
    const defs = `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>`;
    let body = inner.split('fill="currentColor"').join(`fill="url(#${gid})"`);
    body = body.split('stroke="currentColor"').join(`stroke="${dark}"`);
    const shadow = body.split(`url(#${gid})`).join("#000000");
    return defs +
      `<g transform="translate(0 1.3)" opacity="0.16">${shadow}</g>` + body +
      `<ellipse cx="12" cy="7.2" rx="6.4" ry="3.2" fill="#ffffff" opacity="0.25"/>`;
  }

  function composeIcon(name, style) {
    const t = T[name];
    if (!t) return null;
    const A = styleAttrs(style);
    let inner = t.draw(A, style);
    let mono = true;
    if (style.mode === "3d") { inner = threeDLook(inner, style.color, name.replace(/\W/g, "")); mono = false; }
    else if (style.mode !== "outline") { /* solid/duotone keep currentColor */ }
    return { body: inner, w: 24, h: 24, mono };
  }

  /* ---------------- credits (Appwrite users doc) ---------------- */
  let creditsState = { balance: 0, plan: "free", loaded: false };
  function awReady() { return typeof aw !== "undefined" && aw && typeof state !== "undefined" && state.user; }
  async function loadCredits() {
    if (!awReady()) { creditsState = { balance: 0, plan: "free", loaded: false }; renderCredits(); return; }
    const c = root.IG_CONFIG, uid = state.user.$id;
    try {
      const doc = await aw.databases.getDocument(c.databaseId, c.collections.users, uid);
      creditsState = { balance: doc.credits || 0, plan: doc.plan || "free", loaded: true };
    } catch (e) {
      try {
        const { Permission, Role } = window.Appwrite;
        const doc = await aw.databases.createDocument(c.databaseId, c.collections.users, uid,
          { plan: "free", credits: 0 },
          [Permission.read(Role.user(uid)), Permission.update(Role.user(uid)), Permission.delete(Role.user(uid))]);
        creditsState = { balance: doc.credits || 0, plan: doc.plan || "free", loaded: true };
      } catch (e2) { creditsState = { balance: 0, plan: "free", loaded: false }; }
    }
    renderCredits();
  }
  async function debitCredits(n) {
    const c = root.IG_CONFIG, uid = state.user.$id;
    const doc = await aw.databases.getDocument(c.databaseId, c.collections.users, uid);
    const bal = doc.credits || 0;
    if (bal < n) throw new Error(`Not enough credits — this set needs ${n}, your balance is ${bal}.`);
    await aw.databases.updateDocument(c.databaseId, c.collections.users, uid, { credits: bal - n });
    creditsState.balance = bal - n;
    renderCredits();
  }
  async function recordGeneration(prompt, style, count, spent) {
    if (!awReady()) return;
    const c = root.IG_CONFIG;
    try {
      const { Permission, Role, ID } = window.Appwrite;
      await aw.databases.createDocument(c.databaseId, c.collections.generations, ID.unique(),
        { ownerId: state.user.$id, prompt: prompt.slice(0, 500), styleJson: JSON.stringify(style), model: "ig-engine-client-v1", cost: spent, fileId: "" },
        [Permission.read(Role.user(state.user.$id)), Permission.update(Role.user(state.user.$id)), Permission.delete(Role.user(state.user.$id))]);
    } catch (e) { /* ledger is best-effort; the icons are already delivered */ }
  }

  /* ---------------- generation UI ---------------- */
  let candidates = []; // {kind: "composed"|"restyled", name/label, recId or libId, checked}
  function currentStyle() {
    return {
      mode: $("#gen-mode").value,
      color: $("#gen-hex").value,
      stroke: parseFloat($("#gen-stroke").value),
      corner: parseFloat($("#gen-corner").value)
    };
  }
  function genStatus(msg, isErr) {
    const el = $("#gen-status");
    el.textContent = msg || "";
    el.classList.toggle("error", !!isErr);
  }
  async function buildCandidates() {
    const prompt = $("#gen-prompt").value.trim();
    if (!prompt) { genStatus("Describe the set first — a word or two is enough.", true); return; }
    const style = currentStyle();
    const commercial = $("#gen-commercial").checked;
    const maxSet = commercial ? CFG.creditSetMax : CFG.freeSetMax;
    const want = Math.min(parseInt($("#gen-size").value, 10) || CFG.freeSetMax, maxSet);
    genStatus("Composing…");
    candidates = [];
    // 1) composed from templates
    for (const name of matchTemplates(prompt, want)) {
      const made = composeIcon(name, style);
      if (!made) continue;
      const rec = {
        id: newId("gen"), name: `gen-${name}`, body: made.body, w: 24, h: 24, mono: made.mono,
        setName: "Icon Genius — generated", author: "Icon Genius engine",
        kind: "generated", template: name,
        license: commercial
          ? { title: "Icon Genius Commercial License — use in commercial projects, no redistribution of the icon files themselves", spdx: "" }
          : { title: "Icon Genius Personal-Use License — personal projects only. Buy credits to license generated icons commercially.", spdx: "" },
        sourceLine: `Composed in your browser by the Icon Genius engine · style lock: ${style.mode}, stroke ${style.stroke}, corner ${style.corner}, ${style.color}`
      };
      candidates.push({ kind: "composed", label: name, rec, checked: true });
    }
    // 2) retrieval-and-restyle from the licensed library
    try {
      const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(prompt)}&limit=64`);
      const data = await r.json();
      const ids = (data.icons || []).filter((id) => { try { return passesFilter(id); } catch (e) { return true; } }).slice(0, 8);
      for (const id of ids) {
        try {
          const text = await fetchSvgText(id);
          const norm = normalizeSvgText(text, { stroke: style.stroke });
          const b = bodyOf(norm.svg);
          const lic = licenseOf(id), m = meta(id);
          const rec = {
            id: newId("norm"), name: `restyled-${id.split(":")[1]}`, body: b.body, w: b.w, h: b.h,
            mono: isMono(id), setName: m.name || id.split(":")[0], author: (m.author && m.author.name) || "",
            kind: "restyled",
            license: { title: lic.title || "See source set", spdx: lic.spdx || "", url: lic.url || "" },
            sourceLine: `Restyled from the library icon ${id} (${m.name || ""}) — normalized to your style lock. The original set's license applies.`
          };
          candidates.push({ kind: "restyled", label: id, rec, checked: false });
        } catch (e) { /* skip un-restyleable results */ }
      }
    } catch (e) { /* library unreachable — composed set still stands */ }
    renderCandidates();
    genStatus(`${candidates.length} candidates — composed icons are generated on the grid, in your style lock. Restyled library icons keep their original licenses.`);
  }
  function renderCandidates() {
    const wrap = $("#gen-results");
    wrap.innerHTML = candidates.map((c, i) =>
      `<label class="cand"><input type="checkbox" data-cand="${i}" ${c.checked ? "checked" : ""}>
        <span class="slot"><svg viewBox="0 0 ${c.rec.w} ${c.rec.h}">${c.rec.body.split("currentColor").join(currentStyle().color)}</svg></span>
        <span class="cand-name">${c.label}</span><span class="badge">${c.kind}</span></label>`).join("");
    wrap.querySelectorAll("[data-cand]").forEach((box) => box.addEventListener("change", () => { candidates[+box.dataset.cand].checked = box.checked; }));
    $("#btn-gen-add").classList.toggle("hidden", candidates.length === 0);
  }
  async function addCandidatesToCollection() {
    const chosen = candidates.filter((c) => c.checked);
    if (!chosen.length) { genStatus("Nothing selected.", true); return; }
    const style = currentStyle();
    const commercial = $("#gen-commercial").checked;
    const composedCount = chosen.filter((c) => c.kind === "composed").length;
    const cost = commercial ? composedCount * CFG.creditPerIcon : 0;
    if (commercial) {
      if (!awReady()) { genStatus("Sign in first — credits live on your account.", true); return; }
      try { await debitCredits(cost); }
      catch (e) { genStatus(e.message, true); return; }
    }
    const ids = [];
    for (const c of chosen) {
      if (c.kind === "composed" && !commercial) c.rec.license = { title: "Icon Genius Personal-Use License — personal projects only. Buy credits to license generated icons commercially.", spdx: "" };
      if (c.kind === "composed" && commercial) c.rec.license = { title: "Icon Genius Commercial License — use in commercial projects, no redistribution of the icon files themselves", spdx: "" };
      registerCustom(c.rec);
      ids.push(c.rec.id);
    }
    const prompt = $("#gen-prompt").value.trim();
    const col = { id: "c_" + Date.now(), name: `${prompt} set`, icons: ids, color: style.color };
    state.collections.push(col); state.activeCol = col.id;
    saveCollections();
    await recordGeneration(prompt, style, composedCount, cost);
    genStatus(`Added ${ids.length} icons to “${col.name}”${cost ? ` · ${cost} credits spent — commercial license on the composed icons` : " · composed icons carry the personal-use license"}. Export any time — the receipt lists every license.`);
    candidates = []; renderCandidates();
  }

  /* ---------------- normalizer wiring ---------------- */
  async function normalizeOne(id) {
    const stroke = parseFloat($("#norm-stroke").value);
    const text = await fetchSvgText(id);
    const norm = normalizeSvgText(text, { stroke });
    const b = bodyOf(norm.svg);
    const src = customRec(id);
    const rec = {
      id: newId("norm"), name: `normalized-${src ? src.name : id.split(":")[1]}`, body: b.body, w: b.w, h: b.h,
      mono: src ? src.mono : isMono(id), setName: src ? src.setName : (meta(id).name || ""),
      author: src ? src.author : ((meta(id).author || {}).name || ""), kind: "normalized",
      license: src ? src.license : licenseOf(id),
      sourceLine: `Normalized copy of ${id} — ${reportLine(norm.report)}. The source license applies.`
    };
    registerCustom(rec);
    return { rec, report: norm.report };
  }
  async function onNormalizeEditor() {
    if (!state.selected) return;
    const note = $("#norm-note");
    try {
      const { rec, report } = await normalizeOne(state.selected);
      note.textContent = `Normalized copy created: ${reportLine(report)}. The original is untouched.`;
      selectIcon(rec.id);
    } catch (e) { note.textContent = e.message; }
  }
  async function onNormalizeCollection() {
    const col = activeCollection();
    if (!col || !col.icons.length) return;
    const note = $("#norm-col-note");
    note.textContent = "Normalizing…";
    try {
      const out = [];
      for (const id of col.icons) { const { rec } = await normalizeOne(id); out.push(rec.id); }
      col.icons = out;
      saveCollections();
      note.textContent = `Whole set normalized to the ${24} grid, stroke ${$("#norm-stroke").value}. Originals untouched — these are normalized copies.`;
    } catch (e) { note.textContent = e.message; }
  }
  async function onUpload(file) {
    const note = $("#up-note");
    try {
      const text = await file.text();
      const norm = normalizeSvgText(text, { stroke: parseFloat($("#norm-stroke").value) });
      const b = bodyOf(norm.svg);
      const rec = {
        id: newId("up"), name: file.name.replace(/\.svg$/i, ""), body: b.body, w: b.w, h: b.h, mono: false,
        setName: "Uploaded", author: "You", kind: "upload",
        license: { title: "Uploaded by you — you hold the rights to this file and are responsible for its license.", spdx: "" },
        sourceLine: `Uploaded SVG, normalized to the Icon Genius grid. ${reportLine(norm.report)}`
      };
      registerCustom(rec);
      let col = activeCollection();
      if (!col) { col = { id: "c_" + Date.now(), name: "My first set", icons: [], color: "#e8e6df" }; state.collections.push(col); state.activeCol = col.id; }
      col.icons.push(rec.id);
      saveCollections();
      note.textContent = `“${rec.name}” normalized and added to “${col.name}”. ${reportLine(norm.report)}`;
    } catch (e) { note.textContent = e.message; }
  }

  /* ---------------- credits UI + PayPal claims ---------------- */
  function renderCredits() {
    const bal = $("#credits-balance");
    if (!bal) return;
    if (typeof state !== "undefined" && state.user) {
      const em = $("#claim-email");
      if (em && !em.value) em.value = state.user.email || "";
      bal.textContent = creditsState.loaded ? `${creditsState.balance} credits · plan: ${creditsState.plan}` : "credits unavailable right now";
      $("#gen-commercial-row").classList.remove("hidden");
    } else {
      bal.textContent = "Sign in to see your credit balance.";
      $("#gen-commercial-row").classList.add("hidden");
    }
    renderClaims();
  }
  async function submitClaim() {
    const note = $("#claim-note");
    if (!awReady()) { note.textContent = "Sign in first — credits are granted to your account."; return; }
    const packSel = $("#claim-pack");
    const pack = (root.IG_CONFIG.credits.packs || [])[+packSel.value];
    const accountEmail = ($("#claim-email").value.trim() || (state.user && state.user.email) || "").toLowerCase();
    const paypalName = $("#claim-name").value.trim();
    const txn = $("#claim-txn").value.trim();
    if (!pack || !paypalName) { note.textContent = "Add the name on your PayPal payment so it can be matched."; return; }
    if (!accountEmail) { note.textContent = "Add your Icon Genius account email — it is the match key for automatic granting."; return; }
    const c = root.IG_CONFIG;
    try {
      const { Permission, Role, ID } = window.Appwrite;
      await aw.databases.createDocument(c.databaseId, c.collections.exports, ID.unique(),
        { ownerId: state.user.$id, collectionId: pack.id, kind: "credit-claim",
          receiptJson: JSON.stringify({ pack: pack.id, credits: pack.credits, amount: pack.price, accountEmail, paypalName, note: txn, status: "pending", filedAt: new Date().toISOString() }) },
        [Permission.read(Role.user(state.user.$id)), Permission.update(Role.user(state.user.$id)), Permission.delete(Role.user(state.user.$id))]);
      note.textContent = "Claim filed. Once the payment email showing this amount and your account email in its note reaches the payment mailbox, credits are granted automatically — usually within the hour. This claim stays on your account so you can watch its status.";
      renderClaims();
    } catch (e) { note.textContent = "Claim failed to save — try again in a moment."; }
  }
  async function renderClaims() {
    const wrap = $("#my-claims");
    if (!wrap) return;
    if (!awReady()) { wrap.innerHTML = ""; return; }
    const c = root.IG_CONFIG;
    try {
      const res = await aw.databases.listDocuments(c.databaseId, c.collections.exports,
        [window.Appwrite.Query.equal("ownerId", state.user.$id), window.Appwrite.Query.equal("kind", "credit-claim"), window.Appwrite.Query.limit(20)]);
      wrap.innerHTML = res.documents.map((d) => {
        let r = {}; try { r = JSON.parse(d.receiptJson || "{}"); } catch (e) { /* keep */ }
        return `<div class="claim-row"><span>${r.pack || d.collectionId} · ${r.credits || "?"} credits</span><span class="badge">${r.status || "pending"}</span></div>`;
      }).join("");
    } catch (e) { wrap.innerHTML = ""; }
  }
  function renderPacks() {
    const wrap = $("#packs");
    if (!wrap) return;
    wrap.innerHTML = (root.IG_CONFIG.credits.packs || []).map((p) =>
      `<div class="pack"><div class="pack-name">${p.name}</div><div class="pack-price">$${p.price} · ${p.credits} credits</div>
       <a class="btn btn-primary" href="${p.paypalUrl}" target="_blank" rel="noopener">Buy with PayPal</a></div>`).join("");
    const sel = $("#claim-pack");
    if (sel) sel.innerHTML = (root.IG_CONFIG.credits.packs || []).map((p, i) => `<option value="${i}">${p.name} — $${p.price} · ${p.credits} credits</option>`).join("");
  }

  /* ---------------- init ---------------- */
  function initEngine() {
    renderPacks();
    renderCredits();
    $("#btn-gen").addEventListener("click", buildCandidates);
    $("#btn-gen-add").addEventListener("click", addCandidatesToCollection);
    $("#btn-normalize").addEventListener("click", onNormalizeEditor);
    $("#btn-normalize-col").addEventListener("click", onNormalizeCollection);
    $("#up-file").addEventListener("change", (e) => { if (e.target.files[0]) onUpload(e.target.files[0]); e.target.value = ""; });
    $("#claim-submit").addEventListener("click", submitClaim);
    let lastUser = null;
    setInterval(() => {
      const u = (typeof state !== "undefined" && state.user) ? state.user.$id : null;
      if (u !== lastUser) { lastUser = u; loadCredits(); }
    }, 1500);
  }
  root.IGEngine = { normalizeSvgText, composeIcon, matchTemplates, shade, TEMPLATES: T,
    /* Phase 3: Complete My Set spends/records credits through the same
       ledger as Phase 2 generation — one balance, one set of rules. */
    credits: { state: () => ({ balance: creditsState.balance, plan: creditsState.plan, loaded: creditsState.loaded }),
               debit: debitCredits, record: recordGeneration, ready: awReady } };
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", initEngine);
})();
