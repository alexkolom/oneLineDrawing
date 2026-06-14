# Multi-path Threshold Sliders Design

**Date:** 2026-06-14  
**Status:** Approved

## Problem

In multi-path mode, the three path thresholds (t1, t_mid, t2) are auto-computed by `Thresholder.otsu3` on every pipeline run. When Otsu3 picks poor thresholds (e.g. on images with unusual tonal distributions), there is no way to override them — the `t=N` readouts are display-only.

## Solution

Store the three thresholds in a module-level array (`layerThresholds`). Otsu3 still runs when multi-path is first toggled ON to set sensible defaults. After that, each threshold is independently overrideable via a range slider in step 09's multi-path controls. The middle threshold (T-mid) also syncs back to `P.threshold` and the step 04 slider so the single-path threshold stays aligned.

## State Change

Add alongside `layerColors`:

```js
let layerThresholds = [85, 127, 170]; // [fine, medium, coarse] — overwritten by Otsu3 on toggle-ON
```

## Otsu3 Call Site Move

**Currently:** `Thresholder.otsu3(S.leveled)` is called inside step 09's `run()` on every pipeline run.

**After:** Otsu3 is called only in the `btnMultiPath` click handler when toggling ON. It sets `layerThresholds` and updates the three slider DOM elements (`#mp-slider-0/1/2`) to match. Step 09 `run()` reads `layerThresholds` directly — no Otsu3 call inside `run()`.

## Step 09 `run()` change

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

## btnMultiPath toggle handler change

When toggling ON, call Otsu3 and hydrate sliders:

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
    });
  }
  if (S.leveled) runFrom(8);
});
```

## UI: Replace readout with range slider

In `createStepCards()`, the `<span id="mp-t${idx}">` text readout is replaced with a range slider. Each layer row becomes:

```js
wrap.innerHTML = `
  <div class="ctrl-label">${label}</div>
  <div class="ctrl-row">
    <input type="range" id="mp-slider-${idx}" min="0" max="255" step="1" value="${layerThresholds[idx]}"
      style="width:80px">
    <span id="mp-t${idx}" style="font-family:var(--mono);font-size:11px;color:var(--muted);min-width:32px">${layerThresholds[idx]}</span>
    <input type="color" id="mp-color-${idx}" value="${defaults[idx]}"
      style="width:32px;height:24px;cursor:pointer;border:1px solid var(--border);border-radius:4px;padding:1px;background:none">
  </div>`;
```

## Slider event handler

```js
wrap.querySelector(`#mp-slider-${idx}`).addEventListener('input', e => {
  const v = Number(e.target.value);
  layerThresholds[idx] = v;
  const readout = document.getElementById(`mp-t${idx}`);
  if (readout) readout.textContent = v;
  if (idx === 1) {
    P.threshold = v;
    const thr = document.querySelector('#step-3 input[type=range]');
    if (thr) thr.value = v;
  }
  if (S.leveled && multiPath) runFrom(8);
});
```

## Files Changed

| File | Change |
|------|--------|
| `app.js` | Add `layerThresholds`; move Otsu3 to toggle handler; update step 09 `run()`; replace readout with slider in `createStepCards()`; add slider event handler |

## Out of Scope

- Bidirectional sync (step 04 slider → T-mid): not needed, one-directional is sufficient
- Per-layer "reset to auto" button: YAGNI
- Persisting threshold overrides across reloads: YAGNI
