// Ufficio 3D: un piccolo mondo dove gli agenti sferici lavorano, camminano e collaborano.
//
// Ogni movimento è guidato dagli eventi REALI del motore multi-agente (piano, compiti,
// strumenti, consultazioni, revisioni, approvazioni). Quando non succede nulla gli agenti
// restano alle loro scrivanie con piccole animazioni di attesa: non fingono di lavorare.
//
// Tecnologia: three.js (MIT, incluso in /vendor), geometrie procedurali, materiali PBR,
// luce ambientale da RoomEnvironment, ombre morbide, testi sui monitor con CanvasTexture.

import * as THREE from "./vendor/three/three.module.js";
import { OrbitControls } from "./vendor/three/OrbitControls.js";
import { RoomEnvironment } from "./vendor/three/RoomEnvironment.js";
import { RoundedBoxGeometry } from "./vendor/three/RoundedBoxGeometry.js";
import { esc } from "./markdown.js";

export function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch { return false; }
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angleLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------------------------------------------------------------------------
// Pianta dell'ufficio (metri). rot = orientamento della scrivania: l'agente al lavoro
// guarda verso -Z locale (il monitor); la sedia è a +Z locale.
// ---------------------------------------------------------------------------
const DESKS = {
  ricercatore: { x: -6.0, z: -5.05, rot: 0 },
  analista: { x: -3.8, z: -5.05, rot: 0 },
  navigatore: { x: -1.6, z: -5.05, rot: 0 },
  visione: { x: 0.6, z: -5.05, rot: 0 },
  programmatore: { x: -7.05, z: -2.4, rot: Math.PI / 2 },
  operatore: { x: -7.05, z: 0.0, rot: Math.PI / 2 },
  scrittore: { x: -7.05, z: 2.4, rot: Math.PI / 2 },
  coordinatore: { x: 5.5, z: -4.75, rot: 0, big: true },
  critico: { x: 7.0, z: -0.8, rot: -Math.PI / 2 },
  montatore: { x: 7.0, z: 1.6, rot: -Math.PI / 2 },
};
const TABLE = { x: 1.0, z: 1.5, r: 1.05 };
const LOUNGE = { x: -4.0, z: 4.2 };
const BOARD = { x: 3.15, y: 1.55, z: -5.9, w: 2.3, h: 1.35 };
const ROLE_DESC_KEYS = {};

function localToWorld(desk, lx, lz) {
  const s = Math.sin(desk.rot), c = Math.cos(desk.rot);
  return new THREE.Vector3(desk.x + lx * c + lz * s, 0, desk.z - lx * s + lz * c);
}

// ---------------------------------------------------------------------------
// Navigazione: grafo di visibilità tra punti di passaggio, evitando gli ostacoli
// ---------------------------------------------------------------------------
class NavGraph {
  constructor() {
    this.obstacles = []; // {type:'rect', x0,z0,x1,z1} | {type:'circle', x,z,r}
    this.nodes = [];
    this.edges = [];
  }
  addRect(x0, z0, x1, z1, pad = 0.32) { this.obstacles.push({ type: "rect", x0: Math.min(x0, x1) - pad, z0: Math.min(z0, z1) - pad, x1: Math.max(x0, x1) + pad, z1: Math.max(z0, z1) + pad }); }
  addCircle(x, z, r, pad = 0.32) { this.obstacles.push({ type: "circle", x, z, r: r + pad }); }
  blocked(x, z) {
    if (x < -7.6 || x > 7.7 || z < -5.6 || z > 5.6) return true;
    return this.obstacles.some((o) => (o.type === "rect" ? x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 : (x - o.x) ** 2 + (z - o.z) ** 2 < o.r ** 2));
  }
  clear(a, b) {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(2, Math.ceil(d / 0.12));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.blocked(lerp(a.x, b.x, t), lerp(a.z, b.z, t))) return false;
    }
    return true;
  }
  add(x, z, tag = "") { this.nodes.push({ x, z, tag }); return this.nodes.length - 1; }
  build(forced = []) {
    const N = this.nodes.length;
    this.edges = Array.from({ length: N }, () => []);
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = this.nodes[i], b = this.nodes[j];
        if (a.tag === "seat" || b.tag === "seat") continue;
        if (this.clear(a, b)) { const w = Math.hypot(a.x - b.x, a.z - b.z); this.edges[i].push([j, w]); this.edges[j].push([i, w]); }
      }
    }
    for (const [i, j] of forced) { const a = this.nodes[i], b = this.nodes[j]; const w = Math.hypot(a.x - b.x, a.z - b.z); this.edges[i].push([j, w]); this.edges[j].push([i, w]); }
  }
  path(from, to) {
    const N = this.nodes.length;
    const dist = new Array(N).fill(Infinity);
    const prev = new Array(N).fill(-1);
    const done = new Array(N).fill(false);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      if (u === to) break;
      done[u] = true;
      for (const [v, w] of this.edges[u]) if (dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = u; }
    }
    if (dist[to] === Infinity) return null;
    const out = [];
    for (let v = to; v >= 0; v = prev[v]) out.unshift(this.nodes[v]);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Texture disegnate su canvas (monitor, lavagna, legno)
// ---------------------------------------------------------------------------
function woodTexture(dark) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d");
  const base = dark ? ["#5b4636", "#53402f", "#4d3b2c", "#584435"] : ["#d8b48c", "#cfa97f", "#d4ae86", "#c9a277"];
  const plank = 64;
  for (let y = 0; y < 512; y += plank) {
    let x = -((y / plank) % 2) * 128;
    while (x < 512) {
      const w = 256;
      g.fillStyle = base[(Math.abs(x + y) / 64) % base.length | 0];
      g.fillRect(x, y, w, plank);
      g.strokeStyle = dark ? "rgba(0,0,0,.25)" : "rgba(80,50,20,.18)";
      g.lineWidth = 2;
      g.strokeRect(x + 1, y + 1, w - 2, plank - 2);
      for (let k = 0; k < 5; k++) {
        g.strokeStyle = dark ? "rgba(255,255,255,.03)" : "rgba(90,60,30,.08)";
        g.beginPath();
        const yy = y + 8 + k * 11 + Math.sin(x) * 2;
        g.moveTo(x, yy); g.bezierCurveTo(x + 80, yy + 3, x + 160, yy - 3, x + w, yy);
        g.stroke();
      }
      x += w;
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 3);
  tex.anisotropy = 4;
  return tex;
}

class Screen {
  constructor(color) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 256; this.canvas.height = 160;
    this.g = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.color = color;
    this.mode = "idle"; this.tool = ""; this.label = "";
    this.last = 0;
    this.draw(0, true);
  }
  setMode(mode, tool = "", label = "") { this.mode = mode; this.tool = tool; this.label = label; this.draw(performance.now() / 1000, true); }
  animated() { return !["done", "error", "idle"].includes(this.mode); }
  draw(t, force = false) {
    if (!force && (t - this.last < 1 / 12 || !this.animated())) return;
    this.last = t;
    const g = this.g, W = 256, H = 160, col = this.color;
    g.fillStyle = "#0b0f17"; g.fillRect(0, 0, W, H);
    const tool = this.tool || "";
    const lines = (n, palette, speed, x0 = 14) => {
      const off = (t * speed * 16) % 16;
      for (let i = 0; i < n + 1; i++) {
        const y = 14 + i * 16 - off;
        const w = 40 + ((i * 37 + Math.floor(t * speed / 1)) % 150);
        g.fillStyle = palette[(i * 3) % palette.length];
        g.fillRect(x0 + ((i * 7) % 3) * 12, y, w, 6);
      }
    };
    switch (this.mode) {
      case "thinking": {
        for (let i = 0; i < 3; i++) {
          const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - i * 0.7));
          g.fillStyle = col; g.globalAlpha = a;
          g.beginPath(); g.arc(W / 2 - 30 + i * 30, H / 2, 9, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        break;
      }
      case "assigned": {
        g.fillStyle = "#f4f6fa"; g.fillRect(88, 26, 80, 104);
        g.fillStyle = col; g.fillRect(88, 26, 80, 10);
        g.fillStyle = "#b9bfca"; for (let i = 0; i < 5; i++) g.fillRect(98, 48 + i * 14, 60 - (i % 2) * 18, 5);
        g.fillStyle = "#cfd6e3"; g.font = "bold 16px system-ui"; g.textAlign = "center"; g.fillText(this.label || "", W / 2, 150);
        break;
      }
      case "waiting": {
        const on = Math.sin(t * 8) > 0;
        g.fillStyle = on ? "#3a2a05" : "#1d1608"; g.fillRect(0, 0, W, H);
        g.fillStyle = "#ffb020"; g.font = "bold 72px system-ui"; g.textAlign = "center"; g.fillText("!", W / 2, 95);
        g.font = "bold 18px system-ui"; g.fillText("APPROVAZIONE", W / 2, 135);
        break;
      }
      case "done": {
        g.strokeStyle = "#22c57f"; g.lineWidth = 14; g.lineCap = "round";
        g.beginPath(); g.moveTo(90, 82); g.lineTo(118, 108); g.lineTo(168, 54); g.stroke();
        break;
      }
      case "error": {
        g.strokeStyle = "#ff5a5f"; g.lineWidth = 14; g.lineCap = "round";
        g.beginPath(); g.moveTo(98, 48); g.lineTo(158, 108); g.moveTo(158, 48); g.lineTo(98, 108); g.stroke();
        break;
      }
      case "reviewing": {
        g.fillStyle = "#f4f6fa"; g.fillRect(70, 18, 116, 124);
        g.fillStyle = "#b9bfca"; for (let i = 0; i < 7; i++) g.fillRect(82, 32 + i * 15, 92 - (i % 3) * 14, 5);
        const lx = 128 + Math.sin(t * 1.6) * 34, ly = 80 + Math.cos(t * 1.2) * 34;
        g.strokeStyle = col; g.lineWidth = 5; g.beginPath(); g.arc(lx, ly, 20, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(lx + 14, ly + 14); g.lineTo(lx + 30, ly + 30); g.stroke();
        break;
      }
      case "helping": case "asking": {
        for (let i = 0; i < 3; i++) {
          const left = i % 2 === 0;
          const p = clamp((t * 1.2 - i * 0.5) % 3, 0, 1);
          g.globalAlpha = p;
          g.fillStyle = left ? col : "#8ea2c0";
          const w = 120, x = left ? 16 : W - 16 - w;
          g.beginPath(); g.roundRect(x, 18 + i * 44, w, 30, 10); g.fill();
        }
        g.globalAlpha = 1;
        break;
      }
      case "working": case "writing": {
        if (tool === "run_python" || tool === "run_command") {
          g.fillStyle = "#04140a"; g.fillRect(0, 0, W, H);
          lines(9, ["#2bd45a", "#1fa547", "#7cf29d"], 1.6);
          if (Math.sin(t * 6) > 0) { g.fillStyle = "#2bd45a"; g.fillRect(14, H - 18, 10, 12); }
        } else if (tool.startsWith("browser_") || tool === "fetch_url" || tool === "web_search") {
          g.fillStyle = "#eef1f6"; g.fillRect(0, 0, W, H);
          g.fillStyle = "#d5dae3"; g.fillRect(0, 0, W, 24);
          ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(14 + i * 14, 12, 4.5, 0, 7); g.fill(); });
          g.fillStyle = "#fff"; g.beginPath(); g.roundRect(60, 5, 180, 14, 7); g.fill();
          const sc = (t * 22) % 60;
          for (let i = 0; i < 6; i++) { g.fillStyle = i % 3 === 0 ? col : "#c3cad6"; g.globalAlpha = i % 3 === 0 ? 0.75 : 1; g.fillRect(14 + (i % 2) * 118, 36 + Math.floor(i / 2) * 44 - sc % 44, 108, 34); }
          g.globalAlpha = 1;
          if (tool === "web_search") { g.strokeStyle = col; g.lineWidth = 5; const lx = 200 + Math.sin(t * 2) * 20; g.beginPath(); g.arc(lx, 95, 18, 0, 7); g.stroke(); }
        } else if (tool === "search_documents" || tool === "read_document" || tool === "search_text") {
          g.fillStyle = "#f4f6fa"; g.fillRect(64, 16, 128, 128);
          for (let i = 0; i < 7; i++) { g.fillStyle = (i + Math.floor(t * 2)) % 4 === 0 ? "#ffd84d" : "#b9bfca"; g.fillRect(76, 30 + i * 15, 104 - (i % 3) * 16, 6); }
          const lx = 128 + Math.sin(t * 1.8) * 38, ly = 78 + Math.cos(t * 1.3) * 34;
          g.strokeStyle = "#5b8def"; g.lineWidth = 5; g.beginPath(); g.arc(lx, ly, 19, 0, 7); g.stroke();
        } else if (tool === "analyze_image") {
          const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#7cc3ff"); gr.addColorStop(0.55, "#bfe3ff"); gr.addColorStop(0.56, "#46a86e"); gr.addColorStop(1, "#2e7d4f");
          g.fillStyle = gr; g.fillRect(40, 20, 176, 120);
          g.fillStyle = "#ffd84d"; g.beginPath(); g.arc(180, 48, 14, 0, 7); g.fill();
          const sy = 20 + ((t * 60) % 120); g.fillStyle = "rgba(124,92,255,.55)"; g.fillRect(40, sy, 176, 4);
        } else if (tool === "list_files" || tool === "read_file" || tool === "make_dir" || tool === "move_file" || tool === "delete_file") {
          for (let i = 0; i < 8; i++) {
            const x = 30 + (i % 4) * 52, y = 24 + Math.floor(i / 4) * 64;
            const up = Math.max(0, Math.sin(t * 3 - i * 0.6)) * 6;
            g.fillStyle = i % 3 === 0 ? "#e0a100" : "#8ea2c0";
            g.beginPath(); g.roundRect(x, y - up, 36, 44, 4); g.fill();
          }
        } else if (tool === "ask_agent" || tool === "note" || tool === "recall_memory" || tool === "remember") {
          for (let i = 0; i < 3; i++) { g.fillStyle = i % 2 ? "#8ea2c0" : col; g.beginPath(); g.roundRect(i % 2 ? 110 : 16, 18 + i * 44, 130, 30, 10); g.fill(); }
        } else {
          lines(9, [col, "#22b573", "#e0a100", "#8ea2c0", "#5b6b7f"], this.mode === "writing" ? 0.9 : 1.4);
        }
        break;
      }
      default: {
        const gx = W / 2 + Math.sin(t * 0.4) * 70, gy = H / 2 + Math.cos(t * 0.31) * 35;
        const rg = g.createRadialGradient(gx, gy, 2, gx, gy, 60);
        rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
        g.globalAlpha = 0.35; g.fillStyle = rg; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
      }
    }
    this.tex.needsUpdate = true;
  }
}

class Whiteboard {
  constructor(title) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 768; this.canvas.height = 450;
    this.g = this.canvas.getContext("2d");
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.title = title;
    this.notes = [];
    this.draw();
  }
  add(color, who, text) { this.notes.unshift({ color, who, text }); this.notes = this.notes.slice(0, 6); this.draw(); }
  clear() { this.notes = []; this.draw(); }
  draw() {
    const g = this.g, W = 768, H = 450;
    g.fillStyle = "#f7f8fb"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#3a3f4b"; g.font = "600 34px 'Segoe Print','Comic Sans MS',system-ui"; g.textAlign = "left";
    g.fillText(this.title, 28, 52);
    g.strokeStyle = "#7c5cff"; g.lineWidth = 4; g.beginPath(); g.moveTo(28, 64); g.quadraticCurveTo(200, 72, 360, 62); g.stroke();
    this.notes.forEach((n, i) => {
      const x = 28 + (i % 3) * 246, y = 92 + Math.floor(i / 3) * 172;
      g.save(); g.translate(x + 110, y + 75); g.rotate(((i * 37) % 7 - 3) * 0.01); g.translate(-(x + 110), -(y + 75));
      g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(x + 4, y + 6, 220, 150);
      g.fillStyle = "#fff6c2"; g.fillRect(x, y, 220, 150);
      g.fillStyle = n.color; g.fillRect(x, y, 220, 12);
      g.fillStyle = "#111"; g.font = "bold 19px system-ui"; g.fillText(n.who, x + 12, y + 38);
      g.fillStyle = "#2a2a2a"; g.font = "17px system-ui";
      const words = n.text.split(/\s+/); let line = "", ly = y + 64;
      for (const w of words) {
        if (g.measureText(line + w).width > 196) { g.fillText(line, x + 12, ly); line = ""; ly += 22; if (ly > y + 140) break; }
        line += w + " ";
      }
      if (ly <= y + 140) g.fillText(line, x + 12, ly);
      g.restore();
    });
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Personaggio sferico
// ---------------------------------------------------------------------------
const STATE_STYLE = {
  idle: { glow: 0.25, ring: null },
  assigned: { glow: 0.9, ring: "agent" },
  thinking: { glow: 1.0, ring: "agent" },
  working: { glow: 1.3, ring: "agent" },
  writing: { glow: 1.2, ring: "agent" },
  reviewing: { glow: 1.2, ring: "agent" },
  helping: { glow: 1.1, ring: "agent" },
  asking: { glow: 1.0, ring: "agent" },
  waiting: { glow: 1.6, ring: "#ffb020" },
  done: { glow: 0.9, ring: "#22c57f" },
  error: { glow: 1.0, ring: "#ff5a5f" },
};

class Bot {
  constructor(spec, shared, home) {
    this.spec = spec;
    this.id = spec.id;
    this.color = new THREE.Color(spec.color);
    this.state = "idle";
    this.pos = home.seat.clone();
    this.home = home;
    this.yaw = home.workYaw + Math.PI;
    this.path = [];
    this.speed = 0;
    this.walkPhase = 0;
    this.stateTime = 0;
    this.blinkT = 2 + Math.random() * 3;
    this.lookT = 3 + Math.random() * 4;
    this.lookX = 0;
    this.hop = 0;
    this.celebrateT = 0;
    this.faceTarget = null;
    this.activity = [];
    this.task = "";
    this.build(shared);
  }

  build(shared) {
    const g = new THREE.Group();
    this.group = g;
    const pastel = this.color.clone().lerp(new THREE.Color("#ffffff"), 0.18);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: pastel, roughness: 0.28, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color("#ffffff") });
    this.bodyMat = bodyMat;
    const body = new THREE.Group();
    this.body = body;
    g.add(body);
    const sphere = new THREE.Mesh(shared.sphere, bodyMat);
    sphere.castShadow = true;
    sphere.userData.botId = this.id;
    body.add(sphere);
    this.pickMesh = sphere;
    // ventre più chiaro
    const belly = new THREE.Mesh(shared.belly, new THREE.MeshPhysicalMaterial({ color: pastel.clone().lerp(new THREE.Color("#ffffff"), 0.55), roughness: 0.35, clearcoat: 0.6 }));
    belly.position.set(0, -0.08, 0.12);
    belly.scale.set(0.82, 0.7, 0.6);
    body.add(belly);
    // visiera (schermo del volto)
    const visor = new THREE.Mesh(shared.visor, shared.visorMat);
    visor.rotation.x = 0;
    body.add(visor);
    // occhi
    this.eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#bff6ff") });
    this.eyes = [];
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.105, 0.075, 0.392);
      eye.rotation.y = side * 0.28;
      eye.rotation.x = -0.18;
      const open = new THREE.Mesh(shared.eye, this.eyeMat);
      const happy = new THREE.Mesh(shared.eyeHappy, this.eyeMat);
      happy.rotation.z = Math.PI;
      happy.visible = false;
      eye.add(open, happy);
      eye.userData = { open, happy, side };
      body.add(eye);
      this.eyes.push(eye);
    }
    // guance
    const cheekMat = new THREE.MeshBasicMaterial({ color: "#ff8fb1", transparent: true, opacity: 0.55 });
    for (const side of [-1, 1]) {
      const ch = new THREE.Mesh(shared.cheek, cheekMat);
      ch.position.set(side * 0.21, -0.03, 0.352);
      ch.lookAt(side * 0.6, -0.05, 1.2);
      body.add(ch);
    }
    // antenna con luce di stato
    const stalk = new THREE.Mesh(shared.stalk, shared.metal);
    stalk.position.set(0, 0.43, 0);
    body.add(stalk);
    this.bulbMat = new THREE.MeshStandardMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 0.4, roughness: 0.3 });
    const bulb = new THREE.Mesh(shared.bulb, this.bulbMat);
    bulb.position.set(0, 0.55, 0);
    body.add(bulb);
    this.bulb = bulb;
    // aureola che ruota quando pensa
    this.haloMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0, depthWrite: false });
    const halo = new THREE.Mesh(shared.halo, this.haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.6;
    g.add(halo);
    this.halo = halo;
    this.orbiters = [];
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Mesh(shared.orb, new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0 }));
      g.add(o);
      this.orbiters.push(o);
    }
    // piedini
    this.feet = [];
    for (const side of [-1, 1]) {
      const f = new THREE.Mesh(shared.foot, new THREE.MeshPhysicalMaterial({ color: pastel.clone().multiplyScalar(0.8), roughness: 0.4, clearcoat: 0.6 }));
      f.position.set(side * 0.16, 0.06, 0.04);
      f.castShadow = true;
      g.add(f);
      this.feet.push(f);
    }
    // accessorio di ruolo
    this.addAccessory(shared, body);
    // anello di stato a terra
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(shared.ring, this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    g.add(ring);
    this.ring = ring;
    g.position.copy(this.pos);
  }

  addAccessory(shared, body) {
    const dark = shared.dark;
    const acc = new THREE.Group();
    switch (this.id) {
      case "programmatore": { // cuffie
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.028, 10, 32, Math.PI), dark);
        band.position.y = 0.04; acc.add(band);
        for (const s of [-1, 1]) { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 20), dark); cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.39, 0.03, 0); acc.add(cup); }
        break;
      }
      case "analista": case "ricercatore": { // occhiali
        const frame = new THREE.MeshStandardMaterial({ color: this.id === "analista" ? "#2b2b2b" : "#8b5a2b", roughness: 0.4 });
        for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 24), frame); r.position.set(s * 0.105, 0.075, 0.428); r.rotation.y = s * 0.28; acc.add(r); }
        const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), frame); bridge.rotation.z = Math.PI / 2; bridge.position.set(0, 0.085, 0.435); acc.add(bridge);
        break;
      }
      case "critico": { // monocolo
        const gold = new THREE.MeshStandardMaterial({ color: "#d4af37", metalness: 0.9, roughness: 0.25 });
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 8, 24), gold); r.position.set(0.105, 0.075, 0.43); r.rotation.y = 0.28; acc.add(r);
        break;
      }
      case "coordinatore": { // auricolare con microfono
        const m = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.012, 8, 24, Math.PI / 2.2), dark); m.position.set(0.3, -0.05, 0.12); m.rotation.set(0, -0.6, -0.6); acc.add(m);
        const mic = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), dark); mic.position.set(0.17, -0.2, 0.32); acc.add(mic);
        break;
      }
      case "navigatore": { // bussola orbitante
        const r = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.01, 8, 48), new THREE.MeshStandardMaterial({ color: "#7fe0d8", emissive: "#0fa3a3", emissiveIntensity: 0.6 }));
        r.rotation.x = Math.PI / 2.3; acc.add(r); this.spinner = r;
        break;
      }
      case "visione": { // grande obiettivo
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 10, 32), new THREE.MeshStandardMaterial({ color: "#c9b6ff", metalness: 0.7, roughness: 0.2 }));
        lens.position.set(0, 0.075, 0.405); lens.scale.set(1, 0.8, 1); acc.add(lens);
        break;
      }
      case "scrittore": { // penna dietro l'"orecchio"
        const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8), new THREE.MeshStandardMaterial({ color: "#f6c343", roughness: 0.4 }));
        pen.position.set(0.33, 0.22, 0.02); pen.rotation.z = 0.9; acc.add(pen);
        break;
      }
      case "operatore": { // caschetto
        const hat = new THREE.Mesh(new THREE.SphereGeometry(0.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), new THREE.MeshStandardMaterial({ color: "#f5b301", roughness: 0.35 }));
        hat.position.y = 0.16; acc.add(hat);
        break;
      }
      default: break;
    }
    body.add(acc);
  }

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.stateTime = 0;
    if (state === "done") this.celebrateT = 1.2;
    if (state === "assigned" || state === "waiting") this.hop = 1;
  }

  walkTo(points) { this.path = points ? points.slice(1).map((p) => new THREE.Vector3(p.x, 0, p.z)) : []; }
  walking() { return this.path.length > 0; }

  update(dt, t, camPos) {
    this.stateTime += dt;
    const st = STATE_STYLE[this.state] || STATE_STYLE.idle;
    // --- movimento lungo il percorso con accelerazione e frenata
    let moving = false;
    if (this.path.length) {
      const target = this.path[0];
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const remaining = d + this.path.slice(1).reduce((acc, p, i, arr) => acc + (i === 0 ? p.distanceTo(target) : p.distanceTo(arr[i - 1])), 0);
      const maxV = 1.55;
      const want = Math.min(maxV, Math.max(0.35, remaining * 1.6));
      this.speed = lerp(this.speed, want, 1 - Math.exp(-dt * 4));
      const step = this.speed * dt;
      if (d <= step || d < 0.02) {
        this.pos.set(target.x, 0, target.z);
        this.path.shift();
      } else {
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-dt * 9));
      }
      moving = true;
    } else {
      this.speed = lerp(this.speed, 0, 1 - Math.exp(-dt * 6));
      // orientamento a riposo: verso il monitor quando lavora, verso la telecamera o il collega altrimenti
      let desired;
      const atDesk = this.pos.distanceTo(this.home.seat) < 0.05;
      if (this.faceTarget) desired = Math.atan2(this.faceTarget.x - this.pos.x, this.faceTarget.z - this.pos.z);
      else if (atDesk && ["working", "writing", "reviewing", "assigned"].includes(this.state)) desired = this.home.workYaw;
      else desired = Math.atan2(camPos.x - this.pos.x, camPos.z - this.pos.z);
      this.yaw = angleLerp(this.yaw, desired, 1 - Math.exp(-dt * 4));
    }
    // --- ciclo di camminata: piedini alternati, rimbalzo, schiacciamento
    const g = this.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    const walkAmt = clamp(this.speed / 1.2, 0, 1);
    this.walkPhase += dt * (6 + this.speed * 6) * (moving ? 1 : 0.0);
    const s = Math.sin(this.walkPhase);
    this.feet[0].position.z = 0.04 + s * 0.11 * walkAmt;
    this.feet[1].position.z = 0.04 - s * 0.11 * walkAmt;
    this.feet[0].position.y = 0.06 + Math.max(0, Math.cos(this.walkPhase)) * 0.06 * walkAmt;
    this.feet[1].position.y = 0.06 + Math.max(0, -Math.cos(this.walkPhase)) * 0.06 * walkAmt;
    // respiro / battitura / saltelli
    let bob = Math.sin(t * 2.1 + this.id.length) * 0.012;
    if (moving) bob += Math.abs(s) * 0.06 * walkAmt;
    if (this.state === "working" || this.state === "writing") bob += Math.abs(Math.sin(t * 14)) * 0.012;
    if (this.hop > 0) { this.hop = Math.max(0, this.hop - dt * 1.6); bob += Math.sin((1 - this.hop) * Math.PI * 2) * 0.12 * this.hop; }
    if (this.celebrateT > 0) { this.celebrateT = Math.max(0, this.celebrateT - dt); bob += Math.abs(Math.sin(this.celebrateT * 9)) * 0.22 * (this.celebrateT / 1.2); }
    if (this.state === "waiting") bob += Math.abs(Math.sin(t * 5)) * 0.05;
    const squash = 1 - Math.abs(s) * 0.05 * walkAmt;
    this.body.position.y = 0.47 + bob;
    this.body.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
    this.body.rotation.x = moving ? 0.12 * walkAmt : (this.state === "thinking" ? -0.08 : this.state === "error" ? 0.12 : 0);
    this.body.rotation.z = this.state === "thinking" ? Math.sin(t * 1.1) * 0.08 : moving ? s * 0.04 * walkAmt : 0;
    // --- occhi: battito, sguardo, espressioni
    this.blinkT -= dt;
    if (this.blinkT < 0) this.blinkT = 2.5 + Math.random() * 3.5;
    const blink = this.blinkT < 0.12 ? 0.1 : 1;
    this.lookT -= dt;
    if (this.lookT < 0) { this.lookT = 2 + Math.random() * 4; this.lookX = this.state === "idle" ? (Math.random() - 0.5) * 0.06 : 0; }
    const happy = this.state === "done" || this.celebrateT > 0;
    let sy = 1, ox = this.lookX, oy = 0;
    if (["working", "writing", "reviewing"].includes(this.state)) sy = 0.55;
    if (this.state === "thinking") { ox = 0.035; oy = 0.035; sy = 0.85; }
    if (this.state === "waiting") sy = 1.25;
    if (this.state === "error") { sy = 0.5; oy = -0.02; }
    for (const e of this.eyes) {
      e.userData.open.visible = !happy;
      e.userData.happy.visible = happy;
      e.userData.open.scale.y = lerp(e.userData.open.scale.y, sy * blink, 1 - Math.exp(-dt * 18));
      e.position.x = lerp(e.position.x, e.userData.side * 0.105 + ox, 1 - Math.exp(-dt * 6));
      e.position.y = lerp(e.position.y, 0.075 + oy, 1 - Math.exp(-dt * 6));
    }
    this.eyeMat.color.set(this.state === "error" ? "#ffb3b3" : this.state === "waiting" ? "#ffe2a8" : "#bff6ff");
    // --- luce dell'antenna e aloni
    let glow = st.glow;
    if (this.state === "thinking") glow = 0.8 + Math.sin(t * 5) * 0.6;
    if (this.state === "waiting") glow = 1.2 + Math.sin(t * 10) * 0.9;
    if (["working", "writing"].includes(this.state)) glow = 1.1 + Math.sin(t * 22) * 0.15;
    this.bulbMat.emissiveIntensity = lerp(this.bulbMat.emissiveIntensity, Math.max(0.1, glow), 1 - Math.exp(-dt * 8));
    const bulbCol = this.state === "waiting" ? "#ffb020" : this.state === "error" ? "#ff5a5f" : this.state === "done" ? "#22c57f" : null;
    this.bulbMat.emissive.set(bulbCol || this.color);
    const thinking = ["thinking", "reviewing"].includes(this.state);
    this.haloMat.opacity = lerp(this.haloMat.opacity, thinking ? 0.55 : 0, 1 - Math.exp(-dt * 5));
    this.halo.rotation.z += dt * 1.6;
    this.halo.position.y = 1.08 + Math.sin(t * 2) * 0.03 + this.body.position.y - 0.47;
    this.orbiters.forEach((o, i) => {
      const a = t * 2.2 + (i * Math.PI * 2) / 3;
      o.position.set(Math.cos(a) * 0.55, 0.7 + Math.sin(a * 2) * 0.12 + this.body.position.y - 0.47, Math.sin(a) * 0.55);
      o.material.opacity = lerp(o.material.opacity, thinking ? 0.9 : 0, 1 - Math.exp(-dt * 5));
    });
    if (this.spinner) this.spinner.rotation.z += dt * (moving || this.state === "working" ? 2.5 : 0.4);
    // anello di stato
    const ringCol = st.ring === "agent" ? this.color : st.ring ? new THREE.Color(st.ring) : null;
    if (ringCol) this.ringMat.color.copy(ringCol);
    const pulse = this.state === "waiting" ? 0.45 + Math.sin(t * 8) * 0.25 : 0.4;
    this.ringMat.opacity = lerp(this.ringMat.opacity, ringCol ? pulse : 0, 1 - Math.exp(-dt * 6));
    this.ring.scale.setScalar(1 + (this.state === "waiting" ? Math.sin(t * 8) * 0.08 : 0));
  }
}

// ---------------------------------------------------------------------------
// Pacchetti di dati in volo tra gli agenti
// ---------------------------------------------------------------------------
class Packet {
  constructor(scene, shared, kind, from, to, color, resolve) {
    this.scene = scene; this.resolve = resolve;
    this.from = from.clone(); this.to = to.clone();
    this.ctrl = from.clone().add(to).multiplyScalar(0.5); this.ctrl.y = Math.max(from.y, to.y) + 1.6 + from.distanceTo(to) * 0.12;
    this.t = 0; this.dur = 1.15 + from.distanceTo(to) * 0.03;
    const mats = { paper: shared.paperMat, note: shared.noteMat };
    let mesh;
    if (kind === "paper" || kind === "note") {
      mesh = new THREE.Group();
      const card = new THREE.Mesh(kind === "note" ? shared.note : shared.card, mats[kind]);
      card.castShadow = true;
      mesh.add(card);
      const stripe = new THREE.Mesh(shared.stripe, new THREE.MeshBasicMaterial({ color }));
      stripe.position.set(0, kind === "note" ? 0.085 : 0.12, 0.006);
      mesh.add(stripe);
    } else {
      const c = kind === "ok" ? new THREE.Color("#22c57f") : kind === "ko" ? new THREE.Color("#ff5a5f") : color;
      mesh = new THREE.Mesh(shared.packet, new THREE.MeshBasicMaterial({ color: c }));
      const glow = new THREE.Mesh(shared.packetGlow, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, depthWrite: false }));
      mesh.add(glow);
    }
    this.mesh = mesh;
    scene.add(mesh);
    this.trail = [];
    const trailColor = kind === "ok" ? "#22c57f" : kind === "ko" ? "#ff5a5f" : color;
    for (let i = 0; i < 8; i++) {
      const tm = new THREE.Mesh(shared.trail, new THREE.MeshBasicMaterial({ color: trailColor, transparent: true, opacity: 0.0, depthWrite: false }));
      scene.add(tm);
      this.trail.push(tm);
    }
    this.hist = [];
  }
  point(t) {
    const a = this.from, b = this.to, c = this.ctrl, u = 1 - t;
    return new THREE.Vector3(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z);
  }
  update(dt, cam) {
    this.t = Math.min(1, this.t + dt / this.dur);
    const p = this.point(ease(this.t));
    this.mesh.position.copy(p);
    this.mesh.quaternion.copy(cam.quaternion);
    this.mesh.rotateZ(Math.sin(this.t * Math.PI * 2) * 0.25);
    const sc = Math.sin(Math.min(1, this.t * 1.2) * Math.PI) * 0.45 + 0.65;
    this.mesh.scale.setScalar(sc);
    this.hist.unshift(p.clone());
    this.hist = this.hist.slice(0, 16);
    this.trail.forEach((m, i) => {
      const h = this.hist[Math.min(this.hist.length - 1, (i + 1) * 2)];
      if (h) m.position.copy(h);
      m.material.opacity = (1 - i / this.trail.length) * 0.55 * (1 - this.t * 0.4);
      m.scale.setScalar(1 - i / this.trail.length * 0.7);
    });
    if (this.t >= 1) { this.dispose(); this.resolve(); return false; }
    return true;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.trail.forEach((m) => { this.scene.remove(m); m.material.dispose(); });
    this.mesh.traverse((o) => { if (o.material && !o.material.userData?.shared) o.material.dispose?.(); });
  }
}

// ---------------------------------------------------------------------------
// Ufficio 3D
// ---------------------------------------------------------------------------
export class Office3D {
  constructor(root, agents, t, opts = {}) {
    this.root = root;
    this.agents = agents;
    this.t = t;
    this.instant = false;
    this.paused = false;
    this.opts = opts;
    window.__office3d = this; // utile per il debug dalla console del browser
    this.ver = {}; this.cur = {}; this.saved = {};
    this.tasks = {};
    this.timer = null;
    this.packets = [];
    this.bots = {};
    this.selected = null;
    this.quality = opts.quality || (navigator.hardwareConcurrency >= 8 ? "high" : "low");
    this.dark = document.documentElement.dataset.theme !== "light";
    this.visible = true;
    this.renderHud();
    this.initScene();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; });
    this.io.observe(this.root);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.root);
  }

  // -- HUD in sovrimpressione ------------------------------------------------
  renderHud() {
    const t = this.t;
    this.root.innerHTML = `
      <div class="o3-stage"></div>
      <div class="o3-labels"></div>
      <div class="o3-hud">
        <div class="office-top o3-top">
          <div class="job"><span class="job-lbl">${t("currentJob")}</span><span class="job-txt" data-job>${t("noJob")}</span></div>
          <div class="job-meta"><span class="clock" data-clock>00:00</span><div class="progress"><i data-progress></i></div><span data-progress-txt></span></div>
        </div>
        <div class="office-alerts o3-alerts" data-alerts></div>
      </div>
      <div class="o3-tools">
        <button data-act="reset" title="${t("viewReset")}"><svg class="ic s"><use href="#i-home3d"/></svg></button>
        <button data-act="rotate" title="${t("viewRotate")}"><svg class="ic s"><use href="#i-rotate"/></svg></button>
        <button data-act="pause" title="${t("viewPause")}"><svg class="ic s"><use href="#i-pause"/></svg></button>
        <button data-act="quality" title="${t("viewQuality")}">HD</button>
        <button data-act="full" title="${t("viewFull")}"><svg class="ic s"><use href="#i-expand"/></svg></button>
      </div>
      <aside class="o3-inspector hidden" data-inspector></aside>`;
    this.labelsEl = this.root.querySelector(".o3-labels");
    this.root.querySelectorAll(".o3-tools button").forEach((b) => b.addEventListener("click", () => this.toolbar(b.dataset.act, b)));
    if (this.bots && Object.keys(this.bots).length) this.buildLabels();
  }

  render() { // cambio lingua: ricrea solo l'HUD mantenendo la scena
    const stage = this.root.querySelector(".o3-stage");
    const canvas = this.renderer?.domElement;
    this.renderHud();
    if (canvas) this.root.querySelector(".o3-stage").appendChild(canvas);
    if (stage && this.whiteboard) { this.whiteboard.title = this.t("blackboard"); this.whiteboard.draw(); }
    this.updateProgress();
  }

  toolbar(act, btn) {
    if (act === "reset") { this.selected = null; this.root.querySelector("[data-inspector]").classList.add("hidden"); this.focus = { target: new THREE.Vector3(-0.2, 0.2, -0.4), pos: this.defaultCam.clone() }; }
    if (act === "rotate") { this.controls.autoRotate = !this.controls.autoRotate; btn.classList.toggle("on", this.controls.autoRotate); }
    if (act === "pause") { this.paused = !this.paused; btn.classList.toggle("on", this.paused); btn.innerHTML = `<svg class="ic s"><use href="#${this.paused ? "i-play" : "i-pause"}"/></svg>`; }
    if (act === "full") { this.opts.onFull?.(); btn.classList.toggle("on"); setTimeout(() => this.resize(), 50); }
    if (act === "quality") { this.quality = this.quality === "high" ? "low" : "high"; btn.classList.toggle("on", this.quality === "high"); this.applyQuality(); }
  }

  // -- scena ------------------------------------------------------------------
  initScene() {
    const stage = this.root.querySelector(".o3-stage");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.dark ? 1.05 : 0.88;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    stage.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = this.dark ? 0.5 : 0.6;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.defaultCam = new THREE.Vector3(8.6, 9.4, 11.2);
    camera.position.copy(this.defaultCam);
    this.camera = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-0.2, 0.2, -0.4);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 5;
    controls.maxDistance = 38;
    controls.maxPolarAngle = 1.28;
    controls.autoRotateSpeed = 0.5;
    controls.addEventListener("start", () => { this.focus = null; });
    this.controls = controls;

    // luci
    const hemi = new THREE.HemisphereLight(this.dark ? "#b8c4ff" : "#ffffff", this.dark ? "#3a3048" : "#d9c9b0", this.dark ? 1.1 : 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(this.dark ? "#d7deff" : "#fff1dc", this.dark ? 1.6 : 1.9);
    sun.position.set(8, 14, 9);
    sun.castShadow = true;
    sun.shadow.camera.left = -11; sun.shadow.camera.right = 11; sun.shadow.camera.top = 11; sun.shadow.camera.bottom = -11;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 4;
    scene.add(sun);
    this.sun = sun;

    this.buildShared();
    this.buildRoom();
    this.buildFurniture();
    this.buildNav();
    this.buildBots();
    this.buildLabels();
    this.applyQuality();

    // selezione col click
    this.raycaster = new THREE.Raycaster();
    renderer.domElement.addEventListener("pointerdown", (e) => { this.downAt = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!this.downAt || Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, camera);
      const hit = this.raycaster.intersectObjects(Object.values(this.bots).map((b) => b.pickMesh), false)[0];
      if (hit) this.inspect(hit.object.userData.botId);
    });
    this.lastT = performance.now() / 1000;
    this.resize();
  }

  applyQuality() {
    const high = this.quality === "high";
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1));
    this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.resize();
  }

  buildShared() {
    const S = {};
    S.sphere = new THREE.SphereGeometry(0.4, 48, 32);
    S.belly = new THREE.SphereGeometry(0.4, 32, 24);
    // visiera centrata sul davanti (+Z): phi = π/2 punta verso +Z nelle SphereGeometry
    S.visor = new THREE.SphereGeometry(0.405, 48, 32, Math.PI / 2 - Math.PI * 0.3, Math.PI * 0.6, Math.PI * 0.3, Math.PI * 0.27);
    S.visorMat = new THREE.MeshPhysicalMaterial({ color: "#0d1220", roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 });
    S.eye = new THREE.CapsuleGeometry(0.03, 0.05, 6, 12);
    S.eyeHappy = new THREE.TorusGeometry(0.045, 0.016, 8, 20, Math.PI);
    S.cheek = new THREE.CircleGeometry(0.045, 20);
    S.stalk = new THREE.CylinderGeometry(0.012, 0.016, 0.14, 10);
    S.bulb = new THREE.SphereGeometry(0.05, 20, 16);
    S.halo = new THREE.TorusGeometry(0.28, 0.012, 10, 64);
    S.orb = new THREE.SphereGeometry(0.035, 12, 12);
    S.foot = new THREE.SphereGeometry(0.1, 20, 14);
    S.foot.scale(1, 0.55, 1.3);
    S.ring = new THREE.RingGeometry(0.46, 0.53, 48);
    S.metal = new THREE.MeshStandardMaterial({ color: "#c7ccd6", metalness: 0.8, roughness: 0.3 });
    S.dark = new THREE.MeshStandardMaterial({ color: "#22262f", roughness: 0.45, metalness: 0.2 });
    S.card = new THREE.PlaneGeometry(0.26, 0.34);
    S.note = new THREE.PlaneGeometry(0.24, 0.24);
    S.stripe = new THREE.PlaneGeometry(0.26, 0.05);
    S.paperMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.6, side: THREE.DoubleSide });
    S.paperMat.userData.shared = true;
    S.noteMat = new THREE.MeshStandardMaterial({ color: "#ffe066", roughness: 0.6, side: THREE.DoubleSide });
    S.noteMat.userData.shared = true;
    S.packet = new THREE.SphereGeometry(0.09, 20, 16);
    S.packetGlow = new THREE.SphereGeometry(0.18, 20, 16);
    S.trail = new THREE.SphereGeometry(0.05, 10, 8);
    // materiali d'arredo
    S.deskTop = new THREE.MeshStandardMaterial({ color: this.dark ? "#8a6a52" : "#e6d2b8", roughness: 0.55 });
    S.deskLeg = new THREE.MeshStandardMaterial({ color: this.dark ? "#3a3f4b" : "#f2f2f2", roughness: 0.35, metalness: 0.5 });
    S.monitor = new THREE.MeshStandardMaterial({ color: "#1b1f27", roughness: 0.35, metalness: 0.4 });
    S.chair = new THREE.MeshStandardMaterial({ color: this.dark ? "#4b5568" : "#5d6b85", roughness: 0.6 });
    S.plantPot = new THREE.MeshStandardMaterial({ color: this.dark ? "#d8d2c8" : "#f3efe7", roughness: 0.5 });
    S.leaf = new THREE.MeshStandardMaterial({ color: "#3f9a5a", roughness: 0.6, flatShading: true });
    S.leaf2 = new THREE.MeshStandardMaterial({ color: "#62b26f", roughness: 0.6, flatShading: true });
    S.fabric = new THREE.MeshStandardMaterial({ color: this.dark ? "#4a5d8a" : "#8fa7d6", roughness: 0.9 });
    S.rug = new THREE.MeshStandardMaterial({ color: this.dark ? "#3a3550" : "#efe3d3", roughness: 1 });
    this.shared = S;
  }

  buildRoom() {
    const S = this.shared;
    const scene = this.scene;
    // base del diorama
    const slab = new THREE.Mesh(new RoundedBoxGeometry(16.6, 0.5, 12.6, 4, 0.22), new THREE.MeshStandardMaterial({ color: this.dark ? "#2a2f3c" : "#e9ecf2", roughness: 0.7 }));
    slab.position.set(0, -0.27, 0);
    slab.receiveShadow = true;
    scene.add(slab);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), new THREE.MeshStandardMaterial({ map: woodTexture(this.dark), roughness: 0.62, metalness: 0.0 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    // percorsi pedonali
    const pathMat = new THREE.MeshStandardMaterial({ color: this.dark ? "#3b3550" : "#efe6da", roughness: 0.95, transparent: true, opacity: 0.55 });
    for (const [x, z, w, d] of [[0.3, -3.3, 13.5, 0.9], [-5.2, 0.6, 0.9, 7.2], [4.3, 0.6, 0.9, 7.2]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), pathMat);
      p.rotation.x = -Math.PI / 2; p.position.set(x, 0.004, z); p.receiveShadow = true;
      scene.add(p);
    }
    // pareti
    const wallMat = new THREE.MeshStandardMaterial({ color: this.dark ? "#323a4f" : "#f6f3ee", roughness: 0.85 });
    const back = new THREE.Mesh(new RoundedBoxGeometry(16.6, 2.9, 0.3, 2, 0.08), wallMat);
    back.position.set(0, 1.45, -6.15); back.receiveShadow = true; back.castShadow = true;
    scene.add(back);
    const left = new THREE.Mesh(new RoundedBoxGeometry(0.3, 2.9, 12.6, 2, 0.08), wallMat);
    left.position.set(-8.15, 1.45, 0); left.receiveShadow = true; left.castShadow = true;
    scene.add(left);
    // battiscopa
    const trimMat = new THREE.MeshStandardMaterial({ color: this.dark ? "#262c3b" : "#d9d3c9", roughness: 0.6 });
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(16, 0.12, 0.05), trimMat); t1.position.set(0, 0.06, -5.98); scene.add(t1);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 12), trimMat); t2.position.set(-7.98, 0.06, 0); scene.add(t2);
    // finestre luminose
    const glassMat = new THREE.MeshStandardMaterial({ color: this.dark ? "#18244a" : "#bfe3ff", emissive: this.dark ? "#2b3f80" : "#d8f0ff", emissiveIntensity: this.dark ? 0.6 : 0.5, roughness: 0.1 });
    const frameMat = new THREE.MeshStandardMaterial({ color: this.dark ? "#1d2230" : "#ffffff", roughness: 0.4 });
    const windows = [[-6.0, -5.99, 0], [-1.6, -5.99, 0], [-7.99, -1.2, Math.PI / 2], [-7.99, 1.2, Math.PI / 2]];
    for (const [x, z, r] of windows) {
      const w = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), glassMat);
      w.add(glass);
      for (const [fx, fy, fw, fh] of [[0, 0.52, 1.6, 0.06], [0, -0.52, 1.6, 0.06], [-0.78, 0, 0.06, 1.1], [0.78, 0, 0.06, 1.1], [0, 0, 0.04, 1.0]]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.05), frameMat); f.position.set(fx, fy, 0.02); w.add(f);
      }
      w.position.set(x, 1.85, z); w.rotation.y = r;
      scene.add(w);
    }
    if (this.dark) { // stelle fuori dalle finestre
      for (const [x, z, r] of windows) {
        const l = new THREE.PointLight("#6f8cff", 0.6, 3.5); l.position.set(x + (r ? 0.6 : 0), 1.8, z + (r ? 0 : 0.6)); scene.add(l);
      }
    }
    // lavagna condivisa
    this.whiteboard = new Whiteboard(this.t("blackboard"));
    const boardGroup = new THREE.Group();
    const boardFrame = new THREE.Mesh(new RoundedBoxGeometry(BOARD.w + 0.12, BOARD.h + 0.12, 0.06, 2, 0.03), new THREE.MeshStandardMaterial({ color: "#9aa2b0", metalness: 0.6, roughness: 0.3 }));
    boardGroup.add(boardFrame);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), new THREE.MeshStandardMaterial({ map: this.whiteboard.tex, roughness: 0.4 }));
    boardFace.position.z = 0.035;
    boardGroup.add(boardFace);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w * 0.8, 0.04, 0.1), new THREE.MeshStandardMaterial({ color: "#9aa2b0", metalness: 0.6, roughness: 0.3 }));
    tray.position.set(0, -BOARD.h / 2 - 0.06, 0.06);
    boardGroup.add(tray);
    ["#e5484d", "#2f7de1", "#22b573"].forEach((c, i) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.12, 4, 8), new THREE.MeshStandardMaterial({ color: c })); m.rotation.z = Math.PI / 2; m.position.set(-0.4 + i * 0.2, -BOARD.h / 2 - 0.02, 0.07); boardGroup.add(m); });
    boardGroup.position.set(BOARD.x, BOARD.y, BOARD.z);
    scene.add(boardGroup);
    this.boardAnchor = new THREE.Vector3(BOARD.x, BOARD.y, BOARD.z + 0.2);
  }

  addPlant(x, z, s = 1) {
    const S = this.shared;
    const g = new THREE.Group();
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.17 * s, 0.4 * s, 24), S.plantPot);
    pot.position.y = 0.2 * s; pot.castShadow = true; pot.receiveShadow = true; g.add(pot);
    const leaves = [[0, 0.62, 0, 0.3], [0.14, 0.78, 0.05, 0.22], [-0.12, 0.8, -0.04, 0.24], [0.02, 0.98, 0.02, 0.18], [-0.05, 0.7, 0.14, 0.2]];
    leaves.forEach(([lx, ly, lz, r], i) => { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), i % 2 ? S.leaf2 : S.leaf); l.position.set(lx * s, ly * s, lz * s); l.castShadow = true; g.add(l); });
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.plants = this.plants || [];
    this.plants.push(g);
  }

  buildFurniture() {
    const S = this.shared;
    const scene = this.scene;
    this.desks = {};
    for (const [id, d] of Object.entries(DESKS)) {
      if (!this.agents[id]) continue;
      const w = d.big ? 2.3 : 1.7, dep = d.big ? 1.0 : 0.85;
      const g = new THREE.Group();
      const top = new THREE.Mesh(new RoundedBoxGeometry(w, 0.07, dep, 3, 0.03), S.deskTop);
      top.position.y = 0.74; top.castShadow = true; top.receiveShadow = true; g.add(top);
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.72, dep - 0.1, 2, 0.02), S.deskLeg);
        leg.position.set(sx * (w / 2 - 0.08), 0.36, 0); leg.castShadow = true; g.add(leg);
      }
      // monitor con schermo vivo
      const screen = new Screen(this.agents[id].color);
      const mon = new THREE.Group();
      const sw = d.big ? 0.95 : 0.78, sh = sw * 0.62;
      const frame = new THREE.Mesh(new RoundedBoxGeometry(sw + 0.06, sh + 0.06, 0.04, 2, 0.015), S.monitor);
      frame.castShadow = true; mon.add(frame);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
      face.position.z = 0.022; mon.add(face);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 10), S.monitor); stand.position.set(0, -sh / 2 - 0.08, -0.03); mon.add(stand);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.02, 20), S.monitor); foot.position.set(0, -sh / 2 - 0.19, -0.03); mon.add(foot);
      mon.position.set(0, 0.78 + sh / 2 + 0.2, -dep / 2 + 0.2);
      mon.rotation.y = 0;
      // il monitor guarda verso la sedia (+Z locale)
      g.add(mon);
      // tastiera, tazza, lampada
      const kb = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.02, 0.15, 2, 0.008), S.monitor); kb.position.set(0, 0.79, 0.12); g.add(kb);
      const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), new THREE.MeshStandardMaterial({ color: this.agents[id].color, roughness: 0.4 })); mug.position.set(w / 2 - 0.22, 0.83, 0.15); mug.castShadow = true; g.add(mug);
      // sedia
      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.08, 0.5, 2, 0.04), S.chair); seat.position.y = 0.42; seat.castShadow = true; chair.add(seat);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.36, 10), S.deskLeg); pole.position.y = 0.2; chair.add(pole);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 20), S.deskLeg); base.position.y = 0.03; chair.add(base);
      chair.position.set(0, 0, dep / 2 + 0.55);
      g.add(chair);
      // targhetta col nome
      g.position.set(d.x, 0, d.z);
      g.rotation.y = d.rot;
      scene.add(g);
      const seatPos = localToWorld(d, 0, dep / 2 + 0.55);
      const aisle = localToWorld(d, 0, dep / 2 + 1.45);
      const screenWorld = localToWorld(d, 0, -dep / 2 + 0.2); screenWorld.y = 0.78 + sh / 2 + 0.2;
      this.desks[id] = { screen, seat: seatPos, aisle, workYaw: d.rot + Math.PI, screenAnchor: screenWorld, def: d, w, dep, chair };
    }
    // tavolo riunioni
    const tbl = new THREE.Group();
    const ttop = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.r, TABLE.r, 0.08, 64), S.deskTop); ttop.position.y = 0.72; ttop.castShadow = true; ttop.receiveShadow = true; tbl.add(ttop);
    const tleg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.7, 20), S.deskLeg); tleg.position.y = 0.36; tbl.add(tleg);
    const tbase = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.04, 32), S.deskLeg); tbase.position.y = 0.02; tbl.add(tbase);
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.05, 0.2, 16), S.plantPot); vase.position.y = 0.86; tbl.add(vase);
    for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: ["#ff8fb1", "#ffd84d", "#a594ff", "#ff9f43", "#ffffff"][i] })); f.position.set(Math.cos(i * 1.3) * 0.07, 1.0 + (i % 2) * 0.05, Math.sin(i * 1.3) * 0.07); tbl.add(f); }
    tbl.position.set(TABLE.x, 0, TABLE.z);
    scene.add(tbl);
    this.meetingSeats = Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2 + 0.3; return new THREE.Vector3(TABLE.x + Math.cos(a) * 1.65, 0, TABLE.z + Math.sin(a) * 1.65); });
    // area relax
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.7, 64), S.rug); rug.rotation.x = -Math.PI / 2; rug.position.set(LOUNGE.x, 0.006, LOUNGE.z); rug.receiveShadow = true; scene.add(rug);
    const sofa = new THREE.Group();
    const sb = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.42, 0.85, 3, 0.15), S.fabric); sb.position.y = 0.25; sb.castShadow = true; sofa.add(sb);
    const sback = new THREE.Mesh(new RoundedBoxGeometry(2.4, 0.6, 0.25, 3, 0.12), S.fabric); sback.position.set(0, 0.6, -0.32); sback.castShadow = true; sofa.add(sback);
    for (const s of [-1, 1]) { const arm = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.55, 0.85, 3, 0.1), S.fabric); arm.position.set(s * 1.12, 0.38, 0); arm.castShadow = true; sofa.add(arm); }
    for (const [cx, col] of [[-0.55, "#ffd84d"], [0.55, "#ff8fb1"]]) { const c = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.4, 0.14, 3, 0.07), new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 })); c.position.set(cx, 0.62, -0.13); c.rotation.x = -0.25; sofa.add(c); }
    sofa.position.set(LOUNGE.x, 0, LOUNGE.z + 1.15);
    sofa.rotation.y = Math.PI;
    sofa.rotation.y = 0;
    scene.add(sofa);
    const ct = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 40), S.deskTop); ct.position.set(LOUNGE.x, 0.38, LOUNGE.z - 0.2); ct.castShadow = true; scene.add(ct);
    const ctl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.36, 12), S.deskLeg); ctl.position.set(LOUNGE.x, 0.18, LOUNGE.z - 0.2); scene.add(ctl);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 0.2), new THREE.MeshStandardMaterial({ color: "#7c5cff" })); book.position.set(LOUNGE.x - 0.1, 0.43, LOUNGE.z - 0.25); book.rotation.y = 0.4; scene.add(book);
    // lampada da terra
    const lamp = new THREE.Group();
    const lp = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.6, 8), S.deskLeg); lp.position.y = 0.8; lamp.add(lp);
    const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.03, 20), S.deskLeg); lb.position.y = 0.015; lamp.add(lb);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.32, 32, 1, true), new THREE.MeshStandardMaterial({ color: "#fff4dc", emissive: "#ffcf7a", emissiveIntensity: this.dark ? 0.9 : 0.25, side: THREE.DoubleSide })); shade.position.y = 1.62; lamp.add(shade);
    lamp.position.set(LOUNGE.x + 1.8, 0, LOUNGE.z + 1.2);
    scene.add(lamp);
    const warm = new THREE.PointLight("#ffcf7a", this.dark ? 3.5 : 1.2, 5, 1.6); warm.position.set(LOUNGE.x + 1.8, 1.5, LOUNGE.z + 1.2); scene.add(warm);
    // libreria
    const shelf = new THREE.Group();
    const shelfMat = new THREE.MeshStandardMaterial({ color: this.dark ? "#6b5242" : "#d8c3a5", roughness: 0.6 });
    const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.35), shelfMat); sideL.position.set(-0.6, 0.9, 0); shelf.add(sideL);
    const sideR = sideL.clone(); sideR.position.x = 0.6; shelf.add(sideR);
    const bookColors = ["#7c5cff", "#1e9bd7", "#16a36a", "#e08a00", "#d6457a", "#5b6b7f", "#c0392b", "#0fa3a3"];
    for (let r = 0; r < 4; r++) {
      const pl = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.04, 0.35), shelfMat); pl.position.set(0, 0.05 + r * 0.45, 0); pl.receiveShadow = true; shelf.add(pl);
      let x = -0.54;
      for (let b = 0; b < 9 && x < 0.5; b++) {
        const bw = 0.06 + ((b * 7 + r * 3) % 4) * 0.02, bh = 0.25 + ((b * 5 + r) % 3) * 0.05;
        const bk = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.24), new THREE.MeshStandardMaterial({ color: bookColors[(b + r * 3) % bookColors.length], roughness: 0.7 }));
        bk.position.set(x + bw / 2, 0.07 + r * 0.45 + bh / 2, 0); bk.rotation.z = b % 5 === 4 ? 0.2 : 0; bk.castShadow = true; shelf.add(bk);
        x += bw + 0.012;
      }
    }
    shelf.position.set(-7.75, 0, 4.4); shelf.rotation.y = Math.PI / 2;
    scene.add(shelf);
    // angolo caffè
    const counter = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.9, 0.6, 3, 0.05), new THREE.MeshStandardMaterial({ color: this.dark ? "#3d4558" : "#ffffff", roughness: 0.45 }));
    counter.position.set(6.6, 0.45, 4.8); counter.castShadow = true; counter.receiveShadow = true; scene.add(counter);
    const machine = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.42, 0.3, 3, 0.05), new THREE.MeshStandardMaterial({ color: "#c0392b", roughness: 0.35, metalness: 0.3 }));
    machine.position.set(6.3, 1.11, 4.8); machine.castShadow = true; scene.add(machine);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 14), new THREE.MeshStandardMaterial({ color: ["#ffffff", "#ffd84d", "#a594ff"][i] })); c.position.set(6.75 + i * 0.13, 0.94, 4.85); scene.add(c); }
    // piante
    this.addPlant(-7.4, -5.5, 1.3);
    this.addPlant(7.4, -5.5, 1.2);
    this.addPlant(7.4, 2.6, 1.1);
    this.addPlant(-2.3, 5.4, 0.9);
    this.addPlant(2.3, -5.5, 0.8);
    // orologio a muro
    const clock = new THREE.Group();
    const cf = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 40), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.4 })); cf.rotation.x = Math.PI / 2; clock.add(cf);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 10, 40), S.monitor); clock.add(rim);
    this.clockHands = [0.2, 0.14].map((len, i) => { const h = new THREE.Mesh(new THREE.BoxGeometry(0.018, len, 0.01), S.monitor); h.geometry.translate(0, len / 2, 0); h.position.z = 0.035 + i * 0.005; clock.add(h); return h; });
    clock.position.set(5.5, 2.25, -5.97);
    scene.add(clock);
  }

  buildNav() {
    const nav = new NavGraph();
    for (const d of Object.values(this.desks)) {
      const { x, z } = d.def;
      const hw = (d.def.rot === 0 ? d.w : d.dep) / 2, hd = (d.def.rot === 0 ? d.dep : d.w) / 2;
      nav.addRect(x - hw, z - hd, x + hw, z + hd, 0.3);
    }
    nav.addCircle(TABLE.x, TABLE.z, TABLE.r, 0.35);
    nav.addRect(LOUNGE.x - 1.35, LOUNGE.z + 0.65, LOUNGE.x + 1.35, LOUNGE.z + 1.7, 0.25); // divano
    nav.addCircle(LOUNGE.x, LOUNGE.z - 0.2, 0.45, 0.3);
    nav.addRect(5.8, 4.5, 7.4, 5.1, 0.25);
    for (const p of this.plants) nav.addCircle(p.position.x, p.position.z, 0.3, 0.25);
    const forced = [];
    for (const [id, d] of Object.entries(this.desks)) {
      d.seatNode = nav.add(d.seat.x, d.seat.z, "seat");
      d.aisleNode = nav.add(d.aisle.x, d.aisle.z, "aisle");
      forced.push([d.seatNode, d.aisleNode]);
    }
    this.meetingNodes = this.meetingSeats.map((p) => nav.add(p.x, p.z, "meet"));
    for (const x of [-5.2, -2.8, -0.4, 2.2, 4.4, 6.2]) for (const z of [-3.2, -1.0, 1.4, 3.4]) if (!nav.blocked(x, z)) nav.add(x, z, "hub");
    nav.build(forced);
    this.nav = nav;
  }

  nearestNode(p) {
    let best = 0, bd = Infinity;
    this.nav.nodes.forEach((n, i) => { if (n.tag === "seat") return; const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2; if (d < bd && this.nav.clear(n, p)) { bd = d; best = i; } });
    return best;
  }

  route(bot, node) {
    const startNode = this.nav.add(bot.pos.x, bot.pos.z, "tmp");
    // collega temporaneamente la posizione attuale
    const atSeat = Object.values(this.desks).find((d) => d.seat.distanceTo(bot.pos) < 0.05);
    this.nav.edges.push([]);
    const link = (j) => { const w = Math.hypot(this.nav.nodes[j].x - bot.pos.x, this.nav.nodes[j].z - bot.pos.z); this.nav.edges[startNode].push([j, w]); this.nav.edges[j].push([startNode, w]); };
    if (atSeat) link(atSeat.aisleNode);
    else this.nav.nodes.forEach((n, j) => { if (j !== startNode && n.tag !== "seat" && this.nav.clear(n, bot.pos)) link(j); });
    const p = this.nav.path(startNode, node);
    // rimuove il nodo temporaneo
    for (const [j] of this.nav.edges[startNode]) this.nav.edges[j] = this.nav.edges[j].filter(([k]) => k !== startNode);
    this.nav.nodes.pop(); this.nav.edges.pop();
    return p;
  }

  goTo(id, node) {
    const bot = this.bots[id];
    if (!bot) return;
    if (this.instant || reducedMotion()) { const n = this.nav.nodes[node]; bot.pos.set(n.x, 0, n.z); bot.path = []; return; }
    bot.walkTo(this.route(bot, node));
  }

  goHome(id) {
    const d = this.desks[id];
    if (!d || !this.bots[id]) return;
    // dopo una riunione di avvio, gli agenti restano al tavolo qualche secondo prima di tornare
    const wait = (this.meetingUntil || 0) - performance.now();
    if (wait > 0 && !this.instant) { clearTimeout(this.bots[id].homeTimer); this.bots[id].homeTimer = setTimeout(() => this.goHome(id), wait); return; }
    this.bots[id].faceTarget = null;
    if (this.bots[id].pos.distanceTo(d.seat) > 0.05) this.goTo(id, d.seatNode);
  }

  visit(id, targetId) {
    const d = this.desks[targetId];
    const bot = this.bots[id];
    if (!d || !bot || id === targetId) return;
    // va nel corridoio davanti alla scrivania del collega e lo guarda
    bot.faceTarget = d.seat.clone();
    this.goTo(id, d.aisleNode);
  }

  meeting(ids) {
    if (this.instant || reducedMotion()) return;
    this.meetingUntil = performance.now() + 4200;
    ids.forEach((id, i) => {
      const bot = this.bots[id];
      if (!bot) return;
      bot.faceTarget = new THREE.Vector3(TABLE.x, 0, TABLE.z);
      this.goTo(id, this.meetingNodes[i % this.meetingNodes.length]);
    });
  }

  buildBots() {
    for (const [id, spec] of Object.entries(this.agents)) {
      const d = this.desks[id];
      if (!d) continue;
      const bot = new Bot(spec, this.shared, d);
      this.scene.add(bot.group);
      this.bots[id] = bot;
    }
  }

  buildLabels() {
    this.labelsEl.innerHTML = "";
    for (const bot of Object.values(this.bots)) {
      const el = document.createElement("div");
      el.className = "o3-label";
      el.style.setProperty("--c", bot.spec.color);
      el.innerHTML = `<span class="o3-name">${esc(bot.spec.name)}</span><span class="o3-bubble"></span>`;
      el.addEventListener("click", () => this.inspect(bot.id));
      this.labelsEl.appendChild(el);
      bot.labelEl = el;
      bot.bubbleEl = el.querySelector(".o3-bubble");
      if (bot.bubbleText) { bot.bubbleEl.textContent = bot.bubbleText; el.classList.add("talk"); }
    }
  }

  // -- ispettore -------------------------------------------------------------
  inspect(id) {
    const bot = this.bots[id];
    if (!bot) return;
    this.selected = id;
    const p = bot.pos.clone();
    // ritratto: davanti all'agente, leggermente dall'alto, verso il centro della stanza
    const toCenter = new THREE.Vector3(0.5 - p.x, 0, 1.5 - p.z).normalize();
    this.focus = { target: new THREE.Vector3(p.x, 0.55, p.z), pos: new THREE.Vector3(p.x, 0.55, p.z).addScaledVector(toCenter, 3.4).add(new THREE.Vector3(0, 1.5, 0)) };
    bot.faceTarget = this.focus.pos.clone();
    setTimeout(() => { if (bot.faceTarget && this.selected === id && this.stateOf(id) === "idle") bot.faceTarget = null; }, 6000);
    this.renderInspector();
  }

  renderInspector() {
    const box = this.root.querySelector("[data-inspector]");
    const bot = this.bots[this.selected];
    if (!bot) { box.classList.add("hidden"); return; }
    const c = this.cur[bot.id] || { state: "idle", opts: {} };
    const tools = (bot.spec.tools || []).map((x) => `<code>${esc(x)}</code>`).join(" ");
    box.innerHTML = `
      <div class="o3-insp-head" style="--c:${bot.spec.color}"><span class="o3-dot"></span><b>${esc(bot.spec.name)}</b><button data-close>✕</button></div>
      <p class="muted small">${esc(bot.spec.description || "")}</p>
      <div class="o3-kv"><span>${this.t("stateLbl")}</span><b>${esc(this.t(`st_${c.state}`))}</b></div>
      ${c.opts?.text ? `<div class="o3-kv"><span>${this.t("doingLbl")}</span><span>${esc(c.opts.text)}</span></div>` : ""}
      ${bot.task ? `<div class="o3-kv"><span>${this.t("taskLbl")}</span><span>${esc(bot.task)}</span></div>` : ""}
      <div class="o3-sub">${this.t("recentLbl")}</div>
      <ul class="o3-acts">${bot.activity.slice(0, 8).map((a) => `<li><span class="muted">${a.time}</span> ${esc(a.text)}</li>`).join("") || `<li class="muted">—</li>`}</ul>
      <div class="o3-sub">${this.t("tools")}</div><div class="o3-tools-list">${tools || "—"}</div>`;
    box.classList.remove("hidden");
    box.querySelector("[data-close]").addEventListener("click", () => { this.selected = null; box.classList.add("hidden"); });
  }

  log(id, text) {
    const bot = this.bots[id];
    if (!bot || !text) return;
    bot.activity.unshift({ time: new Date().toLocaleTimeString().slice(0, 5), text });
    bot.activity = bot.activity.slice(0, 20);
    if (this.selected === id) this.renderInspector();
  }

  // -- API compatibile con l'ufficio 2D ----------------------------------------
  stateOf(id) { return this.cur[id]?.state || "idle"; }

  set(id, state, { text = "", tool = "", bubble = null, label = "" } = {}) {
    const bot = this.bots[id];
    if (!bot) return;
    this.ver[id] = (this.ver[id] || 0) + 1;
    this.cur[id] = { state, opts: { text, tool, bubble, label } };
    bot.setState(state);
    if (state === "assigned" && text) bot.task = text;
    this.desks[id]?.screen.setMode(state, tool, label);
    bot.bubbleText = bubble || "";
    if (bot.bubbleEl) {
      bot.bubbleEl.textContent = bubble || "";
      bot.labelEl.classList.toggle("talk", Boolean(bubble));
      bot.labelEl.classList.toggle("thought", state === "thinking");
      bot.labelEl.dataset.state = state;
    }
    if (text) this.log(id, text);
    if (this.selected === id) this.renderInspector();
    if (state === "idle" || state === "done") bot.faceTarget = null;
  }

  setAfter(promise, id, state, opts) { const v = this.ver[id] || 0; promise.then(() => { if ((this.ver[id] || 0) === v) this.set(id, state, opts); }); }

  startHelping(id, opts) { const c = this.cur[id]; if (c && c.state !== "helping") this.saved[id] = c; this.set(id, "helping", opts); }

  stopHelping(id) {
    if (this.cur[id]?.state !== "helping") return;
    const prev = this.saved[id]; delete this.saved[id];
    if (prev && prev.state !== "idle") this.set(id, prev.state, prev.opts); else this.set(id, "idle", { text: this.t("st_back") });
  }

  anchor(id) {
    if (id === "board") return this.boardAnchor.clone();
    const bot = this.bots[id];
    if (!bot) return null;
    return bot.group.position.clone().add(new THREE.Vector3(0, 1.0, 0));
  }

  fly(from, to, kind = "paper", label = "", delay = 0) {
    if (this.instant || !from || !to || from === to) return Promise.resolve();
    return new Promise((resolve) => {
      setTimeout(() => {
        const a = this.anchor(from), b = this.anchor(to);
        if (!a || !b) { resolve(); return; }
        const color = new THREE.Color((this.agents[from] || this.agents[to] || { color: "#7c5cff" }).color);
        this.packets.push(new Packet(this.scene, this.shared, kind, a, b, color, () => {
          const bot = this.bots[to];
          if (bot && kind !== "ok" && kind !== "ko") bot.hop = Math.max(bot.hop, 0.6);
          resolve();
        }));
      }, delay);
    });
  }

  pin(agentId, text) { const a = this.agents[agentId] || { color: "#888", name: agentId }; this.whiteboard.add(a.color, a.name, text); }

  alert(el) { this.root.querySelector("[data-alerts]").appendChild(el); }

  reset() {
    this.saved = {};
    for (const id of Object.keys(this.bots)) { this.set(id, "idle"); this.bots[id].task = ""; this.goHome(id); }
    this.whiteboard.clear();
    this.root.querySelector("[data-alerts]").innerHTML = "";
    this.setJob(null);
    this.tasks = {};
    this.updateProgress();
  }

  setJob(text) {
    this.root.querySelector("[data-job]").textContent = text || this.t("noJob");
    clearInterval(this.timer);
    const clock = this.root.querySelector("[data-clock]");
    clock.textContent = "00:00";
    if (text && !this.instant) {
      const start = Date.now();
      this.timer = setInterval(() => { const s = Math.floor((Date.now() - start) / 1000); clock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }, 500);
    }
  }

  stopClock(seconds) {
    clearInterval(this.timer);
    if (seconds != null) { const s = Math.round(seconds); this.root.querySelector("[data-clock]").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
  }

  setTasks(tasks) { this.tasks = Object.fromEntries(tasks.map((x) => [x.id, { ...x, done: false }])); this.updateProgress(); }
  finishTask(id) { if (this.tasks[id]) this.tasks[id].done = true; this.updateProgress(); }
  updateProgress() {
    const all = Object.values(this.tasks); const done = all.filter((x) => x.done).length;
    const bar = this.root.querySelector("[data-progress]"); if (!bar) return;
    bar.style.width = all.length ? `${(done / all.length) * 100}%` : "0%";
    this.root.querySelector("[data-progress-txt]").textContent = all.length ? `${done}/${all.length} ${this.t("tasksDone")}` : "";
  }

  celebrate() {
    if (this.instant || reducedMotion()) return;
    for (const bot of Object.values(this.bots)) if (bot.state !== "idle") bot.celebrateT = 1.2;
    const colors = Object.values(this.agents).map((a) => new THREE.Color(a.color));
    const N = 160;
    const geo = new THREE.PlaneGeometry(0.08, 0.14);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, N);
    const parts = Array.from({ length: N }, (_, i) => ({
      p: new THREE.Vector3((Math.random() - 0.5) * 12, 5 + Math.random() * 3, (Math.random() - 0.5) * 9),
      v: new THREE.Vector3((Math.random() - 0.5) * 1.2, -1 - Math.random() * 1.5, (Math.random() - 0.5) * 1.2),
      r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), w: (Math.random() - 0.5) * 10,
    }));
    parts.forEach((_, i) => mesh.setColorAt(i, colors[i % colors.length]));
    this.scene.add(mesh);
    this.confetti = { mesh, parts, t: 0, geo, mat };
  }

  updateConfetti(dt) {
    const c = this.confetti;
    if (!c) return;
    c.t += dt;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    c.parts.forEach((p, i) => {
      p.p.addScaledVector(p.v, dt);
      p.p.x += Math.sin(c.t * 3 + i) * dt * 0.4;
      p.r.x += p.w * dt; p.r.y += p.w * dt * 0.7;
      if (p.p.y < 0.02) { p.p.y = 0.02; p.v.set(0, 0, 0); p.w = 0; }
      q.setFromEuler(p.r);
      m.compose(p.p, q, s);
      c.mesh.setMatrixAt(i, m);
    });
    c.mesh.instanceMatrix.needsUpdate = true;
    if (c.t > 4) { this.scene.remove(c.mesh); c.geo.dispose(); c.mat.dispose(); c.mesh.dispose(); this.confetti = null; }
  }

  // -- ciclo di rendering ---------------------------------------------------------
  resize() {
    const r = this.root.getBoundingClientRect();
    const w = Math.max(10, r.width), h = Math.max(10, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // su schermi stretti allontana la telecamera per far entrare tutto l'ufficio
    this.camera.fov = w / h < 1 ? 46 : 32;
    this.camera.updateProjectionMatrix();
  }

  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - this.lastT);
    this.lastT = now;
    if (!this.visible || document.hidden || this.manualClock) return;
    this.tick(this.paused ? 0 : dt, now);
  }

  // Avanza la simulazione di dt secondi (usato dal ciclo di rendering e dai test/registrazioni)
  tick(dt, t) {
    if (this.focus) {
      this.controls.target.lerp(this.focus.target, 1 - Math.exp(-dt * 3 - 0.02));
      this.camera.position.lerp(this.focus.pos, 1 - Math.exp(-dt * 3 - 0.02));
      if (this.camera.position.distanceTo(this.focus.pos) < 0.05) this.focus = null;
    }
    this.controls.update(dt);
    for (const bot of Object.values(this.bots)) bot.update(dt, t, this.camera.position);
    for (const d of Object.values(this.desks)) if (!this.paused) d.screen.draw(t);
    this.packets = this.packets.filter((p) => p.update(dt, this.camera));
    this.updateConfetti(dt);
    if (this.clockHands) { const d = new Date(); this.clockHands[0].rotation.z = -((d.getHours() % 12) / 12) * Math.PI * 2; this.clockHands[1].rotation.z = -(d.getMinutes() / 60) * Math.PI * 2; }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  updateLabels() {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    for (const bot of Object.values(this.bots)) {
      if (!bot.labelEl) continue;
      v.copy(bot.group.position); v.y += 1.25;
      v.project(this.camera);
      const behind = v.z > 1;
      const x = (v.x * 0.5 + 0.5) * r.width, y = (-v.y * 0.5 + 0.5) * r.height;
      bot.labelEl.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      bot.labelEl.style.opacity = behind ? "0" : "1";
      bot.labelEl.style.zIndex = String(1000 - Math.round(v.z * 1000));
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.io.disconnect(); this.ro.disconnect();
    clearInterval(this.timer);
    this.scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); });
    this.renderer.dispose();
  }
}
