# Expressive Strokes Mode — Design

**Date:** 2026-06-18
**Status:** Approved for planning

## Goal

Add a new drawing mode that renders an image as **1–3 bold, expressive, pure strokes** — a fundamentally different approach from the current contour/threshold pipeline. The current pipeline traces every contour and then fights to filter out fine-detail noise; this mode never admits noise because it only ever keeps a handful of high-importance strokes.

The output is **pure line work**: deliberate black strokes on white, no tone, no shading, no fill, no hatching, no patterns. Light areas simply receive no stroke.

### Stroke hierarchy (importance, not detail level)

- **Line 1 — Primary:** one bold, flowing line capturing the subject's *essence* (the dominant silhouette/contour). If good enough alone, the drawing can stop here.
- **Lines 2–3 — Complementary (optional):** supportive strokes that add structure so the drawing better *resembles* the original (e.g. a defining feature like brow+nose or jawline). Bold and meaningful in their own right — never fine-detail noise.

This is a hierarchy of **importance**, explicitly *not* the old high/mid/low detail split.

## Scope

- A **new mode alongside** the existing 9-step pipeline (toggle in header). The current pipeline is untouched and remains the default.
- Separate implementation, but **reuses shared primitives** (image load, grayscale, levels, Sobel, Otsu, contour tracing, simplify, smoothing).
- First entry in a possible future "collection of styles" — but only this one style is in scope now.

### Out of scope (possible future styles)

- Tonal / density-based shading (the originally-considered "space-filling / TSP" line). Explicitly dropped: no fill, no patterns.
- Variable / tapered stroke width.
- Face-specific or subject-specific logic.
- Automated tests (per standing project preference — validate visually).

## Data Flow

1. **Load → Grayscale → Levels** — reused from the current pipeline (shared front end).
2. **Two extraction sources, run in parallel:**
   - **Primary-line source:** boundary of the *largest tonal mass* — Otsu threshold → biggest contour. Yields one clean, dominant silhouette loop. Reuses `Thresholder`, `ContourTracer`.
   - **Feature-candidate source:** strongest *internal* edges — Sobel → NMS → connected edge segments. Reuses `EdgeDetector`.
3. **Rank & select** — score every candidate by importance; greedily select with spatial diversity (below).
4. **Abstract each kept stroke** — heavy RDP simplify + Catmull-Rom smooth → bold, confident, flowing curves. Reuses `ContourSimplifier`, `BezierPathBuilder`.
5. **Render** — pure black strokes on white; each kept stroke is its own `<path>`. No tone, no fill.

**Design rationale for the two-source split:** a thresholded mass produces a far cleaner dominant silhouette than raw edges; edges are better at catching internal features (eyes, nose, mouth) that are not separate tonal regions. The hybrid plays to both strengths.

## Ranking & Selection

### Importance score

Each candidate stroke is scored:

```
score = sqrt(arcLength) × avgEdgeStrength × spatialSpread
```

- **arcLength** — longer strokes carry more structure. Uses `√arcLength` (not raw length) so length does not completely dominate — this lets a short-but-crisp feature (e.g. a dark eye) compete for a complementary slot against a long faint line.
- **avgEdgeStrength** — mean Sobel magnitude along the stroke. Faint texture edges score low even when long; crisp structural edges score high.
- **spatialSpread** — bounding-box diagonal. Rewards strokes that span the subject over ones curled into a corner.

### Diversity selection

Greedy selection with a **spatial suppression radius**:

1. Pick the highest-scoring candidate.
2. Suppress remaining candidates that overlap it spatially (within the suppression radius).
3. Repeat until the stroke-count cap is reached.

This guarantees the 2–3 kept lines are **complementary** (different regions/features) rather than redundant copies of the same dominant edge.

The primary line is the top-scoring stroke (typically the mass boundary); complementary lines are the next diverse picks.

### User controls (two knobs)

- **Stroke count (1–3):** the cap. 1 = pure essence; 3 = more resemblance.
- **Abstraction (smooth ↔ faithful):** drives RDP tolerance + smoothing iterations. High = a few bold sweeping curves; low = strokes hug the real contour more tightly.

Other parameters (threshold, edge sensitivity, suppression radius) take sensible auto-defaults derived from the image, with optional advanced sliders deferred.

## Mode Integration & Code Structure

### Header

The existing Multi-path toggle gains a sibling: a mode selector (`Pipeline` / `Strokes`). Selecting `Strokes` swaps the step cards for this mode's stages. Default remains `Pipeline`.

### New files

- **`StrokeExtractor.js`** — orchestrates two-source extraction + scoring + diversity selection. The new brain of this mode.
- **Stroke-mode UI wiring** — its step cards, the two knobs, render (a new section in `app.js` or a dedicated `strokeMode.js`, following existing app structure).

### Reused as-is

`EdgeDetector` (grayscale, levels, Sobel/NMS), `Thresholder` (Otsu), `ContourTracer`, `ContourSimplifier` (arcLength, RDP), `BezierPathBuilder` (smooth).

### Params

Live in a parallel block on the existing `P` object, e.g. `P.strokeMode = { count, abstraction, ... }`, persisted via the same localStorage mechanism.

### Step cards (preserve the inspect-each-stage feel)

1. **Source** — grayscale + levels (shared).
2. **Mass & Edges** — threshold mass and Sobel edges side by side.
3. **Candidates** — all extracted strokes, drawn faint.
4. **Ranked Selection** — the chosen 1–3, color-coded by rank.
5. **Output** — final pure-stroke SVG.

## Output & Edge Cases

- **Output:** one `<svg>`, each kept stroke a separate `<path>`, pure black on white, bold uniform stroke width.
- **Non-portrait photos:** algorithm is subject-agnostic — ranks by structure, not "face." A landscape yields its dominant mass + key edges via the same path.
- **Degenerate images** (low contrast / empty): if no candidate clears a minimum score, render fewer strokes (possibly zero) rather than inventing noise. Failing quiet is intended behaviour for this mode.
- **Testing:** none automated; validated visually through the step cards.
