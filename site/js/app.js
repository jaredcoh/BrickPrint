"use strict";
/* BrickPrint — static single-page app. All data comes from /data/*.json built by build/*.py */

// ---------- sources (every displayed item cites one of these) ----------
const SOURCES = {
  rb: {name: "Rebrickable", url: "https://rebrickable.com/downloads/",
       note: "Part names, categories, set inventories, color values and images. Free CSV downloads, https://rebrickable.com/downloads/."},
  ldraw: {name: "LDraw Parts Library", url: "https://www.ldraw.org/",
          note: "3D geometry for every part. Creative Commons (CC BY 4.0 / CC BY 2.0 depending on part); authors are listed on each part page."},
  spool: {name: "SpoolmanDB", url: "https://github.com/Donkie/SpoolmanDB",
          note: "Open filament database: brand, material, color name and hex swatch. Hex values are the database's swatches, not measured prints."},
  calc: {name: "Computed here", url: "#/sources",
         note: "CIEDE2000 color difference between the LEGO color swatch and the filament swatch, calculated in your browser."},
  editorial: {name: "Editorial note", url: "https://help.prusa3d.com/materials",
              note: "Short material summaries written for this site, not measured data. See the Prusa materials guide for reference."},
  tweak: {name: "Estimate", url: "#/sources",
          note: "Print-ready tweak: stud walls shrink and tube bores grow by the offset you choose. This is an estimate and has not been tested on your printer."}
};

// ---------- tiny DOM helper ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}
const ext = (href, text, cls) => h("a", {href, target: "_blank", rel: "noopener noreferrer", class: cls}, text);
function srcTag(key, extra) {
  const s = SOURCES[key];
  const isExt = s.url.startsWith("http");
  return h("div", {class: "src", title: s.note},
    "Source: ", isExt ? ext(s.url, s.name) : h("a", {href: s.url}, s.name), extra ? " · " + extra : "");
}
const store = {
  get(k, d) { try { const v = localStorage.getItem("bp." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("bp." + k, JSON.stringify(v)); } catch {} }
};

// ---------- data ----------
const D = {};
async function load(name) {
  if (!D[name]) D[name] = fetch("data/" + name + ".json").then(r => { if (!r.ok) throw new Error(name); return r.json(); });
  return D[name];
}
async function core() {
  const [parts, colors] = await Promise.all([load("parts"), load("colors")]);
  if (!D.partById) { D.colorList = colors; D.partById = new Map(parts.map(p => [p.id, p])); D.colorById = new Map(colors.map(c => [c.id, c])); }
  return {parts, colors};
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(s) { let c = 0xFFFFFFFF; for (let i = 0; i < s.length; i++) c = CRC[(c ^ s.charCodeAt(i)) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function inventory(setNum) {
  const shard = await load("inv/" + (crc32(setNum) % 32));
  return shard[setNum];
}

// ---------- color math (sRGB -> Lab, CIEDE2000) ----------
function hexToLab(hex) {
  const c = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  let x = (c[0] * 0.4124564 + c[1] * 0.3575761 + c[2] * 0.1804375) / 0.95047;
  let y = c[0] * 0.2126729 + c[1] * 0.7151522 + c[2] * 0.0721750;
  let z = (c[0] * 0.0193339 + c[1] * 0.1191920 + c[2] * 0.9503041) / 1.08883;
  const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  [x, y, z] = [f(x), f(y), f(z)];
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function dE2000(a, b) {
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const [L1, a1, b1] = a, [L2, a2, b2] = b;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (y, x) => { if (!y && !x) return 0; const t = Math.atan2(y, x) * deg; return t < 0 ? t + 360 : t; };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * rad / 2);
  const Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
  let hb = hp1 + hp2;
  if (Cp1 * Cp2) { hb = Math.abs(hp1 - hp2) <= 180 ? (hp1 + hp2) / 2 : (hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2); }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
  const dth = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cpb, Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin(2 * dth * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}
function matchFilaments(fils, color, mats, limit) {
  const lab = hexToLab(color.hex);
  return fils.filter(f => mats.has(f.mat) && f.trans === color.trans)
    .map(f => ({f, de: dE2000(lab, f._lab || (f._lab = hexToLab(f.hex)))}))
    .sort((a, b) => a.de - b.de).slice(0, limit);
}

// ---------- shared UI ----------
function swatch(hex, trans) {
  return h("span", {class: "swatch", style: {background: "#" + hex, opacity: trans ? ".7" : "1"}});
}
function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === name));
}
function mount(...nodes) {
  const app = document.getElementById("app");
  app.replaceChildren(...nodes.filter(n => n != null && n !== false));
  window.scrollTo(0, 0);
}
function pic(url, alt) {
  return url ? h("img", {src: url, alt, loading: "lazy", referrerpolicy: "no-referrer"}) : h("span", {class: "hint"}, "no photo");
}
// Parts without a photo get a small render of their own 3D model instead (colored if the model has colors).
let thumbGL = null;
const thumbCache = new Map();
async function renderThumb(p, hex) {
  const key = meshId(p) + "/" + hex;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const m = await loadMesh(meshId(p));
  if (!thumbGL) {
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
    renderer.setSize(220, 165);
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 220 / 165, 0.1, 2000);
    cam.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 0.9));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(40, -60, 80); scene.add(dl);
    thumbGL = {renderer, scene, cam, mat: new THREE.MeshStandardMaterial({roughness: 0.45, metalness: 0})};
  }
  const {renderer, scene, cam, mat} = thumbGL;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  const g2 = g.toNonIndexed(); g2.computeVertexNormals(); g.dispose();
  if (m.attr) {
    g2.setAttribute("color", new THREE.BufferAttribute(triColors(m.attr, [hex, ...(p.pal || [])]), 3));
    mat.vertexColors = true; mat.color.set(0xffffff);
  } else { mat.vertexColors = false; mat.color.set("#" + hex); }
  mat.needsUpdate = true;
  const mesh = new THREE.Mesh(g2, mat);
  scene.add(mesh);
  const bb = new THREE.Box3().setFromBufferAttribute(g2.getAttribute("position"));
  const size = bb.getSize(new THREE.Vector3()), r = Math.max(size.x, size.y, size.z) * 0.9 + 4;
  cam.position.set(r * 2.6 * Math.sin(1.0) * Math.cos(-0.8), r * 2.6 * Math.sin(1.0) * Math.sin(-0.8), r * 2.6 * Math.cos(1.0));
  cam.lookAt(0, 0, size.z / 2);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL("image/png");
  scene.remove(mesh); g2.dispose();
  thumbCache.set(key, url);
  return url;
}
const thumbObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    thumbObserver.unobserve(e.target);
    e.target._render && e.target._render();
  }
}, {rootMargin: "200px"}) : null;
function partPic(p, hex) {
  if (p.img) return pic(p.img, p.name);
  const box = h("span", {class: "hint"}, "rendering…");
  box._render = () => renderThumb(p, hex || "C91A09")
    .then(u => box.replaceWith(h("img", {src: u, alt: p.name + " (3D render)", title: "3D render from the LDraw model; no photo available"})))
    .catch(() => { box.textContent = "no photo"; });
  thumbObserver ? thumbObserver.observe(box) : box._render();
  return box;
}
function loadingNode(t) { return h("p", {class: "hint"}, t || "Loading…"); }
function partCard(p, opts) {
  opts = opts || {};
  const q = opts.color != null ? "?color=" + opts.color : "";
  const col = opts.color != null ? D.colorById.get(opts.color) : null;
  return h("a", {class: "item", href: "#/part/" + encodeURIComponent(p.id) + q},
    h("div", {class: "pic"}, partPic(p, col && col.hex), opts.qty ? h("span", {class: "qty", title: "Quantity in this set"}, "×" + opts.qty) : null),
    h("b", {}, p.name),
    h("small", {}, "Part " + p.id + " · " + p.cat),
    p.kind ? h("small", {}, h("span", {class: "badge"}, p.kind === "print" ? "plain shape of printed part" : "alternate mold")) : null,
    p.pal ? h("small", {}, h("span", {class: "badge"}, "multi-color · " + (p.pal.length + 1) + " colors")) : null,
    col ? h("small", {}, swatch(col.hex, col.trans), col.name) : null,
    h("div", {class: "src"}, "Source: Rebrickable (name, photo) · LDraw (3D)"));
}

// ---------- tolerance settings (shared) ----------
const tweakState = {on: store.get("tweakOn", false), mm: store.get("tweakMm", 0.1)};
function saveTweak() { store.set("tweakOn", tweakState.on); store.set("tweakMm", tweakState.mm); }

// ---------- mesh + STL ----------
const meshCache = new Map();
async function loadMesh(id) {
  if (!meshCache.has(id)) {
    meshCache.set(id, fetch("data/meshes/" + id + ".bin").then(async r => {
      if (!r.ok) throw new Error("mesh");
      const buf = await r.arrayBuffer();
      const [nv, ni, flags] = new Uint32Array(buf, 0, 3);
      let o = 12;
      const pos = new Float32Array(buf.slice(o, o + nv * 12)); o += nv * 12;
      let dir = null;
      if (flags & 1) { dir = new Int8Array(buf.slice(o, o + nv * 3)); o += nv * 3; }
      const idx = flags & 2 ? new Uint32Array(buf.slice(o, o + ni * 4)) : new Uint16Array(buf.slice(o, o + ni * 2));
      o += flags & 2 ? ni * 4 : ni * 2;
      // flags & 4: one byte per triangle. 0 = the color the user picks, 1.. = fixed color from the palette,
      // bit 7 = printed artwork (a thin layer lying on the surface)
      const attr = flags & 4 ? new Uint8Array(buf.slice(o, o + ni / 3)) : null;
      return {pos, dir, idx, attr};
    }));
  }
  return meshCache.get(id);
}
function applyTweak(m, mm) {
  if (!m.dir || !mm) return m.pos;
  const out = new Float32Array(m.pos);
  for (let i = 0; i < out.length; i++) out[i] += m.dir[i] / 127 * mm;
  return out;
}
function buildStl(m, pos) {
  const tris = [];
  for (let t = 0; t < m.idx.length / 3; t++) if (!m.attr || !(m.attr[t] & 0x80)) tris.push(t);
  const n = tris.length, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  const hdr = "BrickPrint STL (mm). Geometry: LDraw Parts Library, CC BY.";
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  for (const t of tris) {
    const a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, c = m.idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2]]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Blob([buf], {type: "model/stl"});
}
// Minimal store-only zip, enough for a 3MF package.
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32bytes(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true);
    parts.push(lh.buffer, nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true);
    ch.setUint32(42, off, true);
    central.push(ch.buffer, nb);
    off += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, b) => a + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], {type: "model/3mf"});
}
function crc32bytes(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// One object, one base material per color, each triangle points at its material.
function build3mf(m, pos, pal, mainHex, title) {
  const hexes = [mainHex, ...pal];
  const v = [];
  for (let i = 0; i < pos.length; i += 3) v.push('<vertex x="' + pos[i].toFixed(4) + '" y="' + pos[i + 1].toFixed(4) + '" z="' + pos[i + 2].toFixed(4) + '"/>');
  const t = [];
  for (let i = 0; i < m.idx.length; i += 3) t.push('<triangle v1="' + m.idx[i] + '" v2="' + m.idx[i + 1] + '" v3="' + m.idx[i + 2] + '" pid="1" p1="' + (m.attr ? m.attr[i / 3] & 0x7f : 0) + '"/>');
  const model = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    + '<metadata name="Title">' + title + '</metadata><metadata name="Designer">BrickPrint (geometry: LDraw Parts Library, CC BY)</metadata>'
    + '<resources><basematerials id="1">' + hexes.map((x, i) => '<base name="' + (i ? "Color " + i : "Main color") + '" displaycolor="#' + x + 'FF"/>').join("") + '</basematerials>'
    + '<object id="2" type="model" pid="1" pindex="0"><mesh><vertices>' + v.join("") + '</vertices><triangles>' + t.join("") + '</triangles></mesh></object></resources>'
    + '<build><item objectid="2"/></build></model>';
  return zipStore([
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
    ["3D/3dmodel.model", model]]);
}
function download(blob, name) {
  const a = h("a", {href: URL.createObjectURL(blob), download: name});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const meshId = p => p.mesh || p.id;
async function downloadPart3mf(p, mainHex) {
  const m = await loadMesh(meshId(p));
  const mm = tweakState.on ? tweakState.mm : 0;
  download(build3mf(m, applyTweak(m, mm), p.pal || [], mainHex, "LEGO " + p.id), "lego-" + p.id + "-color.3mf");
}
async function downloadPartStl(p) {
  const id = p.id;
  const m = await loadMesh(meshId(p));
  const mm = tweakState.on ? tweakState.mm : 0;
  const tag = mm && m.dir ? "-tol" + mm.toFixed(2) : "";
  download(buildStl(m, applyTweak(m, mm)), "lego-" + id + tag + ".stl");
}

// ---------- 3D viewer (three.js core + minimal orbit) ----------
// Per-vertex colors (3 vertices per triangle, non-indexed) from the per-triangle palette index.
function triColors(attr, hexes) {
  const table = hexes.map(x => new THREE.Color("#" + x));
  const col = new Float32Array(attr.length * 9);
  for (let t = 0; t < attr.length; t++) {
    const c = table[attr[t] & 0x7f] || table[0];
    for (let k = 0; k < 3; k++) { col[t * 9 + k * 3] = c.r; col[t * 9 + k * 3 + 1] = c.g; col[t * 9 + k * 3 + 2] = c.b; }
  }
  return col;
}
function makeViewer(container) {
  const w = container.clientWidth || 400, hgt = container.clientHeight || 400;
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, hgt);
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, w / hgt, 0.1, 2000);
  cam.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(40, -60, 80); scene.add(dl);
  const mat = new THREE.MeshStandardMaterial({color: 0xcc0000, roughness: 0.45, metalness: 0});
  let mesh = null, radius = 40, theta = -0.8, phi = 1.0, dist = 100, mainHex = "CC0000", mainTrans = false;
  const paint = () => {
    if (!mesh) return;
    const attr = mesh.userData.attr, pal = mesh.userData.pal;
    mat.vertexColors = !!attr;
    mat.transparent = !!mainTrans; mat.opacity = mainTrans ? 0.65 : 1;
    if (attr) {
      mat.color.set(0xffffff);
      mesh.geometry.setAttribute("color", new THREE.BufferAttribute(triColors(attr, [mainHex, ...pal]), 3));
    } else mat.color.set("#" + mainHex);
    mat.needsUpdate = true;
  };
  const render = () => {
    cam.position.set(dist * Math.sin(phi) * Math.cos(theta), dist * Math.sin(phi) * Math.sin(theta), dist * Math.cos(phi));
    cam.lookAt(0, 0, radius * 0.0 + (mesh ? mesh.userData.cz : 0));
    renderer.render(scene, cam);
  };
  let drag = null;
  const el = renderer.domElement;
  el.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY]; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", e => {
    if (!drag) return;
    theta -= (e.clientX - drag[0]) * 0.01; phi = Math.min(3.0, Math.max(0.15, phi - (e.clientY - drag[1]) * 0.01));
    drag = [e.clientX, e.clientY]; render();
  });
  el.addEventListener("pointerup", () => drag = null);
  el.addEventListener("wheel", e => { e.preventDefault(); dist = Math.min(radius * 8, Math.max(radius * 1.2, dist * Math.exp(e.deltaY * 0.001))); render(); }, {passive: false});
  const ro = new ResizeObserver(() => {
    const W = container.clientWidth, H = container.clientHeight;
    if (!W || !H) return;
    renderer.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); render();
  });
  ro.observe(container);
  return {
    setMesh(m, pos, pal) {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      g.computeBoundingBox();
      const g2 = g.toNonIndexed(); g2.computeVertexNormals(); g.dispose();
      mesh = new THREE.Mesh(g2, mat);
      const bb = new THREE.Box3().setFromBufferAttribute(g2.getAttribute("position"));
      const size = bb.getSize(new THREE.Vector3());
      radius = Math.max(size.x, size.y, size.z) * 0.9 + 4;
      mesh.userData.cz = size.z / 2;
      mesh.userData.attr = m.attr; mesh.userData.pal = pal || [];
      paint();
      if (!this._fit) { dist = radius * 3.2; this._fit = true; }
      scene.add(mesh); render();
    },
    setColor(hex, trans) {
      mainHex = hex; mainTrans = !!trans; paint(); render();
    },
    dispose() { ro.disconnect(); renderer.dispose(); el.remove(); }
  };
}

// ---------- filament panel ----------
const MAT_NOTES = [
  ["PLA", "Easiest to print and the widest color range. Softens around 55–60 °C, so avoid hot cars or dishwashers. Fine for display bricks and light clutch use."],
  ["PETG", "Tougher and a bit more flexible than PLA, with better heat resistance. Can string; bricks may clutch a little tighter."],
  ["ASA", "UV- and heat-resistant and closest to real LEGO plastic in feel. Needs an enclosure and good ventilation while printing."],
  ["ABS", "What genuine LEGO bricks are molded from. Strong and heat-resistant but warps and gives off fumes, so enclose and ventilate."]
];
let filState = {mats: new Set(store.get("mats", ["PLA", "PETG", "ASA", "ABS"]))};
async function filamentPanel(getColor) {
  const fils = await load("filaments");
  const box = h("div", {});
  const list = h("div", {});
  const chips = h("div", {class: "chips", role: "group", "aria-label": "Filament materials"},
    ["PLA", "PETG", "ASA", "ABS"].map(m => {
      const id = "mat-" + m;
      const cb = h("input", {type: "checkbox", id, checked: filState.mats.has(m) || null, onchange: () => {
        cb.checked ? filState.mats.add(m) : filState.mats.delete(m);
        store.set("mats", [...filState.mats]); draw();
      }});
      return h("label", {class: "chip", for: id}, cb, m);
    }));
  function draw() {
    const color = getColor();
    list.replaceChildren();
    if (!color) return;
    if (!filState.mats.size) { list.append(h("p", {class: "hint"}, "Select at least one material.")); return; }
    const res = matchFilaments(fils, color, filState.mats, 10);
    list.append(h("p", {class: "hint"},
      color.trans ? "Showing translucent filaments only, because this LEGO color is transparent."
                  : "Showing opaque filaments only."));
    if (!res.length) { list.append(h("p", {}, "No matching filament in the database for these materials.")); return; }
    for (const {f, de} of res) {
      const cls = de < 3 ? "good" : de < 8 ? "ok" : "far";
      const verdict = de < 3 ? "near match" : de < 8 ? "close" : "loose match";
      const q = encodeURIComponent([f.brand, f.name, f.dia + "mm", "filament"].join(" "));
      list.append(h("div", {class: "fil"},
        h("div", {class: "sw", style: {background: "#" + f.hex, opacity: f.trans ? ".7" : "1"}}),
        h("div", {},
          h("b", {}, f.brand + " — " + f.name),
          h("div", {class: "hint"}, [f.mat, f.finish, f.dia + " mm", "#" + f.hex].filter(Boolean).join(" · ")),
          h("div", {class: "links"},
            ext("https://www.amazon.com/s?k=" + q, "Search Amazon"),
            ext("https://www.google.com/search?tbm=shop&q=" + q, "Search shops"),
            ext(f.src, "Data source")),
        ),
        h("div", {class: "de " + cls, title: "CIEDE2000 color difference (lower is closer)"}, "ΔE " + de.toFixed(1), h("div", {class: "hint"}, verdict))));
    }
    list.append(srcTag("spool", "swatches"), srcTag("calc", "color difference"));
  }
  box.append(
    h("h3", {}, "Recommended filament"),
    chips, list,
    h("details", {class: "sticky-pad"}, h("summary", {}, "Material tradeoffs"),
      MAT_NOTES.map(([m, t]) => h("p", {}, h("b", {}, m + ": "), t)), srcTag("editorial")),
    h("p", {class: "note"}, "Swatch colors are the manufacturers' listed values. A printed part can look lighter or darker than the swatch, and metallic, pearl or glow LEGO colors only match approximately. Search links carry no price data and no affiliate tags."));
  draw();
  return {node: box, redraw: draw};
}

function colorPicker(onPick, selectedId) {
  const search = h("input", {type: "search", placeholder: "Filter LEGO colors (e.g. red, bright green)", "aria-label": "Filter LEGO colors"});
  const grid = h("div", {class: "colorgrid", role: "group", "aria-label": "LEGO colors"});
  let sel = selectedId;
  function draw() {
    const q = search.value.trim().toLowerCase();
    grid.replaceChildren(...D.colorList.filter(c => !q || c.name.toLowerCase().includes(q))
      .map(c => h("button", {class: "cbtn", type: "button", "aria-pressed": c.id === sel ? "true" : "false", onclick: () => { sel = c.id; onPick(c); draw(); }},
        swatch(c.hex, c.trans), c.name + (c.trans ? " (trans)" : ""))));
  }
  search.addEventListener("input", draw);
  draw();
  return h("div", {}, search, grid, srcTag("rb", "color values (colors.csv)"));
}

const PRINTED_RE = /(?:pr|pb|pat|px|ps|pd|pt|ph|pm)\d|stk\d/;

// ---------- views ----------
async function viewHome() {
  setNav("home");
  const {parts} = await core();
  const sets = await load("sets");
  const out = h("div", {class: "grid"});
  const input = h("input", {type: "search", "aria-label": "Search", autocomplete: "off"});
  const help = h("p", {class: "hint"});
  let mode = store.get("mode", "set");
  const MODES = {
    set: ["By set", "Type a set number or name, for example 10698 or Millennium Falcon", "Pick the set you own, then see which of its pieces have printable models."],
    part: ["By part", "Type a part number or name, for example 3001 or slope 45", "Search the " + parts.length.toLocaleString() + " printable parts by LEGO part number or name."],
    paste: ["Paste a link or ID", "Paste a Rebrickable, BrickLink or LDraw link, or a file such as 3001.dat", "Start from a link you already have. Set and part links both work."],
  };
  const tabs = h("div", {class: "tabs", role: "tablist"});
  function drawTabs() {
    tabs.replaceChildren(...Object.entries(MODES).map(([k, v]) =>
      h("button", {class: "tab", role: "tab", "aria-selected": k === mode ? "true" : "false", onclick: () => { mode = k; store.set("mode", k); input.value = ""; drawTabs(); run(); }}, v[0])),
      h("a", {class: "tab", href: "#/browse", style: {textDecoration: "none"}}, "Browse categories"),
      h("a", {class: "tab", href: "#/colors", style: {textDecoration: "none"}}, "By color (filament only)"));
    input.placeholder = MODES[mode][1];
    help.textContent = MODES[mode][2];
  }
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  function setItem(s) {
    return h("a", {class: "item", href: "#/set/" + s.n},
      h("div", {class: "pic"}, pic(s.img, s.name)), h("b", {}, s.name),
      h("small", {}, s.n + " · " + s.y + " · " + s.p + " pieces"), h("small", {}, s.t),
      h("div", {class: "src"}, "Source: Rebrickable"));
  }
  function parsePaste(v) {
    v = v.trim();
    let m;
    if ((m = v.match(/rebrickable\.com\/sets\/([\w-]+)/i))) return {set: m[1]};
    if ((m = v.match(/rebrickable\.com\/parts\/([\w]+)/i))) return {part: m[1]};
    if ((m = v.match(/bricklink\.com.*[?&]S=([\w-]+)/i))) return {set: m[1].includes("-") ? m[1] : m[1] + "-1"};
    if ((m = v.match(/bricklink\.com.*[?&]P=([\w]+)/i))) return {part: m[1]};
    if ((m = v.match(/([\w]+)\.dat\b/i))) return {part: m[1]};
    if (/^\d{3,7}-\d+$/.test(v)) return {set: v};
    if (/^[\w]+$/.test(v)) return {part: v};
    return null;
  }
  function run() {
    const q = norm(input.value);
    out.replaceChildren();
    if (mode === "paste") {
      if (!input.value.trim()) return;
      const r = parsePaste(input.value);
      if (!r) { out.append(h("p", {class: "hint"}, "That doesn't look like a set, part or link I understand.")); return; }
      location.hash = r.set ? "#/set/" + r.set : "#/part/" + encodeURIComponent(r.part);
      return;
    }
    if (!q) {
      if (mode === "set") sets.filter(s => s.p >= 200).slice(0, 12).forEach(s => out.append(setItem(s)));
      else parts.filter(p => p.sets).sort((a, b) => b.sets - a.sets).slice(0, 12).forEach(p => out.append(partCard(p)));
      return;
    }
    if (mode === "set") {
      const hits = [], wordsQ = q.split(" ");
      for (const s of sets) {
        const hay = norm(s.n + " " + s.name + " " + s.t);
        if (wordsQ.every(w => hay.includes(w))) { hits.push(s); if (hits.length >= 48) break; }
      }
      hits.forEach(s => out.append(setItem(s)));
      if (!hits.length) out.append(h("p", {class: "hint"}, "No set found. Only sets containing at least one printable part are listed."));
    } else {
      const words = q.split(" ");
      parts.filter(p => words.every(w => norm(p.id + " " + p.name).includes(w))).slice(0, 48).forEach(p => out.append(partCard(p)));
      if (!out.children.length) out.append(h("p", {class: "hint"}, "No printable part found for “" + input.value + "”. It may not be in the library yet."));
    }
  }
  input.addEventListener("input", run);
  input.addEventListener("keydown", e => { if (e.key === "Enter" && mode === "paste") run(); });
  drawTabs(); run();
  mount(
    h("h1", {}, "Lost a brick? Print a replacement."),
    h("p", {class: "lead"}, "Start from the set you own, a part number or a link. Preview the piece in 3D, download a printable STL, and get filament suggestions for the exact LEGO color."),
    h("div", {class: "card"}, tabs, input, help, out),
    h("p", {class: "hint sticky-pad"}, parts.length.toLocaleString() + " printable parts (bricks, plates, tiles, slopes, curves, wedges) · " + sets.length.toLocaleString() + " sets · " + D.colorList.length + " LEGO colors. "),
    h("p", {class: "hint"}, "Parts outside this library can still be found through ", ext("https://library.ldraw.org/", "LDraw"), " or ", ext("https://rebrickable.com/", "Rebrickable"), "."));
}

async function viewSet(num) {
  setNav("home");
  mount(loadingNode("Loading set…"));
  const {parts} = await core();
  const sets = await load("sets");
  const s = sets.find(x => x.n === num);
  if (!s) { mount(h("p", {}, "Set ", num, " isn't in the library (no printable parts, or unknown number). "), h("a", {href: "#/"}, "Back to search")); return; }
  const inv = await inventory(num) || [];
  const colorIds = [...new Set(inv.map(r => r[1]))].map(id => D.colorById.get(id)).filter(Boolean);
  const grid = h("div", {class: "grid"});
  const search = h("input", {type: "search", placeholder: "Filter this set's pieces by name or number", "aria-label": "Filter pieces"});
  const colorSel = h("select", {"aria-label": "Filter by color"}, h("option", {value: ""}, "All colors"),
    colorIds.map(c => h("option", {value: c.id}, c.name)));
  function draw() {
    const q = search.value.trim().toLowerCase(), c = colorSel.value;
    grid.replaceChildren(...inv.filter(([pid, cid]) => {
      const p = D.partById.get(pid);
      return p && (!c || +c === cid) && (!q || (p.id + " " + p.name).toLowerCase().includes(q));
    }).map(([pid, cid, qty]) => partCard(D.partById.get(pid), {color: cid, qty})));
  }
  search.addEventListener("input", draw); colorSel.addEventListener("change", draw);
  draw();
  mount(
    h("div", {class: "crumbs"}, h("a", {href: "#/"}, "← Find a piece")),
    h("div", {class: "row"}, h("img", {class: "setpic", src: s.img, alt: s.name, referrerpolicy: "no-referrer"}),
      h("div", {}, h("h1", {}, s.name), h("p", {class: "hint"}, s.n + " · " + s.y + " · " + s.t + " · " + s.p + " pieces in the set"),
        srcTag("rb", "set details and inventory"),
        h("div", {}, ext("https://rebrickable.com/sets/" + s.n + "/", "View on Rebrickable"), " · ", ext("https://www.bricklink.com/v2/catalog/catalogitem.page?S=" + s.n, "BrickLink")))),
    h("div", {class: "note sticky-pad"}, s.lib + " of this set's pieces have printable models (" + inv.length + " part/color combinations)."
      + (s.oth ? " The other " + s.oth + " pieces (printed parts, minifigure parts, special molds and so on) aren't in the library yet." : "")
      + " Pick the piece you're missing:"),
    h("div", {class: "row sticky-pad"}, h("div", {style: {flex: "2 1 240px"}}, search), h("div", {style: {flex: "1 1 160px"}}, colorSel)),
    grid);
}

async function viewBrowse(params) {
  setNav("browse");
  const {parts} = await core();
  const cats = [...new Set(parts.map(p => p.cat))];
  let cat = params.get("cat") || "";
  const search = h("input", {type: "search", placeholder: "Filter by name or number", "aria-label": "Filter parts"});
  const sel = h("select", {"aria-label": "Category"}, h("option", {value: ""}, "All categories"),
    cats.map(c => h("option", {value: c, selected: c === cat || null}, c + " (" + parts.filter(p => p.cat === c).length + ")")));
  const grid = h("div", {class: "grid"}), count = h("p", {class: "hint"});
  const kindSel = h("select", {"aria-label": "Part type"},
    h("option", {value: "base"}, "Base parts (no printed variants)"), h("option", {value: "all"}, "Include printed-design and alternate parts"),
    h("option", {value: "mc"}, "Multi-color parts only (colors built into the model)"));
  let limit = 60;
  function draw() {
    const q = search.value.trim().toLowerCase();
    const list = parts.filter(p => (kindSel.value === "all" || (kindSel.value === "mc" ? p.pal : !p.kind)) && (!sel.value || p.cat === sel.value) && (!q || (p.id + " " + p.name).toLowerCase().includes(q)));
    count.textContent = list.length + " parts";
    grid.replaceChildren(...list.slice(0, limit).map(p => partCard(p)));
    if (list.length > limit) grid.append(h("button", {class: "btn sec", onclick: () => { limit += 60; draw(); }}, "Show more"));
  }
  search.addEventListener("input", () => { limit = 60; draw(); }); sel.addEventListener("change", () => { limit = 60; draw(); }); kindSel.addEventListener("change", () => { limit = 60; draw(); });
  draw();
  mount(h("h1", {}, "Browse printable parts"),
    h("p", {class: "lead"}, "Categories follow Rebrickable's part categories."),
    h("div", {class: "row"}, h("div", {style: {flex: "1 1 220px"}}, sel), h("div", {style: {flex: "2 1 260px"}}, search), h("div", {style: {flex: "1 1 220px"}}, kindSel)),
    count, grid, srcTag("rb", "names and categories"));
}

async function viewPart(id, params) {
  setNav("home");
  mount(loadingNode("Loading part…"));
  const {parts, colors} = await core();
  const p = D.partById.get(id);
  if (!p) {
    mount(h("div", {class: "crumbs"}, h("a", {href: "#/"}, "← Find a piece")),
      h("h1", {}, "Part " + id + " isn't in the printable library yet"),
      h("p", {class: "lead"}, "The first release covers bricks, plates, tiles, slopes, curves and wedges that have a matching LDraw model. Try these places:"),
      h("ul", {}, [
        ["Rebrickable part page", "https://rebrickable.com/parts/" + encodeURIComponent(id) + "/"],
        ["BrickLink catalog", "https://www.bricklink.com/v2/catalog/catalogitem.page?P=" + encodeURIComponent(id)],
        ["LDraw official file (if it exists)", "https://library.ldraw.org/library/official/parts/" + encodeURIComponent(id) + ".dat"],
        ["Search Printables", "https://www.printables.com/search/models?q=lego%20" + encodeURIComponent(id)],
        ["Search Thingiverse", "https://www.thingiverse.com/search?q=lego%20" + encodeURIComponent(id)]
      ].map(([t, u]) => h("li", {}, ext(u, t)))),
      h("p", {class: "hint"}, "These are search/lookup links to third-party sites; their content and licenses are their own."));
    return;
  }
  let color = D.colorById.get(+params.get("color")) || D.colorById.get(0) || colors[0];
  const viewer = h("div", {class: "viewer"}, h("div", {class: "msg"}, "Loading 3D model…"));
  const tweakBox = h("div", {class: "opt"});
  const dims = p.size_mm.map(v => v.toFixed(1)).join(" × ");
  const colorLine = h("p", {}, "");
  let vw = null, fp = null;
  const mesh = loadMesh(meshId(p));
  function updateColorLine() {
    colorLine.replaceChildren(swatch(color.hex, color.trans), h("b", {}, color.name), color.trans ? " (transparent)" : "", " ",
      h("span", {class: "hint"}, "#" + color.hex));
  }
  async function refresh() {
    const m = await mesh;
    const mm = tweakState.on ? tweakState.mm : 0;
    vw.setMesh(m, applyTweak(m, mm), p.pal);
  }
  updateColorLine();
  const cb = h("input", {type: "checkbox", id: "tw", checked: tweakState.on || null, onchange: () => { tweakState.on = cb.checked; saveTweak(); drawTweak(); refresh(); }});
  const rng = h("input", {type: "range", min: "0.02", max: "0.30", step: "0.01", value: tweakState.mm, "aria-label": "Clearance offset in millimetres",
    oninput: () => { tweakState.mm = +rng.value; saveTweak(); drawTweak(); refresh(); }});
  function drawTweak() {
    tweakBox.replaceChildren(
      h("label", {for: "tw"}, cb, h("span", {}, "Print-ready tweaks (experimental)")),
      h("span", {class: "hint"}, p.tweak
        ? "Shrinks stud walls and widens tube bores by " + tweakState.mm.toFixed(2) + " mm so the piece clutches instead of jamming. Off = the plain LDraw model."
        : "This part has no standard studs or tubes, so tweaks change nothing."),
      p.tweak ? h("div", {}, rng, h("span", {class: "hint"}, "Offset: " + tweakState.mm.toFixed(2) + " mm (typical FDM range 0.05–0.20)")) : null,
      srcTag("tweak"));
  }
  drawTweak();

  const pickerNode = colorPicker(c => { color = c; updateColorLine(); vw.setColor(c.hex, c.trans); fp && fp.redraw(); history.replaceState(null, "", "#/part/" + encodeURIComponent(p.id) + "?color=" + c.id); }, color.id);
  const filHost = h("div", {}, loadingNode("Loading filaments…"));
  const ldFile = "https://library.ldraw.org/library/" + (p.unf ? "unofficial" : "official") + "/parts/" + encodeURIComponent(meshId(p)) + ".dat";

  mount(
    h("div", {class: "crumbs"}, h("a", {href: "#/"}, "← Find a piece"), " · ", h("a", {href: "#/browse?cat=" + encodeURIComponent(p.cat)}, p.cat)),
    h("h1", {}, p.name),
    p.kind === "print" ? h("p", {class: "note"}, "This part has a printed design or pattern. The STL is the plain shape of part " + meshId(p) + "; the artwork isn't modelled. Print it in the base color, then add a sticker or paint. (Link between parts: Rebrickable part relationships.)") : null,
    p.kind === "alt" ? h("p", {class: "note"}, "Rebrickable lists this as an alternate or mold variant of part " + meshId(p) + ". The STL uses that part's shape, so small details may differ from your piece.") : null,
    p.pal ? h("p", {class: "note"}, "This model has " + (p.pal.length + 1) + " colors built in (the main color follows the LEGO color you pick; the other " + p.pal.length + " are fixed). Download the plain STL for one-color printing, or the 3MF to load it into a multi-color slicer with one material per color. The 3MF export has not been tested in slicers yet.") : null,
    !p.pal && p.kind !== "print" && PRINTED_RE.test(p.id) ? h("p", {class: "note"}, "This part has a printed design or sticker. The LDraw library stores printed artwork as image textures, so the STL is the plain shape only. Use the photo as a guide, then add a sticker or paint.") : null,
    p.unf ? h("p", {class: "note"}, "This model comes from LDraw's unofficial library: not yet officially reviewed, so check dimensions before printing.") : null,
    h("p", {class: "hint"}, "Part " + p.id + " · " + p.cat + " · about " + dims + " mm (X × Y × Z) · " + p.tris.toLocaleString() + " triangles"),
    h("div", {class: "split"},
      h("div", {}, viewer, h("p", {class: "hint"}, "Drag to rotate, scroll to zoom. Printed with the flat side down."),
        h("div", {class: "row"},
          h("button", {class: "btn", onclick: e => { e.target.disabled = true; downloadPartStl(p).finally(() => e.target.disabled = false); }}, "Download STL"),
          p.pal ? h("button", {class: "btn sec", onclick: e => { e.target.disabled = true; downloadPart3mf(p, color.hex).finally(() => e.target.disabled = false); }}, "Download 3MF (multi-color)") : null,
          h("span", {class: "hint"}, "Generated in your browser from the LDraw model")),
        srcTag("ldraw", (p.unf ? "unofficial library, " : "") + "geometry by " + (p.author || "LDraw contributors") + (p.license ? " · " + p.license : "")),
        p.img ? h("div", {class: "photo"}, pic(p.img, p.name + " photo"), h("div", {class: "src"}, "Photo: Rebrickable (one color variant; your color may differ)")) : null,
        h("div", {class: "sticky-pad"}, tweakBox)),
      h("div", {class: "panel"},
        h("div", {class: "card"}, h("h3", {}, "LEGO color"), colorLine, pickerNode),
        h("div", {class: "card"}, filHost),
        h("div", {class: "card"}, h("h3", {}, "Other places to look"),
          h("ul", {}, [
            ["Rebrickable", "https://rebrickable.com/parts/" + encodeURIComponent(p.id) + "/"],
            ["BrickLink", "https://www.bricklink.com/v2/catalog/catalogitem.page?P=" + encodeURIComponent(p.id)],
            ["LDraw source file (.dat)", ldFile],
            ["Printables search", "https://www.printables.com/search/models?q=lego%20" + encodeURIComponent(p.id)],
            ["Thingiverse search", "https://www.thingiverse.com/search?q=lego%20" + encodeURIComponent(p.id)]
          ].map(([t, u]) => h("li", {}, ext(u, t)))),
          srcTag("rb", "part name, category" + (p.img ? ", photo" : ""))))));
  try {
    vw = makeViewer(viewer);
    viewer.querySelector(".msg")?.remove();
  } catch (e) { viewer.querySelector(".msg").textContent = "3D preview needs WebGL, which isn't available here. You can still download the STL."; }
  if (vw) { vw.setColor(color.hex, color.trans); refresh().catch(() => { viewer.append(h("div", {class: "msg"}, "Couldn't load the model.")); }); }
  fp = await filamentPanel(() => color);
  filHost.replaceChildren(fp.node);
}

async function viewColors(params) {
  setNav("colors");
  const {colors} = await core();
  let color = D.colorById.get(+params.get("c")) || D.colorById.get(5) || colors[0];
  const line = h("p", {});
  function upd() { line.replaceChildren(swatch(color.hex, color.trans), h("b", {}, color.name), " ", h("span", {class: "hint"}, "#" + color.hex)); }
  upd();
  const filHost = h("div", {}, loadingNode("Loading filaments…"));
  let fp;
  mount(h("h1", {}, "Filament by LEGO color"),
    h("p", {class: "lead"}, "Pick a LEGO color and see the closest filaments from the database."),
    h("div", {class: "split"},
      h("div", {class: "card"}, line, colorPicker(c => { color = c; upd(); fp && fp.redraw(); history.replaceState(null, "", "#/colors?c=" + c.id); }, color.id)),
      h("div", {class: "card"}, filHost)));
  fp = await filamentPanel(() => color);
  filHost.replaceChildren(fp.node);
}

function viewSources() {
  setNav("sources");
  const rows = [
    ["Part names, categories, photos", "Rebrickable", SOURCES.rb.url, "Free CSV downloads. Rebrickable asks for attribution; photos are hotlinked from its CDN."],
    ["Set list and set inventories", "Rebrickable", SOURCES.rb.url, "Latest inventory version per set, spare parts excluded."],
    ["LEGO color names and swatch values", "Rebrickable (colors.csv)", SOURCES.rb.url, "Transparent flag from the same file."],
    ["Printed/alternate part → shape mapping", "Rebrickable (part_relationships.csv)", SOURCES.rb.url, "Printed (P/T) and alternate/mold (A/M) relationships point a part to the base part whose LDraw model is used. Printed artwork is not modelled."],
    ["3D geometry of every part", "LDraw Parts Library (official + unofficial)", SOURCES.ldraw.url, "Creative Commons: CC BY 4.0 (newer files) or CC BY 2.0 (older files). Each part's author and license are shown on its page. Converted to triangle meshes with build/build_meshes.py."],
    ["Filament brands, materials, colors, hex", "SpoolmanDB", SOURCES.spool.url, "Open database. Only single-color PLA, PETG, ABS and ASA entries are used; multi-color spools can't be matched on one swatch."],
    ["Color matching score (ΔE)", "Computed here", "#/sources", "CIEDE2000 on CIELAB values converted from the two swatches. Lower is closer; under 3 is a near match."],
    ["Material tradeoff notes", "Editorial", SOURCES.editorial.url, "Short summaries written for this site, not a dataset."],
    ["Print-ready tweak (stud/tube offset)", "Estimate", "#/sources", "Radial offset applied to stud.dat-style studs and stud4 tube bores. Not tested on any printer; adjust to your calibration."],
    ["Retailer search links", "Amazon / Google Shopping searches", "https://www.amazon.com/", "Plain search URLs, no affiliate tags, no price data."],
    ["Other-place links", "BrickLink, Printables, Thingiverse", "https://www.bricklink.com/", "Link-outs only; nothing is copied from these sites."]
  ];
  mount(h("h1", {}, "Sources and licenses"),
    h("p", {class: "lead"}, "Every item on this site cites where it came from. This is the full list."),
    h("div", {class: "card"}, h("table", {}, h("thead", {}, h("tr", {}, ["What", "Source", "Notes"].map(t => h("th", {}, t)))),
      h("tbody", {}, rows.map(([w, s, u, n]) => h("tr", {}, h("td", {}, w), h("td", {}, u.startsWith("http") ? ext(u, s) : s), h("td", {}, n)))))),
    h("h2", {class: "sticky-pad"}, "Legal"),
    h("p", {}, "LEGO® is a trademark of the LEGO Group, which does not sponsor, authorize or endorse this site. This is a non-commercial fan tool for reprinting pieces you've lost. LDraw models are © their authors under the licenses above; STL files generated here carry that attribution."),
    h("h2", {}, "Known limits"),
    h("ul", {}, [
      "A part is included only if it, or a base part linked to it by Rebrickable, has an LDraw model. Printed and sticker artwork is stored in LDraw as image textures, so most printed parts print as the plain shape (no artwork) and the photo is your guide. About a hundred parts (windows, signs, hinged and assembled parts) carry real multiple colors in their model and offer a multi-color 3MF. Alternate molds may differ in small details. Unofficial LDraw models are flagged on their page.",
      "LDraw models describe how a part looks, not how it prints. Clutch fit depends on your printer; start with the tweak offset and test-print.",
      "Filament swatches are listed colors, not measured prints.",
      "Part names are tidied from Rebrickable's (spacing, \u201c2x4\u201d to \u201c2 x 4\u201d, \u201cw/\u201d to \u201cwith\u201d). The original name is kept in the data."
    ].map(t => h("li", {}, t))));
}

// ---------- router ----------
async function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = hash.split("?");
  const params = new URLSearchParams(qs || "");
  const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
  try {
    if (!seg.length) await viewHome();
    else if (seg[0] === "set" && seg[1]) await viewSet(seg[1]);
    else if (seg[0] === "part" && seg[1]) await viewPart(seg[1], params);
    else if (seg[0] === "browse") await viewBrowse(params);
    else if (seg[0] === "colors") await viewColors(params);
    else if (seg[0] === "sources") viewSources();
    else await viewHome();
  } catch (e) {
    console.error(e);
    mount(h("h1", {}, "Something went wrong"), h("p", {}, "Data files couldn't be loaded. If you opened this page as a file, serve the folder over HTTP instead (see README)."));
  }
}
addEventListener("hashchange", route);
route();
