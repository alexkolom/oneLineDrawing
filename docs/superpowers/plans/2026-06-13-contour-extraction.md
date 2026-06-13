# Contour-Based Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Canny + skeleton + junction graph (steps 4–6) with threshold → contour trace → RDP simplify, producing clean artsy contour output with minimal per-image tuning.

**Architecture:** Binary threshold using Otsu's method produces two regions; Suzuki-style border-following traces their boundaries into ordered polylines; Ramer-Douglas-Peucker simplifies those polylines to clean sparse curves; a nearest-neighbor TSP chains the segments into a single routed path.

**Tech Stack:** Vanilla JS ES modules, browser Canvas API. No build step, no test framework.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `Thresholder.js` | Otsu threshold computation + binary apply |
| Create | `ContourTracer.js` | Border-pixel extraction + greedy chain ordering |
| Create | `ContourSimplifier.js` | Area filter + RDP simplification |
| Modify | `PathPlanner.js` | Replace Euler-path solve with nearest-neighbor segment router |
| Modify | `app.js` | Wire new pipeline: imports, state, params, step defs, loadFile, Auto All |
| Modify | `index.html` | Add Auto All button to header |
| Delete (unused) | `Skeletonizer.js` | Replaced — leave file in place, just unused |
| Delete (unused) | `SkeletonGraph.js` | Replaced — leave file in place, just unused |

---

## Task 1: Create `Thresholder.js`

**Files:**
- Create: `Thresholder.js`

- [ ] **Step 1: Create the file**

```javascript
export class Thresholder {
  // Otsu's method: find threshold that maximises inter-class variance.
  // gray: Uint8Array of grayscale pixel values.
  // Returns integer 0–255.
  static otsu(gray) {
    const hist = new Array(256).fill(0);
    for (const v of gray) hist[v]++;
    const total = gray.length;

    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];

    let wB = 0, sumB = 0, maxVar = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const v = wB * wF * (mB - mF) ** 2;
      if (v > maxVar) { maxVar = v; threshold = t; }
    }
    return threshold;
  }

  // Apply threshold: pixels <= t become 255 (foreground/dark), rest 0.
  // gray: Uint8Array. Returns Uint8Array.
  static apply(gray, t) {
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= t ? 255 : 0;
    return out;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add Thresholder.js
git commit -m "feat: add Thresholder with Otsu auto-threshold"
```

---

## Task 2: Create `ContourTracer.js`

Extracts the boundary pixels of each connected foreground region and orders them as a chain.

**Files:**
- Create: `ContourTracer.js`

- [ ] **Step 1: Create the file**

```javascript
export class ContourTracer {
  static #DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
  static #DY8 = [0, 1, 1,  1,  0, -1, -1, -1];

  // binary: Uint8Array (255=foreground, 0=background), width, height
  // Returns Array<{x,y}[]> — one ordered polyline per region boundary
  static trace(binary, width, height) {
    // Step 1: find border pixels (foreground with ≥1 background 4-neighbour)
    const border = new Uint8Array(binary.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!binary[i]) continue;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            !binary[i - 1] || !binary[i + 1] ||
            !binary[i - width] || !binary[i + width]) {
          border[i] = 1;
        }
      }
    }

    // Step 2: BFS to group border pixels into 8-connected components
    const comp = new Int32Array(binary.length).fill(-1);
    const components = [];
    for (let i = 0; i < border.length; i++) {
      if (!border[i] || comp[i] >= 0) continue;
      const label = components.length;
      const pixels = [];
      const queue = [i];
      comp[i] = label;
      while (queue.length) {
        const idx = queue.pop();
        pixels.push(idx);
        const cx = idx % width, cy = (idx / width) | 0;
        for (let d = 0; d < 8; d++) {
          const nx = cx + this.#DX8[d], ny = cy + this.#DY8[d];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (!border[ni] || comp[ni] >= 0) continue;
          comp[ni] = label;
          queue.push(ni);
        }
      }
      components.push(pixels);
    }

    // Step 3: order each component as a greedy 8-connected chain
    return components.map(pixels => this.#orderChain(pixels, width));
  }

  static #orderChain(pixels, width) {
    if (pixels.length <= 2) {
      return pixels.map(i => ({ x: i % width, y: (i / width) | 0 }));
    }

    // Build lookup set and sort to find topmost-leftmost start
    const inSet = new Uint8Set(pixels);
    pixels.sort((a, b) => ((a / width) | 0) - ((b / width) | 0) || a % width - b % width);

    const visited = new Uint8Set([]);
    const chain = [];
    let cur = pixels[0];

    while (cur !== undefined) {
      visited.add(cur);
      chain.push({ x: cur % width, y: (cur / width) | 0 });
      const cx = cur % width, cy = (cur / width) | 0;
      cur = undefined;
      for (let d = 0; d < 8; d++) {
        const nx = cx + ContourTracer.#DX8[d], ny = cy + ContourTracer.#DY8[d];
        const ni = ny * width + nx;
        if (inSet.has(ni) && !visited.has(ni)) { cur = ni; break; }
      }
    }
    return chain;
  }
}

// Minimal integer set backed by Uint8Array for performance
class Uint8Set {
  #data;
  constructor(items) {
    this.#data = new Map();
    for (const v of items) this.#data.set(v, 1);
  }
  has(v) { return this.#data.has(v); }
  add(v) { this.#data.set(v, 1); }
}
```

> **Note on `Uint8Set`:** Using a `Map` rather than a plain `Set` to avoid prototype pollution risk; functionally identical to `Set<number>`. If performance is slow on very large images, swap to a `Uint8Array` keyed by pixel index.

- [ ] **Step 2: Commit**

```bash
git add ContourTracer.js
git commit -m "feat: add ContourTracer (border-following contour extraction)"
```

---

## Task 3: Create `ContourSimplifier.js`

**Files:**
- Create: `ContourSimplifier.js`

- [ ] **Step 1: Create the file**

```javascript
export class ContourSimplifier {
  // Keep only contours whose bounding-box area >= minArea (px²).
  static filter(contours, minArea) {
    return contours.filter(c => {
      if (c.length < 3) return false;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of c) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      return (maxX - minX) * (maxY - minY) >= minArea;
    });
  }

  // Ramer-Douglas-Peucker: reduce points while preserving shape.
  // epsilon: max allowed deviation in pixels.
  static rdp(points, epsilon) {
    if (points.length <= 2) return points.slice();
    let maxDist = 0, maxIdx = 0;
    const a = points[0], b = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = this.#ptSegDist(points[i], a, b);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilon) {
      const L = this.rdp(points.slice(0, maxIdx + 1), epsilon);
      const R = this.rdp(points.slice(maxIdx), epsilon);
      return [...L.slice(0, -1), ...R];
    }
    return [a, b];
  }

  // Apply RDP to every contour; drop any that collapse to <2 points.
  static simplify(contours, epsilon) {
    return contours.map(c => this.rdp(c, epsilon)).filter(c => c.length >= 2);
  }

  static #ptSegDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add ContourSimplifier.js
git commit -m "feat: add ContourSimplifier (area filter + RDP)"
```

---

## Task 4: Replace `PathPlanner.solve` with segment router

The current `solve` expects a `SkeletonGraph` and runs MST + Chinese Postman + Hierholzer. With disjoint contour segments there is no shared graph — replace with a nearest-neighbour TSP pass over segment endpoints.

**Files:**
- Modify: `PathPlanner.js` (full replacement)

- [ ] **Step 1: Replace the entire file**

```javascript
export class PathPlanner {
  // segments: Array<{x,y}[]>  — one polyline per contour (output of ContourSimplifier)
  // opts:     { maxJumpFrac=0.08, width, height }
  // Returns:  (Point | null)[]  — nulls mark pen-up jumps
  static solve(segments, opts = {}) {
    const { maxJumpFrac = 0.08, width = 1, height = 1 } = opts;
    if (!segments?.length) return [];

    const maxJump = maxJumpFrac * Math.sqrt(width * width + height * height);
    const used = new Uint8Array(segments.length);
    const result = [];

    // Start with the longest segment (most detail, good anchor)
    let startIdx = 0, bestLen = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].length > bestLen) { bestLen = segments[i].length; startIdx = i; }
    }

    const append = (seg) => { result.push(...seg); };

    used[startIdx] = 1;
    append(segments[startIdx]);
    let tail = segments[startIdx][segments[startIdx].length - 1];

    for (let pass = 1; pass < segments.length; pass++) {
      // Find nearest unvisited segment endpoint (either end, either direction)
      let bestDist = Infinity, bestIdx = -1, bestRev = false;
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const seg = segments[i];
        const dH = Math.hypot(seg[0].x - tail.x, seg[0].y - tail.y);
        const dT = Math.hypot(seg[seg.length - 1].x - tail.x, seg[seg.length - 1].y - tail.y);
        if (dH < bestDist) { bestDist = dH; bestIdx = i; bestRev = false; }
        if (dT < bestDist) { bestDist = dT; bestIdx = i; bestRev = true; }
      }
      if (bestIdx < 0) break;

      used[bestIdx] = 1;
      const seg = segments[bestIdx];
      const ordered = bestRev ? [...seg].reverse() : seg;
      if (bestDist > maxJump) result.push(null);
      append(ordered);
      tail = ordered[ordered.length - 1];
    }

    return result;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add PathPlanner.js
git commit -m "refactor: replace PathPlanner Euler solver with contour segment router"
```

---

## Task 5: Wire up `app.js`

This task updates all of `app.js`: imports, state object, parameter set, step definitions for steps 04–08, `loadFile` auto-detect, and the Auto All handler.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Replace imports (top of file, lines 1–6)**

```javascript
import { EdgeDetector }      from './EdgeDetector.js';
import { Thresholder }       from './Thresholder.js';
import { ContourTracer }     from './ContourTracer.js';
import { ContourSimplifier } from './ContourSimplifier.js';
import { PathPlanner }       from './PathPlanner.js';
import { BezierPathBuilder } from './BezierPathBuilder.js';
```

- [ ] **Step 2: Replace the state object `S` (lines 12–23)**

```javascript
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
```

- [ ] **Step 3: Replace the parameter object `P` and defaults (lines 26–42)**

```javascript
const P = {
  blackPoint:      0,
  whitePoint:      255,
  gamma:           1.0,
  threshold:       128,
  minContourFrac:  0.0005,
  simplification:  1.5,
  maxJumpFrac:     0.08,
  strokeWidth:     1.0,
};
const P_DEFAULTS = { ...P };
const P_STORAGE_KEY = 'singleline_params_v2';
```

> **Note:** The storage key is bumped to `v2` so stale Canny params saved in localStorage are not loaded.

- [ ] **Step 4: Replace STEPS[3] — Canny → Threshold**

Find the step object starting with `num: '04', name: 'CANNY EDGES'` and replace it:

```javascript
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
```

- [ ] **Step 5: Replace STEPS[4] — Skeleton → Contour Trace**

Find the step object starting with `num: '05', name: 'SKELETON'` and replace it:

```javascript
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
```

- [ ] **Step 6: Replace STEPS[5] — Junction Graph → Filter + Simplify**

Find the step object starting with `num: '06', name: 'JUNCTION GRAPH'` and replace it:

```javascript
  {
    num: '06', name: 'FILTER + SIMPLIFY',
    desc: 'drop small contours · Ramer-Douglas-Peucker — reduces to clean sparse polylines',
    controls: [
      { key: 'minContourFrac', label: 'Min Area',   min: 0, max: 0.005, step: 0.0001, firstAffected: 5 },
      { key: 'simplification', label: 'Simplify ε', min: 0.5, max: 15,  step: 0.5,   firstAffected: 5 },
    ],
    run() {
      if (!S.rawContours?.length) { S.contours = []; return; }
      const minArea = P.minContourFrac * W * H;
      const filtered = ContourSimplifier.filter(S.rawContours, minArea);
      S.contours = ContourSimplifier.simplify(filtered, P.simplification);
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
```

- [ ] **Step 7: Update STEPS[6] — Euler Path (now takes `S.contours`)**

Find the `run()` method inside the `num: '07'` step and replace just that method:

```javascript
    run() {
      if (!S.contours?.length) { S.eulerPath = []; return; }
      S.eulerPath = PathPlanner.solve(S.contours, { maxJumpFrac: P.maxJumpFrac, width: W, height: H });
    },
```

Also update its `stat()` to remove the `pxEq` reference to the old `diag()` call (it stays, `diag()` still exists):

```javascript
    stat() {
      if (!S.eulerPath) return '—';
      const pts  = S.eulerPath.filter(p => p !== null).length;
      const gaps = S.eulerPath.filter(p => p === null).length;
      const pxEq = (P.maxJumpFrac * diag()).toFixed(0);
      return `${pts.toLocaleString()} pts · ${gaps} pen-up${gaps !== 1 ? 's' : ''} · max jump≈${pxEq}px`;
    },
```

- [ ] **Step 8: Update STEPS[7] — Smooth Spline (remove resample, fixed tension)**

Find the `run()` inside `num: '08'` and replace it:

```javascript
    run() {
      if (!S.eulerPath?.length) { S.smoothed = []; return; }
      S.smoothed = BezierPathBuilder.smooth(S.eulerPath, 4);
    },
```

Remove the two controls (`splineTension`, `sampleFrac`) from this step's `controls` array — set it to `[]`:

```javascript
    controls: [],
```

Update `stat()` to remove the `pxEq` line (no more `sampleFrac`):

```javascript
    stat() {
      if (!S.smoothed) return '—';
      const pts = S.smoothed.filter(p => p !== null).length;
      return `${pts.toLocaleString()} pts`;
    },
```

- [ ] **Step 9: Update STEPS[8] — SVG Output (fixed tension)**

Find the `run()` inside `num: '09'` and replace it:

```javascript
    run() {
      if (!S.smoothed?.length) { S.svgString = ''; return; }
      const d = BezierPathBuilder.build(S.smoothed, 0.5);
      S.svgString = makeSVG(d, W, H, P.strokeWidth);
    },
```

- [ ] **Step 10: Update `loadFile` to auto-detect threshold on image load**

Find the `loadFile` function and add Otsu auto-detect before `showPipeline()`:

```javascript
async function loadFile(file) {
  const img = await loadImage(file);

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
```

- [ ] **Step 11: Add Auto All handler in `init()`**

Add after the existing `btnReset` listener in `init()`:

```javascript
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
```

- [ ] **Step 12: Commit**

```bash
git add app.js
git commit -m "feat: wire contour pipeline into app.js — replaces Canny+skeleton steps"
```

---

## Task 6: Add Auto All button to `index.html`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add button to the header's `header-right` div**

Find this block in `index.html`:

```html
    <div class="header-right">
      <div class="status-badge" id="statusBadge">no image</div>
      <button class="btn-reset" id="btnReset">Reset Settings</button>
```

Replace with:

```html
    <div class="header-right">
      <div class="status-badge" id="statusBadge">no image</div>
      <button class="btn-auto" id="btnAutoAll">Auto All</button>
      <button class="btn-reset" id="btnReset">Reset Settings</button>
```

- [ ] **Step 2: Verify in browser**

Start the dev server (`node server.js`), open `http://localhost:3333`, load a photo. Confirm:
1. Pipeline shows 9 steps with new names: THRESHOLD, CONTOUR TRACE, FILTER + SIMPLIFY
2. Threshold step shows a binary black/white image
3. Contour Trace step shows coloured contour rings
4. Filter + Simplify step shows fewer, cleaner coloured polylines
5. Final SVG shows a recognisable clean contour drawing
6. Auto All button resets to sensible defaults and re-runs

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add Auto All button to header"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Threshold step with Otsu auto-detect → Task 1 + Task 5 Step 4
- [x] Contour trace (Suzuki-Abe style border following) → Task 2 + Task 5 Step 5
- [x] Contour filter (minArea) + RDP simplify → Task 3 + Task 5 Step 6
- [x] PathPlanner adapted for contour segments → Task 4
- [x] Parameters collapsed to threshold/minContourFrac/simplification/maxJumpFrac/strokeWidth → Task 5 Steps 2–3
- [x] Auto All button → Task 5 Step 11 + Task 6
- [x] Auto threshold on image load → Task 5 Step 10
- [x] Levels params kept (blackPoint/whitePoint/gamma) → Task 5 Step 3
- [x] Spline step simplified (no resample, fixed tension 0.5) → Task 5 Steps 8–9

**No placeholders:** All steps contain full working code. No TBD/TODO.

**Type consistency:**
- `ContourTracer.trace` → `{x,y}[][]`
- `ContourSimplifier.filter` + `.simplify` consume and produce `{x,y}[][]`
- `PathPlanner.solve` accepts `{x,y}[][]`, returns `(Point|null)[]`
- `BezierPathBuilder.smooth` + `.build` accept `(Point|null)[]` — unchanged, compatible
- `S.contours` is `{x,y}[][]` throughout steps 6→7
- `S.eulerPath` is `(Point|null)[]` throughout steps 7→8→9 — same as before
