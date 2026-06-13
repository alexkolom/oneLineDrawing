# Contour-Based Extraction Pipeline

**Date:** 2026-06-13  
**Goal:** Replace Canny + skeleton + junction graph with threshold → contour trace → RDP simplify, producing clean artsy contour output with minimal per-image adjustment.

---

## Problem

The current pipeline finds every edge pixel (Canny), thins them to 1-pixel centerlines (Zhang-Suen), then routes through all of them. This produces bulky, barely-recognizable output because:

1. Canny detects interior texture and noise, not just meaningful shape boundaries.
2. 12 parameters interact in non-obvious ways, requiring manual tuning per image.

The target aesthetic is clean contour style: minimal lines, only essential outlines, high readability.

---

## Architecture

The pipeline splits into **extraction** (steps 2–6) and **routing** (steps 7–9). Only extraction changes.

| Step | Current | New |
|------|---------|-----|
| 02 | Grayscale | Grayscale (unchanged) |
| 03 | Levels | Levels + Otsu auto-threshold (improved) |
| 04 | Canny edges | Threshold → binary image |
| 05 | Skeleton (Zhang-Suen) | Contour trace (Suzuki-Abe) |
| 06 | Junction graph | Contour filter + RDP simplify |
| 07 | Euler path | Euler path (unchanged) |
| 08 | Smooth spline | Smooth spline (unchanged) |
| 09 | SVG output | SVG output (unchanged) |

### New modules
- `Thresholder.js` — Otsu's method + binary thresholding
- `ContourTracer.js` — Suzuki-Abe border-following contour extraction
- `ContourSimplifier.js` — contour filtering + Ramer-Douglas-Peucker simplification

### Removed modules
- `Skeletonizer.js` — replaced by contour trace
- `SkeletonGraph.js` — replaced by contour simplifier

### Unchanged modules
- `EdgeDetector.js` — grayscale, levels, histogram analysis (Canny-specific methods can stay but go unused)
- `PathPlanner.js` — adapated to accept contour segments instead of graph edges
- `BezierPathBuilder.js` — unchanged
- `SVGExporter.js` — exists but currently unused (`app.js` uses its own `makeSVG`); leave unchanged

---

## Step Designs

### Step 4 — Threshold

Input: leveled grayscale `Uint8Array`  
Output: binary `Uint8Array` (0 = background, 255 = foreground)

- Apply Otsu's method: find threshold `t` that maximizes inter-class variance between pixel values below and above `t`.
- Parameter: `threshold` (0–255). Default = Otsu result. Manual override via slider.
- Auto button runs Otsu and sets the slider.

### Step 5 — Contour Trace

Input: binary image  
Output: `Array<{x,y}[]>` — list of contours, each an ordered array of pixel coordinates

- Implement Suzuki-Abe border-following (the standard algorithm for finding connected contour boundaries in a binary image).
- Traces both outer boundaries and hole boundaries of connected regions.
- No parameters.
- Each contour is a closed polygon (last point connects back to first).

### Step 6 — Contour Filter + Simplify

Input: raw contours  
Output: simplified contours ready for routing

Two sub-operations applied in sequence:

**Filter:** discard contours whose bounding area is below `minContourArea` (in px²).
- Default auto: `0.0005 × W × H` (0.05% of image area).
- Removes specks, noise, tiny closed loops that add clutter.

**Simplify:** run Ramer-Douglas-Peucker on each surviving contour with epsilon `simplification` (in px).
- Default: `1.5`px.
- Reduces dense pixel-walk outlines to clean sparse polylines.
- Higher epsilon = smoother, fewer points. Lower = more detail, more jagged.

---

## Parameters (new set)

| Key | Label | Default | Auto | Range |
|-----|-------|---------|------|-------|
| `threshold` | Threshold | Otsu | Otsu's method | 0–255 |
| `minContourArea` | Min Area | 0.0005 × W×H | 0.05% image area | 0–0.005 frac |
| `simplification` | Simplify | 1.5 | fixed | 0.5–10 px |
| `maxJumpFrac` | Max Jump | 0.08 | — | 0.01–0.3 |
| `strokeWidth` | Stroke Width | 1.0 | — | 0.5–4 |

**Removed params:** `blackPoint`, `whitePoint`, `gamma`, `detailLevel`, `blurSigmaFrac`, `cannyHighFrac`, `cannyLowFrac`, `closeFrac`, `minBranchFrac`, `silhouetteBonus`, `splineTension`, `sampleFrac`

> Note: `blackPoint`, `whitePoint`, `gamma` are kept on the Levels step (step 03) since contrast upstream directly affects which contours get traced. The Levels Auto button (histogram-based) also stays. These are the only surviving "old" params.

**Auto All button:** runs Otsu threshold, then sets `minContourArea` based on image size. Located in the header / controls bar. Gives a good result for most images with zero manual steps.

---

## PathPlanner adaptation

Currently `PathPlanner.solve(graph, options)` takes a `SkeletonGraph` with `.nodes` and `.edges`.

With contours, the input is an array of polyline segments (each contour is one segment). The planner needs to:
1. Treat each contour as a traversable segment (forward or reversed).
2. Find the ordering and direction of segments that minimizes total pen-up jump distance.
3. Produce the same `(Point | null)[]` output format (nulls = pen-up).

This is a nearest-neighbor TSP over segment endpoints. The existing Chinese Postman / Hierholzer logic is not needed since contours don't share endpoints — replace with a greedy nearest-neighbor pass over open/closed contour endpoints.

---

## UI changes

- Remove sliders for deleted params.
- Add `threshold` slider + Auto button to step 04.
- Add `minContourArea` slider + auto note to step 06.
- Add `simplification` slider to step 06.
- Add **Auto All** button to the top controls bar.
- Step 05 (contour trace) has no controls — header only.

---

## Out of scope

- Stroke width variation (thicker lines for silhouette vs. thin for interior).
- Multi-threshold / color-region contours.
- Undo / history.
