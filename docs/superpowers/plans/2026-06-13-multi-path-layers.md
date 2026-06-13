# Multi-Path Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional multi-path mode that runs three independent pipeline passes at auto-computed threshold levels and emits one SVG `<path>` per layer with adjustable grey shades.

**Architecture:** `Thresholder.otsu3` computes two class boundaries from the leveled grayscale; `app.js` derives three threshold values (t_low, t_mid, t_high) and runs the full threshold→contour→simplify→path-plan→spline sub-pipeline for each; `makeSVG` is updated to accept an array of `{d, color}` layers. Steps 1–8 are unchanged; all multi-path work happens inside step 09's `run()`. A toggle button in the header switches modes; color swatches and threshold readouts appear in step 09's controls when multi-path is on.

**Tech Stack:** Vanilla JS ES modules, browser Canvas API, no build step.

---

## File Map

| File | Change |
|------|--------|
| `Thresholder.js` | Add `static otsu3(gray)` — returns `[t1, t2]` |
| `app.js` | Update `makeSVG` signature; add `multiPath` state + `layerColors`; add `runLayer()` helper; update step 09 `run()`; add toggle wiring in `init()`; inject multi-path controls in `createStepCards()` |
| `index.html` | Add `<button id="btnMultiPath">` to `.header-right` |

`SVGExporter.js` is not used by the live pipeline — leave it untouched.

---

## Task 1: Add `Thresholder.otsu3`

**Files:** Modify `Thresholder.js`

- [ ] **Add the method after `otsu()`:**

```js
// 3-class Otsu: exhaustive (t1, t2) search for two thresholds that
// maximise total inter-class variance. Returns [t1, t2] where t1 < t2.
static otsu3(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const N = gray.length;

  // Prefix sums: cn[i+1] = pixel count for values 0..i; cs[i+1] = their sum
  const cn = new Float64Array(257);
  const cs = new Float64Array(257);
  for (let i = 0; i < 256; i++) {
    cn[i + 1] = cn[i] + hist[i];
    cs[i + 1] = cs[i] + i * hist[i];
  }
  const μ = cs[256] / N;

  let maxVar = -1, t1Best = 85, t2Best = 170;

  for (let t1 = 1; t1 < 254; t1++) {
    const w0 = cn[t1 + 1];
    if (w0 === 0) continue;
    const μ0 = cs[t1 + 1] / w0;

    for (let t2 = t1 + 1; t2 < 255; t2++) {
      const w1 = cn[t2 + 1] - cn[t1 + 1];
      if (w1 === 0) continue;
      const w2 = N - cn[t2 + 1];
      if (w2 === 0) continue;

      const μ1 = (cs[t2 + 1] - cs[t1 + 1]) / w1;
      const μ2 = (cs[256] - cs[t2 + 1]) / w2;

      const v = w0 * (μ0 - μ) ** 2 + w1 * (μ1 - μ) ** 2 + w2 * (μ2 - μ) ** 2;
      if (v > maxVar) { maxVar = v; t1Best = t1; t2Best = t2; }
    }
  }

  return [t1Best, t2Best]; // class boundaries: ≤t1, t1<…≤t2, >t2
}
```

- [ ] **Commit:**

```bash
git add Thresholder.js
git commit -m "feat: add Thresholder.otsu3 — 3-class threshold via exhaustive inter-class variance search"
```

---

## Task 2: Update `makeSVG` to accept layers array

**Files:** Modify `app.js` — `makeSVG` function and its one call site in step 09's `run()`

- [ ] **Replace `makeSVG` (currently at the `function makeSVG` definition ~line 322):**

Old signature: `makeSVG(d, w, h, sw)` — single path string.

New signature: `makeSVG(layers, w, h, sw)` — array of `{d, color}`.

```js
function makeSVG(layers, w, h, sw) {
  const paths = layers.map(({ d, color }) =>
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
  ).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<rect width="${w}" height="${h}" fill="white"/>
${paths}
</svg>`;
}
```

- [ ] **Update the existing call site in step 09's `run()` (currently `makeSVG(d, W, H, P.strokeWidth)`):**

```js
S.svgString = makeSVG([{ d, color: 'black' }], W, H, P.strokeWidth);
```

- [ ] **Commit:**

```bash
git add app.js
git commit -m "refactor: update makeSVG to accept layers array — backward compat via single-element array"
```

---

## Task 3: Add multi-path state, `runLayer` helper, and step 09 logic

**Files:** Modify `app.js`

- [ ] **Add module-level state just after the `P_DEFAULTS` block (after line ~37):**

```js
let multiPath = false;
const layerColors = ['#bbbbbb', '#777777', '#222222']; // [fine, medium, coarse]
```

- [ ] **Add `runLayer` helper just before `runFrom` (after the `makeSVG` function):**

```js
function runLayer(leveled, threshold) {
  const binary   = Thresholder.apply(leveled, threshold);
  const raw      = ContourTracer.trace(binary, W, H);
  const minArea  = P.minContourFrac * W * H;
  const filtered = ContourSimplifier.filter(raw, minArea);
  const contours = ContourSimplifier.simplify(filtered, P.simplification);
  const euler    = PathPlanner.solve(contours, { maxJumpFrac: P.maxJumpFrac, width: W, height: H });
  const smoothed = BezierPathBuilder.smooth(euler, 4);
  return BezierPathBuilder.build(smoothed, 0.5);
}
```

- [ ] **Replace step 09's `run()` body (currently in the STEPS array, the last entry):**

Find the step 09 object's `run()` method. Replace its body so it handles both modes:

```js
run() {
  if (!S.leveled) { S.svgString = ''; return; }
  if (multiPath) {
    const [t1, t2] = Thresholder.otsu3(S.leveled);
    const thresholds = [t1, Math.round((t1 + t2) / 2), t2]; // fine, medium, coarse
    const layers = thresholds.map((t, i) => ({ d: runLayer(S.leveled, t), color: layerColors[i] }));
    S.svgString = makeSVG(layers, W, H, P.strokeWidth);
    thresholds.forEach((t, i) => {
      const el = document.getElementById(`mp-t${i}`);
      if (el) el.textContent = `t=${t}`;
    });
  } else {
    if (!S.smoothed?.length) { S.svgString = ''; return; }
    const d = BezierPathBuilder.build(S.smoothed, 0.5);
    S.svgString = makeSVG([{ d, color: 'black' }], W, H, P.strokeWidth);
  }
},
```

- [ ] **Commit:**

```bash
git add app.js
git commit -m "feat: add multi-path pipeline — runLayer helper + step 09 dual-mode run"
```

---

## Task 4: Add toggle button to header

**Files:** Modify `index.html`

- [ ] **Insert `<button id="btnMultiPath">` inside `.header-right`, before `id="btnReset"`:**

```html
<button class="btn-reset" id="btnMultiPath">Multi-path: OFF</button>
```

Full updated `.header-right` block:

```html
<div class="header-right">
  <div class="status-badge" id="statusBadge">no image</div>
  <button class="btn-auto" id="btnAutoAll">Auto All</button>
  <button class="btn-reset" id="btnMultiPath">Multi-path: OFF</button>
  <button class="btn-reset" id="btnReset">Reset Settings</button>
  <label class="btn-load">
    Load Image
    <input type="file" id="fileInput" accept="image/*">
  </label>
</div>
```

- [ ] **Wire the toggle in `init()` in `app.js`, after the `btnAutoAll` block:**

```js
const btnMultiPath = document.getElementById('btnMultiPath');
if (btnMultiPath) {
  btnMultiPath.addEventListener('click', () => {
    multiPath = !multiPath;
    btnMultiPath.textContent = `Multi-path: ${multiPath ? 'ON' : 'OFF'}`;
    btnMultiPath.style.color         = multiPath ? 'var(--accent)' : '';
    btnMultiPath.style.borderColor   = multiPath ? 'var(--accent)' : '';
    const mpControls = document.getElementById('multipath-controls');
    if (mpControls) mpControls.style.display = multiPath ? 'flex' : 'none';
    if (S.leveled) runFrom(8);
  });
}
```

- [ ] **Commit:**

```bash
git add index.html app.js
git commit -m "feat: add Multi-path toggle button to header"
```

---

## Task 5: Add layer controls to step 09 card

**Files:** Modify `app.js` — inside `createStepCards()`

The color swatches and threshold readouts live in step 09's `.step-controls` area. They are always created but hidden; the toggle in Task 4 shows/hides them via `id="multipath-controls"`.

- [ ] **Inside `createStepCards()`, find the `if (step.isSVG)` block that creates the Export SVG button. Add the multi-path controls div after the export button:**

```js
if (step.isSVG) {
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn-export';
  exportBtn.textContent = 'Export SVG';
  exportBtn.disabled = true;
  exportBtn.addEventListener('click', exportSVG);
  ctrl.appendChild(exportBtn);

  // Multi-path layer controls (hidden until toggle is on)
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
        <span id="mp-t${idx}" style="font-family:var(--mono);font-size:11px;color:var(--muted);min-width:40px">—</span>
        <input type="color" id="mp-color-${idx}" value="${defaults[idx]}"
          style="width:32px;height:24px;cursor:pointer;border:1px solid var(--border);border-radius:4px;padding:1px;background:none">
      </div>`;
    wrap.querySelector(`#mp-color-${idx}`).addEventListener('input', e => {
      layerColors[idx] = e.target.value;
      if (S.leveled && multiPath) runFrom(8);
    });
    mpDiv.appendChild(wrap);
  });

  ctrl.appendChild(mpDiv);
}
```

Note: the existing code in `createStepCards` already has `if (step.isSVG)` creating the export button — **replace that entire block** with the version above (which includes the export button plus the new mpDiv).

- [ ] **Commit:**

```bash
git add app.js
git commit -m "feat: add multi-path layer controls (color swatches + threshold readouts) to step 09"
```

---

## Task 6: Manual verification

- [ ] Start the server: `node server.js` and open `http://localhost:3333`
- [ ] Load `testData/IMG_2845.png`
- [ ] Confirm pipeline runs normally in single-path mode (step 09 shows single black line SVG)
- [ ] Click "Multi-path: ON" — button turns accent color, layer controls appear in step 09
- [ ] Confirm step 09 reruns and SVG shows three paths in light/medium/dark grey
- [ ] Click each color swatch — native color picker opens; changing a color re-renders SVG
- [ ] Threshold readouts (t=N) update next to each swatch label
- [ ] Click "Multi-path: OFF" — single-path SVG reappears, layer controls hide
- [ ] Export SVG — file contains 3 `<path>` elements (open in text editor to verify)
