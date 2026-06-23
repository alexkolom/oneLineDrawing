# Framing Silhouette Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, toggleable framing silhouette line — the subject's outer boundary rendered as a separate bolder line behind the single-line drawing — in both Easy and Strokes modes.

**Architecture:** Reuse the outer-boundary loops the Tonal Mass step already traces (`SS.massContours`). A new pure `Silhouette` module selects the largest-area loop(s), simplifies/smooths them, and builds one SVG path. The STROKE OUTPUT step (run by both Easy and Strokes) adds this as a bolder layer when a shared `frameOn` flag is set; two UI toggles flip it.

**Tech Stack:** Vanilla JS ES modules, browser canvas/SVG, no framework. Served via `node server.js` on port 3333.

## Global Constraints

- **No test files.** Verify pure functions with throwaway `node` smoke commands and behavior manually in the browser at `http://localhost:3333`.
- `RegionTracer.trace` returns outer-boundary loops only; `SS.massContours` holds these for the current image (Strokes + Easy).
- Frame **defaults off**; `frameOn` is module-level session state (not persisted), mirroring the existing `let multiPath = false;` pattern.
- Frame drawn **underneath** the detail line (push its layer first); width `Math.max(2, P.strokeWidth * 2.5)`, color black.
- With the frame OFF, the produced SVG must be byte-identical to today's output.
- Pipeline mode is untouched.
- Match existing style: 2-space indent, ES module `import`/`export`.

---

## File Structure

- **`Silhouette.js`** (new) — pure module: `area`, `select`, `buildPath`.
- **`app.js`** — import `Silhouette`; per-layer `width` in `makeSVG`; `frameOn` state; frame logic in STROKE OUTPUT `run()`; Easy + Strokes toggle wiring.
- **`index.html`** — "Frame" toggle button in the `.easy-bar`.

---

### Task 1: `Silhouette.js` module

**Files:**
- Create: `Silhouette.js`

**Interfaces:**
- Consumes: `ContourSimplifier.rdp(points, epsilon)`, `BezierPathBuilder.smoothFactor(points, amount)`, `BezierPathBuilder.build(points, tension)` (existing).
- Produces:
  - `Silhouette.area(loop) → number` (absolute shoelace area)
  - `Silhouette.select(loops, fracOfMax=0.5) → loop[]` (largest + loops ≥ fracOfMax×maxArea)
  - `Silhouette.buildPath(loops, {simplifyEps, smooth, tension}) → string` (SVG path `d`, or `''`)

- [ ] **Step 1: Create the module**

Create `Silhouette.js` with exactly:

```js
import { ContourSimplifier } from './ContourSimplifier.js';
import { BezierPathBuilder } from './BezierPathBuilder.js';

// Builds the subject's outer silhouette as a single SVG path, reusing the
// outer-boundary loops already traced by RegionTracer (e.g. SS.massContours).
export class Silhouette {
  // Absolute polygon area via the shoelace formula. loop: array of {x,y}.
  static area(loop) {
    if (!loop || loop.length < 3) return 0;
    let a = 0;
    for (let i = 0, n = loop.length; i < n; i++) {
      const p = loop[i], q = loop[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  // Largest-area loop plus any loop whose area >= fracOfMax * maxArea.
  // Drops smaller noise loops. Returns [] for empty input or zero area.
  static select(loops, fracOfMax = 0.5) {
    if (!loops || !loops.length) return [];
    const scored = loops.map(l => ({ l, a: this.area(l) }));
    const maxA = scored.reduce((m, o) => Math.max(m, o.a), 0);
    if (maxA <= 0) return [];
    return scored.filter(o => o.a >= fracOfMax * maxA).map(o => o.l);
  }

  // Build one SVG path `d` covering the selected silhouette loops: RDP-simplify
  // each, close it, join loops with null separators, smooth, and build a
  // Catmull-Rom path. Returns '' when there is nothing to draw.
  static buildPath(loops, { simplifyEps = 1, smooth = 1.5, tension = 0.5 } = {}) {
    const selected = this.select(loops);
    const pts = [];
    for (const loop of selected) {
      let s = ContourSimplifier.rdp(loop, simplifyEps);
      if (s.length < 2) continue;
      s = [...s, s[0]]; // close the loop
      if (pts.length) pts.push(null);
      pts.push(...s);
    }
    if (!pts.length) return '';
    const smoothed = BezierPathBuilder.smoothFactor(pts, smooth);
    return BezierPathBuilder.build(smoothed, tension);
  }
}
```

- [ ] **Step 2: Smoke-check in node**

Run:

```bash
node --input-type=module -e "
import { Silhouette } from './Silhouette.js';
const big  = [{x:0,y:0},{x:0,y:10},{x:10,y:10},{x:10,y:0}]; // area 100
const tiny = [{x:0,y:0},{x:0,y:1},{x:1,y:1},{x:1,y:0}];      // area 1
console.log('area=', Silhouette.area(big));                 // 100
console.log('selectLen=', Silhouette.select([big, tiny]).length); // 1 (tiny dropped)
console.log('emptySelect=', Silhouette.select([]).length);  // 0
const d = Silhouette.buildPath([big], { simplifyEps: 0.5 });
console.log('pathStartsM=', d.startsWith('M'));             // true
console.log('emptyPath=', JSON.stringify(Silhouette.buildPath([], {}))); // \"\"
"
```

Expected output:
```
area= 100
selectLen= 1
emptySelect= 0
pathStartsM= true
emptyPath= ""
```

- [ ] **Step 3: Commit**

```bash
git add Silhouette.js
git commit -m "feat: add Silhouette module (outer-boundary frame path)"
```

---

### Task 2: Per-layer width in `makeSVG`

**Files:**
- Modify: `app.js` — `makeSVG` function (search for `function makeSVG(layers, w, h, sw) {`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `makeSVG` layers may now include an optional `width`; layers without it keep using `sw` (backward-compatible).

- [ ] **Step 1: Add per-layer width**

In `app.js`, replace:

```js
  const paths = layers.map(({ d, color }) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('\n');
```

with:

```js
  const paths = layers.map(({ d, color, width }) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width ?? sw}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('\n');
```

- [ ] **Step 2: Verify the file parses**

Run: `node --check app.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: allow per-layer stroke width in makeSVG"
```

---

### Task 3: `frameOn` state + frame layer in STROKE OUTPUT

**Files:**
- Modify: `app.js` — imports (top), state near `let multiPath = false;`, and the STROKE OUTPUT step `run()` (the step with `num: '05', name: 'STROKE OUTPUT'`).

**Interfaces:**
- Consumes: `Silhouette.buildPath` (Task 1), per-layer `width` in `makeSVG` (Task 2), existing `SS.massContours`, `diag()`, `P.strokeWidth`, `P.strokeSmooth`.
- Produces: module-level `let frameOn` (boolean, default false), read here and flipped by the Task 4 toggles.

- [ ] **Step 1: Import the Silhouette module**

In `app.js`, after the line:

```js
import { RegionTracer }      from './RegionTracer.js';
```

add:

```js
import { Silhouette }        from './Silhouette.js';
```

- [ ] **Step 2: Add the `frameOn` state flag**

In `app.js`, immediately after:

```js
let multiPath = false;
```

add:

```js
let frameOn = false; // framing silhouette line — session state, default off
```

- [ ] **Step 3: Add the frame layer to STROKE OUTPUT `run()`**

In `app.js`, in the STROKE OUTPUT step (`num: '05', name: 'STROKE OUTPUT'`), replace its `run()`:

```js
    run() {
      if (!SS.linkedPath?.length) { S.svgString = ''; return; }
      const smoothed = BezierPathBuilder.smoothFactor(SS.linkedPath, P.strokeSmooth);
      const d        = BezierPathBuilder.build(smoothed, 0.5);
      S.svgString    = d ? makeSVG([{ d, color: 'black' }], W, H, P.strokeWidth) : '';
    },
```

with:

```js
    run() {
      if (!SS.linkedPath?.length) { S.svgString = ''; return; }
      const smoothed = BezierPathBuilder.smoothFactor(SS.linkedPath, P.strokeSmooth);
      const d        = BezierPathBuilder.build(smoothed, 0.5);
      if (!d) { S.svgString = ''; return; }
      const layers = [];
      if (frameOn) {
        const frameD = Silhouette.buildPath(SS.massContours || [], {
          simplifyEps: 0.006 * diag(),
          smooth: 1.5,
        });
        // pushed first → renders underneath the detail line
        if (frameD) layers.push({ d: frameD, color: 'black', width: Math.max(2, P.strokeWidth * 2.5) });
      }
      layers.push({ d, color: 'black' });
      S.svgString = makeSVG(layers, W, H, P.strokeWidth);
    },
```

- [ ] **Step 4: Verify the file parses**

Run: `node --check app.js`
Expected: no output (exit 0).

- [ ] **Step 5: Verify frame-off is unchanged**

With `frameOn` still false everywhere (no toggle wired yet), the layers array is `[{ d, color: 'black' }]` — identical to the old call. Confirm by inspecting the diff that the only behavioral change is gated behind `if (frameOn)`.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: render framing silhouette layer in STROKE OUTPUT when frameOn"
```

---

### Task 4: Frame toggles (Easy bar + Strokes controls)

**Files:**
- Modify: `index.html` — the `.easy-bar` (search for `id="easyExport"`).
- Modify: `app.js` — `init()` Easy wiring (after the `easyExport` listener), and `createStepCards` (after the `exportBtn` is appended, inside `if (step.isSVG)`).

**Interfaces:**
- Consumes: `frameOn` (Task 3), `runEasy()`, `runFrom(idx)`, `S.imageData`, `mode`.
- Produces: two toggle buttons that flip the shared `frameOn` and re-render.

- [ ] **Step 1: Add the Easy-bar toggle button**

In `index.html`, replace:

```html
      <button class="btn-export" id="easyExport" disabled>Export SVG</button>
```

with:

```html
      <button class="btn-reset" id="easyFrame">Frame: OFF</button>
      <button class="btn-export" id="easyExport" disabled>Export SVG</button>
```

- [ ] **Step 2: Wire the Easy toggle**

In `app.js`, in `init()`, immediately after:

```js
  const easyExport = document.getElementById('easyExport');
  if (easyExport) easyExport.addEventListener('click', exportSVG);
```

add:

```js
  const easyFrame = document.getElementById('easyFrame');
  if (easyFrame) {
    easyFrame.addEventListener('click', () => {
      frameOn = !frameOn;
      easyFrame.textContent = `Frame: ${frameOn ? 'ON' : 'OFF'}`;
      easyFrame.style.color       = frameOn ? 'var(--accent)' : '';
      easyFrame.style.borderColor = frameOn ? 'var(--accent)' : '';
      if (S.imageData && mode === 'easy') runEasy();
    });
  }
```

- [ ] **Step 3: Add the Strokes-mode toggle**

In `app.js`, in `createStepCards`, immediately after:

```js
        exportBtn.addEventListener('click', exportSVG);
        ctrl.appendChild(exportBtn);
```

add:

```js
        if (mode === 'strokes') {
          const frameBtn = document.createElement('button');
          frameBtn.className = 'btn-reset';
          frameBtn.textContent = `Frame: ${frameOn ? 'ON' : 'OFF'}`;
          frameBtn.style.color       = frameOn ? 'var(--accent)' : '';
          frameBtn.style.borderColor = frameOn ? 'var(--accent)' : '';
          frameBtn.addEventListener('click', () => {
            frameOn = !frameOn;
            frameBtn.textContent = `Frame: ${frameOn ? 'ON' : 'OFF'}`;
            frameBtn.style.color       = frameOn ? 'var(--accent)' : '';
            frameBtn.style.borderColor = frameOn ? 'var(--accent)' : '';
            if (S.imageData) runFrom(4);
          });
          ctrl.appendChild(frameBtn);
        }
```

- [ ] **Step 4: Verify and sanity-check**

Run: `node --check app.js`
Expected: no output (exit 0).

Run:
```bash
grep -c "frameOn = !frameOn" app.js
```
Expected: `2` (the two toggle handlers).

- [ ] **Step 5: Commit**

```bash
git add app.js index.html
git commit -m "feat: add Frame toggle to Easy bar and Strokes controls"
```

---

### Task 5: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Serve the app**

```bash
node server.js &
```

Open `http://localhost:3333`.

- [ ] **Step 2: Easy mode frame**

Load an image from `testData/`. In Easy mode, confirm the `.easy-bar` shows a "Frame: OFF" button. Click it → it reads "Frame: ON" (accent-colored) and a **bolder outline of the subject's silhouette** appears behind the single-line drawing. Click again → frame disappears, drawing returns to the plain single line.

- [ ] **Step 3: Frame persists across detail levels**

With Frame ON, click Low / Mid / High. Confirm the frame re-renders at each level (silhouette stays, interior detail changes).

- [ ] **Step 4: Strokes mode frame**

Switch to Strokes mode. In the STROKE OUTPUT step controls, confirm a "Frame" toggle is present and reflects the current state (ON if you left it on in Easy). Toggle it and confirm the silhouette line appears/disappears in the STROKE OUTPUT preview.

- [ ] **Step 5: Frame-off is unchanged; Pipeline untouched**

With Frame OFF, confirm the output looks exactly as before. Switch to Pipeline mode and confirm there is no Frame toggle and behavior is unchanged.

- [ ] **Step 6: Export includes the frame**

In Easy mode with Frame ON, click Export SVG and confirm the downloaded `singleline.svg` contains both the bold silhouette and the detail line.

- [ ] **Step 7: Tune if needed**

If the frame is too jagged or too smooth, adjust `simplifyEps` / `smooth` in the STROKE OUTPUT `run()` (Task 3), or the boldness via the `Math.max(2, P.strokeWidth * 2.5)` factor, and re-verify. Commit any tuning:

```bash
git add app.js
git commit -m "tune: framing silhouette smoothness/weight"
```

---

## Self-Review

**Spec coverage:**
- `Silhouette.js` (area/select/buildPath) → Task 1. ✓
- `makeSVG` per-layer width → Task 2. ✓
- STROKE OUTPUT frame layer (underneath, bolder, no-op when empty) → Task 3. ✓
- `frameOn` session state, default off → Task 3. ✓
- Easy + Strokes toggles sharing `frameOn` → Task 4. ✓
- Frame-off byte-identical → Task 3 Step 5 + Task 5 Step 5. ✓
- Pipeline untouched → Strokes-only guard in Task 4 Step 3; verified Task 5 Step 5. ✓
- Files: `Silhouette.js`, `app.js`, `index.html` → all covered. ✓
- Out of scope (morphology, persistence, color options) → not present. ✓

**Type consistency:** `Silhouette.buildPath(loops, opts)` and `Silhouette.select`/`area` signatures match between Task 1 and their call in Task 3. `frameOn` is defined in Task 3 and consumed in Tasks 3–4 with the same name. `makeSVG` layer `width` added in Task 2 and used in Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; commands have expected output. ✓
