# Multi-path Threshold Sliders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three independently-adjustable range sliders (T1, T-mid, T2) to the multi-path layer controls in step 09, replacing static readouts — Otsu3 sets defaults on toggle-ON, user can override freely, and T-mid syncs back to P.threshold and the step 04 slider.

**Architecture:** All changes are in `app.js`. A new `layerThresholds` array stores the live threshold values. Otsu3 moves from step 09 `run()` into the toggle handler (fires only on toggle-ON). Step 09 `run()` reads `layerThresholds` directly. The `createStepCards()` multipath block gains a range slider per layer plus an event handler that updates `layerThresholds`, syncs P.threshold for the mid slider, and triggers `runFrom(8)`.

**Tech Stack:** Vanilla JS ES modules, browser DOM, no build step. No tests (project policy).

---

## File Map

| File | Change |
|------|--------|
| `app.js` | Add `layerThresholds`; update step 09 `run()`; update `btnMultiPath` handler; update `createStepCards()` multipath block |

---

## Task 1: Add `layerThresholds` state and update step 09 `run()`

**Files:** Modify `/Users/alex/GitProjects/singleLine/app.js`

Two tightly-coupled edits: the new state variable and the `run()` that consumes it.

### Edit 1: Add `layerThresholds` after `layerColors`

Find:
```js
const layerColors = ['#bbbbbb', '#777777', '#222222']; // [fine, medium, coarse]
```

Replace with:
```js
const layerColors = ['#bbbbbb', '#777777', '#222222']; // [fine, medium, coarse]
let layerThresholds = [85, 127, 170];                  // [fine, medium, coarse] — overwritten by Otsu3 on toggle-ON
```

### Edit 2: Update step 09 `run()` — remove inline Otsu3, use `layerThresholds`

Find:
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

Replace with:
```js
    run() {
      if (!S.leveled) { S.svgString = ''; return; }
      if (multiPath) {
        const layers = layerThresholds.map((t, i) => ({ d: runLayer(S.leveled, t), color: layerColors[i] }));
        S.svgString = makeSVG(layers, W, H, P.strokeWidth);
      } else {
        if (!S.smoothed?.length) { S.svgString = ''; return; }
        const d = BezierPathBuilder.build(S.smoothed, 0.5);
        S.svgString = makeSVG([{ d, color: 'black' }], W, H, P.strokeWidth);
      }
    },
```

- [ ] **Make both edits above.**

- [ ] **Commit:**

```bash
git -C /Users/alex/GitProjects/singleLine add app.js
git -C /Users/alex/GitProjects/singleLine commit -m "feat: add layerThresholds state; step 09 run() reads layerThresholds instead of calling Otsu3"
```

---

## Task 2: Update `btnMultiPath` toggle handler to call Otsu3 and hydrate sliders

**Files:** Modify `/Users/alex/GitProjects/singleLine/app.js`

When the user toggles multi-path ON, run Otsu3 once, write the results into `layerThresholds`, and push the values into the slider DOM elements.

### Edit: Replace the `btnMultiPath` click handler body

Find:
```js
    btnMultiPath.addEventListener('click', () => {
      multiPath = !multiPath;
      btnMultiPath.textContent = `Multi-path: ${multiPath ? 'ON' : 'OFF'}`;
      btnMultiPath.style.color       = multiPath ? 'var(--accent)' : '';
      btnMultiPath.style.borderColor = multiPath ? 'var(--accent)' : '';
      const mpControls = document.getElementById('multipath-controls');
      if (mpControls) mpControls.style.display = multiPath ? 'flex' : 'none';
      if (S.leveled) runFrom(8);
    });
```

Replace with:
```js
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
```

- [ ] **Make the edit above.**

- [ ] **Commit:**

```bash
git -C /Users/alex/GitProjects/singleLine add app.js
git -C /Users/alex/GitProjects/singleLine commit -m "feat: call Otsu3 in toggle handler and hydrate threshold sliders on multi-path ON"
```

---

## Task 3: Replace threshold readouts with sliders in `createStepCards()`

**Files:** Modify `/Users/alex/GitProjects/singleLine/app.js`

Replace the static `<span id="mp-t${idx}">` readout with a range slider + numeric readout + existing color swatch. Add the slider `input` event handler after the color swatch handler.

### Edit: Replace the multipath `forEach` block inside `createStepCards()`

Find:
```js
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
```

Replace with:
```js
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
            if (S.leveled && multiPath) runFrom(8);
          });
          wrap.querySelector(`#mp-color-${idx}`).addEventListener('input', e => {
            layerColors[idx] = e.target.value;
            if (S.leveled && multiPath) runFrom(8);
          });
          mpDiv.appendChild(wrap);
        });
```

- [ ] **Make the edit above.**

- [ ] **Commit:**

```bash
git -C /Users/alex/GitProjects/singleLine add app.js
git -C /Users/alex/GitProjects/singleLine commit -m "feat: replace mp-t readouts with range sliders; T-mid syncs P.threshold and step 04 slider"
```
