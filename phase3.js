"use strict";
/* Icon Genius — Phase 3 (Nov 17, 2026): Complete My Set, dev exports,
   shareable set pages. Still 100% client-side, $0 to run.
   - Style inference reads the attributes actually present in the user's
     own SVG files and shows the measurements — it is an estimate, the UI
     says so, and every measured value is adjustable before generating.
   - Dev exports are built by pure string builders (exposed on IGPhase3)
     so the test harness can parse and validate every format's output.
   - Share links carry the whole set in the URL fragment (the AuraFlow
     /w/ pattern): no server storage, payload never in the hostname. */
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const CFG = (root.IG_CONFIG && root.IG_CONFIG.generation) || { freeSetMax: 6, creditSetMax: 24, creditPerIcon: 1 };
  const $ = (s) => document.querySelector(s);
  const COMMERCIAL_LICENSE = { title: "Icon Genius Commercial License — use in commercial projects, no redistribution of the icon files themselves", spdx: "" };
  const PERSONAL_LICENSE = { title: "Icon Genius Personal-Use License — personal projects only. Buy credits to license generated icons commercially.", spdx: "" };
  const SHARE_CHAR_CAP = 6000;   // encoded payload ceiling — stated in the UI
  const SHARE_ICON_CAP = 48;     // icons per shared set — stated in the UI

  /* ================= 1. Style inference =================
     Reads attributes only (never computed styles): stroke widths are
     normalized onto the 24 grid using each file's own viewBox, fills are
     counted as drawn, rect rx values stand in for corner character. */
  const median = (arr) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const round1 = (n) => Math.round(n * 10) / 10;

  function analyzeSvg(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg || doc.querySelector("parsererror")) return null;
    const vbParts = (svg.getAttribute("viewBox") || "0 0 24 24").split(/[\s,]+/).map(Number);
    const vbW = vbParts[2] || 24, vbH = vbParts[3] || 24;
    const to24 = 24 / Math.max(vbW, vbH);
    const strokes = [], rxs = [], colors = {};
    let stroked = 0, filled = 0, translucent = 0, shapes = 0;
    const bump = (m, k) => { if (k) m[k] = (m[k] || 0) + 1; };
    const SKIP = new Set(["defs", "title", "desc", "metadata", "style", "lineargradient", "radialgradient", "stop", "clippath", "mask"]);
    /* Presentation attributes inherit — real sets (Lucide & friends) put
       fill/stroke on the root or a <g> and let shapes inherit them, so
       the walk carries effective values down the tree. Absent fill reads
       as the SVG default (filled); absent stroke reads as none. */
    function walk(el, inh) {
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) return;
      const cur = {
        fill: el.getAttribute("fill") ?? inh.fill,
        stroke: el.getAttribute("stroke") ?? inh.stroke,
        sw: el.getAttribute("stroke-width") ?? inh.sw,
        op: el.getAttribute("opacity") ?? inh.op
      };
      if (tag !== "svg" && tag !== "g") {
        shapes++;
        const hasStroke = !!cur.stroke && cur.stroke !== "none";
        const hasFill = cur.fill !== "none";
        if (hasStroke) {
          stroked++;
          strokes.push(parseFloat(cur.sw || "1") * to24);
          if (cur.stroke !== "currentColor") bump(colors, cur.stroke.toLowerCase());
        }
        if (hasFill) {
          filled++;
          if (cur.fill && cur.fill !== "currentColor") bump(colors, cur.fill.toLowerCase());
          const o = parseFloat(el.getAttribute("fill-opacity") ?? cur.op ?? "1");
          if (!Number.isNaN(o) && o < 1) translucent++;
        }
        const rx = el.getAttribute("rx");
        if (rx) rxs.push(parseFloat(rx) * to24);
      }
      for (const child of el.children) walk(child, cur);
    }
    walk(svg, { fill: null, stroke: null, sw: null, op: null });
    return { grid: Math.round(Math.max(vbW, vbH)), strokes, rxs, colors, stroked, filled, translucent, shapes };
  }

  function inferStyle(texts) {
    const per = texts.map(analyzeSvg).filter(Boolean);
    if (!per.length) return null;
    const allStrokes = per.flatMap((p) => p.strokes);
    const allRxs = per.flatMap((p) => p.rxs);
    const stroked = per.reduce((n, p) => n + p.stroked, 0);
    const filled = per.reduce((n, p) => n + p.filled, 0);
    const translucent = per.reduce((n, p) => n + p.translucent, 0);
    const grids = per.map((p) => p.grid);
    const grid = median(grids);
    // Mode: duotone needs translucent fills alongside strokes; otherwise
    // the stroked-vs-filled shape count decides, and the readout shows it.
    let mode = "outline";
    if (stroked > 0 && translucent >= 2) mode = "duotone";
    else if (filled > stroked) mode = "solid";
    else if (stroked === 0 && filled > 0) mode = "solid";
    const colorCounts = {};
    for (const p of per) for (const [k, v] of Object.entries(p.colors)) colorCounts[k] = (colorCounts[k] || 0) + v;
    const topColor = Object.entries(colorCounts).sort((a, b) => b[1] - a[1])[0];
    const hexMatch = topColor && /^#[0-9a-f]{6}$/.test(topColor[0]) ? topColor[0] : null;
    return {
      files: per.length,
      grid,
      stroke: allStrokes.length ? Math.min(2.5, Math.max(1, round1(median(allStrokes)))) : 1.8,
      strokeRange: allStrokes.length ? [round1(Math.min(...allStrokes)), round1(Math.max(...allStrokes))] : null,
      strokeSamples: allStrokes.length,
      mode, stroked, filled, translucent,
      corner: allRxs.length ? Math.min(4, Math.round(median(allRxs) * 2) / 2) : null,
      cornerSamples: allRxs.length,
      color: hexMatch,
      colorMentions: topColor ? topColor[1] : 0
    };
  }

  function readoutText(inf) {
    const bits = [`Read ${inf.files} file${inf.files === 1 ? "" : "s"}, drawn on a ${inf.grid} grid.`];
    if (inf.strokeSamples) bits.push(`Stroke: median ${inf.stroke} across ${inf.strokeSamples} stroked shapes (range ${inf.strokeRange[0]}–${inf.strokeRange[1]}, scaled to the 24 grid).`);
    else bits.push("No stroked shapes found — stroke left at 1.8.");
    bits.push(`Filled vs outlined: ${inf.filled} filled shapes, ${inf.stroked} stroked${inf.translucent ? `, ${inf.translucent} translucent fills` : ""} → read as ${inf.mode === "3d" ? "3D Look" : inf.mode}.`);
    if (inf.cornerSamples) bits.push(`Corners: median rounded-corner radius ${inf.corner} across ${inf.cornerSamples} rounded rectangles.`);
    else bits.push("Corners: no rounded rectangles in the files to measure — corner left at 2; drag it if your set is sharper or rounder.");
    if (inf.color) bits.push(`Most-used color in the files: ${inf.color} — set as the brand color.`);
    else bits.push("The files mostly draw in currentColor or black/white — brand color is yours to pick.");
    bits.push("These are measurements of the files' attributes, not a promise — check them against your set and adjust before generating.");
    return bits.join(" ");
  }

  /* ================= Complete My Set flow ================= */
  let cmsStyle = null;      // inferred + user-adjusted style lock
  let cmsCandidates = [];   // {kind, label, rec, checked}

  function cmsStatus(msg, isErr) {
    const el = $("#cms-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("error", !!isErr);
  }
  function cmsCurrentStyle() {
    return {
      mode: $("#cms-mode").value,
      color: $("#cms-hex").value,
      stroke: parseFloat($("#cms-stroke").value),
      corner: parseFloat($("#cms-corner").value)
    };
  }
  function readFileText(f) {
    if (typeof f.text === "function") return f.text();
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
  }
  async function onCmsFiles(fileList) {
    const files = [...fileList].filter((f) => /\.svg$/i.test(f.name) || f.type.includes("svg"));
    if (!files.length) { cmsStatus("No SVG files in that selection.", true); return; }
    const texts = [];
    for (const f of files) texts.push(await readFileText(f));
    const inf = inferStyle(texts);
    if (!inf) { cmsStatus("None of those files parsed as SVG.", true); return; }
    cmsStyle = inf;
    $("#cms-mode").value = inf.mode;
    $("#cms-stroke").value = inf.stroke;
    $("#cms-corner").value = inf.corner != null ? inf.corner : 2;
    if (inf.color) $("#cms-hex").value = inf.color;
    $("#cms-readout").textContent = readoutText(inf);
    $("#cms-controls").classList.remove("hidden");
    $("#cms-subjects-row").classList.remove("hidden");
    $("#cms-commercial-row").classList.toggle("hidden", !(typeof state !== "undefined" && state.user));
    cmsStatus("");
  }
  async function buildCmsCandidates() {
    if (!cmsStyle) { cmsStatus("Upload a few icons from your set first — the style is measured from them.", true); return; }
    const style = cmsCurrentStyle();
    const commercial = $("#cms-commercial") && $("#cms-commercial").checked;
    const maxSet = commercial ? CFG.creditSetMax : CFG.freeSetMax;
    let subjects = $("#cms-subjects").value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!subjects.length) { cmsStatus("Name the subjects you're missing — comma-separated.", true); return; }
    let cappedNote = "";
    if (subjects.length > maxSet) {
      cappedNote = ` Only the first ${maxSet} subjects were used — ${commercial ? "the credit set limit is " + CFG.creditSetMax : "free sets cap at " + CFG.freeSetMax + " composed icons; spend credits to complete up to " + CFG.creditSetMax}.`;
      subjects = subjects.slice(0, maxSet);
    }
    cmsStatus("Composing in your set's measured style…");
    cmsCandidates = [];
    const usedLib = new Set();
    for (const subject of subjects) {
      // composed from templates, in the inferred style
      const tName = root.IGEngine.matchTemplates(subject, 1)[0];
      const made = tName && root.IGEngine.composeIcon(tName, style);
      if (made) {
        cmsCandidates.push({
          kind: "composed", label: `${subject} · composed (${tName})`, checked: true,
          rec: {
            id: newCmsId("gen"), name: `gen-${tName}`, body: made.body, w: 24, h: 24, mono: made.mono,
            setName: "Icon Genius — generated", author: "Icon Genius engine", kind: "generated", template: tName,
            license: commercial ? { ...COMMERCIAL_LICENSE } : { ...PERSONAL_LICENSE },
            sourceLine: `Composed in your browser to complete your set · style measured from your uploaded icons: ${style.mode}, stroke ${style.stroke}, corner ${style.corner}, ${style.color}`
          }
        });
      }
      // retrieval-and-restyle: top library match, normalized to the style
      try {
        const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(subject)}&limit=16`);
        const data = await r.json();
        const id = (data.icons || []).find((x) => { try { return passesFilter(x) && !usedLib.has(x); } catch (e) { return !usedLib.has(x); } });
        if (id) {
          usedLib.add(id);
          const text = await fetchSvgText(id);
          const norm = root.IGEngine.normalizeSvgText(text, { stroke: style.stroke });
          const b = root.IGCustom.bodyOf(norm.svg);
          const lic = licenseOf(id), m = meta(id);
          cmsCandidates.push({
            kind: "restyled", label: `${subject} · restyled (${id})`, checked: false,
            rec: {
              id: newCmsId("norm"), name: `restyled-${id.split(":")[1]}`, body: b.body, w: b.w, h: b.h,
              mono: isMono(id), setName: m.name || id.split(":")[0], author: (m.author && m.author.name) || "", kind: "restyled",
              license: { title: lic.title || "See source set", spdx: lic.spdx || "", url: lic.url || "" },
              sourceLine: `Restyled from the library icon ${id} (${m.name || ""}) — normalized to your set's measured style. The original set's license applies.`
            }
          });
        }
      } catch (e) { /* library unreachable — composed candidates still stand */ }
    }
    renderCmsCandidates();
    cmsStatus(`${cmsCandidates.length} candidates in your set's measured style (${style.mode}, stroke ${style.stroke}, corner ${style.corner}). Composed icons are drawn from templates; restyled library icons keep their original licenses.${cappedNote}`);
  }
  let cmsUid = 0;
  function newCmsId(kind) { return `${kind}:${Date.now().toString(36)}p3${(cmsUid++).toString(36)}`; }
  function renderCmsCandidates() {
    const wrap = $("#cms-results");
    wrap.innerHTML = cmsCandidates.map((c, i) =>
      `<label class="cand"><input type="checkbox" data-cms="${i}" ${c.checked ? "checked" : ""}>
        <span class="slot"><svg viewBox="0 0 ${c.rec.w} ${c.rec.h}">${c.rec.body.split("currentColor").join(cmsCurrentStyle().color)}</svg></span>
        <span class="cand-name">${c.label}</span><span class="badge">${c.kind}</span></label>`).join("");
    wrap.querySelectorAll("[data-cms]").forEach((box) => box.addEventListener("change", () => { cmsCandidates[+box.dataset.cms].checked = box.checked; }));
    $("#btn-cms-add").classList.toggle("hidden", cmsCandidates.length === 0);
  }
  async function addCmsToCollection() {
    const chosen = cmsCandidates.filter((c) => c.checked);
    if (!chosen.length) { cmsStatus("Nothing selected.", true); return; }
    const commercial = $("#cms-commercial") && $("#cms-commercial").checked;
    const composedCount = chosen.filter((c) => c.kind === "composed").length;
    const cost = commercial ? composedCount * CFG.creditPerIcon : 0;
    if (commercial) {
      if (!root.IGEngine.credits.ready()) { cmsStatus("Sign in first — credits live on your account.", true); return; }
      try { await root.IGEngine.credits.debit(cost); }
      catch (e) { cmsStatus(e.message, true); return; }
    }
    const ids = [];
    for (const c of chosen) {
      if (c.kind === "composed") c.rec.license = commercial ? { ...COMMERCIAL_LICENSE } : { ...PERSONAL_LICENSE };
      root.IGCustom.register(c.rec);
      ids.push(c.rec.id);
    }
    const subjects = $("#cms-subjects").value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const col = { id: "c_" + Date.now(), name: `Completed set — ${subjects.slice(0, 3).join(", ")}${subjects.length > 3 ? "…" : ""}`, icons: ids, color: cmsCurrentStyle().color };
    state.collections.push(col); state.activeCol = col.id;
    saveCollections();
    await root.IGEngine.credits.record(`complete-my-set: ${subjects.join(", ")}`, cmsCurrentStyle(), composedCount, cost);
    cmsStatus(`Added ${ids.length} icons as “${col.name}”${cost ? ` · ${cost} credits spent — commercial license on the composed icons` : " · composed icons carry the personal-use license"}. Export any time — the receipt lists every license.`);
    cmsCandidates = []; renderCmsCandidates();
  }

  /* ================= 2. Dev exports =================
     Pure builders return strings so the harness can parse them. */
  function exportBaseName(id, used) {
    const cr = customRec(id);
    let raw = cr ? cr.name : (id.split(":")[1] || "icon");
    raw = raw.replace(/^(gen|restyled|normalized|up)-/, "");
    let base = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "icon";
    let name = base, n = 2;
    while (used.has(name)) name = `${base}-${n++}`;
    used.add(name);
    return name;
  }
  const pascal = (s) => s.split("-").map((p) => p ? p[0].toUpperCase() + p.slice(1) : "").join("");
  const JSX_ATTRS = {
    "stroke-width": "strokeWidth", "stroke-linecap": "strokeLinecap", "stroke-linejoin": "strokeLinejoin",
    "stroke-dasharray": "strokeDasharray", "stroke-dashoffset": "strokeDashoffset", "stroke-miterlimit": "strokeMiterlimit",
    "stroke-opacity": "strokeOpacity", "fill-opacity": "fillOpacity", "fill-rule": "fillRule", "clip-rule": "clipRule",
    "stop-color": "stopColor", "stop-opacity": "stopOpacity", "class": "className", "xlink:href": "href"
  };
  function toJsxAttrs(inner) {
    return inner.replace(/([a-zA-Z-]+)=/g, (m, attr) => (JSX_ATTRS[attr] ? JSX_ATTRS[attr] : attr) + "=");
  }
  function svgParts(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg || doc.querySelector("parsererror")) return null;
    return { viewBox: svg.getAttribute("viewBox") || "0 0 24 24", inner: svg.innerHTML };
  }
  function reactComponent(name, svgText) {
    const p = svgParts(svgText);
    if (!p) return null;
    const comp = pascal(name) + "Icon";
    return `import type { SVGProps } from "react";\n\n` +
      `export function ${comp}(props: SVGProps<SVGSVGElement>) {\n` +
      `  return (\n    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.viewBox}" {...props}>${toJsxAttrs(p.inner)}</svg>\n  );\n}\n`;
  }
  function vueComponent(name, svgText) {
    const p = svgParts(svgText);
    if (!p) return null;
    return `<template>\n  <svg xmlns="http://www.w3.org/2000/svg" viewBox="${p.viewBox}" v-bind="$attrs">${p.inner}</svg>\n</template>\n\n` +
      `<script setup lang="ts">\ndefineOptions({ name: "${pascal(name)}Icon" });\n</script>\n`;
  }
  function cssExport(entries, receipt) {
    const blocks = entries.map(({ name, svg }) =>
      `.ig-${name} {\n  background-image: url("data:image/svg+xml,${encodeURIComponent(svg)}");\n}`);
    return `/*\n${receipt}\n*/\n.ig {\n  display: inline-block;\n  width: 1em;\n  height: 1em;\n  background-size: contain;\n  background-repeat: no-repeat;\n  background-position: center;\n}\n\n${blocks.join("\n\n")}\n`;
  }
  function spriteWithReceipt(entries, receipt) {
    const parts = entries.map(({ name, svg }) => {
      const p = svgParts(svg);
      return p ? `<symbol id="${name}" viewBox="${p.viewBox}">${p.inner}</symbol>` : "";
    }).filter(Boolean);
    return `<!--\n${receipt.replace(/--/g, "–")}\n-->\n<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${parts.join("\n")}\n</svg>`;
  }
  async function collectEntries(col) {
    const used = new Set();
    const entries = [];
    for (const id of col.icons) {
      const name = exportBaseName(id, used);
      const svg = await fetchSvgText(id, col.color);
      entries.push({ id, name, svg });
    }
    return entries;
  }
  function devNote(msg) { const el = $("#dev-note"); if (el) el.textContent = msg || ""; }
  async function exportReact() {
    const col = activeCollection();
    if (!col || !col.icons.length) return;
    const entries = await collectEntries(col);
    const zip = new JSZip();
    const folder = zip.folder("components");
    const names = [];
    for (const e of entries) {
      const tsx = reactComponent(e.name, e.svg);
      if (tsx) { folder.file(`${pascal(e.name)}Icon.tsx`, tsx); names.push(pascal(e.name) + "Icon"); }
    }
    zip.file("index.ts", names.map((n) => `export { ${n} } from "./components/${n}";`).join("\n") + "\n");
    zip.file("LICENSE-RECEIPT.txt", licenseReceipt(col));
    download(await zip.generateAsync({ type: "blob" }), `${col.name.replace(/\W+/g, "-").toLowerCase()}-react.zip`);
    devNote(`React export: ${names.length} components + index.ts + the license receipt. Each component takes standard SVG props.`);
  }
  async function exportVue() {
    const col = activeCollection();
    if (!col || !col.icons.length) return;
    const entries = await collectEntries(col);
    const zip = new JSZip();
    const folder = zip.folder("components");
    const names = [];
    for (const e of entries) {
      const sfc = vueComponent(e.name, e.svg);
      if (sfc) { folder.file(`${pascal(e.name)}Icon.vue`, sfc); names.push(pascal(e.name) + "Icon"); }
    }
    zip.file("index.js", names.map((n) => `export { default as ${n} } from "./components/${n}.vue";`).join("\n") + "\n");
    zip.file("LICENSE-RECEIPT.txt", licenseReceipt(col));
    download(await zip.generateAsync({ type: "blob" }), `${col.name.replace(/\W+/g, "-").toLowerCase()}-vue.zip`);
    devNote(`Vue export: ${names.length} single-file components + index.js + the license receipt. Attributes pass through via $attrs.`);
  }
  async function exportCss() {
    const col = activeCollection();
    if (!col || !col.icons.length) return;
    const entries = await collectEntries(col);
    download(new Blob([cssExport(entries, licenseReceipt(col))], { type: "text/css" }), `${col.name.replace(/\W+/g, "-").toLowerCase()}-icons.css`);
    devNote(`CSS export: ${entries.length} .ig-* classes with the icons as data URIs, receipt in the header comment. Use as <span class="ig ig-name"></span>.`);
  }
  async function exportSpriteDev() {
    const col = activeCollection();
    if (!col || !col.icons.length) return;
    const entries = await collectEntries(col);
    download(new Blob([spriteWithReceipt(entries, licenseReceipt(col))], { type: "image/svg+xml" }), `${col.name.replace(/\W+/g, "-").toLowerCase()}-sprite.svg`);
    devNote(`Sprite export: ${entries.length} <symbol> entries + the license receipt in the header comment. Reference with <use href="#name">.`);
  }

  /* ================= 3. Shareable set pages =================
     The whole set rides in the URL fragment (#/s/<base64url JSON>) —
     the AuraFlow /w/ pattern. Nothing is stored server-side. */
  function utf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(str);
    const bin = unescape(encodeURIComponent(str));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  function utf8String(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder().decode(bytes);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return decodeURIComponent(escape(bin));
  }
  function b64urlEncode(str) {
    const bytes = utf8Bytes(str);
    let bin = "";
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return utf8String(bytes);
  }
  function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

  function buildSharePayload(col) {
    const icons = [];
    for (const id of col.icons) {
      const cr = customRec(id);
      if (cr) icons.push({ c: { n: cr.name, b: cr.body, w: cr.w || 24, h: cr.h || 24, m: cr.mono ? 1 : 0, s: cr.setName || "", a: cr.author || "", k: cr.kind || "", lic: cr.license || {}, src: cr.sourceLine || "" } });
      else icons.push({ id });
    }
    return { v: 1, name: col.name, color: col.color || "#e8e6df", icons };
  }
  function buildShareLink(col) {
    if (!col || !col.icons.length) return { error: "This set is empty — add icons before sharing it." };
    if (col.icons.length > SHARE_ICON_CAP) return { error: `Share links carry the whole set in the URL, so a shared set caps at ${SHARE_ICON_CAP} icons — this one has ${col.icons.length}. Split it or trim it to share.` };
    const encoded = b64urlEncode(JSON.stringify(buildSharePayload(col)));
    if (encoded.length > SHARE_CHAR_CAP) {
      return { error: `This set encodes to ${encoded.length.toLocaleString()} characters — over the ${SHARE_CHAR_CAP.toLocaleString()}-character share-link limit. Library icons are tiny in a link; generated and uploaded icons carry their full drawing, so a set with several of those hits the cap fast. Remove a few generated icons and try again.` };
    }
    return { url: `${location.origin}${location.pathname}#/s/${encoded}`, chars: encoded.length };
  }
  function parseShareHash(hash) {
    const m = /^#\/s\/([A-Za-z0-9\-_]+)$/.exec(hash || "");
    if (!m) return null;
    try {
      const payload = JSON.parse(b64urlDecode(m[1]));
      if (!payload || payload.v !== 1 || !Array.isArray(payload.icons)) return null;
      return payload;
    } catch (e) { return null; }
  }
  /* Turn a decoded payload into renderable icon ids, registering the
     carried custom icons locally (ids are content hashes — revisiting
     the same link is idempotent). License records travel untouched. */
  function materializeShared(payload) {
    const ids = [];
    for (const item of payload.icons) {
      if (item.id) { ids.push(item.id); continue; }
      if (item.c) {
        const id = `shared:${hashStr(item.c.b + "|" + item.c.n)}`;
        if (!root.IGCustom.get(id)) {
          root.IGCustom.register({
            id, name: item.c.n, body: item.c.b, w: item.c.w, h: item.c.h, mono: !!item.c.m,
            setName: item.c.s, author: item.c.a, kind: item.c.k || "shared",
            license: item.c.lic || {}, sourceLine: item.c.src || "Shared set — license status as shared."
          });
        }
        ids.push(id);
      }
    }
    return ids;
  }
  let sharedCtx = null; // {payload, ids}
  function personalComposed(ids) {
    return ids.map((id) => root.IGCustom.get(id)).filter((r) => r && r.kind === "generated" && /Personal-Use/.test((r.license || {}).title || ""));
  }
  function renderSharedView() {
    const payload = parseShareHash(location.hash);
    const view = $("#shared-view");
    if (!payload) { view.classList.add("hidden"); sharedCtx = null; return; }
    const ids = materializeShared(payload);
    sharedCtx = { payload, ids };
    view.classList.remove("hidden");
    $("#shared-title").textContent = `Shared set — ${payload.name}`;
    const wrap = $("#shared-icons");
    wrap.innerHTML = ids.map((id) => `<div class="mini lg" title="${id}"><span class="slot" data-icon="${id}"></span></div>`).join("");
    hydrateIcons(wrap, () => payload.color);
    const personal = personalComposed(ids);
    $("#shared-note").textContent = `${ids.length} icons, read-only. Library icons keep their source licenses; generated icons keep the license status they were shared with${personal.length ? ` — ${personal.length} generated icon${personal.length === 1 ? " is" : "s are"} on the personal-use license` : ""}.`;
    $("#btn-shared-upgrade").classList.toggle("hidden", personal.length === 0);
    if (personal.length) $("#btn-shared-upgrade").textContent = `Upgrade ${personal.length} generated icon${personal.length === 1 ? "" : "s"} to commercial (${personal.length} credit${personal.length === 1 ? "" : "s"})`;
    view.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function makeItYours() {
    if (!sharedCtx) return;
    const col = { id: "c_" + Date.now(), name: sharedCtx.payload.name, icons: [...sharedCtx.ids], color: sharedCtx.payload.color };
    state.collections.push(col); state.activeCol = col.id;
    saveCollections();
    $("#shared-note").textContent = `Saved to your collections as “${col.name}” — it's yours now: edit, export, and build on it. The icons' licenses came with them, unchanged.`;
  }
  async function upgradeShared() {
    if (!sharedCtx) return;
    const targets = personalComposed(sharedCtx.ids);
    if (!targets.length) return;
    const note = $("#shared-note");
    if (!root.IGEngine.credits.ready()) { note.textContent = "Sign in first — the upgrade spends credits from your account."; return; }
    try { await root.IGEngine.credits.debit(targets.length * CFG.creditPerIcon); }
    catch (e) { note.textContent = e.message; return; }
    for (const rec of targets) { rec.license = { ...COMMERCIAL_LICENSE }; root.IGCustom.register(rec); }
    note.textContent = `Upgraded: ${targets.length} generated icon${targets.length === 1 ? "" : "s"} now carry the commercial license under your account. Library icons were already covered by their own licenses — no credits spent on those.`;
    $("#btn-shared-upgrade").classList.add("hidden");
  }
  async function shareCurrent() {
    const col = activeCollection();
    const note = $("#share-note");
    if (!col) { note.textContent = "Pick a collection first."; return; }
    const res = buildShareLink(col);
    if (res.error) { note.textContent = res.error; return; }
    let copied = false;
    try { await navigator.clipboard.writeText(res.url); copied = true; } catch (e) { /* clipboard blocked — show the link instead */ }
    note.innerHTML = copied
      ? `Share link copied (${res.chars.toLocaleString()} characters — the whole set is in the link, nothing is stored on a server). Anyone opening it sees the set read-only and can make it their own; licenses travel with the icons.`
      : `Share link (${res.chars.toLocaleString()} characters — the whole set is in the link): <span class="share-url">${res.url}</span>`;
  }

  /* ================= init ================= */
  function initPhase3() {
    const cmsFiles = $("#cms-files");
    if (cmsFiles) cmsFiles.addEventListener("change", (e) => { if (e.target.files.length) onCmsFiles(e.target.files); });
    const cmsBtn = $("#btn-cms");
    if (cmsBtn) cmsBtn.addEventListener("click", buildCmsCandidates);
    const cmsAdd = $("#btn-cms-add");
    if (cmsAdd) cmsAdd.addEventListener("click", addCmsToCollection);
    const map = { "btn-export-react": exportReact, "btn-export-vue": exportVue, "btn-export-css": exportCss, "btn-export-sprite-dev": exportSpriteDev, "btn-share": shareCurrent, "btn-shared-own": makeItYours, "btn-shared-upgrade": upgradeShared };
    for (const [id, fn] of Object.entries(map)) { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); }
    window.addEventListener("hashchange", renderSharedView);
    renderSharedView();
  }
  root.IGPhase3 = { inferStyle, analyzeSvg, readoutText, reactComponent, vueComponent, cssExport, spriteWithReceipt, buildSharePayload, buildShareLink, parseShareHash, materializeShared, SHARE_CHAR_CAP, SHARE_ICON_CAP };
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", initPhase3);
})();
