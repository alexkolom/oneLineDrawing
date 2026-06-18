# Expressive Strokes Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Strokes" mode that renders an image as 1–3 bold, pure black strokes (no tone, no fill) — a primary silhouette line plus up to two complementary feature lines — living alongside the existing 9-step pipeline.

**Architecture:** A new `StrokeExtractor.js` module holds the novel scoring + diversity-selection logic. `app.js` gains a `mode` flag and a parallel `STROKE_STEPS` array; `createStepCards()` and `runFrom()` operate on whichever step array is active. The primary line is the boundary of the largest tonal mass (threshold → contour trace); complementary lines are the top-ranked internal edge segments. Each kept stroke is heavily simplified + smoothed, then rendered as pure black `<path>` elements. All existing pipeline code is untouched.

**Tech Stack:** Vanilla JS ES modules, browser Canvas API, no build step. Node static server on port 3333 (`npm start`). No automated tests — validation is visual through the step cards (project standing rule).

**Important deviation from the spec:** the spec sketched params as a nested `P.strokeMode = {...}` object. The existing persistence (`loadSavedParams`), `setParam`, `resetParams`, and slider wiring all assume **flat numeric keys** on `P` with matching `data-key` slider attributes. To stay compatible we add **flat** keys instead: `strokeCount`, `strokeAbstraction`, `edgeSensitivity` (and reuse existing `blackPoint`, `whitePoint`, `gamma`, `threshold`, `strokeWidth`).

---

## File Structure

- **Create `StrokeExtractor.js`** — pure logic: importance scoring (`√arcLength × avgEdgeStrength × spatialSpread`) and greedy diversity selection. No DOM dependencies; imports only `ContourSimplifier`.
- **Modify `app.js`** — add `mode` flag, `getSteps()` accessor, `SS` stroke-state object, `lerp`/`drawStrokes` helpers, the `STROKE_STEPS` array (built up across tasks), mode-toggle wiring, and a guard so multi-path controls only render in pipeline mode.
- **Modify `index.html`** — add a `Mode: Pipeline` header button.

Reused as-is: `EdgeDetector` (grayscale, levels, Sobel, NMS, hysteresis), `Thresholder` (Otsu, apply), `ContourTracer`, `ContourSimplifier` (filter, arcLength, sortByLength, rdp, simplify), `BezierPathBuilder` (smooth, build).

**One-time setup before validating any task:** start the static server once and leave it running:
```bash
npm start
```
Then open `http://localhost:3333` in a browser. Use any image from `testData/` (e.g. `testData/mm.png`). The server sends `Cache-Control: no-store`, so a normal browser refresh picks up code changes.

---

### Task 1: StrokeExtractor module (scoring + diversity selection)

**Files:**
- Create: `StrokeExtractor.js`

- [ ] **Step 1: Create `StrokeExtractor.js`**

```js
import { ContourSimplifier } from './ContourSimplifier.js';

export class StrokeExtractor {
  // Mean of all points — used as a stroke's location for diversity suppression.
  static centroid(contour) {
    let sx = 0, sy = 0;
    for (const p of contour) { sx += p.x; sy += p.y; }
    return { x: sx / contour.length, y: sy / contour.length };
  }

  // Bounding-box diagonal — rewards strokes that span the subject over
  // strokes curled up in a corner.
  static spatialSpread(contour) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of contour) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return Math.hypot(maxX - minX, maxY - minY);
  }

  // Mean normalised Sobel magnitude (0–255) sampled at each contour point.
  // Faint texture edges score low even when long; crisp structural edges high.
  static avgEdgeStrength(contour, edgeMag, width, height) {
    let sum = 0;
    for (const p of contour) {
      const x = Math.min(width - 1,  Math.max(0, Math.round(p.x)));
      const y = Math.min(height - 1, Math.max(0, Math.round(p.y)));
      sum += edgeMag[y * width + x];
    }
    return sum / contour.length;
  }

  // Importance score. √arcLength (not raw length) keeps a long faint line from
  // always out-ranking a short crisp feature like a dark eye.
  static score(contour, edgeMag, width, height) {
    const len    = ContourSimplifier.arcLength(contour);
    const eStr   = this.avgEdgeStrength(contour, edgeMag, width, height);
    const spread = this.spatialSpread(contour);
    return Math.sqrt(len) * eStr * spread;
  }

  // Greedy selection with spatial suppression so the kept strokes are
  // complementary (different regions) rather than redundant copies of the
  // same dominant edge. Returns up to `count` contours, highest score first.
  static selectDiverse(candidates, count, suppressRadius, edgeMag, width, height) {
    if (count <= 0 || !candidates.length) return [];
    const scored = candidates.map(c => ({
      contour:  c,
      score:    this.score(c, edgeMag, width, height),
      centroid: this.centroid(c),
    }));
    scored.sort((a, b) => b.score - a.score);

    const picked = [];
    for (const cand of scored) {
      if (picked.length >= count) break;
      const tooClose = picked.some(p =>
        Math.hypot(p.centroid.x - cand.centroid.x, p.centroid.y - cand.centroid.y) < suppressRadius);
      if (!tooClose) picked.push(cand);
    }
    return picked.map(p => p.contour);
  }
}
```

- [ ] **Step 2: Verify the module loads and selection suppresses near-duplicates**

Run (from repo root):
```bash
node --input-type=module -e "
import { StrokeExtractor } from './StrokeExtractor.js';
const big  = [{x:10,y:10},{x:190,y:10},{x:190,y:190},{x:10,y:190},{x:10,y:10}]; // spread, centroid ~100,100
const near = [{x:95,y:95},{x:120,y:95},{x:120,y:120}];                          // centroid ~112,103 — close to big
const far  = [{x:10,y:170},{x:60,y:175},{x:60,y:190}];                          // centroid ~43,178 — far
const mag  = new Uint8Array(200*200).fill(255);
const sel  = StrokeExtractor.selectDiverse([big, near, far], 2, 60, mag, 200, 200);
console.log('picked', sel.length);
console.log('centroids', sel.map(c => StrokeExtractor.centroid(c)));
"
```
Expected: `picked 2`, and the two centroids are spatially separated (≈`{x:100,y:100}` and ≈`{x:43,y:178}`) — the `near` triangle is suppressed because its centroid is within radius 60 of the big square's.

- [ ] **Step 3: Commit**

```bash
git add StrokeExtractor.js
git commit -m "feat: add StrokeExtractor — importance scoring + diversity selection"
```

---

### Task 2: Mode scaffolding (toggle + Source step)

Introduces the `mode` flag, the `getSteps()` accessor, the `SS` stroke-state object, the `lerp` helper, a one-step `STROKE_STEPS` array (Source only), the header button, and a guard so multi-path controls stay pipeline-only. After this task, toggling the header button swaps the pipeline for a single "Source" card showing grayscale+levels.

**Files:**
- Modify: `app.js`
- Modify: `index.html`

- [ ] **Step 1: Add the Mode button to the header**

In `index.html`, find the header buttons (around line 326–328):
```html
      <button class="btn-auto" id="btnAutoAll">Auto All</button>
      <button class="btn-reset" id="btnMultiPath">Multi-path: OFF</button>
      <button class="btn-reset" id="btnReset">Reset Settings</button>
```
Replace with (adds `btnMode` first):
```html
      <button class="btn-auto" id="btnAutoAll">Auto All</button>
      <button class="btn-reset" id="btnMode">Mode: Pipeline</button>
      <button class="btn-reset" id="btnMultiPath">Multi-path: OFF</button>
      <button class="btn-reset" id="btnReset">Reset Settings</button>
```

- [ ] **Step 2: Add stroke params to `P` and `P_DEFAULTS`**

In `app.js`, the `P` object ends (lines 37–39):
```js
  smoothIter:      1,
  tension:         0.5,
  strokeWidth:     1.0,
};
```
Replace with:
```js
  smoothIter:      1,
  tension:         0.5,
  strokeWidth:     1.0,
  // ── Strokes mode ──
  strokeCount:       1,    // 1–3: primary + up to 2 complementary
  strokeAbstraction: 0.5,  // 0 = hug contour, 1 = bold sweeping curves
  edgeSensitivity:   0.5,  // 0 = only strongest edges, 1 = admit more
};
```

- [ ] **Step 3: Add `mode`, `SS`, and the `lerp` helper**

In `app.js`, after the `S` state object closes (line 24, `};`) add:
```js

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
```

- [ ] **Step 4: Add the `STROKE_STEPS` array and `getSteps()` accessor**

In `app.js`, immediately after the `STEPS` array closes (line 302, the `];` that ends the array) add:
```js

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
];

function getSteps() { return mode === 'strokes' ? STROKE_STEPS : STEPS; }
```

- [ ] **Step 5: Point `createStepCards()` at the active step array**

In `app.js` `createStepCards()`, the loop header (line 518):
```js
  STEPS.forEach((step, i) => {
```
Replace with:
```js
  getSteps().forEach((step, i) => {
```

- [ ] **Step 6: Guard the multi-path controls so they stay pipeline-only**

In `app.js` `createStepCards()`, the multi-path block begins with a comment + `mpDiv` creation (around line 604–606):
```js
        // Multi-path layer controls (hidden until toggle is on)
        const mpDiv = document.createElement('div');
        mpDiv.id = 'multipath-controls';
```
Replace that comment line with a mode guard that opens a block:
```js
        // Multi-path layer controls (hidden until toggle is on) — pipeline mode only
        if (mode === 'pipeline') {
        const mpDiv = document.createElement('div');
        mpDiv.id = 'multipath-controls';
```
Then find where that block appends `mpDiv` to `ctrl` (around line 642):
```js
        ctrl.appendChild(mpDiv);
      }
```
Replace with (closes the new `if (mode === 'pipeline')` block):
```js
        ctrl.appendChild(mpDiv);
        }
      }
```

- [ ] **Step 7: Point `runFrom()` at the active step array**

In `app.js` `runFrom()`, the loop header (line 382):
```js
  for (let i = fromIdx; i < STEPS.length; i++) {
```
Replace with:
```js
  for (let i = fromIdx; i < getSteps().length; i++) {
```

Then in the same loop, the step lookup (line 385):
```js
    const step = STEPS[i];
```
Replace with:
```js
    const step = getSteps()[i];
```

- [ ] **Step 8: Wire the Mode toggle button in `init()`**

In `app.js` `init()`, after the `btnMultiPath` block ends (the closing `}` of `if (btnMultiPath) { ... }`, around line 730, just before the final `}` of `init`) add:
```js

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
```

- [ ] **Step 9: Validate in the browser**

Refresh `http://localhost:3333`, load `testData/mm.png`. The 9-step pipeline runs as before. Click **Mode: Pipeline** → it becomes **Mode: Strokes** (accent-colored) and the pipeline is replaced by a single **01 SOURCE** card showing the grayscale + levels image, with Black Pt / White Pt / Gamma sliders. Toggle back → the full 9-step pipeline returns. Confirm the multi-path controls do NOT appear in Strokes mode.

- [ ] **Step 10: Commit**

```bash
git add app.js index.html
git commit -m "feat: add Strokes mode scaffolding + Source step"
```

---

### Task 3: Tonal Mass step (primary line)

Adds the second stroke step: threshold the leveled image, trace contours, and take the longest as the primary silhouette loop.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Append the Tonal Mass step**

In `app.js`, in the `STROKE_STEPS` array, after the SOURCE step object's closing `},` and before the array's closing `];`, insert:
```js
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
```

- [ ] **Step 2: Validate in the browser**

Refresh, load `testData/mm.png`, switch to Strokes mode. There are now two cards. **02 TONAL MASS** shows faint gray candidate contours with the single longest one drawn bold white — this should read as the dominant silhouette of the subject. Drag the **Threshold** slider; the bold primary loop changes. Click **Auto** → threshold snaps to the Otsu value and re-runs.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add Tonal Mass step — primary silhouette line"
```

---

### Task 4: Edge Candidates step (feature pool)

Adds the third stroke step: extract internal edges via Sobel→NMS→hysteresis→trace and keep them as feature candidates. Also stashes the Sobel magnitude for scoring.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Append the Edge Candidates step**

In `app.js`, in the `STROKE_STEPS` array, after the TONAL MASS step's closing `},` and before the array's closing `];`, insert:
```js
  {
    num: '03', name: 'EDGE CANDIDATES',
    desc: 'strongest internal edges → complementary-feature candidates',
    controls: [
      { key: 'edgeSensitivity', label: 'Edge Sens', min: 0, max: 1, step: 0.05, firstAffected: 2 },
    ],
    run() {
      if (!SS.leveled) { SS.candidates = []; SS.edgeMag = null; SS.edges = null; return; }
      SS.edgeMag      = EdgeDetector.sobel(SS.leveled, W, H);
      const nms       = EdgeDetector.nonMaxSuppression(SS.leveled, W, H);
      const highFrac  = lerp(0.30, 0.08, P.edgeSensitivity); // low sens → fewer, stronger edges
      SS.edges        = EdgeDetector.hysteresis(nms, W, H, highFrac * 0.4, highFrac);
      const raw       = ContourTracer.trace(SS.edges, W, H);
      const minArc    = 0.04 * diag();
      SS.candidates   = ContourSimplifier.filter(raw, 0, minArc);
    },
    draw(canvas) {
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineCap = 'round';
      (SS.candidates || []).forEach((c, i) => {
        if (c.length < 2) return;
        ctx.strokeStyle = `hsl(${(i * 137.5) % 360}, 70%, 60%)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(c[0].x, c[0].y);
        for (let j = 1; j < c.length; j++) ctx.lineTo(c[j].x, c[j].y);
        ctx.stroke();
      });
    },
    stat() { return SS.candidates ? `${SS.candidates.length} candidates` : '—'; },
  },
```

- [ ] **Step 2: Validate in the browser**

Refresh, load image, Strokes mode. A third card **03 EDGE CANDIDATES** shows multiple colored edge segments (the internal features). Drag **Edge Sens** toward 0 → fewer, only the strongest edges survive; toward 1 → more candidates appear. The candidate count in the card stat updates.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add Edge Candidates step — feature pool + Sobel magnitude"
```

---

### Task 5: Ranked Selection step

Adds the fourth stroke step: combine the primary mass loop with the top diversity-suppressed feature candidates, capped at `strokeCount`.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Import `StrokeExtractor`**

In `app.js`, the import block (lines 1–6) ends with:
```js
import { BezierPathBuilder } from './BezierPathBuilder.js';
```
Add below it:
```js
import { StrokeExtractor }   from './StrokeExtractor.js';
```

- [ ] **Step 2: Add the `drawStrokes` helper**

In `app.js`, after the `drawGradient` function closes (line 339, its final `}`) add:
```js

function drawStrokes(canvas, strokes, colors) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokes.forEach((c, i) => {
    if (!c || c.length < 2) return;
    ctx.strokeStyle = colors[i] || `hsl(${(i * 137.5) % 360}, 70%, 60%)`;
    ctx.lineWidth   = i === 0 ? 3 : 2; // primary bolder than complementary
    ctx.beginPath();
    ctx.moveTo(c[0].x, c[0].y);
    for (let j = 1; j < c.length; j++) ctx.lineTo(c[j].x, c[j].y);
    ctx.stroke();
  });
}
```

- [ ] **Step 3: Append the Ranked Selection step**

In `app.js`, in the `STROKE_STEPS` array, after the EDGE CANDIDATES step's closing `},` and before the array's closing `];`, insert:
```js
  {
    num: '04', name: 'RANKED SELECTION',
    desc: 'primary + top complementary features (diversity-suppressed)',
    controls: [
      { key: 'strokeCount',       label: 'Strokes',     min: 1, max: 3, step: 1,    firstAffected: 3 },
      { key: 'strokeAbstraction', label: 'Abstraction', min: 0, max: 1, step: 0.05, firstAffected: 4 },
    ],
    run() {
      SS.selected = [];
      if (SS.primary) SS.selected.push(SS.primary);
      const need = P.strokeCount - SS.selected.length;
      if (need > 0 && SS.candidates?.length && SS.edgeMag) {
        const suppress = 0.12 * diag();
        const feats = StrokeExtractor.selectDiverse(SS.candidates, need, suppress, SS.edgeMag, W, H);
        SS.selected.push(...feats);
      }
    },
    draw(canvas) {
      drawStrokes(canvas, SS.selected || [], ['#fff', '#7c5af6', '#4ade80']);
    },
    stat() { return SS.selected ? `${SS.selected.length} stroke${SS.selected.length === 1 ? '' : 's'}` : '—'; },
  },
```

- [ ] **Step 4: Validate in the browser**

Refresh, load image, Strokes mode. A fourth card **04 RANKED SELECTION** shows the white primary loop plus complementary strokes in purple/green. With **Strokes = 1** only the white primary shows; set **Strokes = 2** or **3** and 1–2 colored feature strokes appear in *different* regions (not stacked on the same edge). The stat reads `N stroke(s)`.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: add Ranked Selection step — primary + diverse features"
```

---

### Task 6: Stroke Output step (pure-stroke SVG)

Adds the final stroke step: simplify + smooth each selected stroke per the abstraction knob, then render pure black `<path>`s with an Export button.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Append the Stroke Output step**

In `app.js`, in the `STROKE_STEPS` array, after the RANKED SELECTION step's closing `},` and before the array's closing `];`, insert:
```js
  {
    num: '05', name: 'STROKE OUTPUT',
    desc: 'pure black strokes — no tone, no fill',
    isSVG: true,
    controls: [
      { key: 'strokeWidth', label: 'Stroke Width', min: 0.5, max: 6, step: 0.5, firstAffected: 4 },
    ],
    run() {
      if (!SS.selected?.length) { S.svgString = ''; return; }
      const eps  = lerp(1.5, 12, P.strokeAbstraction);
      const iter = Math.round(lerp(0, 4, P.strokeAbstraction));
      const layers = SS.selected.map(stroke => {
        const simplified = ContourSimplifier.rdp(stroke, eps);
        const smoothed   = BezierPathBuilder.smooth(simplified, iter);
        return { d: BezierPathBuilder.build(smoothed, 0.5), color: 'black' };
      }).filter(l => l.d);
      S.svgString = layers.length ? makeSVG(layers, W, H, P.strokeWidth) : '';
    },
    draw() {},
    stat() { return S.svgString ? `${(S.svgString.length / 1024).toFixed(1)} KB` : '—'; },
  },
```

- [ ] **Step 2: Validate in the browser**

Refresh, load image, Strokes mode. A fifth card **05 STROKE OUTPUT** shows the final drawing: pure black strokes on white, no gray/fill. Drag **Abstraction** toward 1 → strokes become bolder/sweeping; toward 0 → they hug the real contour. Drag **Stroke Width**. Click **Export SVG** → downloads `singleline.svg`; open it and confirm it contains only black `<path>` elements on a white `<rect>`.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add Stroke Output step — pure-stroke SVG + export"
```

---

### Task 7: Degenerate-image handling + final pass

Confirms the mode fails quiet (renders fewer/zero strokes, never invents noise) and that params persist across reloads.

**Files:**
- Modify: `app.js` (only if validation reveals a gap)

- [ ] **Step 1: Validate fail-quiet behavior**

Refresh, Strokes mode. Push **Black Pt** and **White Pt** together (or set Threshold to 255 / 0) to produce a near-empty image. Expected: the Tonal Mass / Selection cards show few or no strokes and the Output card shows the "no output" placeholder — **no dense noise appears**. This is the intended fail-quiet behavior; no contour-noise should ever show up the way it can in the old pipeline.

- [ ] **Step 2: Verify selection respects `strokeCount` when candidates are scarce**

With a low-contrast image where Edge Candidates shows 0–1 segments, set **Strokes = 3**. Expected: the Selection card shows only as many strokes as actually exist (e.g. just the primary) — `selectDiverse` returns fewer than requested rather than erroring or duplicating.

- [ ] **Step 3: Verify persistence**

Set **Strokes = 2**, **Abstraction ≈ 0.8**, **Edge Sens ≈ 0.3**. Refresh the page. Expected: switch to Strokes mode and the sliders retain those values (they persist via the existing `localStorage` mechanism, since they are flat numeric keys on `P`). Click **Reset Settings** → they return to defaults (1, 0.5, 0.5).

- [ ] **Step 4: Commit any fixes**

Only if Steps 1–3 surfaced a problem you had to fix:
```bash
git add app.js
git commit -m "fix: strokes-mode degenerate-image handling"
```
If no fixes were needed, there is nothing to commit — the mode is complete.

---

## Self-Review

**Spec coverage:**
- New mode alongside pipeline, toggle in header → Task 2 (mode flag, `getSteps`, button). ✅
- Reuses image-load/grayscale/levels + Sobel/Otsu/trace/simplify/smooth → all steps call existing modules; nothing reimplemented. ✅
- Two-source extraction (mass boundary primary + edge features) → Tasks 3 & 4. ✅
- Importance score `√arcLength × avgEdgeStrength × spatialSpread` → Task 1 `StrokeExtractor.score`. ✅
- Diversity selection with spatial suppression → Task 1 `selectDiverse`, used in Task 5. ✅
- Two knobs (stroke count, abstraction) → Task 5 controls (`strokeCount`, `strokeAbstraction`); abstraction consumed in Task 6. ✅
- Pure black strokes, no tone/fill, each its own `<path>` → Task 6 (`makeSVG` with `color:'black'`). ✅
- Five step cards (Source, Mass+Edges, Candidates, Ranked Selection, Output) → realized as Source / Tonal Mass / Edge Candidates / Ranked Selection / Stroke Output (mass and edges split into two single-canvas cards, which fits the existing one-canvas-per-card UI better than a side-by-side). ✅
- Degenerate images fail quiet → Task 7. ✅
- Non-portrait images: algorithm is subject-agnostic (ranks by structure) — no face-specific code anywhere. ✅
- No automated tests → honored; validation is visual + one node sanity check. ✅

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✅

**Type/name consistency:** `SS` fields (`leveled`, `massBinary`, `massContours`, `primary`, `edges`, `edgeMag`, `candidates`, `selected`) are defined in Task 2 Step 3 and used consistently in Tasks 3–6. `StrokeExtractor.selectDiverse(candidates, count, suppressRadius, edgeMag, width, height)` is defined in Task 1 and called with the matching argument order in Task 5. `getSteps()` defined in Task 2 Step 4, used in Steps 5 & 7. Param keys `strokeCount`/`strokeAbstraction`/`edgeSensitivity` added in Task 2 Step 2 and referenced thereafter. `S.svgString` (shared) is written by the Stroke Output step so the existing `renderSVG`/`exportSVG` work unchanged. ✅
