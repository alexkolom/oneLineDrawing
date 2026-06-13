# Multi-Path Layer Design

**Date:** 2026-06-13  
**Status:** Approved

## Problem

A single threshold can't capture both the outer silhouette (needs high threshold ~200) and internal face features like eyes, nose, mouth (needs low threshold ~60). The result is always a trade-off.

## Solution

Three independent pipeline passes at auto-computed threshold levels, each producing its own SVG `<path>` with a distinct grey shade. Coarse captures the silhouette, fine captures subtle details, medium sits between them.

## Threshold Computation

Add `Thresholder.otsu3(gray)` — 3-class Otsu via exhaustive search over all `(t1, t2)` pairs to maximise total inter-class variance. Returns `[t_low, t_mid, t_high]` adaptive to the image histogram.

## Pipeline Architecture

Three independent full passes: `threshold → contour trace → filter/simplify → path plan → spline`.

- No pixel subtraction between layers — each pass is fully independent
- Silhouette edge appears in all three layers; coarse (darkest, rendered last) naturally dominates
- SVG `<path>` order: fine first, medium second, coarse last (painter's order)
- Single-path mode is unchanged; multi-path is an opt-in toggle

## UI

- Toggle: "Multi-path" checkbox/button in controls panel
- When enabled:
  - Single threshold slider hidden; three read-only threshold readouts shown
  - Three color swatches: `#222` (coarse), `#777` (medium), `#bbb` (fine) — click to open native color picker
  - SVG preview and export reflect all three paths
- When disabled: existing single-path UI, no changes

## Files to Change

| File | Change |
|------|--------|
| `Thresholder.js` | Add `otsu3(gray)` static method |
| `app.js` | Multi-path toggle, 3-pass pipeline, updated SVG step, color swatch UI |
| `SVGExporter.js` | Accept array of `{path, color}` objects, emit one `<path>` per entry |

## Out of Scope

- Manual threshold sliders per layer (future)
- More than 3 layers
- Stroke width per layer (future)
- Subtractive/exclusive pixel assignment between layers
