"use strict";
/* Icon Genius — Phase 1: library search + editor + collections + exports.
   Library data: Iconify public API (no key). Persistence: localStorage,
   synced to Appwrite when signed in and Phase 0 IDs are configured. */

const API = "https://api.iconify.design";
const SAFE = new Set(["MIT", "Apache-2.0", "ISC", "CC0-1.0", "Unlicense", "BSD-2-Clause", "BSD-3-Clause", "BSD-3-Clause-Clear", "OFL-1.1", "MPL-2.0"]);
const ATTR = new Set(["CC-BY-4.0", "CC-BY-3.0", "CC-BY-SA-4.0"]);
const FAMILIES = [
  ["lucide", "Lucide"], ["tabler", "Tabler"], ["ph", "Phosphor"], ["heroicons", "Heroicons"],
  ["mdi", "Material Design"], ["solar", "Solar"], ["mingcute", "MingCute"], ["iconamoon", "IconaMoon"],
  ["material-symbols", "Material Symbols"], ["ri", "Remix"], ["bi", "Bootstrap"], ["gg", "css.gg"],
  ["radix-icons", "Radix"], ["carbon", "Carbon"], ["fluent", "Fluent"], ["octicon", "Octicons"]
];
const PAGE = 96;

const $ = (s) => document.querySelector(s);
const state = {
  sets: {},            // prefix -> meta {name, license{title,spdx,url}, author, palette, total}
  results: [],         // full filtered id list for current view
  shown: 0,
  selected: null,      // "prefix:name"
  collections: JSON.parse(localStorage.getItem("ig_collections") || "[]"),
  activeCol: localStorage.getItem("ig_active_col") || null,
  user: null,
  remoteIds: {}        // local collection id -> appwrite document id
};

/* ---------- helpers ---------- */
const splitId = (id) => { const i = id.indexOf(":"); return [id.slice(0, i), id.slice(i + 1)]; };
const meta = (id) => state.sets[splitId(id)[0]] || {};
const isMono = (id) => meta(id).palette === false;
const licenseOf = (id) => (meta(id).license || {});
function licenseClass(id) {
  const spdx = licenseOf(id).spdx || "";
  if (SAFE.has(spdx)) return "safe";
  if (ATTR.has(spdx)) return "attr";
  return "";
}
function passesFilter(id) {
  if (!$("#safe-only").checked) return true;
  const spdx = licenseOf(id).spdx || "";
  return SAFE.has(spdx) || ATTR.has(spdx);
}
function svgUrl(id, color) {
  const [p, n] = splitId(id);
  let u = `${API}/${p}/${n}.svg`;
  if (color && isMono(id)) u += `?color=${encodeURIComponent(color)}`;
  return u;
}
function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function fetchSvgText(id, color) {
  const r = await fetch(svgUrl(id, color));
  if (!r.ok) throw new Error("svg fetch failed");
  return r.text();
}
async function svgToPngBlob(svgText, size) {
  const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    c.getContext("2d").drawImage(img, 0, 0, size, size);
    return await new Promise((res) => c.toBlob(res, "image/png"));
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- catalog metadata ---------- */
async function loadSets() {
  try {
    const cached = sessionStorage.getItem("ig_sets");
    if (cached) { state.sets = JSON.parse(cached); return; }
  } catch (e) { /* ignore */ }
  const r = await fetch(`${API}/collections`);
  state.sets = await r.json();
  try { sessionStorage.setItem("ig_sets", JSON.stringify(state.sets)); } catch (e) { /* too big, fine */ }
}

/* ---------- results grid ---------- */
function renderGrid() {
  const grid = $("#grid");
  const slice = state.results.slice(0, state.shown);
  grid.innerHTML = slice.map((id) => {
    const [, name] = splitId(id);
    const lic = licenseOf(id);
    const cls = licenseClass(id);
    const badge = lic.spdx ? `<span class="badge ${cls}">${lic.spdx}</span>` : "";
    return `<div class="tile${state.selected === id ? " selected" : ""}" data-id="${id}" title="${id}">
      <img loading="lazy" src="${svgUrl(id)}" alt="${name}">
      <span class="tname">${name}</span>${badge}</div>`;
  }).join("");
  $("#empty").classList.toggle("hidden", state.results.length > 0);
  $("#btn-more").classList.toggle("hidden", state.shown >= state.results.length);
  $("#results-count").textContent = state.results.length
    ? `${state.results.length} icons${$("#safe-only").checked ? " · commercial-safe filter on" : ""}`
    : "No results";
  grid.querySelectorAll(".tile").forEach((t) => t.addEventListener("click", () => selectIcon(t.dataset.id)));
}
function setResults(ids) {
  state.results = ids.filter(passesFilter);
  state.shown = Math.min(PAGE, state.results.length);
  renderGrid();
}
async function doSearch(q) {
  q = (q || "").trim();
  if (!q) return;
  $("#results-count").textContent = "Searching…";
  const r = await fetch(`${API}/search?query=${encodeURIComponent(q)}&limit=256`);
  const data = await r.json();
  setResults(data.icons || []);
}
async function browseSet(prefix) {
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.prefix === prefix));
  $("#results-count").textContent = `Loading ${state.sets[prefix]?.name || prefix}…`;
  const r = await fetch(`${API}/collection?prefix=${encodeURIComponent(prefix)}`);
  const data = await r.json();
  let names = [...(data.icons || [])];
  if (data.categories) for (const k of Object.keys(data.categories)) names = names.concat(data.categories[k]);
  setResults([...new Set(names)].map((n) => `${prefix}:${n}`));
}

/* ---------- editor ---------- */
function selectIcon(id) {
  state.selected = id;
  document.querySelectorAll(".tile").forEach((t) => t.classList.toggle("selected", t.dataset.id === id));
  $("#editor-empty").classList.add("hidden");
  $("#editor-body").classList.remove("hidden");
  const lic = licenseOf(id);
  const m = meta(id);
  $("#sel-name").textContent = id;
  $("#sel-license").innerHTML = lic.title
    ? `${m.name || splitId(id)[0]} · ${lic.title}${lic.url ? ` · <a href="${lic.url}" target="_blank" rel="noopener">license</a>` : ""}${m.author?.name ? ` · by ${m.author.name}` : ""}`
    : "License unknown — check the source set before commercial use.";
  $("#palette-note").classList.toggle("hidden", isMono(id));
  refreshPreview();
}
function refreshPreview() {
  if (!state.selected) return;
  const color = $("#ed-color").value;
  $("#preview").innerHTML = `<img src="${svgUrl(state.selected, color)}" alt="">`;
  $("#preview").className = `preview bg-${$("#ed-bg").value}`;
}

/* ---------- collections ---------- */
function saveCollections() {
  localStorage.setItem("ig_collections", JSON.stringify(state.collections));
  localStorage.setItem("ig_active_col", state.activeCol || "");
  renderCollections();
  syncToAppwrite();
}
function activeCollection() { return state.collections.find((c) => c.id === state.activeCol) || null; }
function renderCollections() {
  const wrap = $("#collections");
  wrap.innerHTML = state.collections.map((c) =>
    `<div class="col-item${c.id === state.activeCol ? " active" : ""}" data-id="${c.id}">
       <span>${c.name} <span class="muted">(${c.icons.length})</span></span>
       <button class="del" data-del="${c.id}" title="Delete collection">✕</button>
     </div>`).join("") || `<p class="muted">No collections yet — create one, then add icons to it.</p>`;
  wrap.querySelectorAll(".col-item").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.dataset.del) return;
    state.activeCol = el.dataset.id;
    saveCollections();
  }));
  wrap.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
    state.collections = state.collections.filter((c) => c.id !== b.dataset.del);
    if (state.activeCol === b.dataset.del) state.activeCol = state.collections[0]?.id || null;
    saveCollections();
  }));
  const col = activeCollection();
  $("#col-detail").classList.toggle("hidden", !col);
  if (col) {
    $("#col-color").value = col.color || "#e8e6df";
    $("#col-count").textContent = `${col.icons.length} icons`;
    $("#col-icons").innerHTML = col.icons.map((id) =>
      `<div class="mini" title="${id}"><img src="${svgUrl(id, col.color)}" alt=""><button data-rm="${id}">✕</button></div>`).join("");
    $("#col-icons").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      col.icons = col.icons.filter((i) => i !== b.dataset.rm);
      saveCollections();
    }));
  }
}
function licenseReceipt(col) {
  const lines = [
    `ICON GENIUS — LICENSE RECEIPT`,
    `Collection: ${col.name}`,
    `Exported: ${new Date().toISOString()}`,
    ``,
    `Every icon below keeps the license of its source set. Keep this file with the icons.`,
    ``
  ];
  for (const id of col.icons) {
    const lic = licenseOf(id); const m = meta(id);
    lines.push(`- ${id}`);
    lines.push(`  Set: ${m.name || splitId(id)[0]}${m.author?.name ? ` by ${m.author.name}` : ""}`);
    lines.push(`  License: ${lic.title || "UNKNOWN — verify before commercial use"}${lic.spdx ? ` (${lic.spdx})` : ""}`);
    if (lic.url) lines.push(`  License text: ${lic.url}`);
  }
  return lines.join("\n");
}

/* ---------- exports ---------- */
async function exportZip() {
  const col = activeCollection();
  if (!col || !col.icons.length) return;
  const btn = $("#btn-export-zip"); btn.disabled = true; btn.textContent = "Building…";
  try {
    const zip = new JSZip();
    for (const id of col.icons) {
      const [, name] = splitId(id);
      const svg = await fetchSvgText(id, col.color);
      zip.file(`${name}.svg`, svg);
      const png = await svgToPngBlob(svg, 256);
      if (png) zip.file(`${name}.png`, png);
    }
    zip.file("LICENSE-RECEIPT.txt", licenseReceipt(col));
    download(await zip.generateAsync({ type: "blob" }), `${col.name.replace(/\W+/g, "-").toLowerCase()}-icons.zip`);
  } finally { btn.disabled = false; btn.textContent = "Export ZIP (SVG + PNG + license receipt)"; }
}
async function exportSprite() {
  const col = activeCollection();
  if (!col || !col.icons.length) return;
  const parts = [];
  for (const id of col.icons) {
    const [, name] = splitId(id);
    const text = await fetchSvgText(id, col.color);
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) continue;
    const vb = svg.getAttribute("viewBox") || "0 0 24 24";
    parts.push(`<symbol id="${name}" viewBox="${vb}">${svg.innerHTML}</symbol>`);
  }
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${parts.join("\n")}\n</svg>`;
  download(new Blob([sprite], { type: "image/svg+xml" }), `${col.name.replace(/\W+/g, "-").toLowerCase()}-sprite.svg`);
}

/* ---------- Appwrite ---------- */
let aw = null; // {account, databases}
function appwriteReady() {
  const c = window.IG_CONFIG || {};
  return !!(window.Appwrite && c.projectId && c.databaseId && c.collections?.collections);
}
function initAppwrite() {
  if (!window.Appwrite || !window.IG_CONFIG?.projectId) return;
  try {
    const client = new window.Appwrite.Client()
      .setEndpoint(window.IG_CONFIG.endpoint)
      .setProject(window.IG_CONFIG.projectId);
    aw = { account: new window.Appwrite.Account(client), databases: new window.Appwrite.Databases(client) };
  } catch (e) { aw = null; }
}
async function refreshSession() {
  if (!aw) return;
  try {
    state.user = await aw.account.get();
    $("#auth-state").textContent = state.user.email;
    $("#btn-signin").classList.add("hidden");
    $("#btn-signout").classList.remove("hidden");
    if (appwriteReady()) await pullRemoteCollections();
  } catch (e) {
    state.user = null;
    $("#auth-state").textContent = "Local mode";
    $("#btn-signin").classList.remove("hidden");
    $("#btn-signout").classList.add("hidden");
  }
  renderCollections();
}
async function pullRemoteCollections() {
  const c = window.IG_CONFIG;
  const res = await aw.databases.listDocuments(c.databaseId, c.collections.collections,
    [window.Appwrite.Query.equal("ownerId", state.user.$id), window.Appwrite.Query.limit(100)]);
  state.remoteIds = {};
  const remote = res.documents.map((d) => {
    const localId = "c_" + d.$id;
    state.remoteIds[localId] = d.$id;
    let icons = [], style = {};
    try { icons = JSON.parse(d.iconsJson || "[]"); } catch (e) { /* keep empty */ }
    try { style = JSON.parse(d.styleJson || "{}"); } catch (e) { /* keep empty */ }
    return { id: localId, name: d.name, icons, color: style.color || "#e8e6df" };
  });
  if (remote.length) {
    state.collections = remote;
    if (!remote.find((x) => x.id === state.activeCol)) state.activeCol = remote[0].id;
    localStorage.setItem("ig_collections", JSON.stringify(state.collections));
  }
}
let syncTimer = null;
function syncToAppwrite() {
  if (!appwriteReady() || !state.user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const c = window.IG_CONFIG;
    const { Permission, Role, ID } = window.Appwrite;
    for (const col of state.collections) {
      const data = {
        name: col.name, ownerId: state.user.$id,
        iconsJson: JSON.stringify(col.icons), styleJson: JSON.stringify({ color: col.color })
      };
      try {
        if (state.remoteIds[col.id]) {
          await aw.databases.updateDocument(c.databaseId, c.collections.collections, state.remoteIds[col.id], data);
        } else {
          const doc = await aw.databases.createDocument(c.databaseId, c.collections.collections, ID.unique(), data,
            [Permission.read(Role.user(state.user.$id)), Permission.update(Role.user(state.user.$id)), Permission.delete(Role.user(state.user.$id))]);
          state.remoteIds[col.id] = doc.$id;
        }
      } catch (e) { /* local copy remains the fallback */ }
    }
  }, 600);
}

/* ---------- auth modal ---------- */
let authMode = "in";
function openAuth() { $("#auth-modal").classList.remove("hidden"); $("#auth-error").classList.add("hidden"); }
function closeAuth() { $("#auth-modal").classList.add("hidden"); }
async function submitAuth() {
  const email = $("#auth-email").value.trim();
  const pass = $("#auth-pass").value;
  const err = $("#auth-error");
  err.classList.add("hidden");
  if (!aw) { err.textContent = "Accounts are not wired yet — everything still works in local mode."; err.classList.remove("hidden"); return; }
  try {
    if (authMode === "up") {
      await aw.account.create(window.Appwrite.ID.unique(), email, pass, $("#auth-name").value.trim() || undefined);
    }
    await aw.account.createEmailPasswordSession(email, pass);
    closeAuth();
    await refreshSession();
  } catch (e) {
    err.textContent = e.message || "Sign-in failed.";
    err.classList.remove("hidden");
  }
}

/* ---------- wire up ---------- */
function init() {
  $("#families").innerHTML = FAMILIES.map(([p, label]) =>
    `<button class="chip" data-prefix="${p}">${label}</button>`).join("");
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => browseSet(c.dataset.prefix)));

  let deb = null;
  $("#search").addEventListener("input", (e) => { clearTimeout(deb); deb = setTimeout(() => doSearch(e.target.value), 350); });
  $("#btn-search").addEventListener("click", () => doSearch($("#search").value));
  $("#search").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(e.target.value); });
  $("#safe-only").addEventListener("change", () => { state.shown = Math.min(PAGE, state.results.length); state.results = state.results.filter(passesFilter); renderGrid(); });
  $("#btn-more").addEventListener("click", () => { state.shown = Math.min(state.shown + PAGE, state.results.length); renderGrid(); });

  $("#ed-color").addEventListener("input", refreshPreview);
  $("#ed-bg").addEventListener("change", refreshPreview);
  $("#btn-dl-svg").addEventListener("click", async () => {
    if (!state.selected) return;
    const svg = await fetchSvgText(state.selected, $("#ed-color").value);
    download(new Blob([svg], { type: "image/svg+xml" }), `${splitId(state.selected)[1]}.svg`);
  });
  $("#btn-dl-png").addEventListener("click", async () => {
    if (!state.selected) return;
    const svg = await fetchSvgText(state.selected, $("#ed-color").value);
    const png = await svgToPngBlob(svg, parseInt($("#ed-size").value, 10));
    if (png) download(png, `${splitId(state.selected)[1]}.png`);
  });
  $("#btn-add").addEventListener("click", () => {
    if (!state.selected) return;
    let col = activeCollection();
    if (!col) {
      col = { id: "c_" + Date.now(), name: "My first set", icons: [], color: "#e8e6df" };
      state.collections.push(col); state.activeCol = col.id;
    }
    if (!col.icons.includes(state.selected)) col.icons.push(state.selected);
    saveCollections();
  });

  $("#btn-col-new").addEventListener("click", () => {
    const name = $("#col-name").value.trim() || "Untitled set";
    const col = { id: "c_" + Date.now(), name, icons: [], color: "#e8e6df" };
    state.collections.push(col); state.activeCol = col.id;
    $("#col-name").value = "";
    saveCollections();
  });
  $("#col-color").addEventListener("input", (e) => {
    const col = activeCollection();
    if (col) { col.color = e.target.value; saveCollections(); }
  });
  $("#btn-export-zip").addEventListener("click", exportZip);
  $("#btn-export-sprite").addEventListener("click", exportSprite);

  $("#btn-signin").addEventListener("click", openAuth);
  $("#btn-signout").addEventListener("click", async () => { try { await aw.account.deleteSession("current"); } catch (e) {} state.user = null; refreshSession(); });
  $("#auth-close").addEventListener("click", closeAuth);
  $("#auth-switch").addEventListener("click", () => {
    authMode = authMode === "in" ? "up" : "in";
    $("#auth-title").textContent = authMode === "in" ? "Sign in" : "Create your account";
    $("#auth-submit").textContent = authMode === "in" ? "Sign in" : "Sign up";
    $("#auth-switch").textContent = authMode === "in" ? "Need an account? Sign up" : "Already have an account? Sign in";
    $("#auth-name").classList.toggle("hidden", authMode === "in");
  });
  $("#auth-submit").addEventListener("click", submitAuth);

  initAppwrite();
  refreshSession();
  renderCollections();
  loadSets().then(() => browseSet("lucide"));
}
document.addEventListener("DOMContentLoaded", init);
