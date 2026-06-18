import { EdgeDetector }      from './EdgeDetector.js';
import { Thresholder }       from './Thresholder.js';
import { ContourTracer }     from './ContourTracer.js';
import { ContourSimplifier } from './ContourSimplifier.js';
import { PathPlanner }       from './PathPlanner.js';
import { BezierPathBuilder } from './BezierPathBuilder.js';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_SIZE = 600;

// ── Pipeline state ─────────────────────────────────────────────────────
let W = 0, H = 0;
const S = {
  srcCanvas:   null,
  imageData:   null,
  gray:        null,
  leveled:     null,
  binary:      null,
  rawContours: null,
  contours:    null,
  eulerPath:   null,
  smoothed:    null,
  svgString:   null,
};

// ── Strokes-mode state (parallel to S; only one mode active at a time) ──
const SS = {
  leveled:      null,
  massBinary:   null,
  massContours: null,
  primary:      null,
  edges:        null,
  edgeMag:      null,
  candidates:   null,
  selected:     null,
};
let mode = 'pipeline'; // 'pipeline' | 'strokes'

const lerp = (a, b, t) => a + (b - a) * t;

// ── User params (all spatial params are fractions of diagonal d=√(W²+H²)) ──
const P = {
  blackPoint:      0,
  whitePoint:      200,
  gamma:           0.8,
  threshold:       128,
  minContourFrac:   0.001,
  minArcLengthFrac: 0.03,
  simplification:   2.5,
  maxJumpFrac:     0.06,
  smoothIter:      1,
  tension:         0.5,
  strokeWidth:     1.0,
  // ── Strokes mode ──
  strokeCount:       1,    // 1–3: primary + up to 2 complementary
  strokeAbstraction: 0.5,  // 0 = hug contour, 1 = bold sweeping curves
  edgeSensitivity:   0.5,  // 0 = only strongest edges, 1 = admit more
};
const P_DEFAULTS = { ...P };
let multiPath = false;
const layerColors = ['#bbbbbb', '#777777', '#222222']; // [fine, medium, coarse]
let layerThresholds = [85, 127, 170];                  // [fine, medium, coarse] — overwritten by Otsu3 on toggle-ON
let mpSliderDebounce = null;
const P_STORAGE_KEY = 'singleline_params_v4';

function saveParams() {
  localStorage.setItem(P_STORAGE_KEY, JSON.stringify(P));
}

function loadSavedParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(P_STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(P_DEFAULTS)) {
        if (key in saved && typeof saved[key] === 'number' && isFinite(saved[key])) {
          P[key] = saved[key];
        }
      }
    }
  } catch {}
}

function setParam(key, value) {
  P[key] = value;
  const slider = document.querySelector(`.ctrl-slider[data-key="${key}"]`);
  if (!slider) return;
  slider.value = value;
  const valEl = slider.closest('.ctrl-row')?.querySelector('.ctrl-val');
  if (valEl) valEl.textContent = value;
  saveParams();
}

function resetParams() {
  Object.assign(P, P_DEFAULTS);
  localStorage.removeItem(P_STORAGE_KEY);
  document.querySelectorAll('.ctrl-slider').forEach(slider => {
    const key = slider.dataset.key;
    if (!(key in P_DEFAULTS)) return;
    slider.value = P_DEFAULTS[key];
    const valEl = slider.closest('.ctrl-row')?.querySelector('.ctrl-val');
    if (valEl) valEl.textContent = P_DEFAULTS[key];
  });
  if (S.srcCanvas) runFrom(0);
}

// ── Step definitions ────────────────────────────────────────────────────
function diag() { return Math.sqrt(W * W + H * H) || 1; }

const STEPS = [
  {
    num: '01', name: 'ORIGINAL IMAGE',
    desc: 'source image scaled to fit processing canvas',
    controls: [],
    run() {},
    draw(canvas) {
      if (!S.srcCanvas) return;
      canvas.width = W; canvas.height = H;
      canvas.getContext('2d').drawImage(S.srcCanvas, 0, 0);
    },
    stat() { return S.srcCanvas ? `${W} × ${H} px` : '—'; },
  },
  {
    num: '02', name: 'GRAYSCALE',
    desc: '0.299 R + 0.587 G + 0.114 B (luminosity)',
    controls: [],
    run() { S.gray = EdgeDetector.toGrayscale(S.imageData); },
    draw(canvas) {
      if (!S.gray) return;
      putImageData(canvas, EdgeDetector.toImageData(S.gray, W, H));
    },
    stat() { return S.gray ? 'luminosity weighted' : '—'; },
  },
  {
    num: '03', name: 'LEVELS',
    desc: 'remap tonal range — raise black point, lower white point, adjust gamma',
    controls: [
      { key: 'blackPoint', label: 'Black Pt',  min: 0,    max: 200,  step: 1,    firstAffected: 2 },
      { key: 'whitePoint', label: 'White Pt',  min: 55,   max: 255,  step: 1,    firstAffected: 2 },
      { key: 'gamma',      label: 'Gamma',     min: 0.25, max: 4.0,  step: 0.05, firstAffected: 2 },
    ],
    auto() {
      if (!S.gray) return;
      const { blackPoint, whitePoint } = EdgeDetector.analyzeHistogram(S.gray);
      setParam('blackPoint', blackPoint);
      setParam('whitePoint', whitePoint);
      scheduleRun(2);
    },
    run() { S.leveled = S.gray ? EdgeDetector.levels(S.gray, P.blackPoint, P.whitePoint, P.gamma) : null; },
    draw(canvas) {
      if (!S.leveled) return;
      putImageData(canvas, EdgeDetector.toImageData(S.leveled, W, H));
    },
    stat() { return S.leveled ? `bp ${P.blackPoint}  wp ${P.whitePoint}  γ ${P.gamma.toFixed(2)}` : '—'; },
  },
  {
    num: '04', name: 'THRESHOLD',
    desc: 'Otsu binarisation — dark pixels become foreground regions for contour tracing',
    controls: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, firstAffected: 3 },
    ],
    auto() {
      if (!S.leveled) return;
      setParam('threshold', Thresholder.otsu(S.leveled));
      scheduleRun(3);
    },
    run() {
      S.binary = S.leveled ? Thresholder.apply(S.leveled, P.threshold) : null;
    },
    draw(canvas) {
      if (!S.binary) return;
      putImageData(canvas, EdgeDetector.toImageData(S.binary, W, H));
    },
    stat() {
      if (!S.binary) return '—';
      let n = 0; for (const v of S.binary) if (v) n++;
      return `${n.toLocaleString()} fg px · t=${P.threshold}`;
    },
  },
  {
    num: '05', name: 'CONTOUR TRACE',
    desc: 'border-following on binary image — one ordered polygon per region boundary',
    controls: [],
    run() {
      S.rawContours = S.binary ? ContourTracer.trace(S.binary, W, H) : [];
    },
    draw(canvas) {
      if (!S.rawContours?.length) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.lineCap = 'round';
      S.rawContours.forEach((c, i) => {
        ctx.strokeStyle = `hsl(${(i * 137.5) % 360}, 70%, 60%)`;
        ctx.beginPath();
        ctx.moveTo(c[0].x, c[0].y);
        for (let j = 1; j < c.length; j++) ctx.lineTo(c[j].x, c[j].y);
        ctx.closePath();
        ctx.stroke();
      });
    },
    stat() {
      if (!S.rawContours) return '—';
      const pts = S.rawContours.reduce((s, c) => s + c.length, 0);
      return `${S.rawContours.length} contours · ${pts.toLocaleString()} pts`;
    },
  },
  {
    num: '06', name: 'FILTER + SIMPLIFY',
    desc: 'drop small contours · Ramer-Douglas-Peucker — reduces to clean sparse polylines',
    controls: [
      { key: 'minContourFrac',   label: 'Min Area',   min: 0,   max: 0.005, step: 0.0001, firstAffected: 5 },
      { key: 'minArcLengthFrac', label: 'Min Arc',    min: 0,   max: 0.15,  step: 0.005,  firstAffected: 5 },
      { key: 'simplification',   label: 'Simplify ε', min: 0.5, max: 15,    step: 0.5,    firstAffected: 5 },
    ],
    run() {
      if (!S.rawContours?.length) { S.contours = []; return; }
      const minArea      = P.minContourFrac * W * H;
      const minArcLength = P.minArcLengthFrac * diag();
      const filtered     = ContourSimplifier.filter(S.rawContours, minArea, minArcLength);
      const simplified   = ContourSimplifier.simplify(filtered, P.simplification);
      S.contours         = ContourSimplifier.sortByLength(simplified);
    },
    draw(canvas) {
      if (!S.contours?.length) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.lineCap = 'round';
      S.contours.forEach((c, i) => {
        ctx.strokeStyle = `hsl(${(i * 137.5) % 360}, 70%, 60%)`;
        ctx.beginPath();
        ctx.moveTo(c[0].x, c[0].y);
        for (let j = 1; j < c.length; j++) ctx.lineTo(c[j].x, c[j].y);
        ctx.stroke();
      });
    },
    stat() {
      if (!S.contours) return '—';
      const pts = S.contours.reduce((s, c) => s + c.length, 0);
      return `${S.contours.length} contours · ${pts.toLocaleString()} pts`;
    },
  },
  {
    num: '07', name: 'EULER PATH',
    desc: 'MST + Chinese Postman + Hierholzer — single continuous route through all branches',
    controls: [
      { key: 'maxJumpFrac', label: 'Max Jump', min: 0.01, max: 0.3, step: 0.01, firstAffected: 6 },
    ],
    run() {
      if (!S.contours?.length) { S.eulerPath = []; return; }
      S.eulerPath = PathPlanner.solve(S.contours, { maxJumpFrac: P.maxJumpFrac, width: W, height: H });
    },
    draw(canvas) {
      if (!S.eulerPath) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      drawGradient(ctx, S.eulerPath, 1);
    },
    stat() {
      if (!S.eulerPath) return '—';
      const pts  = S.eulerPath.filter(p => p !== null).length;
      const gaps = S.eulerPath.filter(p => p === null).length;
      const pxEq = (P.maxJumpFrac * diag()).toFixed(0);
      return `${pts.toLocaleString()} pts · ${gaps} pen-up${gaps !== 1 ? 's' : ''} · max jump≈${pxEq}px`;
    },
  },
  {
    num: '08', name: 'SMOOTH SPLINE',
    desc: 'arc-length subsampling + Catmull-Rom spline — smooth curve through skeleton path',
    controls: [
      { key: 'smoothIter', label: 'Smooth Iter', min: 0, max: 8, step: 1,   firstAffected: 7 },
      { key: 'tension',    label: 'Tension',     min: 0, max: 1, step: 0.05, firstAffected: 7 },
    ],
    run() {
      if (!S.eulerPath?.length) { S.smoothed = []; return; }
      S.smoothed = BezierPathBuilder.smooth(S.eulerPath, P.smoothIter);
    },
    draw(canvas) {
      if (!S.smoothed) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.lineCap = 'round';
      ctx.beginPath();
      let penDown = false;
      for (const p of S.smoothed) {
        if (p === null) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    },
    stat() {
      if (!S.smoothed) return '—';
      const pts = S.smoothed.filter(p => p !== null).length;
      return `${pts.toLocaleString()} pts`;
    },
  },
  {
    num: '09', name: 'SINGLE LINE OUTPUT',
    desc: 'Catmull-Rom cubic Bézier SVG — one continuous stroke from start to end',
    isSVG: true,
    controls: [
      { key: 'strokeWidth', label: 'Stroke Width', min: 0.5, max: 4, step: 0.5, firstAffected: 8 },
    ],
    run() {
      if (!S.leveled) { S.svgString = ''; return; }
      if (multiPath) {
        const layers = layerThresholds.map((t, i) => ({ d: runLayer(S.leveled, t), color: layerColors[i] }));
        S.svgString = makeSVG(layers, W, H, P.strokeWidth);
      } else {
        if (!S.smoothed?.length) { S.svgString = ''; return; }
        const d = BezierPathBuilder.build(S.smoothed, P.tension);
        S.svgString = makeSVG([{ d, color: 'black' }], W, H, P.strokeWidth);
      }
    },
    draw() {},
    stat() { return S.svgString ? `${(S.svgString.length / 1024).toFixed(1)} KB` : '—'; },
  },
];

// ── Strokes-mode step definitions ────────────────────────────────────────
const STROKE_STEPS = [
  {
    num: '01', name: 'SOURCE',
    desc: 'grayscale + levels — shared front end',
    controls: [
      { key: 'blackPoint', label: 'Black Pt', min: 0,    max: 200, step: 1,    firstAffected: 0 },
      { key: 'whitePoint', label: 'White Pt', min: 55,   max: 255, step: 1,    firstAffected: 0 },
      { key: 'gamma',      label: 'Gamma',    min: 0.25, max: 4.0, step: 0.05, firstAffected: 0 },
    ],
    run() {
      if (!S.imageData) { SS.leveled = null; return; }
      const gray = EdgeDetector.toGrayscale(S.imageData);
      SS.leveled = EdgeDetector.levels(gray, P.blackPoint, P.whitePoint, P.gamma);
    },
    draw(canvas) {
      if (!SS.leveled) return;
      putImageData(canvas, EdgeDetector.toImageData(SS.leveled, W, H));
    },
    stat() { return SS.leveled ? `bp ${P.blackPoint}  wp ${P.whitePoint}  γ ${P.gamma.toFixed(2)}` : '—'; },
  },
  {
    num: '02', name: 'TONAL MASS',
    desc: 'largest dark region boundary → primary silhouette loop',
    controls: [
      { key: 'threshold', label: 'Threshold', min: 0, max: 255, step: 1, firstAffected: 1 },
    ],
    auto() {
      if (!SS.leveled) return;
      setParam('threshold', Thresholder.otsu(SS.leveled));
      scheduleRun(1);
    },
    run() {
      if (!SS.leveled) { SS.massContours = []; SS.primary = null; return; }
      SS.massBinary   = Thresholder.apply(SS.leveled, P.threshold);
      const raw       = ContourTracer.trace(SS.massBinary, W, H);
      SS.massContours = ContourSimplifier.sortByLength(raw);
      SS.primary      = SS.massContours[0] || null;
    },
    draw(canvas) {
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      (SS.massContours || []).forEach(c => {
        if (c.length < 2) return;
        ctx.strokeStyle = 'rgba(120,120,140,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c[0].x, c[0].y);
        for (let j = 1; j < c.length; j++) ctx.lineTo(c[j].x, c[j].y);
        ctx.stroke();
      });
      if (SS.primary) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(SS.primary[0].x, SS.primary[0].y);
        for (let j = 1; j < SS.primary.length; j++) ctx.lineTo(SS.primary[j].x, SS.primary[j].y);
        ctx.stroke();
      }
    },
    stat() { return SS.primary ? `primary ${SS.primary.length} pts · t=${P.threshold}` : '—'; },
  },
];

function getSteps() { return mode === 'strokes' ? STROKE_STEPS : STEPS; }

// ── Drawing helpers ────────────────────────────────────────────────────
function putImageData(canvas, imageData) {
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
}

function drawGradient(ctx, pts, lineWidth = 1) {
  // Split at null markers so we never draw across pen-up gaps
  const segments = [];
  let cur = [];
  for (const p of pts) {
    if (p === null) { if (cur.length) segments.push(cur); cur = []; }
    else cur.push(p);
  }
  if (cur.length) segments.push(cur);

  const total = segments.reduce((s, seg) => s + seg.length, 0);
  if (total < 2) return;

  ctx.lineWidth = lineWidth;
  ctx.lineCap   = 'round';

  let drawn = 0;
  for (const seg of segments) {
    if (seg.length < 2) { drawn += seg.length; continue; }
    // colour by midpoint position in overall chain
    const t = (drawn + seg.length / 2) / total;
    ctx.strokeStyle = `hsl(${280 - t * 220}, 80%, 62%)`;
    ctx.beginPath();
    ctx.moveTo(seg[0].x, seg[0].y);
    for (let i = 1; i < seg.length; i++) ctx.lineTo(seg[i].x, seg[i].y);
    ctx.stroke();
    drawn += seg.length;
  }
}

function makeSVG(layers, w, h, sw) {
  const paths = layers.map(({ d, color }) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="white"/>
${paths}
</svg>`;
}

function runLayer(leveled, threshold) {
  const binary   = Thresholder.apply(leveled, threshold);
  const raw      = ContourTracer.trace(binary, W, H);
  const minArea  = P.minContourFrac * W * H;
  const filtered = ContourSimplifier.filter(raw, minArea);
  const contours = ContourSimplifier.simplify(filtered, P.simplification);
  const euler    = PathPlanner.solve(contours, { maxJumpFrac: P.maxJumpFrac, width: W, height: H });
  const smoothed = BezierPathBuilder.smooth(euler, P.smoothIter);
  return BezierPathBuilder.build(smoothed, P.tension);
}

// ── Run control ────────────────────────────────────────────────────────
let runId = 0;

let debounceTimer  = null;
let pendingFromIdx = Infinity;

function scheduleRun(fromIdx) {
  pendingFromIdx = Math.min(pendingFromIdx, fromIdx);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const idx  = pendingFromIdx;
    pendingFromIdx = Infinity;
    runFrom(idx);
  }, 1500);
}

async function runFrom(fromIdx) {
  const id = ++runId;
  setStatus('processing…', true);

  for (let i = fromIdx; i < getSteps().length; i++) {
    if (runId !== id) return;
    const step = getSteps()[i];
    const card = document.getElementById(`step-${i}`);
    if (!card) { console.warn(`Step card #step-${i} not found — skipping`); continue; }

    card.classList.add('running');
    card.classList.remove('done');
    setTime(i, '…');
    addSpinner(i);

    await tick();
    if (runId !== id) return;

    const t0 = performance.now();
    try {
      await step.run();
    } catch (e) {
      console.error(`Step ${i} (${step.name}) failed:`, e);
    }
    const ms = performance.now() - t0;

    removeSpinner(i);

    if (step.isSVG) {
      console.log(`SVG step: smoothed=${S.smoothed?.length ?? 'null'} pts, svgString=${S.svgString?.length ?? 'null'} chars`);
      renderSVG(i);
    } else {
      const canvas = document.querySelector(`#step-${i} canvas`);
      if (canvas) step.draw(canvas);
    }

    card.classList.remove('running');
    card.classList.add('done');
    setTime(i, ms);
    setStat(i, step.stat());
  }

  setStatus('ready', false);
}

function tick() { return new Promise(r => setTimeout(r, 0)); }

// ── Image loading ──────────────────────────────────────────────────────
async function loadFile(file) {
  const img = await loadImage(file);

  // Scale to MAX_SIZE
  const scale = Math.min(1, MAX_SIZE / Math.max(img.width, img.height));
  W = Math.round(img.width  * scale);
  H = Math.round(img.height * scale);

  const offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  const ctx = offscreen.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  S.srcCanvas = offscreen;
  S.imageData = ctx.getImageData(0, 0, W, H);

  // Auto-detect threshold for the new image before running pipeline
  const gray = EdgeDetector.toGrayscale(S.imageData);
  const leveled = EdgeDetector.levels(gray, P.blackPoint, P.whitePoint, P.gamma);
  setParam('threshold', Thresholder.otsu(leveled));

  showPipeline();
  await runFrom(0);
}

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = rej;
    img.src = url;
  });
}

// ── UI helpers ─────────────────────────────────────────────────────────
function setStatus(text, active) {
  const b = document.getElementById('statusBadge');
  b.textContent = text;
  b.className = `status-badge${active ? ' active' : ''}`;
}

function setTime(idx, ms) {
  const el = document.querySelector(`#step-${idx} .step-time`);
  if (!el) return;
  if (ms === '…') { el.textContent = '…'; el.className = 'step-time'; return; }
  const s = ms < 10 ? `${ms.toFixed(1)}ms` : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms/1000).toFixed(2)}s`;
  el.textContent = s;
  el.className = `step-time ${ms < 200 ? 'fast' : ms > 2000 ? 'slow' : ''}`;
}

function setStat(idx, text) {
  const el = document.querySelector(`#step-${idx} .step-stat`);
  if (el) el.textContent = text;
}

function addSpinner(idx) {
  const body = document.querySelector(`#step-${idx} .step-body`);
  if (!body) return;
  const div = document.createElement('div');
  div.className = 'spin-overlay';
  div.innerHTML = '<div class="spin-dot"></div>';
  div.id = `spin-${idx}`;
  body.appendChild(div);
}

function removeSpinner(idx) {
  const el = document.getElementById(`spin-${idx}`);
  if (el) el.remove();
}

function renderSVG(idx) {
  const body = document.querySelector(`#step-${idx} .step-body`);
  if (!body) return;
  let wrap = body.querySelector('.svg-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'svg-wrap'; body.appendChild(wrap); }
  if (S.svgString) {
    wrap.innerHTML = S.svgString;
  } else {
    wrap.style.cssText = 'padding:60px;text-align:center;color:#aaa;font-family:monospace;font-size:11px;background:#f8f8f8;width:100%';
    wrap.textContent = 'no output — lower the threshold or reduce min contour length';
  }

  const btn = document.querySelector(`#step-${idx} .btn-export`);
  if (btn) btn.disabled = !S.svgString;
}

// ── UI creation ────────────────────────────────────────────────────────
function createStepCards() {
  const pipeline = document.getElementById('pipeline');
  pipeline.innerHTML = '';

  getSteps().forEach((step, i) => {
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'conn';
      conn.innerHTML = '<div class="conn-line"></div><div class="conn-arrow">▾</div>';
      pipeline.appendChild(conn);
    }

    const card = document.createElement('div');
    card.className = 'step-card';
    card.id = `step-${i}`;

    // Header
    const head = document.createElement('div');
    head.className = 'step-head';
    head.innerHTML = `
      <div class="step-label">
        <span class="step-num">${step.num}</span>
        <span class="step-name">${step.name}</span>
        <span class="step-desc">${step.desc}</span>
      </div>
      <div class="step-meta">
        <span class="step-stat">—</span>
        <span class="step-time">—</span>
      </div>`;
    card.appendChild(head);

    // Body
    const body = document.createElement('div');
    body.className = `step-body${step.isSVG ? ' white-bg' : ''}`;
    if (!step.isSVG) {
      const canvas = document.createElement('canvas');
      canvas.width = 1; canvas.height = 1;
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      placeholder.textContent = 'awaiting image…';
      body.appendChild(placeholder);
      body.appendChild(canvas);
      canvas.style.display = 'none';
    }
    card.appendChild(body);

    // Controls
    if (step.controls.length > 0 || step.isSVG) {
      const ctrl = document.createElement('div');
      ctrl.className = 'step-controls';

      step.controls.forEach(def => {
        const wrap = document.createElement('div');
        wrap.className = 'ctrl';
        const valId = `val-${i}-${def.key}`;
        wrap.innerHTML = `
          <div class="ctrl-label">${def.label}</div>
          <div class="ctrl-row">
            <input class="ctrl-slider" type="range" data-key="${def.key}"
              min="${def.min}" max="${def.max}" step="${def.step}" value="${P[def.key]}">
            <span class="ctrl-val" id="${valId}">${P[def.key]}</span>
          </div>`;
        const slider = wrap.querySelector('input');
        const valEl  = wrap.querySelector(`#${valId}`);
        slider.addEventListener('input', () => {
          P[def.key] = parseFloat(slider.value);
          valEl.textContent = slider.value;
          if (def.derive) def.derive(P[def.key]);
          saveParams();
          scheduleRun(def.firstAffected);
        });
        ctrl.appendChild(wrap);
      });

      if (step.auto) {
        const btn = document.createElement('button');
        btn.className = 'btn-auto';
        btn.textContent = 'Auto';
        btn.addEventListener('click', () => step.auto());
        ctrl.appendChild(btn);
      }

      if (step.isSVG) {
        const exportBtn = document.createElement('button');
        exportBtn.className = 'btn-export';
        exportBtn.textContent = 'Export SVG';
        exportBtn.disabled = true;
        exportBtn.addEventListener('click', exportSVG);
        ctrl.appendChild(exportBtn);

        // Multi-path layer controls (hidden until toggle is on) — pipeline mode only
        if (mode === 'pipeline') {
        const mpDiv = document.createElement('div');
        mpDiv.id = 'multipath-controls';
        mpDiv.style.cssText = 'display:none; flex-wrap:wrap; gap:22px; width:100%; margin-top:4px';

        ['FINE', 'MEDIUM', 'COARSE'].forEach((label, idx) => {
          const defaults = ['#bbbbbb', '#777777', '#222222'];
          const wrap = document.createElement('div');
          wrap.className = 'ctrl';
          wrap.innerHTML = `
            <div class="ctrl-label">${label}</div>
            <div class="ctrl-row">
              <input type="range" id="mp-slider-${idx}" min="0" max="255" step="1" value="${layerThresholds[idx]}"
                style="width:80px">
              <span id="mp-t${idx}" style="font-family:var(--mono);font-size:11px;color:var(--muted);min-width:32px">${layerThresholds[idx]}</span>
              <input type="color" id="mp-color-${idx}" value="${defaults[idx]}"
                style="width:32px;height:24px;cursor:pointer;border:1px solid var(--border);border-radius:4px;padding:1px;background:none">
            </div>`;
          wrap.querySelector(`#mp-slider-${idx}`).addEventListener('input', e => {
            const v = Number(e.target.value);
            layerThresholds[idx] = v;
            const rd = document.getElementById(`mp-t${idx}`);
            if (rd) rd.textContent = v;
            if (idx === 1) {
              P.threshold = v;
              const thr = document.querySelector('#step-3 input[type=range]');
              if (thr) thr.value = v;
            }
            clearTimeout(mpSliderDebounce);
            mpSliderDebounce = setTimeout(() => { if (S.leveled && multiPath) runFrom(8); }, 250);
          });
          wrap.querySelector(`#mp-color-${idx}`).addEventListener('input', e => {
            layerColors[idx] = e.target.value;
            if (S.leveled && multiPath) runFrom(8);
          });
          mpDiv.appendChild(wrap);
        });

        ctrl.appendChild(mpDiv);
        }
      }

      card.appendChild(ctrl);
    }

    pipeline.appendChild(card);
  });
}

function showPipeline() {
  document.getElementById('dropzone').style.display = 'none';
  const pl = document.getElementById('pipeline');
  pl.style.display = 'flex';

  // Reveal canvases, hide placeholders
  document.querySelectorAll('.step-body .placeholder').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.step-body canvas').forEach(el => el.style.display = 'block');
}

function exportSVG() {
  if (!S.svgString) return;
  const blob = new Blob([S.svgString], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'singleline.svg';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Events ─────────────────────────────────────────────────────────────
function init() {
  loadSavedParams();
  createStepCards();

  const fileInput = document.getElementById('fileInput');
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadFile(e.target.files[0]);
  });

  const dz = document.getElementById('dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFile(file);
  });
  dz.addEventListener('click', () => fileInput.click());

  document.getElementById('btnReset').addEventListener('click', resetParams);

  const btnAutoAll = document.getElementById('btnAutoAll');
  if (btnAutoAll) {
    btnAutoAll.addEventListener('click', () => {
      if (!S.leveled) return;
      const { blackPoint, whitePoint } = EdgeDetector.analyzeHistogram(S.gray);
      setParam('blackPoint', blackPoint);
      setParam('whitePoint', whitePoint);
      setParam('threshold', Thresholder.otsu(S.leveled));
      setParam('minContourFrac', 0.0005);
      setParam('simplification', 1.5);
      runFrom(0);
    });
  }

  const btnMultiPath = document.getElementById('btnMultiPath');
  if (btnMultiPath) {
    btnMultiPath.addEventListener('click', () => {
      multiPath = !multiPath;
      btnMultiPath.textContent = `Multi-path: ${multiPath ? 'ON' : 'OFF'}`;
      btnMultiPath.style.color       = multiPath ? 'var(--accent)' : '';
      btnMultiPath.style.borderColor = multiPath ? 'var(--accent)' : '';
      const mpControls = document.getElementById('multipath-controls');
      if (mpControls) mpControls.style.display = multiPath ? 'flex' : 'none';
      if (multiPath && S.leveled) {
        const [t1, t2] = Thresholder.otsu3(S.leveled);
        layerThresholds = [t1, Math.round((t1 + t2) / 2), t2];
        layerThresholds.forEach((t, i) => {
          const sl = document.getElementById(`mp-slider-${i}`);
          if (sl) sl.value = t;
          const rd = document.getElementById(`mp-t${i}`);
          if (rd) rd.textContent = t;
        });
      }
      if (S.leveled) runFrom(8);
    });
  }

  const btnMode = document.getElementById('btnMode');
  if (btnMode) {
    btnMode.addEventListener('click', () => {
      mode = mode === 'pipeline' ? 'strokes' : 'pipeline';
      btnMode.textContent = `Mode: ${mode === 'strokes' ? 'Strokes' : 'Pipeline'}`;
      btnMode.style.color       = mode === 'strokes' ? 'var(--accent)' : '';
      btnMode.style.borderColor = mode === 'strokes' ? 'var(--accent)' : '';
      createStepCards();
      if (S.imageData) { showPipeline(); runFrom(0); }
    });
  }
}

init();
