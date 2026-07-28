// Interactive defender-decision demo. Loads the momentum-field crate compiled
// to wasm (the REAL defend.rs — decisions here are the simulation's
// decisions), stages the dragged configuration, and renders every defender's
// decided task plus the softmax it decided from. No dependencies, no network
// beyond the one wasm fetch.
'use strict';

const L = 105, W = 68; // pitch metres (pitch.rs)
const ACTIONS = ['man-mark', 'zone', 'lane-block', 'press', 'cover'];
const ACTION_COLOR = ['#f87171', '#64748b', '#fbbf24', '#f472b6', '#a78bfa'];

// ---------------------------------------------------------------- state
// players: {x, y, vx, vy, def} — velocities give runners their lead targets
const SCENES = {
  // the broken-shape state from the post's figures: a runner has beaten the line
  broken: {
    ball: { x: 76.6, y: 33.8, vx: 3.0, vy: -0.5 },
    players: [
      { x: 76.0, y: 34.0, vx: 1.0, vy: 0.0, def: 0 },   // carrier
      { x: 91.0, y: 24.0, vx: 2.0, vy: -0.5, def: 0 },  // runner
      { x: 78.0, y: 23.0, vx: 0.0, vy: 0.0, def: 0 },
      { x: 83.0, y: 46.0, vx: 1.0, vy: 0.5, def: 0 },
      { x: 58.0, y: 30.0, vx: 0.0, vy: 0.0, def: 0 },
      { x: 81.0, y: 36.5, vx: -1.0, vy: -0.5, def: 1 },
      { x: 86.0, y: 33.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 90.0, y: 31.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 68.0, y: 50.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 87.0, y: 43.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 102.5, y: 34.0, vx: 0.0, vy: 0.0, def: 1 },  // keeper
    ],
  },
  block: {
    ball: { x: 68.0, y: 40.0, vx: 2.0, vy: 0.0 },
    players: [
      { x: 67.0, y: 40.0, vx: 1.0, vy: 0.0, def: 0 },
      { x: 80.0, y: 30.0, vx: 1.5, vy: 0.0, def: 0 },
      { x: 80.0, y: 46.0, vx: 1.5, vy: 0.0, def: 0 },
      { x: 60.0, y: 22.0, vx: 0.0, vy: 0.0, def: 0 },
      { x: 55.0, y: 44.0, vx: 0.0, vy: 0.0, def: 0 },
      { x: 84.0, y: 28.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 84.0, y: 40.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 90.0, y: 34.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 78.0, y: 34.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 92.0, y: 24.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 103.0, y: 34.0, vx: 0.0, vy: 0.0, def: 1 },
    ],
  },
  mid: {
    ball: { x: 52.0, y: 34.0, vx: 2.0, vy: 1.0 },
    players: [
      { x: 51.0, y: 33.0, vx: 1.0, vy: 0.5, def: 0 },
      { x: 65.0, y: 20.0, vx: 2.0, vy: 0.0, def: 0 },
      { x: 66.0, y: 48.0, vx: 2.0, vy: 0.0, def: 0 },
      { x: 42.0, y: 40.0, vx: 0.0, vy: 0.0, def: 0 },
      { x: 36.0, y: 26.0, vx: 0.0, vy: 0.0, def: 0 },
      { x: 58.0, y: 36.0, vx: -1.0, vy: 0.0, def: 1 },
      { x: 70.0, y: 26.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 71.0, y: 44.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 82.0, y: 34.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 62.0, y: 55.0, vx: 0.0, vy: 0.0, def: 1 },
      { x: 102.0, y: 34.0, vx: 0.0, vy: 0.0, def: 1 },
    ],
  },
};

const PRESETS = {
  prior: { mark: 1.0, lane: 1.0, press: 1.5, cover: 0.8, zone: 0.2, temp: 1.0 },
  lanes: { mark: 0.5, lane: 6.0, press: 1.5, cover: 0.4, zone: 0.15, temp: 0.6 },
  press: { mark: 0.6, lane: 0.8, press: 5.0, cover: 0.5, zone: 0.0, temp: 0.6 },
  bus:   { mark: 0.8, lane: 0.6, press: 0.3, cover: 2.5, zone: 0.9, temp: 0.8 },
};

let ball = null;
let players = null;
let selected = -1;   // clicked defender index (policy panel)
let result = null;   // parsed defense_decide output
let wasm = null, mem = null;

function loadScene(name) {
  const s = SCENES[name];
  ball = { ...s.ball };
  players = s.players.map(p => ({ ...p }));
  selected = -1;
}
loadScene('broken');

// ---------------------------------------------------------------- wasm
async function boot() {
  const status = document.getElementById('status');
  try {
    // instantiate (not instantiateStreaming) so file:// and strict-MIME
    // static hosts both work — same pattern as the momentum-field app
    const r = await fetch('./wasm/momentum_field.wasm');
    const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {});
    wasm = instance.exports;
    mem = wasm.memory;
    pushTheta();
    decide();
    status.textContent = `wasm ready · ${players.filter(p => p.def).length} defenders deciding live`;
  } catch (e) {
    status.textContent = 'wasm failed to load: ' + e;
    console.error(e);
  }
  draw();
}

function stageF32(arr) {
  // stage as BYTES: a Float32Array view at ptr would assume 4-byte alignment,
  // which a Vec<u8>-backed allocator does not guarantee (same pattern as the
  // main WebGL app's stageFloats)
  const ptr = wasm.mf_alloc(arr.byteLength);
  new Uint8Array(mem.buffer, ptr, arr.byteLength)
    .set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
  return ptr;
}

function pushTheta() {
  if (!wasm) return;
  const v = id => parseFloat(document.getElementById(id).value);
  // def_replan stays at its default (2 s): it shapes the reach discount, and
  // the sliders cover the scheme weights the post discusses
  wasm.set_def_params(v('th_temp'), 2.0, v('th_mark'), v('th_lane'),
                      v('th_press'), v('th_cover'), v('th_zone'));
}

function decide() {
  if (!wasm) return;
  const rows = new Float32Array(players.length * 5);
  players.forEach((p, i) => rows.set([p.x, p.y, p.vx, p.vy, p.def], i * 5));
  stageF32(rows);
  const ptr = wasm.defense_decide(players.length, 1, ball.x, ball.y, ball.vx, ball.vy);
  const out = new Float32Array(mem.buffer, ptr, wasm.defense_out_len());
  // parse: [n, (action, tx, ty, q0..q4, mark) × n, nopts, (tx, ty, q, c) × nopts]
  const n = out[0] | 0;
  const decs = [];
  let k = 1;
  for (let i = 0; i < n; i++, k += 9) {
    decs.push({
      action: out[k] | 0, tx: out[k + 1], ty: out[k + 2],
      q: [out[k + 3], out[k + 4], out[k + 5], out[k + 6], out[k + 7]],
      mark: out[k + 8] | 0,
    });
  }
  const nopts = out[k] | 0; k += 1;
  const opts = [];
  for (let o = 0; o < nopts; o++, k += 4) {
    opts.push({ tx: out[k], ty: out[k + 1], q: out[k + 2], c: out[k + 3] });
  }
  result = { decs, opts };
  renderBars();
}

// ---------------------------------------------------------------- canvas
const canvas = document.getElementById('pitch');
const ctx = canvas.getContext('2d');
let px = 8, ox = 0, oy = 0; // metres → pixels transform

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  px = Math.min(r.width / (L + 4), r.height / (W + 4));
  ox = (r.width - L * px) / 2;
  oy = (r.height - W * px) / 2;
  draw();
}
const X = m => ox + m * px, Y = m => oy + m * px;

function pitchLines() {
  ctx.strokeStyle = '#2a5a40'; ctx.lineWidth = 1.4;
  ctx.strokeRect(X(0), Y(0), L * px, W * px);
  ctx.beginPath(); ctx.moveTo(X(L / 2), Y(0)); ctx.lineTo(X(L / 2), Y(W)); ctx.stroke();
  ctx.beginPath(); ctx.arc(X(L / 2), Y(W / 2), 9.15 * px, 0, 7); ctx.stroke();
  for (const gx of [0, L]) {
    const s = gx === 0 ? 1 : -1;
    ctx.strokeRect(X(gx), Y(W / 2 - 20.16), s * 16.5 * px, 40.32 * px);
    ctx.strokeRect(X(gx), Y(W / 2 - 9.16), s * 5.5 * px, 18.32 * px);
  }
  ctx.fillStyle = '#cfe';
  ctx.fillRect(X(L) - 1, Y(W / 2 - 3.66), 4, 7.32 * px); // attacked goal
}

function draw() {
  const r = canvas.parentElement.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  ctx.fillStyle = '#07120c';
  ctx.fillRect(0, 0, r.width, r.height);
  pitchLines();

  if (result) {
    // pass options: dashed lanes, opacity ∝ q·c
    ctx.setLineDash([6, 5]);
    for (const o of result.opts) {
      ctx.strokeStyle = `rgba(103, 232, 249, ${0.2 + 0.75 * Math.min(1, o.q * o.c * 3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(X(ball.x), Y(ball.y)); ctx.lineTo(X(o.tx), Y(o.ty)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // decided tasks
    result.decs.forEach((d, i) => {
      if (d.action < 0) return;
      const p = players[i];
      const col = ACTION_COLOR[d.action];
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y)); ctx.lineTo(X(d.tx), Y(d.ty)); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(X(d.tx), Y(d.ty), 2.6, 0, 7); ctx.fill();
    });
  }
  // players (velocity ticks show runners)
  players.forEach((p, i) => {
    if (p.vx || p.vy) {
      ctx.strokeStyle = 'rgba(207, 238, 238, 0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y));
      ctx.lineTo(X(p.x + p.vx * 1.2), Y(p.y + p.vy * 1.2)); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 6, 0, 7);
    ctx.fillStyle = p.def ? '#0b1c2e' : '#101d12';
    ctx.fill();
    ctx.lineWidth = i === selected ? 3 : 2;
    ctx.strokeStyle = i === selected ? '#fff' : (p.def ? '#7dd3fc' : '#4ade80');
    ctx.stroke();
  });
  // ball
  ctx.beginPath(); ctx.arc(X(ball.x), Y(ball.y), 4, 0, 7);
  ctx.fillStyle = '#fff'; ctx.fill();
}

// ---------------------------------------------------------------- policy bars
function renderBars() {
  const hdr = document.getElementById('barhdr');
  const bars = document.getElementById('bars');
  bars.innerHTML = '';
  if (selected < 0 || !result || result.decs[selected]?.action < 0) {
    hdr.textContent = 'policy · click a defender';
    return;
  }
  const d = result.decs[selected];
  const isGk = d.q.every(q => q === 0);
  hdr.textContent = isGk
    ? `defender ${selected} · keeper (task fixed: cover)`
    : `defender ${selected} · chose ${ACTIONS[d.action]}`;
  if (isGk) return;
  d.q.forEach((q, a) => {
    const row = document.createElement('div');
    row.className = 'bar';
    row.innerHTML = `<span class="lbl">${ACTIONS[a]}</span>
      <span class="track"><span class="fill" style="width:${(q * 100).toFixed(1)}%;background:${ACTION_COLOR[a]}"></span></span>
      <span class="val">${(q * 100).toFixed(0)}%</span>`;
    bars.appendChild(row);
  });
}

// ---------------------------------------------------------------- interaction
let drag = null; // {kind: 'ball'|'player', i}
function hit(mx, my) {
  const m = { x: (mx - ox) / px, y: (my - oy) / px };
  if (Math.hypot(m.x - ball.x, m.y - ball.y) < 1.6) return { kind: 'ball' };
  let best = null, bd = 1.8;
  players.forEach((p, i) => {
    const d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d < bd) { bd = d; best = { kind: 'player', i }; }
  });
  return best;
}
canvas.addEventListener('pointerdown', e => {
  const r = canvas.getBoundingClientRect();
  const h = hit(e.clientX - r.left, e.clientY - r.top);
  if (h) {
    drag = h;
    canvas.setPointerCapture(e.pointerId);
    if (h.kind === 'player' && players[h.i].def) {
      selected = h.i;
      renderBars();
    }
    draw();
  }
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = canvas.getBoundingClientRect();
  const mx = Math.min(L - 0.5, Math.max(0.5, (e.clientX - r.left - ox) / px));
  const my = Math.min(W - 0.5, Math.max(0.5, (e.clientY - r.top - oy) / px));
  if (drag.kind === 'ball') { ball.x = mx; ball.y = my; }
  else { players[drag.i].x = mx; players[drag.i].y = my; }
  decide(); draw();
});
canvas.addEventListener('pointerup', () => { drag = null; });

// sliders
for (const id of ['th_mark', 'th_lane', 'th_press', 'th_cover', 'th_zone', 'th_temp']) {
  const el = document.getElementById(id);
  el.addEventListener('input', () => {
    el.nextElementSibling.textContent = parseFloat(el.value).toFixed(el.step < 0.1 ? 2 : 1);
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
    pushTheta(); decide(); draw();
  });
}
// scheme presets
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = PRESETS[btn.dataset.preset];
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.nextElementSibling.textContent = v.toFixed(el.step < 0.1 ? 2 : 1);
    };
    set('th_mark', p.mark); set('th_lane', p.lane); set('th_press', p.press);
    set('th_cover', p.cover); set('th_zone', p.zone); set('th_temp', p.temp);
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    pushTheta(); decide(); draw();
  });
});
// scenarios
document.querySelectorAll('[data-scene]').forEach(btn => {
  btn.addEventListener('click', () => {
    loadScene(btn.dataset.scene);
    decide(); draw(); renderBars();
  });
});

// deep links: ?scene=broken|block|mid & scheme=prior|lanes|press|bus & sel=<idx>
function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  const scene = q.get('scene');
  if (scene && SCENES[scene]) loadScene(scene);
  const scheme = q.get('scheme');
  if (scheme && PRESETS[scheme]) {
    const p = PRESETS[scheme];
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.nextElementSibling.textContent = v.toFixed(el.step < 0.1 ? 2 : 1);
    };
    set('th_mark', p.mark); set('th_lane', p.lane); set('th_press', p.press);
    set('th_cover', p.cover); set('th_zone', p.zone); set('th_temp', p.temp);
    document.querySelectorAll('[data-preset]').forEach(b =>
      b.classList.toggle('active', b.dataset.preset === scheme));
  }
  const sel = parseInt(q.get('sel'), 10);
  if (!Number.isNaN(sel) && sel >= 0 && sel < players.length && players[sel].def) {
    selected = sel;
  }
}

window.addEventListener('resize', resize);
applyUrlParams();
resize();
boot();
