# Single-Line Pipeline Rewrite — Design Spec
**Date:** 2026-06-12

## Goal

Replace the current image-to-SVG pipeline with one that produces organic, artistically coherent single-line drawings in the **Minimal Silhouette** style (Picasso-like — dominant outer contour plus a minimal set of interior structural features).

The current pipeline fails because `regionBoundaries` on posterized data produces blocky, grid-like edges. No amount of downstream patching recovers artistic quality lost at that step. The fix is a full architectural replacement from edge detection onward.

---

## Target Aesthetic

- **Minimal silhouette**: outer contour dominates, interior features are selective (eyes, jawline, key shadow edges — not texture)
- **Single unbroken stroke** as the strong preference; invisible pen-up jumps allowed only when forcing a connection would visibly degrade the result
- **Input assumption**: subject on clean white or transparent background (user pre-processes images)
- **Subjects**: mixed — portraits, animals, objects

---

## New Pipeline (9 steps)

| # | Step | Replaces | Controls |
|---|------|----------|----------|
| 01 | Original Image | — | — |
| 02 | Grayscale | — | — |
| 03 | Levels | — | Black Pt, White Pt, Gamma |
| 04 | Canny Edges | Posterize + Median + RegionBounds | Blur σ, High thresh, Low thresh |
| 05 | Skeleton | ContourTrace | — |
| 06 | Junction Graph | RDP + GreedyConnect | Min Branch, Silhouette Bonus |
| 07 | Euler Path | EulerPath (pass-through) | Max Jump |
| 08 | Smooth Spline | Chaikin | Tension, Sample rate |
| 09 | Single Line Output | — | Stroke Width |

---

## Step Details

### 04 — Canny Edges (`EdgeDetector.js`)

**What:** Replace `posterize → medianFilter → regionBoundaries` with a proper Canny pipeline.

**How:**
1. Gaussian blur with σ = `blurSigmaFrac × d` (default 0.006). Kernel radius = `ceil(3σ)`. This suppresses texture while preserving structural edges.
2. Sobel gradient — already implemented in `EdgeDetector._sobelFull`.
3. Non-maximum suppression — already implemented in `EdgeDetector.nonMaxSuppression`.
4. **New: double-threshold hysteresis.** Two thresholds relative to the maximum gradient magnitude:
   - `highFrac` (default 0.15): pixels above → strong edge, always kept
   - `lowFrac` (default 0.05): pixels between high and low → weak edge, kept only if 8-connected to a strong edge pixel (flood-fill from strong pixels)
   - Pixels below `lowFrac` → discarded

**Add to `EdgeDetector.js`:** a `hysteresis(nms, width, height, lowFrac, highFrac)` static method that takes the NMS output and returns a binary edge map.

---

### 05 — Skeleton (`Skeletonizer.js`) — new file

**What:** Zhang-Suen iterative thinning. Reduces the Canny binary edge map to 1-pixel-wide centerlines while preserving topology (no disconnections, no holes created).

**How:** Two sub-iterations per pass. Each sub-iteration marks pixels for removal if they satisfy neighbor-count conditions (standard Zhang-Suen P2–P9 conditions). Repeat until no pixels are marked in a full pass.

**Output:** binary `Uint8Array` of same dimensions, 255 = skeleton pixel, 0 = background.

---

### 06 — Junction Graph (`SkeletonGraph.js`) — new file

**What:** Builds a graph from the skeleton. Nodes = junctions (3+ neighbors) and endpoints (1 neighbor). Edges = branches (sequences of path pixels connecting two nodes).

**How:**
1. Classify every skeleton pixel by neighbor count (8-connectivity).
2. Trace branches: from each endpoint/junction, walk along path pixels until hitting the next endpoint/junction. Store the full pixel sequence for each branch.
3. **Prune:** remove branches shorter than `minBranchFrac × d` (default 0.02). After pruning, merge degree-2 nodes (re-connect their two branches into one).
4. **Silhouette weighting:** for each branch, check whether any adjacent pixel is background (white or transparent). If so, it's a silhouette branch. Branch weight = `length × (1 + silhouetteBonus × isSilhouette)`. `silhouetteBonus` default 2.0 (silhouette edges are 3× more important than interior edges).

**Output:** graph object with nodes (id, x, y, degree) and edges (id, nodeA, nodeB, pixels[], length, weight, isSilhouette).

---

### 07 — Euler Path (`PathPlanner.js`) — new file

**What:** Finds a single continuous route through all graph branches. Produces an ordered array of `{x, y}` points with `null` separators for pen-up moves.

**How:**
1. **Maximum spanning tree (Kruskal's):** select the highest-weight subset of branches that keeps all nodes connected. This prioritises long, silhouette-aligned branches and discards low-importance interior noise.
2. **Chinese Postman fix:** the MST is a tree — all leaf nodes have odd degree (1). To enable an Euler circuit, we must make all node degrees even. Find all odd-degree nodes; pair them by minimum-weight ghost edges (shortest-path distance through the tree). Add a ghost copy of each ghost edge. Ghost edges will be traversed as smooth connectors in the output.
3. **Hierholzer's algorithm:** extract one Euler circuit. At each junction, branch selection priority:
   - Unvisited real edge, longest first
   - Unvisited ghost edge (shortest available)
4. **Pen-up insertion:** for ghost edges whose Euclidean length exceeds `maxJumpFrac × d` (default 0.08), insert a `null` marker instead of drawing the connector.

**Output:** `Point[]` with `null` separators. In the typical case (well-connected subject on clean background) this is one unbroken stroke.

---

### 08 — Smooth Spline (`BezierPathBuilder.js` — rewrite)

**What:** Replace Chaikin corner-cutting with Catmull-Rom spline fitting. Catmull-Rom passes *through* its control points (unlike Chaikin which shrinks inward), so the result faithfully follows the skeleton without over-smoothing.

**How:**
1. Subsample the ordered path at one control point per `sampleFrac × d` pixels (default 0.005), keeping shape-defining turns. This also acts as the RDP replacement.
2. Fit Catmull-Rom through subsampled points with configurable tension (default 0.5; 0 = loose/curvy, 1 = tight/angular).
3. Convert each Catmull-Rom segment to a cubic Bézier (standard closed-form conversion) for SVG output.
4. Null separators → `M` (moveTo) commands in the SVG path data.

---

## Size-Agnostic Parameter Strategy

All pixel-based parameters are expressed as fractions of the image diagonal `d = √(W² + H²)`.

| Parameter | Default fraction | At d=849 (600×600) | Purpose |
|-----------|-----------------|-------------------|---------|
| `blurSigmaFrac` | 0.006 | σ ≈ 5 px | Texture suppression |
| `cannyHighFrac` | 0.15 | relative to max grad | Strong edge threshold |
| `cannyLowFrac` | 0.05 | relative to max grad | Hysteresis lower bound |
| `minBranchFrac` | 0.020 | ≈ 17 px | Prune noise branches |
| `silhouetteBonus` | 2.0 | unitless | Silhouette edge priority |
| `maxJumpFrac` | 0.08 | ≈ 68 px | Max pen-up distance |
| `splineTension` | 0.5 | unitless | Catmull-Rom tightness |
| `sampleFrac` | 0.005 | ≈ 4 px | Spline control point density |

**Slider UX:** sliders show the fraction value with a live parenthetical pixel equivalent, e.g. `Min Branch  0.020  (≈ 17 px)`.

`MAX_SIZE` (currently 600px) is kept for performance. Because all params scale with the diagonal, changing or removing `MAX_SIZE` automatically produces visually consistent output.

---

## Files

### New files
| File | Responsibility |
|------|---------------|
| `Skeletonizer.js` | Zhang-Suen thinning |
| `SkeletonGraph.js` | Junction detection, branch tracing, pruning, silhouette weighting |
| `PathPlanner.js` | MST (Kruskal's), Chinese Postman, Hierholzer Euler circuit |

### Modified files
| File | Change |
|------|--------|
| `EdgeDetector.js` | Add `hysteresis()` method; expose `blurSigma` as float (not integer radius) |
| `BezierPathBuilder.js` | Rewrite: Catmull-Rom fitting + cubic Bézier conversion |
| `app.js` | Rewire pipeline steps 04–08; replace all absolute params with diagonal-fraction params |

### Retired files (delete)
`ContourTracer.js`, `ContourGraph.js`, `GraphBuilder.js`, `GraphNode.js`, `GraphEdge.js`, `KDTreeConnector.js`, `Eulerizer.js`, `EulerPathSolver.js`, `RDPSimplifier.js`, `ChaikinSmoother.js`, `Pipeline.js`

---

## What This Does Not Cover

- Neural/diffusion-based curve optimization (Magne et al. 2026 style) — out of scope, requires external model
- Automatic background removal — user pre-processes; pipeline assumes clean input
- Variable stroke width for tonal shading — that is the Tonal/Zigzag style (C), not chosen
