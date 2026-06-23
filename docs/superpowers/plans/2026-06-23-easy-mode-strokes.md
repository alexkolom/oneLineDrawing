# Easy Mode for Strokes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Easy" mode where uploading an image yields a finished single-line drawing with no per-setting tweaking, driven by one Low/Mid/High detail dial.

**Architecture:** Easy mode is a thin layer over the existing Strokes pipeline. A pure deriver (`deriveEasyParams`) auto-levels the image from its histogram and picks thresholds by *target ink coverage*, sets the same `P.*` values the 5 Strokes steps already consume, runs those steps' `run()` functions in order, and renders the resulting SVG into a dedicated minimal UI. No tracing/linking/rendering logic is reimplemented.

**Tech Stack:** Vanilla JS ES modules, browser canvas, no framework. Served via `node server.js` on port 3333.

## Global Constraints

- **No test files.** Per project preference, do NOT create test files. Verify pure functions with throwaway `node -e` smoke commands and verify UI/behavior manually in the browser at `http://localhost:3333`.
- All tunable parameters live in the single `P` object in `app.js`; persisted via `saveParams()` under `localStorage` key `singleline_params_v4`.
- `Thresholder.apply(gray, t)` treats pixels with value **`<= t`** as foreground (dark). Foreground fraction therefore = fraction of pixels with value `<= t`.
- Strokes and Pipeline modes must remain behaviorally unchanged.
- Follow existing code style: 2-space indent, ES module `import`/`export`, no semicolize changes to unrelated lines.

---

## File Structure

- **`Thresholder.js`** — add one pure static method `thresholdForCoverage`.
- **`app.js`** — add the `minLoopArcFrac` param; parametrize two hardcoded min-arc filters; add `EASY_LEVELS` table, `deriveEasyParams()`, Easy-mode state, `runEasy()`, `renderEasyResult()`; extend the mode switch to 3-way; branch `loadFile`; wire the detail control and Easy export button.
- **`index.html`** — add the `#easy` container (Low/Mid/High segmented control, result area, export button) and its CSS; change the default mode button label.

---

### Task 1: Coverage-targeted threshold helper

**Files:**
- Modify: `Thresholder.js` (add method to the `Thresholder` class, after `apply`, before the closing brace ~line 74)

**Interfaces:**
- Consumes: nothing (pure function over a typed array).
- Produces: `Thresholder.thresholdForCoverage(gray, targetFrac) → integer 0–255` — the smallest threshold `t` such that the fraction of pixels with value `<= t` is at least `targetFrac`. Used by Task 3.

- [ ] **Step 1: Add the method**

In `Thresholder.js`, insert this method inside the class, immediately after the `apply` method:

```js
  // Smallest threshold t (0–255) such that the fraction of pixels with
  // value <= t is at least targetFrac. Pairs with apply(), where value<=t
  // is foreground. Used to guarantee an "ink budget" independent of Otsu.
  // gray: Uint8Array. targetFrac: 0..1. Returns integer 0–255.
  static thresholdForCoverage(gray, targetFrac) {
    const frac = Math.max(0, Math.min(1, targetFrac));
    const hist = new Array(256).fill(0);
    for (const v of gray) hist[v]++;
    const want = gray.length * frac;
    let cum = 0;
    for (let t = 0; t < 256; t++) {
      cum += hist[t];
      if (cum >= want) return t;
    }
    return 255;
  }
```

- [ ] **Step 2: Smoke-check in node**

Run:

```bash
node --input-type=module -e "
import { Thresholder } from './Thresholder.js';
// 100 pixels: values 0..99 evenly. 20% coverage => smallest t with (t+1) >= 20 => t=19.
const g = Uint8Array.from({length:100}, (_,i)=>i);
console.log('20% =>', Thresholder.thresholdForCoverage(g, 0.20)); // expect 19
console.log('0% =>',  Thresholder.thresholdForCoverage(g, 0));    // expect 0
console.log('100% =>',Thresholder.thresholdForCoverage(g, 1));    // expect 99
"
```

Expected output:
```
20% => 19
0% => 0
100% => 99
```

- [ ] **Step 3: Commit**

```bash
git add Thresholder.js
git commit -m "feat: add Thresholder.thresholdForCoverage (coverage-targeted threshold)"
```

---

### Task 2: Add `minLoopArcFrac` param and parametrize the min-arc filters

**Files:**
- Modify: `app.js` — `P` object (~line 41-57), Strokes step 02 `run()` (~line 358), Strokes step 03 `run()` (~line 395)

**Interfaces:**
- Consumes: nothing.
- Produces: `P.minLoopArcFrac` (number, default `0.04`) — the minimum loop arc length as a fraction of the image diagonal, used by the Tonal Mass and Tonal Layers steps. Set per detail level in Task 3/5.

- [ ] **Step 1: Add the param**

In `app.js`, in the `P` object, add `minLoopArcFrac` right after `layerThreshold`:

```js
  layerThreshold:    90,   // darker threshold for complementary tonal-region loops
  minLoopArcFrac:    0.04, // min loop arc length / diagonal — Tonal Mass + Layers loop pruning
```

(The existing `const P_DEFAULTS = { ...P };` line picks this up automatically — do not edit it.)

- [ ] **Step 2: Parametrize the Tonal Mass filter**

In `app.js`, in Strokes step 02 (`name: 'TONAL MASS'`) `run()`, change:

```js
      const minArc    = 0.04 * diag();
```

to:

```js
      const minArc    = P.minLoopArcFrac * diag();
```

- [ ] **Step 3: Parametrize the Tonal Layers filter**

In `app.js`, in Strokes step 03 (`name: 'TONAL LAYERS'`) `run()`, change:

```js
      const minArc   = 0.04 * diag();
```

to:

```js
      const minArc   = P.minLoopArcFrac * diag();
```

- [ ] **Step 4: Verify no behavior change in Strokes mode**

Because the default is `0.04`, Strokes mode is unchanged. Confirm the file parses:

```bash
node --check app.js
```

Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "refactor: parametrize Strokes min-arc loop filter via P.minLoopArcFrac"
```

---

### Task 3: The deriver — `EASY_LEVELS` + `deriveEasyParams`

**Files:**
- Modify: `app.js` — add after the `P_DEFAULTS`/`layerColors` block (~line 60), before `P_STORAGE_KEY` is fine, but place it just after the `diag()` helper (~line 107) so `EdgeDetector`/`Thresholder` imports are already in scope. Use the location right after `function diag()`.

**Interfaces:**
- Consumes: `EdgeDetector.toGrayscale`, `EdgeDetector.analyzeHistogram(gray) → {blackPoint, whitePoint}`, `EdgeDetector.levels(gray, bp, wp, gamma) → Uint8Array`, `Thresholder.thresholdForCoverage(gray, frac)` (Task 1), `P.minLoopArcFrac` (Task 2).
- Produces:
  - `EASY_LEVELS` — object keyed `low`/`mid`/`high`.
  - `deriveEasyParams(gray, level) → { blackPoint, whitePoint, gamma, threshold, layerThreshold, strokeAbstraction, strokeSmooth, minLoopArcFrac, strokeWidth }`. Consumed by `runEasy()` in Task 5.

- [ ] **Step 1: Confirm the imports exist**

Run:

```bash
grep -n "import" app.js | grep -E "EdgeDetector|Thresholder"
```

Expected: lines importing both `EdgeDetector` and `Thresholder`. (They are already used throughout `app.js`.)

- [ ] **Step 2: Add the level table and deriver**

In `app.js`, immediately after the `function diag() { ... }` line (~line 107), add:

```js
// ── Easy mode: detail-level table + auto-deriver ─────────────────────────
// Each level sets a coherent set of downstream knobs. Coverage targets are
// fractions of foreground (dark) pixels we DEMAND to exist, so contours can
// never vanish regardless of the image. Numbers are tuned starting points.
const EASY_LEVELS = {
  low:  { massCoverage: 0.10, layerCoverage: 0.04, strokeAbstraction: 0.80, strokeSmooth: 4.0, minLoopArcFrac: 0.08, strokeWidth: 1.5 },
  mid:  { massCoverage: 0.18, layerCoverage: 0.08, strokeAbstraction: 0.50, strokeSmooth: 2.0, minLoopArcFrac: 0.04, strokeWidth: 1.0 },
  high: { massCoverage: 0.28, layerCoverage: 0.14, strokeAbstraction: 0.25, strokeSmooth: 0.8, minLoopArcFrac: 0.02, strokeWidth: 1.0 },
};

// Pure: (grayscale Uint8Array, level) -> full Easy param set.
// Step 1 auto-levels from the histogram (fixes "tone wrong").
// Step 2 picks thresholds by target coverage (fixes "missed contours").
function deriveEasyParams(gray, level) {
  const cfg = EASY_LEVELS[level] || EASY_LEVELS.mid;
  const { blackPoint, whitePoint } = EdgeDetector.analyzeHistogram(gray);
  // Gamma from mean brightness: dark images get lifted, bright left neutral.
  let sum = 0;
  for (const v of gray) sum += v;
  const mean = sum / gray.length; // 0..255
  const gamma = mean < 100 ? 0.70 : mean > 170 ? 1.00 : 0.85;
  const leveled = EdgeDetector.levels(gray, blackPoint, whitePoint, gamma);
  const threshold      = Thresholder.thresholdForCoverage(leveled, cfg.massCoverage);
  const layerThreshold = Thresholder.thresholdForCoverage(leveled, cfg.layerCoverage);
  return {
    blackPoint, whitePoint, gamma,
    threshold, layerThreshold,
    strokeAbstraction: cfg.strokeAbstraction,
    strokeSmooth:      cfg.strokeSmooth,
    minLoopArcFrac:    cfg.minLoopArcFrac,
    strokeWidth:       cfg.strokeWidth,
  };
}
```

- [ ] **Step 3: Verify the file parses**

Run:

```bash
node --check app.js
```

Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat: add Easy-mode deriver (auto-level + coverage-targeted thresholds)"
```

---

### Task 4: Easy-mode UI markup and styles

**Files:**
- Modify: `index.html` — add `#easy` container after `#pipeline` (~line 343); add CSS in the `<style>` block; change the `#btnMode` default label.

**Interfaces:**
- Consumes: existing `.svg-wrap` and `.btn-export` styles.
- Produces (DOM ids/classes used by Task 5): container `#easy`; segmented control `#easyDetail` with three `button[data-level]` (`low`/`mid`/`high`); result area `#easyResult`; export button `#easyExport`. Default mode button text "Mode: Easy".

- [ ] **Step 1: Add the `#easy` container**

In `index.html`, replace this line:

```html
  <div id="pipeline" style="display:none"></div>
```

with:

```html
  <div id="pipeline" style="display:none"></div>

  <div id="easy" style="display:none">
    <div class="easy-bar">
      <span class="easy-detail-label">DETAIL</span>
      <div class="seg" id="easyDetail">
        <button type="button" data-level="low">Low</button>
        <button type="button" data-level="mid" class="active">Mid</button>
        <button type="button" data-level="high">High</button>
      </div>
      <button class="btn-export" id="easyExport" disabled>Export SVG</button>
    </div>
    <div class="svg-wrap easy-result" id="easyResult"></div>
  </div>
```

- [ ] **Step 2: Add the CSS**

In `index.html`, inside the `<style>` block, just before the `/* ── Scrollbar ── */` comment (~line 311), add:

```css
    /* ── Easy mode ── */
    #easy { display: flex; flex-direction: column; gap: 16px; }
    .easy-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      background: var(--head);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .easy-detail-label {
      font-family: var(--mono);
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .seg { display: flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
    .seg button {
      padding: 7px 16px;
      background: transparent;
      color: var(--muted);
      border: none;
      border-right: 1px solid var(--border);
      font-family: var(--mono);
      font-size: 11px;
      letter-spacing: 0.06em;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .seg button:last-child { border-right: none; }
    .seg button:hover { color: var(--text); }
    .seg button.active { background: var(--accent); color: #fff; }
    .easy-result {
      height: 560px;
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    #easy .btn-export { margin-left: auto; }
```

- [ ] **Step 3: Change the default mode label**

In `index.html`, change:

```html
      <button class="btn-reset" id="btnMode">Mode: Pipeline</button>
```

to:

```html
      <button class="btn-reset" id="btnMode">Mode: Easy</button>
```

- [ ] **Step 4: Verify the static layout**

Start the server (if not running) and open the page:

```bash
node server.js &
```

Open `http://localhost:3333`. The header button should read "Mode: Easy". The `#easy` container is `display:none` for now (wired in Task 5), so the page otherwise looks unchanged. Confirm there are no console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add Easy-mode UI (detail segmented control, result area, styles)"
```

---

### Task 5: Easy-mode wiring (state, run, mode switch, events)

**Files:**
- Modify: `app.js` — module state near `let mode` (~line 36); `loadFile` (~line 605-612); the `#btnMode` handler (~line 899-909); `init()` event wiring (~line 859+); add `runEasy()`, `renderEasyResult()`, `updateModeUI()` helpers.

**Interfaces:**
- Consumes: `deriveEasyParams` (Task 3), `EdgeDetector.toGrayscale`, `STROKE_STEPS` (existing const array of step objects with `run()`), `S.imageData`, `S.svgString`, `saveParams()`, `setStatus()`, `exportSVG()`, the DOM ids from Task 4.
- Produces: `mode` now takes value `'easy'`; `easyLevel` state (`'low'|'mid'|'high'`, default `'mid'`).

- [ ] **Step 1: Default the mode to Easy and add detail state**

In `app.js`, change:

```js
let mode = 'pipeline'; // 'pipeline' | 'strokes'
```

to:

```js
let mode = 'easy'; // 'easy' | 'strokes' | 'pipeline'
let easyLevel = 'mid'; // 'low' | 'mid' | 'high'
```

- [ ] **Step 2: Add `runEasy`, `renderEasyResult`, `updateModeUI`**

In `app.js`, add these functions next to `showPipeline` (after the `showPipeline` function, ~line 826):

```js
// ── Easy mode runtime ────────────────────────────────────────────────────
async function runEasy() {
  if (!S.imageData) return;
  setStatus('processing…', true);
  await tick();
  const gray = EdgeDetector.toGrayscale(S.imageData);
  Object.assign(P, deriveEasyParams(gray, easyLevel));
  saveParams();
  // Reuse the Strokes pipeline compute steps (no step-card UI in Easy mode).
  for (const step of STROKE_STEPS) {
    try { await step.run(); }
    catch (e) { console.error('Easy step failed:', e); }
  }
  renderEasyResult();
  setStatus('ready', false);
}

function renderEasyResult() {
  const wrap = document.getElementById('easyResult');
  if (!wrap) return;
  if (S.svgString) {
    wrap.innerHTML = S.svgString;
  } else {
    wrap.innerHTML = '';
    wrap.textContent = 'no output — try a different detail level';
  }
  const btn = document.getElementById('easyExport');
  if (btn) btn.disabled = !S.svgString;
}

function updateModeUI() {
  const btnMode = document.getElementById('btnMode');
  if (btnMode) {
    const label = mode === 'easy' ? 'Easy' : mode === 'strokes' ? 'Strokes' : 'Pipeline';
    btnMode.textContent = `Mode: ${label}`;
    btnMode.style.color       = mode !== 'pipeline' ? 'var(--accent)' : '';
    btnMode.style.borderColor = mode !== 'pipeline' ? 'var(--accent)' : '';
  }
  // Pipeline-only buttons hidden outside pipeline mode.
  const btnAutoAll  = document.getElementById('btnAutoAll');
  const btnMultiPath = document.getElementById('btnMultiPath');
  if (btnAutoAll)  btnAutoAll.style.display  = mode === 'pipeline' ? '' : 'none';
  if (btnMultiPath) btnMultiPath.style.display = mode === 'pipeline' ? '' : 'none';
  // Container visibility (only switch away from dropzone once an image exists).
  const easy = document.getElementById('easy');
  const pipeline = document.getElementById('pipeline');
  if (S.imageData) {
    if (easy)     easy.style.display     = mode === 'easy' ? 'flex' : 'none';
    if (pipeline) pipeline.style.display = mode === 'easy' ? 'none' : 'flex';
  }
}
```

- [ ] **Step 3: Branch `loadFile` for Easy mode**

In `app.js`, in `loadFile`, replace this block:

```js
  // Auto-detect thresholds for the new image before running pipeline
  const gray = EdgeDetector.toGrayscale(S.imageData);
  const leveled = EdgeDetector.levels(gray, P.blackPoint, P.whitePoint, P.gamma);
  setParam('threshold', Thresholder.otsu(leveled));
  setParam('layerThreshold', Thresholder.otsu3(leveled)[0]); // darker level for tonal-layer loops

  showPipeline();
  await runFrom(0);
```

with:

```js
  if (mode === 'easy') {
    document.getElementById('dropzone').style.display = 'none';
    document.getElementById('easy').style.display = 'flex';
    await runEasy();
    return;
  }

  // Auto-detect thresholds for the new image before running pipeline
  const gray = EdgeDetector.toGrayscale(S.imageData);
  const leveled = EdgeDetector.levels(gray, P.blackPoint, P.whitePoint, P.gamma);
  setParam('threshold', Thresholder.otsu(leveled));
  setParam('layerThreshold', Thresholder.otsu3(leveled)[0]); // darker level for tonal-layer loops

  showPipeline();
  await runFrom(0);
```

- [ ] **Step 4: Make the mode switch 3-way**

In `app.js`, replace the `#btnMode` handler:

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

with:

```js
  const btnMode = document.getElementById('btnMode');
  if (btnMode) {
    btnMode.addEventListener('click', () => {
      mode = mode === 'easy' ? 'strokes' : mode === 'strokes' ? 'pipeline' : 'easy';
      if (mode !== 'easy') createStepCards();
      updateModeUI();
      if (S.imageData) {
        if (mode === 'easy') {
          runEasy();
        } else {
          showPipeline();
          runFrom(0);
        }
      }
    });
  }
```

- [ ] **Step 5: Wire the detail control and Easy export**

In `app.js`, inside `init()`, after the `btnMode` block and before the closing brace of `init()`, add:

```js
  const easyDetail = document.getElementById('easyDetail');
  if (easyDetail) {
    easyDetail.addEventListener('click', e => {
      const btn = e.target.closest('button[data-level]');
      if (!btn) return;
      easyLevel = btn.dataset.level;
      easyDetail.querySelectorAll('button').forEach(b =>
        b.classList.toggle('active', b === btn));
      if (S.imageData && mode === 'easy') runEasy();
    });
  }

  const easyExport = document.getElementById('easyExport');
  if (easyExport) easyExport.addEventListener('click', exportSVG);

  updateModeUI();
```

- [ ] **Step 6: Verify the file parses**

```bash
node --check app.js
```

Expected: no output (exit 0).

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat: wire Easy mode (runEasy, 3-way mode switch, detail control)"
```

---

### Task 6: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Serve the app**

```bash
node server.js &
```

Open `http://localhost:3333`. Header shows "Mode: Easy"; "Auto All" and "Multi-path" buttons are hidden.

- [ ] **Step 2: Upload and confirm auto result**

Load an image from `testData/` (e.g. drag in or click Load Image). Confirm:
- The `#easy` view appears (DETAIL segmented control + a single white result panel), NOT the step strip.
- A non-empty single-line drawing renders at the default **Mid** level without touching any control.

- [ ] **Step 3: Confirm the dial changes density monotonically**

Click **Low**, then **High**. Confirm the drawing visibly gets sparser/bolder at Low and denser/more detailed at High, and that none of the three levels produces an empty result.

- [ ] **Step 4: Try several different images**

Load 3–4 different `testData/` images (portrait, photo, high-key, low-key). Confirm each produces a recognizable, non-empty result at Mid with no tweaking. (This is the core success criterion: no image comes out empty.)

- [ ] **Step 5: Confirm Strokes and Pipeline modes are intact**

Click "Mode" to switch to Strokes, then Pipeline. Confirm:
- The step strip reappears with each mode's full controls.
- With an image loaded, each mode re-runs and renders as before.
- The Easy view is hidden in those modes.

- [ ] **Step 6: Confirm export**

Back in Easy mode, click "Export SVG" and confirm a `singleline.svg` downloads and opens as the displayed drawing.

- [ ] **Step 7: Tune if needed**

If any image comes out too sparse/dense at a level, adjust the `EASY_LEVELS` coverage/abstraction/`minLoopArcFrac` numbers in `app.js` and re-verify. Commit any tuning:

```bash
git add app.js
git commit -m "tune: Easy-mode detail-level coverage targets"
```

---

## Self-Review

**Spec coverage:**
- Auto-level (analyzeHistogram + gamma) → Task 3. ✓
- Coverage-targeted thresholds (`thresholdForCoverage`) → Task 1 + Task 3. ✓
- Low/Mid/High table mapping every knob → Task 3 (`EASY_LEVELS`) + Task 2 (`minLoopArcFrac` plumbed). ✓
- Thin layer reusing Strokes pipeline → Task 5 (`runEasy` calls `STROKE_STEPS[].run()`). ✓
- 3-way mode cycle, Easy default → Task 4 (label) + Task 5 (switch). ✓
- Easy UI: upload (shared), Low/Mid/High control, result preview, export → Task 4 + Task 5. ✓
- Files: `Thresholder.js`, `app.js`, `index.html` → all covered. ✓
- Out of scope (reroll, advanced panel, Pipeline changes) → not present. ✓

**Type consistency:** `deriveEasyParams` returns exactly the keys assigned via `Object.assign(P, …)` and all exist in `P` after Task 2 adds `minLoopArcFrac`. `thresholdForCoverage(gray, targetFrac)` signature matches its calls. DOM ids (`easy`, `easyDetail`, `easyResult`, `easyExport`) are identical in Task 4 markup and Task 5 wiring. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓
