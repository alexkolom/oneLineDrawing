# Framing Silhouette Line — Design

**Date:** 2026-06-23
**Status:** Approved, ready for implementation plan

## Problem

The single-line drawing traces interior detail and region boundaries, but the
subject's overall outline can be hard to read. The user wants an optional extra
line that traces the object's **outer boundary / silhouette** to frame the
drawing and make the object's shape legible.

## Goal

Add an optional, toggleable **framing silhouette line**: the outer boundary of
the subject, rendered as a separate bolder line layered with the single-line
drawing. Available in both **Easy** and **Strokes** modes. Default **off**.

Non-goal: changing Pipeline mode; folding the silhouette into the single
continuous stroke; convex-hull framing.

## Approach

Reuse what the pipeline already computes. `RegionTracer.trace` returns **outer
boundaries only** (each connected foreground component is flood-filled, so
interior holes are never traced), and the Tonal Mass step already stores these
loops as `SS.massContours`. The subject silhouette is therefore the
**largest-area loop(s)** in that set — no new tracing is required.

Rejected alternatives:
- *Dedicated hole-filled silhouette* (morphological close → fill → trace): more
  robust to a silhouette broken into pieces at the mass threshold, but adds a
  morphology helper and a second tracing pass. Deferred as a follow-up only if
  real images show broken frames.
- *Convex hull*: not the true silhouette shape.

## Components

### 1. `Silhouette.js` (new, pure)

A small isolated module. Depends only on `ContourSimplifier` and
`BezierPathBuilder` (both existing ES modules).

```
Silhouette.area(loop) → number
  Absolute polygon area via the shoelace formula. loop: array of {x,y}.

Silhouette.select(loops, fracOfMax = 0.5) → array of loops
  Returns the largest-area loop plus any whose area is >= fracOfMax * maxArea.
  Returns [] for empty input or when maxArea <= 0.

Silhouette.buildPath(loops, { simplifyEps, smooth, tension = 0.5 }) → string
  1. selected = select(loops)
  2. for each selected loop: rdp-simplify with simplifyEps; skip if < 2 pts;
     close it (append a copy of its first point); separate loops with null.
  3. smooth the combined point array with BezierPathBuilder.smoothFactor(_, smooth)
  4. return BezierPathBuilder.build(smoothed, tension)
  Returns '' when there is nothing to draw.
```

`buildPath` produces a single SVG path `d` string covering all silhouette loops
(multiple subpaths joined via `null` separators, which `build`/`smoothFactor`
already support).

### 2. Rendering — `makeSVG` per-layer width

`makeSVG(layers, w, h, sw)` currently applies one `sw` to every layer. Extend
each layer to optionally carry its own `width`:

```
stroke-width="${width ?? sw}"
```

Backward-compatible: existing layers omit `width` and keep using `sw`.

### 3. Integration point — STROKE OUTPUT step `run()`

Both Strokes and Easy modes execute the STROKE OUTPUT step (`STROKE_STEPS`
index 4), so this single `run()` covers both modes. New behavior:

```
run() {
  if (!SS.linkedPath?.length) { S.svgString = ''; return; }
  const smoothed = BezierPathBuilder.smoothFactor(SS.linkedPath, P.strokeSmooth);
  const d = BezierPathBuilder.build(smoothed, 0.5);
  if (!d) { S.svgString = ''; return; }
  const layers = [];
  if (frameOn) {
    const frameD = Silhouette.buildPath(SS.massContours || [], {
      simplifyEps: 0.006 * diag(),
      smooth: 1.5,
    });
    if (frameD) layers.push({ d: frameD, color: 'black', width: Math.max(2, P.strokeWidth * 2.5) });
  }
  layers.push({ d, color: 'black' });
  S.svgString = makeSVG(layers, W, H, P.strokeWidth);
}
```

The frame layer is pushed **first** so it renders **underneath** the detail
line (SVG paint order = array order). It gracefully no-ops (no frame layer)
when `SS.massContours` is empty or `buildPath` returns ''.

### 4. Toggle + state

Module-level `let frameOn = false;` — default off, session state only (not
persisted), mirroring the existing `multiPath` toggle pattern. Two UI entry
points, both flipping `frameOn` and re-rendering:

- **Easy mode:** a "Frame" toggle button in the `.easy-bar` (id `#easyFrame`).
  On click: flip `frameOn`, update button active state, and if an image is
  loaded call `runEasy()`.
- **Strokes mode:** a "Frame" toggle in the STROKE OUTPUT step controls
  (created in `createStepCards`, only for the STROKE OUTPUT step). On click:
  flip `frameOn`, update button state, and `runFrom(4)` if an image is loaded.

The two toggles share the same `frameOn`, so the state carries across a mode
switch and the next render in either mode reflects it.

## Defaults / Decisions

- Frame drawn **underneath** the detail line.
- Toggle **defaults off**.
- Frame color: black; width `max(2, strokeWidth * 2.5)`.
- `select` keeps loops within 50% of the max area (largest plus comparable big
  blobs), dropping smaller noise loops.
- `simplifyEps = 0.006 * diag`, `smooth = 1.5`, `tension = 0.5` — tunable
  starting points.

## Files Touched

- **`Silhouette.js`** — new module (`area`, `select`, `buildPath`).
- **`app.js`** — import `Silhouette`; per-layer `width` in `makeSVG`; frame
  logic in STROKE OUTPUT `run()`; `frameOn` state; Easy-bar toggle wiring;
  Strokes STROKE-OUTPUT toggle in `createStepCards`.
- **`index.html`** — "Frame" toggle button (`#easyFrame`) in the `.easy-bar`.

## Out of Scope (YAGNI)

- Hole-fill morphology (Approach B) — follow-up only if frames come out broken.
- Persisting the toggle across reloads.
- Frame color options or separate frame width slider.
- Pipeline-mode framing.

## Success Criteria

- With Frame on, a recognizable bolder outline of the subject's silhouette
  appears behind the single-line drawing, in both Easy and Strokes modes.
- Frame off reproduces today's output exactly (byte-identical SVG).
- Toggling does not break either mode; no image with no loops throws or shows a
  stray frame.
- Strokes and Pipeline modes' existing behavior is otherwise unchanged.
