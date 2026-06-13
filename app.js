import { EdgeDetector }      from './EdgeDetector.js';
import { Skeletonizer }      from './Skeletonizer.js';
import { SkeletonGraph }     from './SkeletonGraph.js';
import { PathPlanner }       from './PathPlanner.js';
import { BezierPathBuilder } from './BezierPathBuilder.js';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_SIZE = 600;

// ── Pipeline state ─────────────────────────────────────────────────────
let W = 0, H = 0;
const S = {
  srcCanvas:  null,
  imageData:  null,
  gray:       null,
  leveled:    null,
  canny:      null,
  skeleton:   null,
  graph:      null,
  eulerPath:  null,
  smoothed:   null,
  svgString:  null,
};

// ── User params (all spatial params are fractions of diagonal d=√(W²+H²)) ──
const P = {
  blackPoint:       0,
  whitePoint:       255,
  gamma:            1.0,
  detailLevel:      0.75,
  blurSigmaFrac:    0.006,
  cannyHighFrac:    0.15,
  cannyLowFrac:     0.05,
  closeFrac:        0.003,
  minBranchFrac:    0.020,
  silhouetteBonus:  2.0,
  maxJumpFrac:      0.08,
  splineTension:    0.5,
  sampleFrac:       0.015,
  strokeWidth:      1.0,
};
const P_DEFAULTS = { ...P };
const P_STORAGE_KEY = 'singleline_params';

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
    num: '04', name: 'CANNY EDGES',
    desc: 'Gaussian blur → Sobel → non-max suppression → hysteresis — finds real gradient edges',
    controls: [
      { key: 'detailLevel',   label: 'Detail',    min: 0,    max: 1,    step: 0.05,  firstAffected: 3,
        derive(v) {
          const lerp = (a, b, t) => a + (b - a) * t;
          setParam('blurSigmaFrac', parseFloat(lerp(0.015, 0.003, v).toFixed(3)));
          setParam('cannyHighFrac', parseFloat(lerp(0.35,  0.08,  v).toFixed(2)));
          setParam('cannyLowFrac',  parseFloat((lerp(0.35, 0.08,  v) * 0.35).toFixed(2)));
          setParam('minBranchFrac', parseFloat(lerp(0.04,  0.01,  v).toFixed(3)));
        },
      },
      { key: 'blurSigmaFrac', label: 'Blur σ',   min: 0,    max: 0.02, step: 0.001, firstAffected: 3 },
      { key: 'cannyHighFrac', label: 'High Thr',  min: 0.05, max: 0.5,  step: 0.01,  firstAffected: 3 },
      { key: 'cannyLowFrac',  label: 'Low Thr',   min: 0.01, max: 0.2,  step: 0.01,  firstAffected: 3 },
    ],
    auto() {
      if (!S.leveled) return;
      const { highFrac, lowFrac } = EdgeDetector.autoCannyFracs(S.leveled, W, H);
      setParam('cannyHighFrac', parseFloat(highFrac.toFixed(2)));
      setParam('cannyLowFrac',  parseFloat(lowFrac.toFixed(2)));
      scheduleRun(3);
    },
    run() {
      if (!S.leveled) return;
      const sigma  = P.blurSigmaFrac * diag();
      const blurred = EdgeDetector.gaussianBlur(S.leveled, W, H, sigma);
      const nms     = EdgeDetector.nonMaxSuppression(blurred, W, H);
      S.canny       = EdgeDetector.hysteresis(nms, W, H, P.cannyLowFrac, P.cannyHighFrac);
    },
    draw(canvas) {
      if (!S.canny) return;
      putImageData(canvas, EdgeDetector.toImageData(S.canny, W, H));
    },
    stat() {
      if (!S.canny) return '—';
      let n = 0; for (const v of S.canny) if (v) n++;
      const pxEq = (P.blurSigmaFrac * diag()).toFixed(1);
      return `${n.toLocaleString()} edge px · σ≈${pxEq}px`;
    },
  },
  {
    num: '05', name: 'SKELETON',
    desc: 'morphological closing → Zhang-Suen thinning — fills gaps then reduces to 1-pixel centerlines',
    controls: [
      { key: 'closeFrac', label: 'Close Radius', min: 0, max: 0.01, step: 0.001, firstAffected: 4 },
    ],
    run() {
      if (!S.canny) { S.skeleton = null; return; }
      const closed = EdgeDetector.morphClose(S.canny, W, H, P.closeFrac * diag());
      S.skeleton = Skeletonizer.thin(closed, W, H);
    },
    draw(canvas) {
      if (!S.skeleton) return;
      putImageData(canvas, EdgeDetector.toImageData(S.skeleton, W, H));
    },
    stat() {
      if (!S.skeleton || !S.canny) return '—';
      const before = [...S.canny].filter(Boolean).length;
      const after  = [...S.skeleton].filter(Boolean).length;
      const pct    = before ? Math.round((1 - after / before) * 100) : 0;
      return `${after.toLocaleString()} px (↓${pct}% from ${before.toLocaleString()})`;
    },
  },
  {
    num: '06', name: 'JUNCTION GRAPH',
    desc: 'classify junctions & endpoints, trace branches, prune short ones, weight silhouette edges',
    controls: [
      { key: 'minBranchFrac',   label: 'Min Branch',      min: 0.005, max: 0.05,  step: 0.005, firstAffected: 5 },
      { key: 'silhouetteBonus', label: 'Silhouette Bonus', min: 0,     max: 5,     step: 0.5,   firstAffected: 5 },
    ],
    run() {
      if (!S.skeleton || !S.leveled) { S.graph = null; return; }
      S.graph = SkeletonGraph.build(S.skeleton, W, H, S.leveled,
        { minBranchFrac: P.minBranchFrac, silhouetteBonus: P.silhouetteBonus });
    },
    draw(canvas) {
      if (!S.graph) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.lineCap = 'round';
      S.graph.edges.forEach((e, i) => {
        ctx.strokeStyle = e.isSilhouette
          ? '#ff9944'
          : `hsl(${(i * 137.5) % 360}, 70%, 60%)`;
        ctx.beginPath();
        ctx.moveTo(e.pixels[0].x, e.pixels[0].y);
        for (let j = 1; j < e.pixels.length; j++) ctx.lineTo(e.pixels[j].x, e.pixels[j].y);
        ctx.stroke();
      });
    },
    stat() {
      if (!S.graph) return '—';
      const sil = S.graph.edges.filter(e => e.isSilhouette).length;
      const pxEq = (P.minBranchFrac * diag()).toFixed(0);
      return `${S.graph.nodes.length} nodes · ${S.graph.edges.length} edges · ${sil} silhouette · min≈${pxEq}px`;
    },
  },
  {
    num: '07', name: 'EULER PATH',
    desc: 'MST + Chinese Postman + Hierholzer — single continuous route through all branches',
    controls: [
      { key: 'maxJumpFrac', label: 'Max Jump', min: 0.01, max: 0.3, step: 0.01, firstAffected: 6 },
    ],
    run() {
      if (!S.graph) { S.eulerPath = []; return; }
      S.eulerPath = PathPlanner.solve(S.graph, { maxJumpFrac: P.maxJumpFrac, width: W, height: H });
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
      { key: 'splineTension', label: 'Tension',     min: 0,     max: 1,    step: 0.05,  firstAffected: 8 },
      { key: 'sampleFrac',   label: 'Sample Rate', min: 0.002, max: 0.02, step: 0.001, firstAffected: 7 },
    ],
    run() {
      if (!S.eulerPath?.length) { S.smoothed = []; return; }
      const step = P.sampleFrac * diag();
      const resampled = BezierPathBuilder.resample(S.eulerPath, step);
      S.smoothed = BezierPathBuilder.smooth(resampled, 4);
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
      const pts  = S.smoothed.filter(p => p !== null).length;
      const pxEq = (P.sampleFrac * diag()).toFixed(1);
      return `${pts.toLocaleString()} pts · step≈${pxEq}px`;
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
      if (!S.smoothed?.length) { S.svgString = ''; return; }
      const d = BezierPathBuilder.build(S.smoothed, P.splineTension);
      S.svgString = makeSVG(d, W, H, P.strokeWidth);
    },
    draw() {},
    stat() { return S.svgString ? `${(S.svgString.length / 1024).toFixed(1)} KB` : '—'; },
  },
];

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

function makeSVG(d, w, h, sw) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="white"/>
<path d="${d}" fill="none" stroke="black" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
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

  for (let i = fromIdx; i < STEPS.length; i++) {
    if (runId !== id) return;
    const step = STEPS[i];
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

  STEPS.forEach((step, i) => {
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
        const btn = document.createElement('button');
        btn.className = 'btn-export';
        btn.textContent = 'Export SVG';
        btn.disabled = true;
        btn.addEventListener('click', exportSVG);
        ctrl.appendChild(btn);
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
}

init();
