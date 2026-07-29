// momentum-field WebGL2 frontend.
//
// The Rust drift/diffusion + Fokker-Planck core is compiled to wasm and called
// directly here: we stage the empirical field (parsed from field.csv) into wasm
// linear memory, then ask it to propagate a ball-state PDF into N uniform time
// snapshots. Those snapshots are uploaded as textures and animated over a pitch,
// with the *actual* ball position (from ball.f32) drawn on the same clock so you
// can see where the ball really is as the predicted density evolves.

const PITCH_L = 105.0, PITCH_W = 68.0;
const N_FRAMES = 64;          // density snapshots per propagation
const BALL_DT = 0.04;         // tracking sample period (25 Hz), for interpolation

const $ = id => document.getElementById(id);
const fail = msg => { const e = $('err'); e.style.display = 'flex'; e.textContent = 'error:\n' + msg; throw new Error(msg); };

// ---------------------------------------------------------------- wasm glue
let wasm, mem;
async function loadWasm() {
  // STANDALONE BUNDLE: the wasm ships inside this folder and is fetched by a
  // RELATIVE path, so the whole directory can be hosted at any subpath of any
  // static host (blog /momentum-field/, GitHub Pages, S3, ...). arrayBuffer
  // (not instantiateStreaming) so we don't depend on the static server
  // sending Content-Type: application/wasm.
  const r = await fetch('./wasm/kalshi_basket.wasm');
  if (!r.ok) fail('./wasm/kalshi_basket.wasm not found (keep the bundle layout intact)');
  const { instance } = await WebAssembly.instantiate(await r.arrayBuffer(), {});
  wasm = instance.exports;
}
// re-view helpers (call AFTER any wasm call that may have grown memory)
const f32at = (ptr, len) => new Float32Array(wasm.memory.buffer, ptr, len);
const stageFloats = (arr) => { const ptr = wasm.mf_alloc(arr.byteLength); new Uint8Array(wasm.memory.buffer, ptr, arr.byteLength).set(new Uint8Array(arr.buffer)); return ptr; };

// --------------------------------------------------------- learned kernel
// fetch kernel.json, flatten weights in the exact order set_kernel expects, stage.
async function loadKernel() {
  let k; try { k = await (await fetch('./assets/kernel.json')).json(); } catch { return false; }
  // guard: the wasm set_kernel hard-codes a 4-feature φ — a mismatched kernel.json
  // would read past the staged buffer and TRAP the whole wasm. Skip instead.
  if (!k.weights || k.weights['phi.0.weight']?.[0]?.length !== 4) {
    console.warn('kernel.json arch mismatch (expected 4 player-features) — learned kernel disabled'); return false;
  }
  const flat = [];
  const p2 = m => { for (const row of m) for (const x of row) flat.push(x); };
  const p1 = a => { for (const x of a) flat.push(x); };
  const W = k.weights;
  p2(W['phi.0.weight']); p1(W['phi.0.bias']); p2(W['phi.2.weight']); p1(W['phi.2.bias']);
  p2(W['rho.0.weight']); p1(W['rho.0.bias']); p2(W['rho.2.weight']); p1(W['rho.2.bias']);
  p2(W['rho.4.weight']); p1(W['rho.4.bias']);
  p1(k.norm.gmu); p1(k.norm.gsd); p1(k.norm.pmu); p1(k.norm.psd);
  const arr = new Float32Array(flat);
  stageFloats(arr); wasm.set_kernel(arr.length);
  return true;
}

// fetch the FITTED θ (written by `momentum-field fit --out-flat`) and stage it
// into the wasm; falls back silently to the built-in prior defaults.
let thetaFitted = false;
async function loadParams() {
  let p;
  try { p = await (await fetch('./assets/params_flat.json')).json(); } catch { return false; }
  if (p?.schema !== 'theta-flat-v1' || !Array.isArray(p.values)) return false;
  if (p.values.length > wasm.param_count()) {
    console.warn(`params_flat.json has ${p.values.length} values but the wasm expects at most ${wasm.param_count()} — using defaults`);
    return false;
  }
  if (p.values.length < wasm.param_count()) {
    // θ grows append-only, so an older fitted file stages as a PREFIX and the
    // appended parameters (e.g. the defender-decision block) keep defaults
    console.info(`params_flat.json has ${p.values.length} of ${wasm.param_count()} values — staging as a prefix`);
  }
  stageFloats(new Float32Array(p.values));
  wasm.set_params(p.values.length);
  thetaFitted = true;
  // the value view's "ideal speed" defaults to the θ-DERIVED transport speed
  // (fitted carry top speed + fitted pass-transport rate) — learned, not a knob
  if (wasm.theta_speed) {
    const ts = wasm.theta_speed();
    if (ts > 0) $('vmax').value = Math.min(14, Math.max(2, ts)).toFixed(1);
  }
  return true;
}

// --------------------------------------------------------------- field load
let grid = { nx: 0, ny: 0, h: 3.0 };
let driftField = null; // {bx,by} Float32Arrays for the quiver

async function loadField() {
  const txt = await (await fetch('./assets/field.csv')).text();
  const lines = txt.trim().split('\n');
  const rows = lines.slice(1).map(l => l.split(',').map(Number));
  // rows are j-major: x,y,bx,by,dxx,dxy,dyy,count ; centres at ((i+.5)h,(j+.5)h)
  const xs = rows.map(r => r[0]);
  const h = +(xs[1] - xs[0]).toFixed(3);
  const firstY = rows[0][1];
  let nx = rows.findIndex(r => r[1] !== firstY);
  if (nx <= 0) nx = rows.length;
  const ny = Math.round(rows.length / nx);
  grid = { nx, ny, h };

  // stage [nx, ny, h, (bx,by,dxx,dxy,dyy)*ncells] into wasm and init the Field
  const ncells = nx * ny;
  const buf = new Float32Array(3 + ncells * 5);
  buf[0] = nx; buf[1] = ny; buf[2] = h;
  const bx = new Float32Array(ncells), by = new Float32Array(ncells);
  for (let k = 0; k < ncells; k++) {
    const r = rows[k], o = 3 + k * 5;
    buf[o] = r[2]; buf[o + 1] = r[3]; buf[o + 2] = r[4]; buf[o + 3] = r[5]; buf[o + 4] = r[6];
    bx[k] = r[2]; by[k] = r[3];
  }
  driftField = { bx, by };

  const ptr = wasm.mf_alloc(buf.byteLength);
  new Uint8Array(wasm.memory.buffer, ptr, buf.byteLength).set(new Uint8Array(buf.buffer));
  wasm.init_field(buf.length);
}

// ---------------------------------------------------------------- ball track
let ball = { t: null, x: null, y: null, n: 0, tMax: 0 };
async function loadBall() {
  const ab = await (await fetch('./assets/ball.f32')).arrayBuffer();
  const a = new Float32Array(ab);
  const n = a.length / 3;
  const t = new Float32Array(n), x = new Float32Array(n), y = new Float32Array(n);
  for (let i = 0; i < n; i++) { t[i] = a[i * 3]; x[i] = a[i * 3 + 1]; y[i] = a[i * 3 + 2]; }
  // per-frame attacking direction (+1 = toward x=L, -1 = toward x=0, 0 = loose ball),
  // possessor team (0/1/-1), and player positions (11 team0 then 11 team1, cm int16)
  let dir = null, poss = null, players = null;
  try { const d = new Int8Array(await (await fetch('./assets/dir.i8')).arrayBuffer()); if (d.length === n) dir = d; } catch {}
  try { const p = new Int8Array(await (await fetch('./assets/poss.i8')).arrayBuffer()); if (p.length === n) poss = p; } catch {}
  try { const pl = new Int16Array(await (await fetch('./assets/players.i16')).arrayBuffer()); if (pl.length === n * 44) players = pl; } catch {}
  ball = { t, x, y, n, tMax: t[n - 1], dir, poss, players };
}
// nearest sample index to relative match time `tr` (shared by dir/poss/players)
function frameIndexAt(tr) {
  const { t, n } = ball;
  if (tr <= t[0]) return 0; if (tr >= t[n - 1]) return n - 1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tr) lo = m; else hi = m; }
  return (tr - t[lo] < t[hi] - tr) ? lo : hi;
}
function dirAt(tr) { return ball.dir ? ball.dir[frameIndexAt(tr)] : 0; }
function possAt(tr) { return ball.poss ? ball.poss[frameIndexAt(tr)] : -1; }
// players at `tr` as {0:[[x,y]×11], 1:[[x,y]×11]} in metres
function playersAt(tr) {
  if (!ball.players) return null;
  const o = frameIndexAt(tr) * 44, pl = ball.players, t0 = [], t1 = [];
  for (let k = 0; k < 11; k++) { t0.push([pl[o+k*2]/100, pl[o+k*2+1]/100]); t1.push([pl[o+22+k*2]/100, pl[o+22+k*2+1]/100]); }
  return { 0: t0, 1: t1 };
}
// all 22 players as (x, y, vx, vy, is_def) rows for the v2 interaction model,
// velocities finite-differenced over `dt` of replay (glitch-capped at 11 m/s)
function playersV5(tr, dt = 0.2) {
  const pl = playersAt(tr); if (!pl) return null;
  const pt = possAt(tr); if (pt !== 0 && pt !== 1) return null;
  const pp = playersAt(tr - dt) || pl;
  const arr = new Float32Array(22 * 5); let w = 0;
  for (const tm of [0, 1]) for (let k = 0; k < 11; k++) {
    const [x, y] = pl[tm][k], [px, py] = pp[tm][k];
    let vx = (x - px) / dt, vy = (y - py) / dt;
    const sp = Math.hypot(vx, vy); if (sp > 11) { vx *= 11 / sp; vy *= 11 / sp; }
    arr[w++] = x; arr[w++] = y; arr[w++] = vx; arr[w++] = vy; arr[w++] = (tm !== pt) ? 1 : 0;
  }
  return arr;
}

// ball velocity (m/s) at relative match time `tr`, clamped against teleport glitches
function ballVel(tr, dt = 0.2) {
  const [ax, ay] = ballAt(tr - dt), [bx, by] = ballAt(tr + dt);
  let vx = (bx - ax) / (2 * dt), vy = (by - ay) / (2 * dt);
  const sp = Math.hypot(vx, vy), CAP = 12;
  if (sp > CAP) { vx *= CAP / sp; vy *= CAP / sp; }
  return [vx, vy];
}
// Active (ball-in-motion) intervals in t_rel, for the "skip dead time" toggle.
// A sample is active if speed > threshold; we dilate, merge nearby runs, and drop
// tiny ones so playback fast-jumps over stoppages to the next bit of real play.
let activeIntervals = [];
function computeActiveIntervals() {
  const { t, x, y, n } = ball;
  const TH = 1.2, DILATE = 1.0, MERGE = 2.5, MINDUR = 0.8;
  const iv = []; let s = null;
  for (let k = 1; k < n; k++) {
    const dt = t[k] - t[k - 1];
    const sp = (dt > 0 && dt <= 1) ? Math.hypot(x[k] - x[k - 1], y[k] - y[k - 1]) / dt : 0;
    if (sp > TH) { if (s === null) s = t[k - 1]; }
    else if (s !== null) { iv.push([Math.max(0, s - DILATE), t[k - 1] + DILATE]); s = null; }
  }
  if (s !== null) iv.push([Math.max(0, s - DILATE), t[n - 1]]);
  const tMax = ball.tMax;
  const merged = [];
  for (const [a, b0] of iv) {
    const b = Math.min(tMax, b0);
    const last = merged[merged.length - 1];
    if (last && a - last[1] < MERGE) last[1] = b; else merged.push([a, b]);
  }
  activeIntervals = merged.filter(([a, b]) => b - a >= MINDUR);
}
function inActive(tr) { for (const [a, b] of activeIntervals) if (tr >= a && tr <= b) return true; return false; }
function nextActiveStart(tr) {
  for (const [a] of activeIntervals) if (a > tr) return a;
  return activeIntervals.length ? activeIntervals[0][0] : tr; // wrap
}

// ball position at relative match time `tr` (binary search + linear interp).
// Across a data gap (>1s between samples, e.g. the halftime break) we snap to the
// nearest sample instead of interpolating, so the ball doesn't "creep" for 800s.
function ballAt(tr) {
  const { t, x, y, n } = ball;
  if (tr <= t[0]) return [x[0], y[0]];
  if (tr >= t[n - 1]) return [x[n - 1], y[n - 1]];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tr) lo = m; else hi = m; }
  if (t[hi] - t[lo] > 1.0) return (tr - t[lo] < t[hi] - tr) ? [x[lo], y[lo]] : [x[hi], y[hi]];
  const f = (tr - t[lo]) / Math.max(t[hi] - t[lo], 1e-6);
  return [x[lo] + (x[hi] - x[lo]) * f, y[lo] + (y[hi] - y[lo]) * f];
}

// --------------------------------------------------------------- propagation
let frames = null;      // Array<Uint8Array(ncells)>  normalized 0..255
let series = null;      // Float32Array of [t,mass,xg] triples
let lastXg = 0, horizonNow = 8, t0Now = 0, seed = [52.5, 34];

function propagate(x, y, horizon) {
  const ptr = wasm.propagate_frames(x, y, horizon, N_FRAMES);
  if (ptr === 0) fail('propagate returned null (field not initialised)');
  const ncells = grid.nx * grid.ny;
  const flat = f32at(ptr, N_FRAMES * ncells);
  let max = 1e-12;
  for (let i = 0; i < flat.length; i++) if (flat[i] > max) max = flat[i];
  const inv = 255 / max;
  frames = [];
  for (let k = 0; k < N_FRAMES; k++) {
    const u = new Uint8Array(ncells);
    const base = k * ncells;
    for (let c = 0; c < ncells; c++) u[c] = Math.min(255, flat[base + c] * inv) | 0;
    frames.push(u);
  }
  const sp = wasm.series_ptr(), sl = wasm.series_len();
  series = f32at(sp, sl).slice();
  lastXg = wasm.last_xg();
  horizonNow = horizon;
}
// linear-interp the (t,mass,xg) series at sim time `ts`
function seriesAt(ts) {
  if (!series || series.length < 3) return [0, 0];
  const n = series.length / 3;
  if (ts <= series[0]) return [series[1], series[2]];
  for (let i = 1; i < n; i++) {
    const t = series[i * 3];
    if (t >= ts) {
      const t0 = series[(i - 1) * 3], f = (ts - t0) / Math.max(t - t0, 1e-6);
      const m = series[(i - 1) * 3 + 1] + (series[i * 3 + 1] - series[(i - 1) * 3 + 1]) * f;
      const g = series[(i - 1) * 3 + 2] + (series[i * 3 + 2] - series[(i - 1) * 3 + 2]) * f;
      return [m, g];
    }
  }
  return [series[(n - 1) * 3 + 1], series[(n - 1) * 3 + 2]];
}

// -------------------------------------------------------------------- WebGL
let gl, progTex, progFlat, densTex, fwdTex, valTex, xform = [1, 1, 0, 0];
let quadBuf, dynBuf;

const VS_TEX = `#version 300 es
in vec2 aPos; out vec2 vUV; uniform vec4 uX; uniform vec2 uP;
void main(){ vUV = aPos / uP; gl_Position = vec4(aPos.x*uX.x+uX.z, aPos.y*uX.y+uX.w, 0., 1.); }`;
const FS_TEX = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform float uGam; uniform int uCmap;
vec3 turbo(float t){
  const vec3 c0=vec3(0.1140,0.0628,0.2248); const vec3 c1=vec3(6.7164,3.1822,7.5715);
  const vec3 c2=vec3(-66.094,-4.9279,-10.094); const vec3 c3=vec3(228.766,25.049,-91.541);
  const vec3 c4=vec3(-334.835,-69.317,288.585); const vec3 c5=vec3(218.763,67.521,-305.204);
  const vec3 c6=vec3(-52.889,-21.545,110.517);
  t=clamp(t,0.,1.); return clamp(c0+t*(c1+t*(c2+t*(c3+t*(c4+t*(c5+t*c6))))),0.,1.);
}
vec3 ice(float t){ t=clamp(t,0.,1.);          // cool ramp for the forward (future) layer
  vec3 c=vec3(0.0,0.08,0.18);
  c=mix(c, vec3(0.0,0.45,0.85), smoothstep(0.0,0.5,t));
  c=mix(c, vec3(0.45,0.92,1.0), smoothstep(0.45,0.82,t));
  c=mix(c, vec3(0.95,1.0,1.0),  smoothstep(0.82,1.0,t));
  return c;
}
void main(){ float v=pow(texture(uTex,vUV).r, uGam);
  vec3 col = (uCmap==1) ? ice(v) : turbo(v);
  o=vec4(col, smoothstep(0.02,0.25,v)); }`;
const VS_FLAT = `#version 300 es
in vec2 aPos; in vec4 aCol; in float aSz; out vec4 vCol; uniform vec4 uX;
void main(){ vCol=aCol; gl_PointSize=aSz; gl_Position=vec4(aPos.x*uX.x+uX.z, aPos.y*uX.y+uX.w, 0., 1.); }`;
const FS_FLAT = `#version 300 es
precision highp float; in vec4 vCol; out vec4 o; uniform float uRound;
void main(){
  if (uRound > 0.5) { vec2 d = gl_PointCoord - 0.5; if (dot(d,d) > 0.25) discard; }
  o = vCol;
}`;

function sh(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) fail(gl.getShaderInfoLog(s));
  return s;
}
function prog(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) fail(gl.getProgramInfoLog(p));
  return p;
}

function initGL() {
  const c = $('gl');
  gl = c.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) fail('WebGL2 not available');
  progTex = prog(VS_TEX, FS_TEX);
  progFlat = prog(VS_FLAT, FS_FLAT);
  quadBuf = gl.createBuffer();
  dynBuf = gl.createBuffer();

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const mkTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, grid.nx, grid.ny, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  densTex = mkTex();   // wake (past) layer, turbo
  fwdTex = mkTex();    // forward (future) layer, ice
  valTex = mkTex();    // value (ideal xG) layer, turbo

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  resize();
  window.addEventListener('resize', resize);
}

function resize() {
  const c = $('gl'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth * dpr, h = c.clientHeight * dpr;
  c.width = w; c.height = h; gl.viewport(0, 0, w, h);
  // aspect-correct fit (same px/metre on both axes), centred, y up, with margin.
  const fit = (1 - 0.06) * Math.min(w / PITCH_L, h / PITCH_W); // pixels per metre
  xform = [ (fit / w) * 2, (fit / h) * 2, -(fit * PITCH_L / w), -(fit * PITCH_W / h) ];
}

// build flat-colored vertex data: each vertex = [x,y, r,g,b,a, size]
function drawFlat(mode, verts, count, round = false) {
  gl.useProgram(progFlat);
  gl.uniform4fv(gl.getUniformLocation(progFlat, 'uX'), xform);
  gl.uniform1f(gl.getUniformLocation(progFlat, 'uRound'), round ? 1 : 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
  const stride = 7 * 4;
  const aPos = gl.getAttribLocation(progFlat, 'aPos');
  const aCol = gl.getAttribLocation(progFlat, 'aCol');
  const aSz = gl.getAttribLocation(progFlat, 'aSz');
  gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 4, gl.FLOAT, false, stride, 8);
  gl.enableVertexAttribArray(aSz); gl.vertexAttribPointer(aSz, 1, gl.FLOAT, false, stride, 24);
  gl.drawArrays(mode, 0, count);
}
function rect(x0, y0, x1, y1, col) {
  const [r, g, b, a] = col;
  return [x0,y0,r,g,b,a,0, x1,y0,r,g,b,a,0, x1,y1,r,g,b,a,0,
          x0,y0,r,g,b,a,0, x1,y1,r,g,b,a,0, x0,y1,r,g,b,a,0];
}
function line(x0, y0, x1, y1, col) { const [r,g,b,a]=col; return [x0,y0,r,g,b,a,0, x1,y1,r,g,b,a,0]; }

// --- smooth, thick trajectory rendering (WebGL lineWidth>1 is unsupported, so
// we Catmull-Rom densify the polyline and emit it as a triangle ribbon) ---
const toPairs = flat => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
function catmullRom(P, spp = 10) {
  if (!P || P.length < 3) return P || [];
  const at = i => P[Math.max(0, Math.min(P.length - 1, i))], out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < spp; s++) {
      const t = s / spp, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2*p1[0] + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
        0.5 * (2*p1[1] + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
      ]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
// drop near-coincident consecutive points (the DP can repeat a grid cell across
// steps → zero-length segments that inject spurious angles smoothing can't remove)
function dedupe(P, minD = 0.8) {
  if (P.length < 2) return P;
  const o = [P[0]], m2 = minD * minD;
  for (let i = 1; i < P.length; i++) {
    const a = o[o.length - 1], b = P[i];
    if ((a[0]-b[0])**2 + (a[1]-b[1])**2 >= m2) o.push(b);
  }
  if (o.length < 2) o.push(P[P.length - 1]);
  return o;
}
// moving-average low-pass — kills the grid zigzag/near-U-turns in the DP path
// before corner-cutting (Chaikin alone can't remove a ~180° reversal).
function movavg(P, passes = 2) {
  for (let k = 0; k < passes && P.length >= 3; k++) {
    const o = [P[0]];
    for (let i = 1; i < P.length - 1; i++)
      o.push([(P[i-1][0]+P[i][0]+P[i+1][0])/3, (P[i-1][1]+P[i][1]+P[i+1][1])/3]);
    o.push(P[P.length - 1]); P = o;
  }
  return P;
}
// Chaikin corner-cutting — rounds a quantized polyline (e.g. the grid-snapped
// predicted path) far better than a spline through the staircase points.
function chaikin(P, iters = 3) {
  for (let k = 0; k < iters && P.length >= 3; k++) {
    const out = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      out.push([a[0]*0.75+b[0]*0.25, a[1]*0.75+b[1]*0.25]);
      out.push([a[0]*0.25+b[0]*0.75, a[1]*0.25+b[1]*0.75]);
    }
    out.push(P[P.length - 1]);
    P = out;
  }
  return P;
}
// resample a polyline to N points evenly spaced by arc length (for point-wise
// temporal smoothing of the hurricane tracks across frames)
function resample(P, N) {
  if (P.length < 2) return P;
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i-1] + Math.hypot(P[i][0]-P[i-1][0], P[i][1]-P[i-1][1]));
  const total = cum[cum.length - 1] || 1, out = [];
  for (let k = 0; k < N; k++) {
    const d = total * k / (N - 1);
    let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i-1]) / Math.max(cum[i] - cum[i-1], 1e-6);
    out.push([P[i-1][0] + (P[i][0]-P[i-1][0])*t, P[i-1][1] + (P[i][1]-P[i-1][1])*t]);
  }
  return out;
}
// triangle-ribbon vertices for a polyline, width `w` metres, colour `col`
function ribbon(pts, w, col) {
  const hw = w / 2, [r, g, b, a] = col, v = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    let dx = x1 - x0, dy = y1 - y0; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy * hw, ny = dx * hw;
    v.push(x0+nx,y0+ny,r,g,b,a,0, x0-nx,y0-ny,r,g,b,a,0, x1+nx,y1+ny,r,g,b,a,0,
           x0-nx,y0-ny,r,g,b,a,0, x1-nx,y1-ny,r,g,b,a,0, x1+nx,y1+ny,r,g,b,a,0);
  }
  return new Float32Array(v);
}
function drawRibbon(pts, w, col) { if (pts.length > 1) drawFlat(gl.TRIANGLES, ribbon(pts, w, col), 6 * (pts.length - 1)); }
// arrowheads at fixed arc-length spacing from the start — distance-anchored, so
// they stay put as the path is recomputed (vs sliding with point-fraction placement)
function drawArrowsSpaced(pts, sizeM, col, spacingM) {
  if (pts.length < 2) return;
  const [r, g, b, a] = col, v = []; let acc = spacingM;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i], [px, py] = pts[i - 1];
    let dx = x - px, dy = y - py; const L = Math.hypot(dx, dy); if (L < 1e-6) continue;
    acc += L;
    if (acc >= spacingM) {
      acc = 0; const ux = dx / L, uy = dy / L;
      const bx = x - ux * sizeM, by = y - uy * sizeM, nx = -uy * sizeM * 0.6, ny = ux * sizeM * 0.6;
      v.push(x,y,r,g,b,a,0, bx+nx,by+ny,r,g,b,a,0, bx-nx,by-ny,r,g,b,a,0);
    }
  }
  if (v.length) drawFlat(gl.TRIANGLES, new Float32Array(v), v.length / 7);
}
// arrowhead triangles along a polyline, pointing in travel direction
function drawArrows(pts, sizeM, col, n = 4) {
  if (pts.length < 2) return;
  const [r, g, b, a] = col, v = [], step = Math.max(1, Math.floor(pts.length / (n + 1)));
  for (let i = step; i < pts.length; i += step) {
    const [x, y] = pts[i], [px, py] = pts[i - 1];
    let dx = x - px, dy = y - py; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const bx = x - dx * sizeM, by = y - dy * sizeM, nx = -dy * sizeM * 0.6, ny = dx * sizeM * 0.6;
    v.push(x,y,r,g,b,a,0, bx+nx,by+ny,r,g,b,a,0, bx-nx,by-ny,r,g,b,a,0);
  }
  if (v.length) drawFlat(gl.TRIANGLES, new Float32Array(v), v.length / 7);
}

// static pitch markings (corner-origin metric coords)
function pitchLines() {
  const L = PITCH_L, W = PITCH_W, col = [1, 1, 1, 0.5], v = [];
  const P = (...a) => v.push(...line(...a, col));
  P(0,0, L,0); P(L,0, L,W); P(L,W, 0,W); P(0,W, 0,0);   // border
  P(L/2,0, L/2,W);                                       // halfway
  // penalty + goal boxes (both ends)
  const pbY0 = W/2 - 20.16, pbY1 = W/2 + 20.16, gbY0 = W/2 - 9.16, gbY1 = W/2 + 9.16;
  P(0,pbY0, 16.5,pbY0); P(16.5,pbY0, 16.5,pbY1); P(16.5,pbY1, 0,pbY1);
  P(L,pbY0, L-16.5,pbY0); P(L-16.5,pbY0, L-16.5,pbY1); P(L-16.5,pbY1, L,pbY1);
  P(0,gbY0, 5.5,gbY0); P(5.5,gbY0, 5.5,gbY1); P(5.5,gbY1, 0,gbY1);
  P(L,gbY0, L-5.5,gbY0); P(L-5.5,gbY0, L-5.5,gbY1); P(L-5.5,gbY1, L,gbY1);
  // centre circle (polyline)
  const cx=L/2, cy=W/2, rr=9.15, seg=40;
  for (let i=0;i<seg;i++){ const a0=i/seg*2*Math.PI, a1=(i+1)/seg*2*Math.PI;
    P(cx+rr*Math.cos(a0),cy+rr*Math.sin(a0), cx+rr*Math.cos(a1),cy+rr*Math.sin(a1)); }
  return new Float32Array(v);
}
let pitchVerts = null;

function quiverVerts() {
  const { nx, ny, h } = grid, v = [];
  let maxs = 1e-6;
  for (let k=0;k<nx*ny;k++){ const s=Math.hypot(driftField.bx[k],driftField.by[k]); if(s>maxs)maxs=s; }
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++){
    const k=j*nx+i, bx=driftField.bx[k], by=driftField.by[k];
    const s=Math.hypot(bx,by); if(s<1e-3) continue;
    const cx=(i+0.5)*h, cy=(j+0.5)*h, sc=Math.min(h*0.9, s*1.2)/s;
    const ex=cx+bx*sc, ey=cy+by*sc;
    const a=0.25+0.55*(s/maxs), col=[0.5,0.85,1.0,a];
    v.push(...line(cx,cy,ex,ey,col));
    // arrowhead
    const ang=Math.atan2(by,bx), hl=Math.min(h*0.35, s*0.4+0.3);
    v.push(...line(ex,ey, ex-hl*Math.cos(ang-0.4), ey-hl*Math.sin(ang-0.4), col));
    v.push(...line(ex,ey, ex-hl*Math.cos(ang+0.4), ey-hl*Math.sin(ang+0.4), col));
  }
  return new Float32Array(v);
}
let quiverCache = null;

// upload a normalized Uint8 grid into a texture
function uploadTex(tex, u8) {
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,grid.nx,grid.ny,gl.RED,gl.UNSIGNED_BYTE, u8);
}
const uploadDensity = u8 => uploadTex(densTex, u8);   // wake layer
const uploadForward = u8 => uploadTex(fwdTex, u8);    // forward layer

const quadV = new Float32Array([0,0, PITCH_L,0, PITCH_L,PITCH_W, 0,0, PITCH_L,PITCH_W, 0,PITCH_W]);

// draw one density texture over the pitch with the given colormap (0=turbo,1=ice)
function drawTexLayer(tex, cmap) {
  gl.useProgram(progTex);
  gl.uniform4fv(gl.getUniformLocation(progTex,'uX'), xform);
  gl.uniform2f(gl.getUniformLocation(progTex,'uP'), PITCH_L, PITCH_W);
  gl.uniform1f(gl.getUniformLocation(progTex,'uGam'), +$('gam').value);
  gl.uniform1i(gl.getUniformLocation(progTex,'uCmap'), cmap);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(gl.getUniformLocation(progTex,'uTex'),0);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadV, gl.DYNAMIC_DRAW);
  const aP = gl.getAttribLocation(progTex,'aPos');
  gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP,2,gl.FLOAT,false,0,0);
  gl.drawArrays(gl.TRIANGLES,0,6);
}

// draw the current scene. `ballTime` = match-relative time of the ball marker;
// `pathA`..`pathB` = match-relative window to draw the actual ball path over;
// `travB` = (forward mode) end of the "traveled" gold segment, else null.
function render(ballTime, pathA, pathB, travB) {
  gl.clearColor(0.047, 0.059, 0.078, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  drawFlat(gl.TRIANGLES, new Float32Array(rect(0,0,PITCH_L,PITCH_W,[0.094,0.227,0.137,1])), 6);

  // density layer(s) — textures uploaded by the caller. In single mode only the
  // wake/propagation texture exists; the forward cone is a follow-mode overlay.
  const lyr = (mode === 'follow') ? layer : (layer === 'value' ? 'value' : 'wake');
  if (lyr === 'wake') drawTexLayer(densTex, 0);                    // turbo (past)
  if (lyr === 'forward' || lyr === 'game') drawTexLayer(fwdTex, 1); // ice (future)
  if (lyr === 'value') drawTexLayer(valTex, 0); // turbo (ideal xG potential)

  if (!pitchVerts) pitchVerts = pitchLines();
  drawFlat(gl.LINES, pitchVerts, pitchVerts.length/7);

  if ($('quiver').checked) {
    if (!quiverCache) quiverCache = quiverVerts();
    drawFlat(gl.LINES, quiverCache, quiverCache.length/7);
  }
  if ($('optfield').checked && valFlat) { const ov = optFieldVerts(); drawFlat(gl.LINES, ov, ov.length/7); }

  // players (the state of play the field is conditioned on): possessor warm, others cool
  if ($('players').checked) {
    const pl = playersAt(ballTime);
    if (pl) {
      const pt = possAt(ballTime), dpr2 = Math.min(devicePixelRatio, 2), v = [];
      const att = [1.0, 0.6, 0.2, 0.95], def = [0.45, 0.62, 0.92, 0.9];
      const push = (arr, col) => { for (const [x, y] of arr) v.push(x, y, col[0], col[1], col[2], col[3], 9 * dpr2); };
      push(pl[0], pt === 0 ? att : def);
      push(pl[1], pt === 1 ? att : def);
      drawFlat(gl.POINTS, new Float32Array(v), v.length / 7, true);
    }
  }

  const sampleBall = (a, b, st) => { const p = []; for (let tt = a; tt <= b + 1e-6; tt += st) p.push(ballAt(tt)); return p; };

  // recent ball path over [pathA, pathB] (grey) — hidden on the forward-only layer
  if ($('future').checked && pathB > pathA && lyr === 'wake') {
    drawRibbon(catmullRom(sampleBall(pathA, pathB, 0.2)), 0.45, [0.55,0.62,0.72,0.5]);
    if (travB != null && travB > pathA)
      drawRibbon(catmullRom(sampleBall(pathA, travB, 0.2)), 0.55, [1,0.9,0.3,0.9]);
  }

  // future ACTUAL ball trajectory (cyan), its own length slider
  if ($('futureactual').checked) {
    const base = (mode === 'follow') ? playhead : t0Now, fh = +$('actlen').value;
    const pts = catmullRom(sampleBall(base, base + fh, 0.2));
    drawRibbon(pts, 0.6, [0.15,0.85,1.0,0.9]); drawArrows(pts, 2.4, [0.15,0.85,1.0,1], 4);
  }

  // evolved-player ghosts (receding-horizon game): future player positions, fading with time
  if (lyr === 'game' && ghostSnaps && ghostSnaps.length) {
    const dpr2 = Math.min(devicePixelRatio, 2);
    for (let s = 1; s < ghostSnaps.length; s++) {
      const a = 0.5 * (1 - s / ghostSnaps.length), v = [];
      for (const [x, y] of ghostSnaps[s]) v.push(x, y, 0.7, 0.75, 0.8, a, 5 * dpr2);
      drawFlat(gl.POINTS, new Float32Array(v), v.length / 7, true);
    }
  }

  // decided defensive tasks at the playhead (Part 3): line = defender → its
  // decided target, colour = action (legend in the game controls)
  if (lyr === 'game' && defDecisions && defDecisions.length) {
    const dpr2 = Math.min(devicePixelRatio, 2), dots = [];
    for (const d of defDecisions) {
      const c = DEC_COLORS[d.a];
      if (Math.hypot(d.tx - d.x, d.ty - d.y) > 0.6)
        drawRibbon([[d.x, d.y], [d.tx, d.ty]], 0.32, c);
      dots.push(d.tx, d.ty, c[0], c[1], c[2], c[3], 6 * dpr2);
    }
    drawFlat(gl.POINTS, new Float32Array(dots), dots.length / 7, true);
  }

  // PREDICTED tracks — hurricane fan: the K most-likely paths, thicker/brighter for
  // higher probability; small fixed-spacing arrows on the single most-likely track.
  if (lyr === 'game' && predPaths && predPaths.length) {
    let best = 0;
    for (let i = 1; i < predPaths.length; i++) if (predPaths[i].w > predPaths[best].w) best = i;
    for (const o of predPaths)
      drawRibbon(o.pts, 0.3 + 0.6 * o.w, [1.0, 0.35, 0.9, 0.28 + 0.6 * o.w]);
    drawArrowsSpaced(predPaths[best].pts, 1.3, [1.0, 0.55, 0.95, 1], 9);
  }

  const dpr = Math.min(devicePixelRatio, 2);
  const [bx,by] = ballAt(ballTime);
  drawFlat(gl.POINTS, new Float32Array([
    bx,by, 1,1,1,1, 16*dpr,
    bx,by, 0.05,0.05,0.07,1, 9*dpr,
  ]), 2, true);
  // seed marker (single-mode launch point, or a clicked forward-sim seed)
  if (mode === 'single' || manualSeed)
    drawFlat(gl.POINTS, new Float32Array([seed[0],seed[1], 0.22,0.88,0.65,0.95, 12*dpr]), 1, true);
}

// ------------------------------------------------------------------- loop/UI
let mode = 'follow';               // 'follow' (wake follows the ball) | 'single' (one propagation)
let layer = 'forward';             // view: 'forward' | 'game' | 'wake' | 'value'
let playing = true, lastTs = 0, clock = 0;
let playhead = 0, acc = 0, dtSim = 0.125, wakeNorm = 1e-6, wakeU8 = null, wakeFlat = null;
let fwdAccum = null, fwdU8 = null, fwdNorm = 1e-6, fwdDirty = true;

// --- single mode: seed one PDF and propagate it forward ---
function singleReseed() {
  t0Now = +$('t0').value;
  seed = ballAt(t0Now);
  propagate(seed[0], seed[1], +$('hz').value);
  clock = 0;
}

// normalize a linear density buffer to Uint8 via log compression + smoothed max
function logNormalize(flat, ncells, scale, normRef, u8) {
  let mx = 1e-9; const lv = new Float32Array(ncells);
  for (let c = 0; c < ncells; c++) { const l = Math.log1p(flat[c] / scale); lv[c] = l; if (l > mx) mx = l; }
  const norm = Math.max(mx, normRef * 0.92);
  const inv = 255 / norm;
  for (let c = 0; c < ncells; c++) u8[c] = Math.min(255, lv[c] * inv) | 0;
  return norm;
}

// --- wake layer: rolling window of forward-props along the recent ball path ---
function uploadWake(ptr) {
  const ncells = grid.nx * grid.ny, flat = f32at(ptr, ncells);
  if (!wakeU8 || wakeU8.length !== ncells) wakeU8 = new Uint8Array(ncells);
  wakeNorm = logNormalize(flat, ncells, 0.0015, wakeNorm, wakeU8);
  wakeFlat = flat.slice();         // keep a copy for mode extraction (view detaches on next wasm call)
  uploadDensity(wakeU8);
  fwdDirty = true; predDirty = true;   // wake moved → forward cone & predicted path are stale
}
// Warm the rolling window at match-relative time `atT` (defaults to the slider).
// IMPORTANT: take the time explicitly — reading it back from the range input
// rounds to the step (0.5s), which can land just *before* an active interval and
// make "skip dead time" re-skip to the same spot forever.
function wakeWarmup(atT) {
  const H = +$('hz').value;
  playhead = (atT !== undefined) ? atT : +$('t0').value;
  dtSim = H / N_FRAMES;
  wakeNorm = 1e-6;
  wasm.march_reset(H, N_FRAMES);
  let ptr = 0;
  for (let k = N_FRAMES - 1; k >= 0; k--) { const [bx, by] = ballAt(playhead - k * dtSim); ptr = wasm.march_step(bx, by); }
  if (ptr) uploadWake(ptr);
  acc = 0;
}
function wakeAdvance() { const [bx, by] = ballAt(playhead); const ptr = wasm.march_step(bx, by); if (ptr) uploadWake(ptr); }

// --- forward layer: top-K modes of the wake density, each forward-propagated ---
// Top-K representative high-density points: greedily take the highest-density
// cells that are at least `minSepM` apart and above a fraction of the peak. (Not
// strict local maxima — the wake is usually a single monotonic ridge with one
// true maximum, so strict maxima would almost always yield K=1. This spreads the
// K seeds along the high-probability ridge instead.)
function extractModes(flat, K, minSepM) {
  const { nx, ny, h } = grid;
  let peak = 0; for (let c = 0; c < flat.length; c++) if (flat[c] > peak) peak = flat[c];
  if (peak <= 0) return [];
  const floor = 0.04 * peak, cand = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = flat[j * nx + i]; if (v > floor) cand.push({ x: (i + 0.5) * h, y: (j + 0.5) * h, w: v });
  }
  cand.sort((a, b) => b.w - a.w);
  const sel = [], s2 = minSepM * minSepM;
  for (const c of cand) { if (sel.length >= K) break;
    if (sel.every(s => (s.x - c.x) ** 2 + (s.y - c.y) ** 2 >= s2)) sel.push(c); }
  return sel;
}
let fwdModes = [], manualSeed = null;
// dynamics-model source: 'emp' | 'kernel' | 'theta' (radio group)
function fieldSrc() {
  return document.querySelector('input[name="fieldsrc"]:checked')?.value || 'kernel';
}
function nashOn() {
  return document.querySelector('input[name="pmodel"]:checked')?.value === 'nash';
}
// state-of-play weight for the current playhead (0 unless we have clear possession)
function stateWeight() {
  if (manualSeed) return 0;
  const w = +$('statew').value;
  return (w > 0 && (possAt(playhead) === 0 || possAt(playhead) === 1)) ? w : 0;
}
// build the instantaneous (player-conditioned) field in wasm from the defenders.
// MUST be called before staging seeds — set_state consumes the STAGE buffer.
function applyState(sw, gdir) {
  if (sw <= 0) return;
  const pl = playersAt(playhead); if (!pl) return;
  const pt = possAt(playhead);
  const src = fieldSrc();
  if (src === 'theta') {
    // v2 parametric interaction field: time-to-intercept control, pass-lane
    // transport, control volatility — needs positions AND velocities
    const arr = playersV5(playhead);
    if (arr) {
      const [bx, by] = ballAt(playhead), v = ballVel(playhead);
      stageFloats(arr); wasm.set_state_v3(22, gdir, bx, by, v[0], v[1]);
      return;
    }
  }
  if (src === 'kernel') {
    // learned kernel: all 22 players (x, y, is_defender, is_detected=1 full-vis)
    const arr = new Float32Array(22 * 4);
    let w = 0;
    for (const tm of [0, 1]) for (const [x, y] of pl[tm]) { arr[w++] = x; arr[w++] = y; arr[w++] = (tm !== pt) ? 1 : 0; arr[w++] = 1; }
    const v = ballVel(playhead), cvx = gdir < 0 ? -v[0] : v[0];  // canonical ball velocity
    stageFloats(arr); wasm.set_state_learned(22, gdir, cvx, v[1]);
  } else {
    // heuristic pitch-control: defenders only
    const def = pl[1 - pt];
    const arr = new Float32Array(def.length * 2);
    for (let i = 0; i < def.length; i++) { arr[i*2] = def[i][0]; arr[i*2+1] = def[i][1]; }
    stageFloats(arr); wasm.set_state(def.length, gdir);
  }
}

// ------------------- defender decisions overlay (Part 3, defend.rs) -------
// The decided defensive tasks at the playhead: every defender softmaxes over
// {man-mark, zone, lane-block, press, cover} by threat denied. Runs the same
// defense_decide the standalone demo uses — microseconds per round, so it
// re-decides as the playhead moves. Action colours match the Part 3 figures.
const DEC_COLORS = [
  [0.97, 0.44, 0.44, 0.95], // 0 man-mark  #f87171
  [0.39, 0.45, 0.55, 0.80], // 1 zone      #64748b
  [0.98, 0.75, 0.14, 0.95], // 2 lane      #fbbf24
  [0.96, 0.45, 0.71, 0.95], // 3 press     #f472b6
  [0.65, 0.55, 0.98, 0.95], // 4 cover     #a78bfa
];
let defDecisions = null, defDecT = -1e9;
function updateDecisions() {
  const box = $('g-decisions');
  if (layer !== 'game' || !box || !box.checked || !wasm.defense_decide) { defDecisions = null; return; }
  if (defDecisions && Math.abs(playhead - defDecT) < 0.04) return;
  const arr = playersV5(playhead);
  if (!arr) { defDecisions = null; return; }
  const gdir = dirAt(playhead) || 1;
  const [bx, by] = ballAt(playhead), v = ballVel(playhead);
  stageFloats(arr);
  const ptr = wasm.defense_decide(22, gdir, bx, by, v[0], v[1]);
  if (!ptr) { defDecisions = null; return; }
  const out = f32at(ptr, wasm.defense_out_len());
  const n = out[0] | 0, ds = [];
  let k = 1;
  for (let i = 0; i < n; i++, k += 9) {
    if (out[k] < 0) continue; // attacker
    ds.push({ x: arr[i * 5], y: arr[i * 5 + 1], a: out[k] | 0, tx: out[k + 1], ty: out[k + 2] });
  }
  defDecisions = ds; defDecT = playhead;
}

// ------------------------- λ(t) hazard strip (coupled v2, Addendum C) ------
// Propagates BOTH possession densities from the live playhead state and plots
// the conditional per-side goal intensities λ_A/λ_B (goals/min given no goal
// yet) and the no-goal survival S over a late-game window. P(A)+P(B)+S(T)=1.
let muBusy = false, muLastT = -1e9;
function updateMu(force) {
  const on = $('mupanel').checked;
  if (!on) { $('muinfo').textContent = 'off'; drawMuStrip([0, 0], [0, 0], [0, 0]); return; }
  if (muBusy || (!force && Math.abs(playhead - muLastT) < 0.75)) return;
  const info = $('muinfo');
  const pt = possAt(playhead);
  if (pt !== 0 && pt !== 1) { info.textContent = 'no clear possession at playhead'; return; }
  const arr = playersV5(playhead);
  if (!arr) { info.textContent = 'no player telemetry at playhead'; return; }
  const gdir = dirAt(playhead) || 1;
  const [bx, by] = ballAt(playhead), v = ballVel(playhead);
  muBusy = true; muLastT = playhead;
  info.textContent = 'propagating coupled λ(t)…';
  setTimeout(() => {
    try {
      stageFloats(arr); wasm.set_state_v3(22, gdir, bx, by, v[0], v[1]);
      const ptr = wasm.mu_state(80, 90, 0.5);
      const len = wasm.mu_state_len();
      if (!ptr || !len) { info.textContent = 'λ readout unavailable'; return; }
      const out = f32at(ptr, len);
      const n = out[0] | 0;
      const lamA = out.slice(1 + n, 1 + 2 * n), lamB = out.slice(1 + 2 * n, 1 + 3 * n);
      const surv = out.slice(1 + 3 * n, 1 + 4 * n);
      const pA = out[1 + 5 * n], pB = out[2 + 5 * n];
      drawMuStrip(lamA, lamB, surv);
      info.innerHTML =
        `next goal by 90′ — <span style="color:var(--teal)">poss ${(pA * 100).toFixed(0)}%</span>` +
        ` · <span style="color:var(--pink)">opp ${(pB * 100).toFixed(0)}%</span>` +
        ` · none ${((1 - pA - pB) * 100).toFixed(0)}%`;
    } finally { muBusy = false; }
  }, 15);
}
function drawMuStrip(lamA, lamB, surv) {
  const c = $('mustrip'), g = c.getContext('2d'), n = lamA.length;
  const r = c.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(r.width * dpr)), bh = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height;
  g.clearRect(0, 0, W, H);

  const ML = 34, MR = 26, MT = 16, MB = 16;             // margins: λ axis | S axis
  const PW = W - ML - MR, PH = H - MT - MB;
  const idle = Math.max(...lamA, ...lamB) <= 1e-6;

  let peak = 1e-6; for (let i = 0; i < n; i++) peak = Math.max(peak, lamA[i], lamB[i]);
  const yMax = idle ? 1 : peak * 1.15;
  const X = i => ML + PW * i / Math.max(1, n - 1);
  const YL = v => MT + PH * (1 - v / yMax);             // λ scale (left)
  const YR = v => MT + PH * (1 - v);                    // S scale (right, 0..1)

  // grid + ticks: x every 2 minutes over 80'→90', y quarters
  g.strokeStyle = 'rgba(120,150,170,.14)'; g.lineWidth = 1;
  g.fillStyle = 'rgba(150,170,190,.7)'; g.font = '9px ui-monospace,monospace';
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (let m = 0; m <= 10; m += 2) {
    const x = ML + PW * m / 10;
    g.beginPath(); g.moveTo(x, MT); g.lineTo(x, MT + PH); g.stroke();
    g.fillText(`${80 + m}'`, x, MT + PH + 3);
  }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let q = 0; q <= 4; q++) {
    const y = MT + PH * q / 4;
    g.beginPath(); g.moveTo(ML, y); g.lineTo(ML + PW, y); g.stroke();
    g.fillText((yMax * (1 - q / 4)).toFixed(yMax < 0.1 ? 3 : 2), ML - 4, y);
  }
  g.textAlign = 'left';
  for (let q = 0; q <= 4; q += 2)
    g.fillText((1 - q / 4).toFixed(1), ML + PW + 4, MT + PH * q / 4);

  // axis names
  g.fillStyle = 'rgba(150,170,190,.85)'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('λ  goals/min', ML, MT - 5);
  g.textAlign = 'right'; g.fillText('S', ML + PW + MR - 2, MT - 5);

  if (idle) {
    g.fillStyle = 'rgba(160,180,200,.55)'; g.textAlign = 'center';
    g.fillText('enable "compute at playhead" during clear possession', ML + PW / 2, MT + PH / 2);
    return;
  }

  // smoothed series: polyline through quadratic midpoints, optional area fill
  const path = (ys, Y) => {
    g.beginPath();
    g.moveTo(X(0), Y(ys[0]));
    for (let i = 1; i < n; i++) {
      const xm = (X(i - 1) + X(i)) / 2, ym = (Y(ys[i - 1]) + Y(ys[i])) / 2;
      g.quadraticCurveTo(X(i - 1), Y(ys[i - 1]), xm, ym);
    }
    g.lineTo(X(n - 1), Y(ys[n - 1]));
  };
  const area = (ys, Y, fill) => {
    path(ys, Y);
    g.lineTo(X(n - 1), MT + PH); g.lineTo(X(0), MT + PH); g.closePath();
    g.fillStyle = fill; g.fill();
  };
  const stroke = (ys, Y, color, width, dash) => {
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash || []);
    path(ys, Y); g.stroke(); g.setLineDash([]);
  };
  area(lamA, YL, 'rgba(0,240,255,.10)');
  area(lamB, YL, 'rgba(255,43,214,.10)');
  stroke(surv, YR, 'rgba(255,255,255,.55)', 1, [5, 4]);
  stroke(lamA, YL, '#00f0ff', 1.8);
  stroke(lamB, YL, '#ff2bd6', 1.8);

  // legend, top-right inside the plot
  g.font = '9px ui-monospace,monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
  const leg = [['#00f0ff', 'λ poss'], ['#ff2bd6', 'λ opp'], ['rgba(255,255,255,.7)', 'S(τ)']];
  let lx = ML + PW - 150;
  for (const [col, name] of leg) {
    g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath(); g.moveTo(lx, MT + 8); g.lineTo(lx + 12, MT + 8); g.stroke();
    g.fillStyle = 'rgba(220,235,245,.85)'; g.fillText(name, lx + 16, MT + 8);
    lx += 52;
  }
}

// ideal-W value field: V(x)=max future xG attacking toward the current possession dir
let valFlat = null, valU8 = null, valGdir = null, valVmax = null;
function needValue() { return layer === 'value' || $('optfield').checked; }
let valHz = null, valMode = null;
function computeValue() {
  const gdir = dirAt(playhead) || 1, vmax = +$('vmax').value, nc = grid.nx * grid.ny;
  const hz = +$('vhz').value, mode = $('vmode').checked ? 1 : 0;  // 1 = P(shot), 0 = xG
  const iters = hz >= 30 ? 400 : Math.max(1, Math.round(hz / 0.3)); // 30 = ∞ (whole possession)
  // ideal play under LEARNED dynamics when the learned kernel is on and possession is clear
  const useL = fieldSrc() !== 'emp' && (possAt(playhead) === 0 || possAt(playhead) === 1);
  if (useL) applyState(1, gdir);   // builds the learned field into INSTANT
  const ptr = wasm.value_field(gdir, vmax, iters, mode, useL ? 1 : 0);
  valHz = hz; valMode = mode;
  if (!ptr) return;
  valFlat = f32at(ptr, nc).slice();
  let mx = 1e-9; for (const v of valFlat) if (v > mx) mx = v;
  if (!valU8 || valU8.length !== nc) valU8 = new Uint8Array(nc);
  const inv = 255 / mx;
  for (let c = 0; c < nc; c++) valU8[c] = Math.min(255, valFlat[c] * inv) | 0;
  uploadTex(valTex, valU8);
  valGdir = gdir; valVmax = vmax;
}
// optimal-flow quiver: arrows along ∇V (the ideal attacking directions)
function optFieldVerts() {
  const { nx, ny, h } = grid, v = [], idx = (i, j) => j * nx + i;
  let mxg = 1e-9;
  const gx = (i, j) => valFlat[idx(Math.min(i+1,nx-1), j)] - valFlat[idx(Math.max(i-1,0), j)];
  const gy = (i, j) => valFlat[idx(i, Math.min(j+1,ny-1))] - valFlat[idx(i, Math.max(j-1,0))];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const m = Math.hypot(gx(i,j), gy(i,j)); if (m > mxg) mxg = m; }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let dx = gx(i, j), dy = gy(i, j); const m = Math.hypot(dx, dy); if (m < mxg * 0.03) continue;
    dx /= m; dy /= m; const cx = (i+0.5)*h, cy = (j+0.5)*h, len = h*0.9;
    const ex = cx + dx*len, ey = cy + dy*len, a = 0.35 + 0.6*(m/mxg), col = [1, 0.95, 0.5, a];
    v.push(...line(cx, cy, ex, ey, col));
    const ang = Math.atan2(dy, dx), hl = h*0.4;
    v.push(...line(ex, ey, ex - hl*Math.cos(ang-0.4), ey - hl*Math.sin(ang-0.4), col));
    v.push(...line(ex, ey, ex - hl*Math.cos(ang+0.4), ey - hl*Math.sin(ang+0.4), col));
  }
  return new Float32Array(v);
}

function computeForward() {
  const K = +$('kmodes').value, ncells = grid.nx * grid.ny;
  let momX = 0, momY = 0;
  const momScale = +$('mom').value;
  const withMom = () => { if (momScale > 0) { const v = ballVel(playhead); momX = v[0] * momScale; momY = v[1] * momScale; } };
  if (manualSeed) {
    // forward-simulate from a clicked point: single seed, no momentum (unknown velocity)
    fwdModes = [{ x: manualSeed[0], y: manualSeed[1], w: 1 }];
  } else {
    // seed directly from the ball, let the tree branch
    const b = ballAt(playhead);
    fwdModes = [{ x: b[0], y: b[1], w: 1 }];
    withMom();
  }
  const gdir = manualSeed ? 0 : dirAt(playhead), pull = +$('attackbias').value, sw = stateWeight();
  applyState(sw, gdir);                              // build instantaneous field FIRST (uses STAGE)
  const seeds = new Float32Array(K * 3);            // then stage seeds (overwrites STAGE)
  fwdModes.forEach((m, i) => { if (i < K) { seeds[i*3]=m.x; seeds[i*3+1]=m.y; seeds[i*3+2]=m.w; } });
  stageFloats(seeds);
  const depth = +$('depth').value;
  const tauMom = (momX || momY) ? 1.5 : 0;
  const rp = wasm.forward_tree(K, depth, +$('fhz').value, depth > 1 ? 24 : 48, momX, momY, tauMom, gdir, pull, sw);
  if (!rp) return;
  const flat = f32at(rp, ncells);
  const a = +$('trail').value;                     // EWMA: small a = longer trails
  if (!fwdAccum || fwdAccum.length !== ncells) fwdAccum = new Float32Array(ncells);
  for (let c = 0; c < ncells; c++) fwdAccum[c] = a * flat[c] + (1 - a) * fwdAccum[c];
  if (!fwdU8 || fwdU8.length !== ncells) fwdU8 = new Uint8Array(ncells);
  fwdNorm = logNormalize(fwdAccum, ncells, 1e-4, fwdNorm, fwdU8);
  uploadForward(fwdU8);
  fwdDirty = false;
}

let predPaths = null, predDirty = true, ghostSnaps = null, gameOccPrev = null;

// Game-driven UNIFIED forward: one forward_game call produces the PDF (occupancy)
// AND the K tracks AND the player ghosts — all from the same evolving-player field,
// so the heatmap and the trajectories agree (no static-vs-game divergence).
function computeGame() {
  const src = manualSeed || ballAt(playhead);
  const momScale = +$('mom').value; let mx = 0, my = 0;
  if (momScale > 0) { const v = ballVel(playhead); mx = v[0] * momScale; my = v[1] * momScale; }
  const gdir = dirAt(playhead) || 1, K = Math.max(1, +$('kmodes').value), nc = grid.nx * grid.ny;
  const pt = possAt(playhead), pl = playersAt(playhead), arr = new Float32Array(22 * 3); let w = 0;
  for (const tm of [0, 1]) for (const [x, y] of pl[tm]) { arr[w++] = x; arr[w++] = y; arr[w++] = (tm !== pt) ? 1 : 0; }
  stageFloats(arr);
  const ptrOcc = wasm.forward_game(src[0], src[1], mx, my, +$('fhz').value, (mx || my) ? 1.5 : 0, gdir, K,
    nashOn() ? 1 : 0, fieldSrc() === 'theta' ? 1 : 0);
  if (!ptrOcc) { fwdDirty = predDirty = false; return; }
  // PDF (occupancy) — cross-frame EWMA damps the per-frame recompute shake during playback
  const occ = f32at(ptrOcc, nc).slice();
  const ea = manualSeed ? 1 : 0.45;
  if (gameOccPrev && gameOccPrev.length === nc) for (let c = 0; c < nc; c++) occ[c] = ea * occ[c] + (1 - ea) * gameOccPrev[c];
  gameOccPrev = occ;
  if (!fwdU8 || fwdU8.length !== nc) fwdU8 = new Uint8Array(nc);
  fwdNorm = logNormalize(occ, nc, 1e-4, fwdNorm, fwdU8); uploadForward(fwdU8); fwdAccum = occ;
  // tracks (from the SAME run)
  const plen = wasm.predicted_path_len(), buf = f32at(wasm.path_out_ptr(), plen);
  const out = []; let idx = 1; const kp = buf[0];
  for (let i = 0; i < kp; i++) { const npts = buf[idx++], wt = buf[idx++], pts = [];
    for (let j = 0; j < npts; j++) { pts.push([buf[idx], buf[idx+1]]); idx += 2; }
    out.push({ w: wt, pts: chaikin(pts, 1) }); }
  // cross-frame smoothing, but ONLY for tracks whose sampled future is the
  // same shape and nearby — a track that re-rolled a different pass (or died
  // earlier) SNAPS to its new path instead of being averaged through the
  // valley between two modes, which used to draw lines the heatmap disowns
  const a = 0.55, SNAP_M = 6;
  if (predPaths && predPaths.length === out.length)
    for (let i = 0; i < out.length; i++) {
      const cp = out[i].pts, pp = predPaths[i].pts;
      if (cp.length !== pp.length) continue;
      let maxd = 0;
      for (let q = 0; q < cp.length; q++)
        maxd = Math.max(maxd, Math.hypot(cp[q][0]-pp[q][0], cp[q][1]-pp[q][1]));
      if (maxd > SNAP_M) continue;
      out[i].w = a*out[i].w + (1-a)*predPaths[i].w;
      for (let q = 0; q < cp.length; q++) { cp[q][0] = a*cp[q][0]+(1-a)*pp[q][0]; cp[q][1] = a*cp[q][1]+(1-a)*pp[q][1]; }
    }
  predPaths = out;
  // ghosts — cross-frame EWMA (by snapshot/player index) so the future-player dots glide
  const gl_ = wasm.pghost_len();
  if (gl_) { const gb = f32at(wasm.pghost_ptr(), gl_), ns = gb[0], npl = gb[1]; let gi = 2; const ng = [];
    for (let s = 0; s < ns; s++) { const sn = []; for (let q = 0; q < npl; q++) { sn.push([gb[gi], gb[gi+1]]); gi += 2; } ng.push(sn); }
    const pg = ghostSnaps;
    if (pg && pg.length === ng.length && pg[0].length === ng[0].length && !manualSeed)
      for (let s = 0; s < ng.length; s++) for (let q = 0; q < ng[s].length; q++) {
        ng[s][q][0] = ea * ng[s][q][0] + (1 - ea) * pg[s][q][0]; ng[s][q][1] = ea * ng[s][q][1] + (1 - ea) * pg[s][q][1]; }
    ghostSnaps = ng; }
  fwdDirty = predDirty = false;
}

function restart() {
  manualSeed = null;   // scrubbing resumes following the ball
  gameOccPrev = null;  // drop game EWMA history on reseed/scrub so it doesn't lag
  if (mode === 'follow') { fwdAccum = null; fwdNorm = 1e-6; fwdDirty = true; if (layer === 'wake') wakeWarmup(); }
  else singleReseed();
}

// advance the playhead by `dsim` seconds of match time, stepping the wake and
// (with "skip dead time") jumping over stoppages to the next live play.
function advancePlayback(dsim) {
  acc += dsim; let guard = 0;
  while (acc >= dtSim && guard++ < 256) {
    acc -= dtSim; playhead += dtSim;
    fwdDirty = true; predDirty = true;   // ball moved → forward products are stale
    if (playhead > ball.tMax) { wakeWarmup(0); break; }                 // wrap to start
    if ($('skip').checked && activeIntervals.length && !inActive(playhead)) {
      wakeWarmup(nextActiveStart(playhead)); break;                     // jump to next live play
    }
    if (layer === 'wake') wakeAdvance();
  }
  // slider/readout are display-only; the rounded value never feeds back into playhead
  $('t0').value = playhead; $('t0v').textContent = (400 + playhead).toFixed(0) + ' s';
}

function frameLoop(ts) {
  const dt = lastTs ? (ts - lastTs) / 1000 : 0; lastTs = ts;
  const speed = +$('spd').value, H = +$('hz').value;

  if (mode === 'follow') {
    if (playing) advancePlayback(dt * speed);
    updateMu(false);
    // game view unifies the forward PDF + tracks + ghosts via one forward_game call
    const pg = layer === 'game' && !manualSeed && (possAt(playhead) === 0 || possAt(playhead) === 1);
    if (pg) { if (fwdDirty || predDirty) computeGame(); }
    else {
      ghostSnaps = null;
      if ((layer === 'forward' || layer === 'game') && fwdDirty) computeForward();
      updateDecisions();
    }
    if (needValue() && (!valFlat || valGdir !== (dirAt(playhead) || 1) || valVmax !== +$('vmax').value)) computeValue();
    render(playhead, playhead - H, playhead, null);
    $('r-t').textContent = H.toFixed(1) + ' s win';
    $('r-mt').textContent = (400 + playhead).toFixed(1) + ' s';
    if (layer === 'game') {
      $('r-mass-label').textContent = 'ball tracks';
      $('r-mass').textContent = `${$('kmodes').value}`;
    } else if (layer === 'forward') {
      $('r-mass-label').textContent = 'tree paths';
      const wdt = wasm.fwd_tree_width ? wasm.fwd_tree_width() : 1;
      $('r-mass').textContent = `${wdt} (K ${$('kmodes').value} × depth ${$('depth').value})`;
    } else {
      $('r-mass-label').textContent = 'fwd modes';
      $('r-mass').textContent = '—';
    }
    $('r-xg').textContent = '—';
    const srcName = { emp: 'empirical', kernel: 'learned kernel', theta: 'θ v2' }[fieldSrc()];
    $('r-model').textContent = `${srcName} · θ ${thetaFitted ? 'FITTED' : 'prior'}`;
    const d = dirAt(playhead); $('r-poss').textContent = d > 0 ? '▶ attacking +x' : d < 0 ? '◀ attacking −x' : '· loose';
    const [bx, by] = ballAt(playhead); $('r-ball').textContent = `${bx.toFixed(1)}, ${by.toFixed(1)}`;
  } else {
    if (playing) clock += dt * speed;
    if (clock > horizonNow) clock = 0;
    const simT = clock, idx = Math.min(N_FRAMES - 1, Math.floor(simT / horizonNow * N_FRAMES));
    uploadDensity(frames[idx]);
    if (needValue() && (!valFlat || valGdir !== (dirAt(playhead) || 1) || valVmax !== +$('vmax').value)) computeValue();
    render(t0Now + simT, t0Now, t0Now + horizonNow, t0Now + simT);
    const [mass, xg] = seriesAt(simT);
    $('r-t').textContent = simT.toFixed(2) + ' s';
    $('r-mt').textContent = (400 + t0Now + simT).toFixed(1) + ' s';
    $('r-mass-label').textContent = 'surviving';
    $('r-mass').textContent = (mass * 100).toFixed(1) + '%';
    $('r-xg').textContent = xg.toFixed(4);
    $('r-poss').textContent = '—';
    const [bx, by] = ballAt(t0Now + simT); $('r-ball').textContent = `${bx.toFixed(1)}, ${by.toFixed(1)}`;
  }
  requestAnimationFrame(frameLoop);
}

// show only the control groups relevant to the current view; the attack-bias
// row also hides under the θ model (there the pull is learned, not a slider)
const VIEW_INFO = {
  forward: 'Heatmap = expected ball dwell-time over the next horizon, players FROZEN at the playhead. Bright ridge = the corridor of play, not the destination.',
  game: 'Same dwell-time heatmap, but the 22 players are SIMULATED forward (grey ghosts) and the field re-derives from their predicted positions. Under the θ model the carrier DECIDES (passes are value-steered jumps — expect MULTIMODAL lobes at receivers) and, since Part 3, so does the DEFENSE: each defender softmaxes over man-mark / zone / lane-block / press / cover by threat denied. Coloured lines = the decided tasks at the playhead; the simulated defenders re-plan the same way as they evolve.',
  wake: 'Heatmap = where the ball has just been (a rolling window into the past). Pure history, no prediction.',
  value: 'Surface = ideal value V(x): expected goal-scoring from having the ball at x under ideal play. The SAME surface (rebuilt per slice, horizon-coupled) steers the pass-decision policy inside forward/game predictions; these sliders restyle only this view.',
};
function updateVis() {
  document.querySelectorAll('#controls [data-views]').forEach(el => {
    el.style.display = el.dataset.views.split(' ').includes(layer) ? '' : 'none';
  });
  const bias = $('biasrow');
  if (bias && layer === 'forward') bias.style.display = fieldSrc() === 'theta' ? 'none' : '';
  $('viewinfo').textContent = VIEW_INFO[layer] || '';
}
// drop every cross-frame artifact so nothing leaks between views/settings
function resetDerived() {
  fwdAccum = null; fwdNorm = 1e-6; fwdDirty = true;
  predDirty = true; predPaths = null; ghostSnaps = null; gameOccPrev = null;
  defDecisions = null; defDecT = -1e9;
  valFlat = null;
}

function setMode(m) {
  mode = m;
  $('t0label').textContent = m === 'follow' ? 'playhead (match time)' : 'start (match time)';
  $('hzlabel').textContent = m === 'follow' ? 'wake window' : 'horizon';
  restart();
}

function wireUI() {
  // collapsible controls (keeps the pitch visible on mobile); collapsed by default on narrow screens
  const controls = $('controls');
  const relayout = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  // the GL canvas was sized before this collapse changes the stage height —
  // re-run resize() or the backing store stays stale and the pitch stretches
  if (window.innerWidth <= 760) { controls.classList.add('collapsed'); relayout(); }
  $('toggle').onclick = () => { controls.classList.toggle('collapsed'); relayout(); };

  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '⏸ pause' : '▶ play';
    if (playing && manualSeed) { manualSeed = null; fwdDirty = true; } };  // resume → stop the click-sim, follow again
  $('t0').max = Math.floor(ball.tMax);
  const sync = (id, fmt) => { const el = $(id), v = $(id + 'v'); const f = () => v.textContent = fmt(+el.value); el.addEventListener('input', f); f(); };
  sync('t0', x => (400 + x).toFixed(0) + ' s'); sync('hz', x => x.toFixed(1) + ' s');
  sync('spd', x => x.toFixed(1) + '×'); sync('gam', x => x.toFixed(2));
  sync('fhz', x => x.toFixed(1) + ' s'); sync('kmodes', x => x.toFixed(0)); sync('trail', x => x.toFixed(2));
  sync('depth', x => x.toFixed(0)); sync('mom', x => x.toFixed(2));
  sync('actlen', x => x.toFixed(1) + ' s');
  sync('attackbias', x => x.toFixed(1)); sync('statew', x => x.toFixed(2)); sync('vmax', x => x.toFixed(1));
  sync('vhz', x => x >= 30 ? '∞' : x.toFixed(0) + ' s');
  ['vmax', 'vhz'].forEach(id => $(id).addEventListener('input', () => { valFlat = null; }));
  $('vmode').addEventListener('change', () => { valFlat = null; });
  // value-horizon ↔ forward-horizon coupling (the same coupling the pass-
  // decision policy uses internally); hand-moving vhz breaks the link
  const syncVhz = () => {
    if (!$('vlink').checked) return;
    $('vhz').value = Math.min(30, +$('fhz').value);
    $('vhzv').textContent = +$('vhz').value >= 30 ? '∞' : (+$('vhz').value).toFixed(0) + ' s';
    valFlat = null;
  };
  $('vlink').addEventListener('change', syncVhz);
  $('fhz').addEventListener('input', syncVhz);
  $('vhz').addEventListener('input', () => { $('vlink').checked = false; });
  syncVhz();
  // dynamics-model radio: invalidates every state-conditioned product
  document.querySelectorAll('input[name="fieldsrc"]').forEach(el =>
    el.addEventListener('change', () => { resetDerived(); updateVis(); updateMu(true); }));
  document.querySelectorAll('input[name="pmodel"]').forEach(el =>
    el.addEventListener('change', () => { resetDerived(); }));
  $('mupanel').addEventListener('change', () => updateMu(true));
  ['attackbias', 'statew'].forEach(id => $(id).addEventListener('input', () => { fwdAccum = null; fwdNorm = 1e-6; fwdDirty = true; predDirty = true; }));
  $('follow').addEventListener('change', e => setMode(e.target.checked ? 'follow' : 'single'));
  $('t0').addEventListener('input', restart);
  $('hz').addEventListener('input', restart);
  $('layer').addEventListener('change', e => {
    layer = e.target.value;
    resetDerived();
    updateVis();
    if (layer === 'wake') wakeWarmup();
  });
  const gdec = $('g-decisions');
  if (gdec) gdec.addEventListener('change', () => { defDecT = -1e9; defDecisions = null; });
  // deep link: ?view=forward|game|wake|value opens that view directly
  {
    const qv = new URLSearchParams(location.search).get('view');
    if (qv && ['forward', 'game', 'wake', 'value'].includes(qv)) {
      $('layer').value = qv;
      $('layer').dispatchEvent(new Event('change'));
    }
  }
  // recompute the forward cone when its parameters change
  ['fhz', 'kmodes', 'depth'].forEach(id => $(id).addEventListener('input', () => { fwdAccum = null; fwdNorm = 1e-6; fwdDirty = true; predDirty = true; }));
  ['trail', 'mom'].forEach(id => $(id).addEventListener('input', () => { fwdDirty = true; predDirty = true; }));
  updateVis();
  // click pitch to re-seed and forward-simulate from that point (current params)
  $('gl').addEventListener('click', ev => {
    const r = $('gl').getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width, py = 1 - (ev.clientY - r.top) / r.height;
    const pt = [px * PITCH_L, py * PITCH_W];
    if (mode === 'single') { seed = pt; propagate(pt[0], pt[1], +$('hz').value); clock = 0; return; }
    // follow mode: drop a forward-sim seed, pause, and show the forward cone
    manualSeed = pt; seed = pt; playing = false; $('play').textContent = '▶ play';
    if (layer === 'wake' || layer === 'value') { layer = 'forward'; $('layer').value = 'forward'; updateVis(); }
    fwdAccum = null; fwdNorm = 1e-6; fwdDirty = true; predDirty = true;
  });
}

(async function main() {
  try {
    await loadWasm();
    await Promise.all([loadField(), loadBall()]);
    const kernelOk = await loadKernel();
    await loadParams();
    if (!kernelOk) {
      // kernel unavailable → fall back to the empirical field and disable the radio
      $('fs-kernel').disabled = true;
      if (fieldSrc() === 'kernel') $('fs-emp').checked = true;
    }
    computeActiveIntervals();
    initGL();
    pitchVerts = pitchLines();
    wireUI();
    setMode($('follow').checked ? 'follow' : 'single');
    $('play').textContent = '⏸ pause';
    requestAnimationFrame(frameLoop);

    // debug hook (used for headless verification; harmless in normal use)
    window.__mf = {
      get grid() { return grid; },
      get frames() { return frames; },
      get series() { return series; },
      get lastXg() { return lastXg; },
      get seed() { return seed; },
      get mode() { return mode; },
      get layer() { return layer; },
      get playhead() { return playhead; },
      get wasm() { return wasm; },
      get wakeFlat() { return wakeFlat; },
      get fwdModes() { return fwdModes; },
      get fwdAccum() { return fwdAccum; },
      get manualSeed() { return manualSeed; },
      get activeIntervals() { return activeIntervals; },
      get predPaths() { return predPaths; },
      get ghostSnaps() { return ghostSnaps; },
      get valFlat() { return valFlat; },
      inActive, nextActiveStart, advancePlayback, computeValue, computeGame,
      ballAt, ballVel, dirAt, possAt, playersAt, propagate, render, resize, setMode, wakeWarmup, wakeAdvance,
      extractModes, computeForward,
      setManual: (x, y) => { manualSeed = [x, y]; layer = 'forward'; fwdAccum = null; fwdNorm = 1e-6; fwdDirty = true; },
      setLayer: (l) => { layer = l; fwdAccum = null; fwdNorm = 1e-6; fwdDirty = true; },
      gl: () => gl,
      setT0: (v) => { $('t0').value = v; restart(); },
      forceSize: (w, h) => { const c = $('gl'); c.style.width = w + 'px'; c.style.height = h + 'px';
        Object.defineProperty(c, 'clientWidth', { value: w, configurable: true });
        Object.defineProperty(c, 'clientHeight', { value: h, configurable: true }); resize(); },
    };
  } catch (e) { fail(e.message || String(e)); }
})();
