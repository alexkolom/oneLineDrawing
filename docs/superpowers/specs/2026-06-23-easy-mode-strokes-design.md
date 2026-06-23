# Easy Mode for Strokes — Design

**Date:** 2026-06-23
**Status:** Approved, ready for implementation plan

## Problem

In Strokes mode, every image needs hand-tweaking to get a decent result. The
dominant failure modes when a user uploads and does *not* tweak are:

1. **Tone wrong** — black/white points and gamma don't match the image, so
   shadows clump to black or highlights vanish before thresholding.
2. **Too sparse / missed contours** — the thresholds (currently raw Otsu) miss
   the right cut, so important features produce no loops and the drawing is
   nearly empty.

The user's own summary: *"we always miss the correct threshold and levels and
thus, miss the contours to draw."*

## Goal

Add an **Easy mode**: upload an image → get a final single-line result with no
per-setting tweaking. A single **Low / Mid / High** detail dial re-derives every
underlying parameter coherently. No other knobs are visible.

Non-goal: replacing Strokes or Pipeline mode. Both stay fully intact for manual
work.

## Approach

**Auto-level + coverage-targeted thresholds.** Easy mode is a thin layer over the
existing Strokes pipeline — it does not re-implement any tracing, linking, or
rendering. A pure deriver computes parameter values, sets the same `P.*` values
the 5 Strokes steps already consume, then runs that pipeline unchanged and shows
the final SVG.

The two failure modes are attacked directly:
- **Tone wrong** → per-image auto-leveling from the histogram, applied *before*
  any threshold is chosen.
- **Missed contours** → thresholds chosen by a *target ink coverage* rather than
  trusting Otsu. We demand an ink budget, so loops are guaranteed to exist.

Rejected alternatives:
- *Otsu + detail offsets* — inherits Otsu's blind spots; fails on exactly the
  images that fail today.
- *Randomized reroll* — non-deterministic, doesn't target the failure modes.

## The Deriver (core)

A single pure function:

```
deriveEasyParams(gray, detailLevel) → {
  blackPoint, whitePoint, gamma,
  threshold, layerThreshold,
  strokeAbstraction, strokeSmooth,
  minLoopArcFrac, strokeWidth
}
```

`gray` is the grayscale array for the current image; `detailLevel` is one of
`'low' | 'mid' | 'high'`.

### Step 1 — Auto-level (kills "tone wrong")

- `{ blackPoint, whitePoint } = EdgeDetector.analyzeHistogram(gray)` — uses the
  image's actual 5th/95th percentiles (existing helper, currently only wired
  into Pipeline's "Auto All").
- `gamma` derived from the mean brightness of the leveled image: a dark image is
  brightened (gamma < 1), a bright image left near neutral. Clamp to a sane range
  (e.g. 0.5–1.2).

This normalizes every image into the same tonal working range before any
threshold is selected.

### Step 2 — Coverage-targeted thresholds (kills "missed contours")

New helper:

```
Thresholder.thresholdForCoverage(leveled, targetFrac) → threshold (0–255)
```

Walks the cumulative histogram of the *leveled* image and returns the smallest
threshold whose binarization yields approximately `targetFrac` of foreground
(dark) pixels. Note: `Thresholder.apply` treats dark pixels as foreground, so
foreground fraction = fraction of pixels with value `< threshold`. A smaller
target → darker (lower) threshold → fewer, deeper pixels.

- `threshold` (Tonal Mass) = `thresholdForCoverage(leveled, massCoverage)`
- `layerThreshold` (Tonal Layers) = `thresholdForCoverage(leveled, layerCoverage)`
  where `layerCoverage < massCoverage` (deeper shadows).

### Step 3 — Map the dial

`detailLevel` selects one row of a small table that sets every downstream knob
coherently:

| Detail | Mass coverage | Layer coverage | strokeAbstraction | strokeSmooth | minLoopArcFrac |
|--------|---------------|----------------|-------------------|--------------|----------------|
| Low    | ~0.10         | ~0.04          | 0.8 (bold sweeps) | high         | large (drop tiny loops) |
| Mid    | ~0.18         | ~0.08          | 0.5               | mid          | medium |
| High   | ~0.28         | ~0.14          | 0.25 (tight)      | low          | small (keep detail) |

Numbers are starting points, tunable during implementation. `maxJumpFrac` and
`strokeWidth` stay at sensible fixed defaults (per-detail `strokeWidth` nudge
optional). The dial changes **both density and line style** (bolder/simpler when
Low) — confirmed acceptable.

The deriver is pure — `(gray, level) → params` — so all tuning lives in one
place.

## Integration

### Mode switching

`btnMode` currently toggles Pipeline ↔ Strokes. It becomes a 3-way cycle:
**Easy → Strokes → Pipeline**. Easy is the default landing mode.

### Easy mode UI

Hides the step strip entirely. Shows:
- Image upload (shared)
- A **Low / Mid / High** segmented control (defaults to **Mid**)
- The result preview — reuses the Stroke Output SVG render
- Export SVG button (shared)

### Flow

On upload **or** dial change:
1. `deriveEasyParams(gray, level)` computes the param set.
2. Those values are written to `P.*`.
3. The existing Strokes pipeline runs (`runFrom(0)` in strokes mode).
4. The final SVG is shown.

No per-step UI, no other knobs.

## Files Touched

- **`Thresholder.js`** — add `thresholdForCoverage(leveled, targetFrac)`
  (cumulative-histogram lookup).
- **`app.js`** — add `deriveEasyParams()` + the detail-level table; Easy-mode
  state and the 3-way mode switch; derive-and-run wiring; parametrize the two
  hardcoded `0.04 * diag()` min-arc filters in Strokes steps 02 (Tonal Mass) and
  03 (Tonal Layers) to read `P.minLoopArcFrac` so the dial can prune loops.
- **`index.html`** — Easy-mode container + Low/Mid/High segmented control; make
  Easy the default visible mode.

## Out of Scope (YAGNI)

- Randomized reroll / variation button.
- An advanced-knobs panel inside Easy mode.
- Any change to Pipeline mode behavior.
- Persisting the detail level beyond the existing param storage.

## Success Criteria

- Uploading a varied set of test images in Easy mode at **Mid** produces a
  recognizable, non-empty single-line drawing **without** touching any setting.
- Switching Low → Mid → High visibly and monotonically changes density.
- No image comes out empty (coverage targets guarantee ink).
- Strokes and Pipeline modes are unchanged.
