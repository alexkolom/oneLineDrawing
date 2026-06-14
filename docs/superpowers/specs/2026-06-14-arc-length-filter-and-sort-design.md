# Arc-Length Filter + Hierarchy Sort Design

**Date:** 2026-06-14  
**Status:** Approved

## Problem

Two compounding issues degrade output quality for textured images (fur, hair, skin):

1. **Contour noise** — fur/texture transitions produce dozens of short contours that survive the area filter because bounding-box area doesn't correlate with structural importance. These crowd the final line with noise loops.

2. **No hierarchy** — all contours are weighted equally. The silhouette and a 3px fur loop are treated identically. Structurally important (longer) contours should dominate the drawing.

## Solution

Add arc-length filtering and arc-length-based sorting to `ContourSimplifier`, applied in step 06.

Both changes are universal: they improve all photographic inputs and are neutral for clean graphics.

## ContourSimplifier Changes

### `static arcLength(contour)`
Sums Euclidean distances between consecutive points. Works on raw pixel-chain contours and RDP-simplified polylines.

### `filter(contours, minArea, minArcLength)`
Extends existing method with optional `minArcLength` parameter. A contour is dropped if it fails **either** the area check or the arc-length check. Arc-length filter runs on raw contours (before RDP), avoiding wasted computation on noise.

### `static sortByLength(contours)`
Sorts contours by arc-length descending. Non-mutating (returns new array). Called after RDP so sorted lengths reflect the actual simplified polylines passed to PathPlanner.

## Pipeline Order (step 06)

```
area filter → arc-length filter → RDP simplify → sort by arc-length
```

Previously: `area filter → RDP simplify` (unsorted output).

## app.js Changes

New param in `P`:
```js
minArcLengthFrac: 0.03  // fraction of image diagonal
```

New slider in step 06 controls:
- Label: "Min Arc"
- Range: 0–0.15, step: 0.005
- `firstAffected: 5`
- Default 0.03 ≈ 18px on a 600px image

Step 06 `run()`:
```js
const minArea      = P.minContourFrac * W * H;
const minArcLength = P.minArcLengthFrac * diag();
const filtered     = ContourSimplifier.filter(S.rawContours, minArea, minArcLength);
const simplified   = ContourSimplifier.simplify(filtered, P.simplification);
S.contours         = ContourSimplifier.sortByLength(simplified);
```

## Files to Change

| File | Change |
|------|--------|
| `ContourSimplifier.js` | Add `arcLength()`, extend `filter()`, add `sortByLength()` |
| `app.js` | Add `minArcLengthFrac` to `P`; update step 06 `run()` and controls |

## Out of Scope

- Changing path planner weighting (approach C, rejected)
- New pipeline step (approach C, rejected)
- Smoothing changes (separate problem, future work)
