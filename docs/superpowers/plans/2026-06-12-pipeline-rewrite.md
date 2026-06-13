# Single-Line Pipeline Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the posterize→regionBoundaries pipeline with Canny+hysteresis→Zhang-Suen skeleton→junction graph→MST Euler circuit→Catmull-Rom spline, producing organic single-line SVG drawings.

**Architecture:** EdgeDetector gains float-sigma blur and a `hysteresis()` method to complete Canny. Three new pure modules (Skeletonizer, SkeletonGraph, PathPlanner) handle skeleton thinning, graph construction, and Euler path planning. BezierPathBuilder gains a tension parameter and subsampling. app.js is rewired to 9 steps with all parameters expressed as fractions of the image diagonal.

**Tech Stack:** Vanilla ES modules, `"type": "module"` already set in package.json. Tests are plain Node.js scripts (`node tests/test-*.js`), no test runner needed.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `EdgeDetector.js` | Modify | Add `hysteresis()` method; change `gaussianBlur` to accept float sigma |
| `Skeletonizer.js` | Create | Zhang-Suen iterative thinning |
| `SkeletonGraph.js` | Create | Junction detection, branch tracing, pruning, silhouette weighting |
| `PathPlanner.js` | Create | MST (Kruskal's), Chinese Postman, Hierholzer Euler circuit |
| `BezierPathBuilder.js` | Modify | Add tension parameter + arc-length subsampling |
| `app.js` | Rewrite | 9 new pipeline steps, size-agnostic params, new imports |
| `tests/test-edge-detector.js` | Create | Tests for hysteresis |
| `tests/test-skeletonizer.js` | Create | Tests for Zhang-Suen |
| `tests/test-skeleton-graph.js` | Create | Tests for graph construction |
| `tests/test-path-planner.js` | Create | Tests for Euler circuit |
| `tests/test-bezier.js` | Create | Tests for subsampling + tension |
| `ContourTracer.js`, `ContourGraph.js`, `GraphBuilder.js`, `GraphNode.js`, `GraphEdge.js`, `KDTreeConnector.js`, `Eulerizer.js`, `EulerPathSolver.js`, `RDPSimplifier.js`, `ChaikinSmoother.js`, `Pipeline.js` | Delete | Retired |

---

## Task 1: Update EdgeDetector — float sigma + hysteresis

**Files:**
- Modify: `EdgeDetector.js`
- Create: `tests/test-edge-detector.js`

- [ ] **Step 1.1: Write the failing test**

```js
// tests/test-edge-detector.js
import { EdgeDetector } from '../EdgeDetector.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// Test: gaussianBlur accepts float sigma
{
  const gray = new Uint8Array(100); gray[50] = 255;
  const blurred = EdgeDetector.gaussianBlur(gray, 10, 10, 1.5);
  assert(blurred[50] < 255, 'gaussianBlur: centre pixel reduced by blur');
  assert(blurred[50] > 0, 'gaussianBlur: centre pixel non-zero');
  assert(blurred[49] > 0, 'gaussianBlur: neighbour gets some value');
}

// Test: gaussianBlur sigma=0 is identity
{
  const gray = new Uint8Array([10,20,30,40]);
  const out = EdgeDetector.gaussianBlur(gray, 2, 2, 0);
  assert(out[0] === 10 && out[3] === 40, 'gaussianBlur: sigma=0 is identity');
}

// Test: hysteresis — strong pixel kept
{
  const nms = new Uint8Array(9); nms[4] = 200; // centre strong
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[4] === 255, 'hysteresis: strong pixel kept');
}

// Test: hysteresis — weak pixel connected to strong is kept
{
  const nms = new Uint8Array(9);
  nms[4] = 200; // centre strong (200/255 > 0.15)
  nms[5] = 30;  // right weak (30/255 > 0.05 but < 0.15)
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[4] === 255, 'hysteresis: strong pixel kept');
  assert(out[5] === 255, 'hysteresis: weak pixel adjacent to strong kept');
}

// Test: hysteresis — weak pixel isolated is discarded
{
  const nms = new Uint8Array(9);
  nms[0] = 30; // weak, isolated
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[0] === 0, 'hysteresis: isolated weak pixel discarded');
}

// Test: hysteresis — pixel below low threshold always discarded
{
  const nms = new Uint8Array(9);
  nms[4] = 200; nms[5] = 5; // 5/255 < 0.05
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[5] === 0, 'hysteresis: below-low pixel discarded even adjacent to strong');
}

console.log(`EdgeDetector: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
node tests/test-edge-detector.js
```
Expected: multiple FAIL lines (methods don't exist yet / wrong signature).

- [ ] **Step 1.3: Update `gaussianBlur` to accept float sigma**

Replace the current signature and internal sigma/radius computation in `EdgeDetector.js`:

```js
// OLD:
static gaussianBlur(gray, width, height, radius = 1) {
  if (radius === 0) return new Uint8Array(gray);
  const size = 2 * radius + 1;
  const sigma = radius * 0.6 + 0.5;

// NEW:
static gaussianBlur(gray, width, height, sigma = 1.0) {
  if (sigma <= 0) return new Uint8Array(gray);
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const size = 2 * radius + 1;
  // (rest of the method body is unchanged — it already uses `size` and `radius`)
```

- [ ] **Step 1.4: Add `hysteresis` static method to `EdgeDetector.js`**

Add after the existing `threshold` method:

```js
// Canny hysteresis: keep strong edges (>= highFrac*255) unconditionally;
// keep weak edges (>= lowFrac*255) only if 8-connected to a strong edge.
static hysteresis(nms, width, height, lowFrac = 0.05, highFrac = 0.15) {
  const low  = lowFrac  * 255;
  const high = highFrac * 255;
  const out  = new Uint8Array(nms.length);
  const q    = [];

  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= high) { out[i] = 255; q.push(i); }
  }

  let head = 0;
  while (head < q.length) {
    const i = q[head++];
    const x = i % width, y = (i / width) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const ni = ny * width + nx;
        if (!out[ni] && nms[ni] >= low) { out[ni] = 255; q.push(ni); }
      }
    }
  }
  return out;
}
```

- [ ] **Step 1.5: Run tests**

```bash
node tests/test-edge-detector.js
```
Expected: `EdgeDetector: 7 passed, 0 failed`

---

## Task 2: Skeletonizer — Zhang-Suen thinning

**Files:**
- Create: `Skeletonizer.js`
- Create: `tests/test-skeletonizer.js`

- [ ] **Step 2.1: Write the failing test**

```js
// tests/test-skeletonizer.js
import { Skeletonizer } from '../Skeletonizer.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// Helper: create a binary image from a string grid
// '.' = 0, '#' = 255
function fromGrid(rows) {
  const height = rows.length, width = rows[0].length;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data[y * width + x] = rows[y][x] === '#' ? 255 : 0;
  return { data, width, height };
}

function countLit(arr) { let n = 0; for (const v of arr) if (v) n++; return n; }

// A 3px-wide horizontal bar should thin to a 1px-wide line
{
  const { data, width, height } = fromGrid([
    '.............',
    '#############',
    '#############',
    '#############',
    '.............',
  ]);
  const out = Skeletonizer.thin(data, width, height);
  // All lit pixels should be in a single row
  const rows = new Set();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (out[y * width + x]) rows.add(y);
  assert(rows.size === 1, 'thin: 3px bar collapses to 1px');
  assert(countLit(out) > 0, 'thin: some pixels survive');
}

// A single pixel should survive
{
  const data = new Uint8Array(9); data[4] = 255;
  const out = Skeletonizer.thin(data, 3, 3);
  assert(out[4] === 255, 'thin: isolated pixel survives');
}

// An L-shape should remain connected after thinning
{
  const { data, width, height } = fromGrid([
    '.......',
    '.####..',
    '.####..',
    '.##....',
    '.##....',
    '.......',
  ]);
  const out = Skeletonizer.thin(data, width, height);
  assert(countLit(out) > 0, 'thin: L-shape survives');
  assert(countLit(out) < countLit(data), 'thin: L-shape reduced');
}

// Output should be binary (only 0 or 255)
{
  const data = new Uint8Array(25);
  data[6]=data[7]=data[8]=data[11]=data[12]=data[13]=data[16]=data[17]=data[18]=255;
  const out = Skeletonizer.thin(data, 5, 5);
  assert(out.every(v => v === 0 || v === 255), 'thin: output is binary');
}

console.log(`Skeletonizer: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
node tests/test-skeletonizer.js
```
Expected: `Cannot find module '../Skeletonizer.js'`

- [ ] **Step 2.3: Create `Skeletonizer.js`**

```js
export class Skeletonizer {
  static thin(binary, width, height) {
    const n = width * height;
    const p = new Uint8Array(n);
    for (let i = 0; i < n; i++) p[i] = binary[i] ? 1 : 0;

    const get = (x, y) =>
      x < 0 || x >= width || y < 0 || y >= height ? 0 : p[y * width + x];

    let changed = true;
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        const del = [];
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            if (!p[y * width + x]) continue;

            const p2=get(x,y-1), p3=get(x+1,y-1), p4=get(x+1,y), p5=get(x+1,y+1);
            const p6=get(x,y+1), p7=get(x-1,y+1), p8=get(x-1,y), p9=get(x-1,y-1);

            const B = p2+p3+p4+p5+p6+p7+p8+p9;
            if (B < 2 || B > 6) continue;

            const ring = [p2,p3,p4,p5,p6,p7,p8,p9,p2];
            let A = 0;
            for (let k = 0; k < 8; k++) if (!ring[k] && ring[k+1]) A++;
            if (A !== 1) continue;

            if (pass === 0) {
              if (p2 * p4 * p6 !== 0) continue;
              if (p4 * p6 * p8 !== 0) continue;
            } else {
              if (p2 * p4 * p8 !== 0) continue;
              if (p2 * p6 * p8 !== 0) continue;
            }

            del.push(y * width + x);
          }
        }
        if (del.length) { changed = true; for (const i of del) p[i] = 0; }
      }
    }

    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = p[i] ? 255 : 0;
    return out;
  }
}
```

- [ ] **Step 2.4: Run tests**

```bash
node tests/test-skeletonizer.js
```
Expected: `Skeletonizer: 4 passed, 0 failed`

---

## Task 3: SkeletonGraph — junction graph construction

**Files:**
- Create: `SkeletonGraph.js`
- Create: `tests/test-skeleton-graph.js`

- [ ] **Step 3.1: Write the failing test**

```js
// tests/test-skeleton-graph.js
import { SkeletonGraph } from '../SkeletonGraph.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

function fromGrid(rows) {
  const h = rows.length, w = rows[0].length;
  const skel = new Uint8Array(w * h);
  const gray = new Uint8Array(w * h).fill(128); // mid-gray (not background)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === '#') skel[y * w + x] = 255;
      if (rows[y][x] === 'B') gray[y * w + x] = 255; // background
    }
  return { skel, gray, w, h };
}

// A horizontal line: 2 endpoints, 1 edge, no junctions
{
  const { skel, gray, w, h } = fromGrid([
    '.......',
    '.#####.',
    '.......',
  ]);
  const g = SkeletonGraph.build(skel, w, h, gray, { minBranchFrac: 0, silhouetteBonus: 2 });
  assert(g.nodes.length === 2, 'line: 2 endpoint nodes');
  assert(g.edges.length === 1, 'line: 1 edge');
}

// A T-junction: 1 junction node + 3 endpoints
{
  const { skel, gray, w, h } = fromGrid([
    '...#...',
    '...#...',
    '.#####.',
    '.......',
  ]);
  const g = SkeletonGraph.build(skel, w, h, gray, { minBranchFrac: 0, silhouetteBonus: 2 });
  assert(g.nodes.some(n => n.degree >= 3), 'T-junction: junction node exists');
  assert(g.edges.length === 3, 'T-junction: 3 edges');
}

// Short branches are pruned
{
  const { skel, gray, w, h } = fromGrid([
    '............',
    '.##########.',
    '............',
  ]);
  // diagonal = sqrt(12^2 + 3^2) ≈ 12.4; minBranchFrac=0.5 → minLen=6.2
  // branch length ≈ 10 → survives; but let's test that very short branches are pruned
  // Use a cross with one tiny branch
  const skel2 = new Uint8Array(9 * 9);
  const gray2 = new Uint8Array(9 * 9).fill(128);
  // Long horizontal bar row 4
  for (let x = 0; x < 9; x++) skel2[4*9+x] = 255;
  // Short vertical stub col 4, rows 3-4 only (length 1)
  skel2[3*9+4] = 255;
  const g = SkeletonGraph.build(skel2, 9, 9, gray2, { minBranchFrac: 0.15, silhouetteBonus: 2 });
  // The short stub (length 1) should be pruned; remaining = horizontal bar
  assert(g.edges.length <= 2, 'pruning: short stub removed');
}

// Silhouette detection: branch adjacent to background (gray>=240) → isSilhouette
{
  // 3×3: centre pixel is skeleton, right pixel is background (255)
  const skel = new Uint8Array(9); skel[3] = skel[4] = skel[5] = 255; // middle row
  const gray = new Uint8Array(9).fill(128);
  gray[0] = gray[1] = gray[2] = 255; // top row = background
  const g = SkeletonGraph.build(skel, 3, 3, gray, { minBranchFrac: 0, silhouetteBonus: 2 });
  if (g.edges.length > 0) {
    assert(g.edges[0].isSilhouette === true, 'silhouette: branch touching background is flagged');
    assert(g.edges[0].weight > g.edges[0].length, 'silhouette: weight boosted');
  }
}

console.log(`SkeletonGraph: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 3.2: Run test to confirm it fails**

```bash
node tests/test-skeleton-graph.js
```
Expected: `Cannot find module '../SkeletonGraph.js'`

- [ ] **Step 3.3: Create `SkeletonGraph.js`**

```js
export class SkeletonGraph {

  // skeleton: Uint8Array (255=skeleton), gray: Uint8Array (grayscale, 255=background)
  // opts: { minBranchFrac = 0.02, silhouetteBonus = 2.0 }
  // Returns: { nodes: [{id,x,y,degree}], edges: [{id,nodeA,nodeB,pixels,length,weight,isSilhouette}] }
  static build(skeleton, width, height, gray, opts = {}) {
    const { minBranchFrac = 0.02, silhouetteBonus = 2.0 } = opts;
    const minLen = minBranchFrac * Math.sqrt(width * width + height * height);

    // 1. Count skeleton neighbors for each pixel (8-connectivity)
    const nc = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!skeleton[y * width + x]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height)
              if (skeleton[ny * width + nx]) n++;
          }
        nc[y * width + x] = n;
      }
    }

    // 2. Create nodes at endpoints (nc <= 1) and junctions (nc >= 3)
    const nodeAt = new Int32Array(width * height).fill(-1);
    const nodes = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!skeleton[i]) continue;
        const n = nc[i];
        if (n <= 1 || n >= 3) {
          nodeAt[i] = nodes.length;
          nodes.push({ id: nodes.length, x, y, degree: 0 });
        }
      }
    }

    // 3. Trace branches between nodes
    const pathVisited = new Uint8Array(width * height);
    const edges = [];

    for (let startI = 0; startI < width * height; startI++) {
      const startNid = nodeAt[startI];
      if (startNid === -1) continue;
      const sx = startI % width, sy = (startI / width) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const fx = sx + dx, fy = sy + dy;
          if (fx < 0 || fx >= width || fy < 0 || fy >= height) continue;
          const fi = fy * width + fx;
          if (!skeleton[fi]) continue;

          // Direct node-to-node edge: only add once (lower index first)
          if (nodeAt[fi] !== -1) {
            if (fi > startI) {
              const len = Math.hypot(fx - sx, fy - sy);
              const eid = edges.length;
              edges.push({ id: eid, nodeA: startNid, nodeB: nodeAt[fi],
                pixels: [{ x: sx, y: sy }, { x: fx, y: fy }],
                length: len, weight: len, isSilhouette: false, deleted: false });
              nodes[startNid].degree++;
              nodes[nodeAt[fi]].degree++;
            }
            continue;
          }

          if (pathVisited[fi]) continue;

          // Trace path: walk through path pixels until hitting another node
          const pixels = [{ x: sx, y: sy }];
          let prev = startI, cur = fi;

          while (true) {
            if (nodeAt[cur] !== -1) {
              pixels.push({ x: cur % width, y: (cur / width) | 0 });
              const len = branchLen(pixels);
              const eid = edges.length;
              edges.push({ id: eid, nodeA: startNid, nodeB: nodeAt[cur],
                pixels, length: len, weight: len, isSilhouette: false, deleted: false });
              nodes[startNid].degree++;
              nodes[nodeAt[cur]].degree++;
              break;
            }

            pathVisited[cur] = 1;
            pixels.push({ x: cur % width, y: (cur / width) | 0 });

            // Find next: skeleton neighbor, not prev, not yet visited path pixel
            let next = -1;
            const cx = cur % width, cy = (cur / width) | 0;
            for (let ndy = -1; ndy <= 1; ndy++) {
              for (let ndx = -1; ndx <= 1; ndx++) {
                if (!ndx && !ndy) continue;
                const nnx = cx + ndx, nny = cy + ndy;
                if (nnx < 0 || nnx >= width || nny < 0 || nny >= height) continue;
                const nni = nny * width + nnx;
                if (nni === prev) continue;
                if (!skeleton[nni]) continue;
                if (pathVisited[nni] && nodeAt[nni] === -1) continue;
                next = nni;
                break;
              }
              if (next !== -1) break;
            }
            if (next === -1) break; // dead end
            prev = cur;
            cur = next;
          }
        }
      }
    }

    // 4. Prune short dangling branches iteratively
    let pruning = true;
    while (pruning) {
      pruning = false;
      for (const e of edges) {
        if (e.deleted || e.length >= minLen) continue;
        const na = nodes[e.nodeA], nb = nodes[e.nodeB];
        if (na.degree === 1 || nb.degree === 1) {
          e.deleted = true;
          na.degree--;
          nb.degree--;
          pruning = true;
        }
      }
    }

    const liveEdges = edges.filter(e => !e.deleted);

    // 5. Silhouette weighting: branch is silhouette if adjacent to background
    for (const e of liveEdges) {
      let isSil = false;
      outer: for (const { x, y } of e.pixels) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (!skeleton[ni] && gray[ni] >= 240) { isSil = true; break outer; }
          }
        }
      }
      e.isSilhouette = isSil;
      e.weight = e.length * (1 + (isSil ? silhouetteBonus : 0));
    }

    const liveNodes = nodes.filter(n => n.degree > 0);
    return { nodes: liveNodes, edges: liveEdges };
  }
}

function branchLen(pixels) {
  let len = 0;
  for (let i = 1; i < pixels.length; i++)
    len += Math.hypot(pixels[i].x - pixels[i-1].x, pixels[i].y - pixels[i-1].y);
  return len;
}
```

- [ ] **Step 3.4: Run tests**

```bash
node tests/test-skeleton-graph.js
```
Expected: `SkeletonGraph: 7 passed, 0 failed`

---

## Task 4: PathPlanner — MST + Chinese Postman + Hierholzer

**Files:**
- Create: `PathPlanner.js`
- Create: `tests/test-path-planner.js`

- [ ] **Step 4.1: Write the failing test**

```js
// tests/test-path-planner.js
import { PathPlanner } from '../PathPlanner.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// Minimal graph: 2 nodes, 1 edge → path of 2 pixels
{
  const nodes = [{ id: 0, x: 0, y: 0, degree: 1 }, { id: 1, x: 10, y: 0, degree: 1 }];
  const edges = [{ id: 0, nodeA: 0, nodeB: 1,
    pixels: [{ x:0,y:0 }, { x:5,y:0 }, { x:10,y:0 }],
    length: 10, weight: 10, isSilhouette: false }];
  const out = PathPlanner.solve({ nodes, edges }, { maxJumpFrac: 0.5, width: 100, height: 100 });
  const pts = out.filter(p => p !== null);
  assert(pts.length >= 2, 'simple: produces points');
  assert(!out.includes(null), 'simple: no pen-ups for small graph');
}

// Triangle: 3 nodes, 3 edges → Euler circuit visits all edges
{
  const nodes = [
    { id: 0, x: 0, y: 0, degree: 2 },
    { id: 1, x: 10, y: 0, degree: 2 },
    { id: 2, x: 5, y: 8, degree: 2 },
  ];
  const edges = [
    { id: 0, nodeA: 0, nodeB: 1, pixels: [{x:0,y:0},{x:10,y:0}], length:10, weight:10, isSilhouette:false },
    { id: 1, nodeA: 1, nodeB: 2, pixels: [{x:10,y:0},{x:5,y:8}], length:9,  weight:9,  isSilhouette:false },
    { id: 2, nodeA: 2, nodeB: 0, pixels: [{x:5,y:8},{x:0,y:0}],  length:9,  weight:9,  isSilhouette:false },
  ];
  const out = PathPlanner.solve({ nodes, edges }, { maxJumpFrac: 0.5, width: 100, height: 100 });
  const pts = out.filter(p => p !== null);
  assert(pts.length >= 4, 'triangle: visits all 3 edges');
}

// Disconnected graph: 2 isolated edges — output should have at most 1 null (one pen-up)
{
  const nodes = [
    { id: 0, x: 0, y: 0, degree: 1 },   { id: 1, x: 5, y: 0, degree: 1 },
    { id: 2, x: 50, y: 50, degree: 1 }, { id: 3, x: 55, y: 50, degree: 1 },
  ];
  const edges = [
    { id: 0, nodeA: 0, nodeB: 1, pixels: [{x:0,y:0},{x:5,y:0}], length:5, weight:5, isSilhouette:false },
    { id: 1, nodeA: 2, nodeB: 3, pixels: [{x:50,y:50},{x:55,y:50}], length:5, weight:5, isSilhouette:false },
  ];
  const out = PathPlanner.solve({ nodes, edges }, { maxJumpFrac: 0.9, width: 100, height: 100 });
  const nullCount = out.filter(p => p === null).length;
  assert(nullCount <= 1, 'disconnected: at most 1 pen-up to bridge components');
  assert(out.filter(p => p !== null).length >= 4, 'disconnected: all edge pixels visited');
}

// Empty graph returns empty
{
  const out = PathPlanner.solve({ nodes: [], edges: [] }, {});
  assert(Array.isArray(out) && out.length === 0, 'empty: returns []');
}

console.log(`PathPlanner: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 4.2: Run test to confirm it fails**

```bash
node tests/test-path-planner.js
```
Expected: `Cannot find module '../PathPlanner.js'`

- [ ] **Step 4.3: Create `PathPlanner.js`**

```js
export class PathPlanner {

  // graph: { nodes: [{id,x,y,degree}], edges: [{id,nodeA,nodeB,pixels,length,weight,isSilhouette}] }
  // opts: { maxJumpFrac=0.08, width, height }
  // Returns: Point[] with null separators for pen-ups
  static solve(graph, opts = {}) {
    const { maxJumpFrac = 0.08, width = 1, height = 1 } = opts;
    const maxJump = maxJumpFrac * Math.sqrt(width * width + height * height);
    const { nodes, edges } = graph;
    if (!nodes.length || !edges.length) return [];

    // Stable index map: node.id → position in nodes array
    const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));
    const N = nodes.length;

    // 1. Maximum spanning tree (Kruskal's)
    const uf = new UF(N);
    const mst = [];
    for (const e of [...edges].sort((a, b) => b.weight - a.weight)) {
      const a = nodeIdx.get(e.nodeA), b = nodeIdx.get(e.nodeB);
      if (a == null || b == null) continue;
      if (uf.find(a) !== uf.find(b)) { uf.union(a, b); mst.push(e); }
    }

    // 2. Connect disjoint components with ghost edges (nearest-pair)
    const compOf = i => uf.find(i);
    const merged = []; // roots that have been merged into component 0
    const allRoots = [...new Set(nodes.map((_, i) => compOf(i)))];

    for (let c = 1; c < allRoots.length; c++) {
      const root0 = compOf(0);
      let best = Infinity, bi = -1, bj = -1;
      for (let i = 0; i < N; i++) {
        if (compOf(i) !== root0) continue;
        for (let j = 0; j < N; j++) {
          if (compOf(j) === root0) continue;
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (d < best) { best = d; bi = i; bj = j; }
        }
      }
      if (bi === -1) break;
      uf.union(bi, bj);
      mst.push({
        id: -c, nodeA: nodes[bi].id, nodeB: nodes[bj].id,
        pixels: [{ x: nodes[bi].x, y: nodes[bi].y }, { x: nodes[bj].x, y: nodes[bj].y }],
        length: best, weight: 0, isSilhouette: false, isGhost: true
      });
    }

    // 3. Chinese Postman: find odd-degree nodes in MST and pair them
    const mstDeg = new Map(nodes.map(n => [n.id, 0]));
    for (const e of mst) {
      mstDeg.set(e.nodeA, (mstDeg.get(e.nodeA) || 0) + 1);
      mstDeg.set(e.nodeB, (mstDeg.get(e.nodeB) || 0) + 1);
    }
    const odd = nodes.filter(n => (mstDeg.get(n.id) || 0) % 2 === 1);

    // Greedy nearest-neighbor matching of odd-degree nodes
    const ghostEdges = [];
    const paired = new Set();
    for (let i = 0; i < odd.length; i++) {
      if (paired.has(i)) continue;
      let best = Infinity, bestJ = -1;
      for (let j = i + 1; j < odd.length; j++) {
        if (paired.has(j)) continue;
        const d = Math.hypot(odd[i].x - odd[j].x, odd[i].y - odd[j].y);
        if (d < best) { best = d; bestJ = j; }
      }
      if (bestJ === -1) continue;
      paired.add(i); paired.add(bestJ);
      ghostEdges.push({
        id: -(1000 + ghostEdges.length),
        nodeA: odd[i].id, nodeB: odd[bestJ].id,
        pixels: [{ x: odd[i].x, y: odd[i].y }, { x: odd[bestJ].x, y: odd[bestJ].y }],
        length: best, weight: 0, isSilhouette: false, isGhost: true
      });
    }

    // 4. Build adjacency list for Hierholzer
    const allEdges = [...mst, ...ghostEdges];
    const adj = new Map(nodes.map(n => [n.id, []]));
    for (const e of allEdges) {
      if (!adj.has(e.nodeA)) adj.set(e.nodeA, []);
      if (!adj.has(e.nodeB)) adj.set(e.nodeB, []);
      adj.get(e.nodeA).push({ neighbor: e.nodeB, edge: e });
      adj.get(e.nodeB).push({ neighbor: e.nodeA, edge: e });
    }
    // Sort: real edges first (longest first), ghost last
    for (const [, list] of adj) {
      list.sort((a, b) => {
        if (!!a.edge.isGhost !== !!b.edge.isGhost) return a.edge.isGhost ? 1 : -1;
        return b.edge.length - a.edge.length;
      });
    }

    // 5. Hierholzer's algorithm
    const usedEdge = new Set();
    const adjPtr = new Map(nodes.map(n => [n.id, 0]));

    // Prefer to start from a silhouette node
    const startNode =
      allEdges.find(e => e.isSilhouette)?.nodeA ??
      nodes[0]?.id;

    const stack = [startNode];
    const circuit = [];

    while (stack.length) {
      const v = stack[stack.length - 1];
      const list = adj.get(v) || [];
      const ptr = adjPtr.get(v) || 0;
      let moved = false;
      for (let i = ptr; i < list.length; i++) {
        adjPtr.set(v, i + 1);
        const { neighbor, edge } = list[i];
        if (!usedEdge.has(edge.id)) {
          usedEdge.add(edge.id);
          stack.push(neighbor);
          moved = true;
          break;
        }
      }
      if (!moved) circuit.push(stack.pop());
    }
    circuit.reverse();

    // 6. Build output point array from circuit
    // Mark each edge so we use it in the correct direction
    const edgeUsedDir = new Map(); // edgeId → true when used once
    const output = [];

    for (let i = 0; i < circuit.length - 1; i++) {
      const fromId = circuit[i], toId = circuit[i + 1];
      // Find the edge between fromId and toId (unused)
      const list = adj.get(fromId) || [];
      let found = null;
      for (const { neighbor, edge } of list) {
        if (neighbor === toId && !edgeUsedDir.has(edge.id)) {
          edgeUsedDir.set(edge.id, true);
          found = { edge, forward: edge.nodeA === fromId };
          break;
        }
      }
      if (!found) continue;

      const { edge, forward } = found;
      const pts = forward ? edge.pixels : [...edge.pixels].reverse();

      if (edge.isGhost) {
        const jumpLen = Math.hypot(
          pts[pts.length - 1].x - pts[0].x,
          pts[pts.length - 1].y - pts[0].y
        );
        if (jumpLen > maxJump && output.length) {
          output.push(null);
          output.push(...pts);
          continue;
        }
      }

      if (output.length === 0 || output[output.length - 1] === null) {
        output.push(...pts);
      } else {
        output.push(...pts.slice(1));
      }
    }

    return output;
  }
}

class UF {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
    this.r = new Array(n).fill(0);
  }
  find(x) { return this.p[x] === x ? x : (this.p[x] = this.find(this.p[x])); }
  union(x, y) {
    const [px, py] = [this.find(x), this.find(y)];
    if (px === py) return;
    if (this.r[px] < this.r[py]) this.p[px] = py;
    else if (this.r[px] > this.r[py]) this.p[py] = px;
    else { this.p[py] = px; this.r[px]++; }
  }
}
```

- [ ] **Step 4.4: Run tests**

```bash
node tests/test-path-planner.js
```
Expected: `PathPlanner: 4 passed, 0 failed`

---

## Task 5: BezierPathBuilder — tension parameter + subsampling

**Files:**
- Modify: `BezierPathBuilder.js`
- Create: `tests/test-bezier.js`

- [ ] **Step 5.1: Write the failing test**

```js
// tests/test-bezier.js
import { BezierPathBuilder } from '../BezierPathBuilder.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// build() still works with default tension
{
  const pts = [{ x:0,y:0 }, { x:10,y:5 }, { x:20,y:0 }];
  const d = BezierPathBuilder.build(pts);
  assert(typeof d === 'string' && d.startsWith('M'), 'build: returns SVG path string');
  assert(d.includes('C'), 'build: contains cubic bezier command');
}

// tension=0 produces different curves than tension=0.5
{
  const pts = [{ x:0,y:0 }, { x:10,y:10 }, { x:20,y:0 }, { x:30,y:10 }];
  const d1 = BezierPathBuilder.build(pts, 0.5);
  const d2 = BezierPathBuilder.build(pts, 0.1);
  assert(d1 !== d2, 'tension: different values produce different output');
}

// resample: uniform sampling along a straight line
{
  const pts = Array.from({ length: 21 }, (_, i) => ({ x: i, y: 0 }));
  const resampled = BezierPathBuilder.resample(pts, 5);
  // step=5 → approx (20/5)+1 = 5 points
  assert(resampled.length >= 3 && resampled.length <= 7, `resample: approx correct count (got ${resampled.length})`);
  assert(resampled[0].x === 0, 'resample: starts at first point');
}

// null separators: two segments produce two M commands
{
  const pts = [{ x:0,y:0 }, { x:5,y:5 }, null, { x:20,y:20 }, { x:25,y:25 }];
  const d = BezierPathBuilder.build(pts);
  const mCount = (d.match(/M /g) || []).length;
  assert(mCount === 2, 'null separator: two M commands');
}

// resample preserves first and last point approximately
{
  const pts = [{ x:0,y:0 }, { x:10,y:5 }, { x:20,y:0 }];
  const r = BezierPathBuilder.resample(pts, 3);
  assert(Math.abs(r[0].x) < 0.5, 'resample: first point preserved');
  assert(Math.abs(r[r.length-1].x - 20) < 1, 'resample: last point approximately preserved');
}

console.log(`BezierPathBuilder: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 5.2: Run test to confirm it fails**

```bash
node tests/test-bezier.js
```
Expected: some FAILs (tension parameter and resample don't exist yet).

- [ ] **Step 5.3: Update `BezierPathBuilder.js`**

Replace the entire file:

```js
export class BezierPathBuilder {

  // Resample a point array to approximately one point every `step` pixels (arc-length).
  // Null separators are preserved between segments.
  static resample(points, step) {
    const out = [];
    let cur = [];
    for (const p of points) {
      if (p === null) {
        if (cur.length) { out.push(...this._resampleSeg(cur, step)); out.push(null); }
        cur = [];
      } else cur.push(p);
    }
    if (cur.length) out.push(...this._resampleSeg(cur, step));
    return out;
  }

  static _resampleSeg(pts, step) {
    if (pts.length < 2) return pts.slice();
    // Compute cumulative arc lengths
    const cum = [0];
    for (let i = 1; i < pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y));
    const total = cum[cum.length - 1];
    if (total === 0) return [pts[0]];

    const n = Math.max(2, Math.round(total / step));
    const result = [];
    let seg = 0;
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * total;
      while (seg < cum.length - 2 && cum[seg + 1] < t) seg++;
      const segLen = cum[seg + 1] - cum[seg];
      const frac = segLen > 0 ? (t - cum[seg]) / segLen : 0;
      result.push({
        x: pts[seg].x + frac * (pts[seg + 1].x - pts[seg].x),
        y: pts[seg].y + frac * (pts[seg + 1].y - pts[seg].y),
      });
    }
    return result;
  }

  // Build a Catmull-Rom SVG path through `points` (with null pen-up separators).
  // tension: 0 = very loose/curvy, 1 = tight/near-straight. Default 0.5 (classic Catmull-Rom).
  static build(points, tension = 0.5) {
    if (!points.length) return '';

    const segments = [];
    let cur = [];
    for (const p of points) {
      if (p === null) { if (cur.length >= 2) segments.push(cur); cur = []; }
      else cur.push(p);
    }
    if (cur.length >= 2) segments.push(cur);

    let d = '';
    for (const seg of segments) {
      const n = seg.length;
      d += `M ${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
      for (let i = 1; i < n; i++) {
        const p0 = seg[Math.max(0, i - 2)];
        const p1 = seg[i - 1];
        const p2 = seg[i];
        const p3 = seg[Math.min(n - 1, i + 1)];
        // Catmull-Rom → cubic Bézier: control points = p1 ± tangent/3
        // tangent at p1 = tension * (p2 - p0), tangent at p2 = tension * (p3 - p1)
        const t = tension / 3;
        const c1x = p1.x + (p2.x - p0.x) * t;
        const c1y = p1.y + (p2.y - p0.y) * t;
        const c2x = p2.x - (p3.x - p1.x) * t;
        const c2y = p2.y - (p3.y - p1.y) * t;
        d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      }
    }
    return d;
  }
}
```

- [ ] **Step 5.4: Run tests**

```bash
node tests/test-bezier.js
```
Expected: `BezierPathBuilder: 5 passed, 0 failed`

---

## Task 6: Rewire app.js + delete retired files

**Files:**
- Rewrite: `app.js`
- Delete: `ContourTracer.js`, `ContourGraph.js`, `GraphBuilder.js`, `GraphNode.js`, `GraphEdge.js`, `KDTreeConnector.js`, `Eulerizer.js`, `EulerPathSolver.js`, `RDPSimplifier.js`, `ChaikinSmoother.js`, `Pipeline.js`

- [ ] **Step 6.1: Replace the imports and state/params blocks at the top of `app.js`**

Replace lines 1–44 (everything up to and including the `P` object):

```js
import { EdgeDetector }      from './EdgeDetector.js';
import { Skeletonizer }      from './Skeletonizer.js';
import { SkeletonGraph }     from './SkeletonGraph.js';
import { PathPlanner }       from './PathPlanner.js';
import { BezierPathBuilder } from './BezierPathBuilder.js';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_SIZE = 600;

// ── Pipeline state ─────────────────────────────────────────────────────
let W = 0, H = 0;
const S = {
  srcCanvas:  null,
  imageData:  null,
  gray:       null,
  leveled:    null,
  canny:      null,
  skeleton:   null,
  graph:      null,
  eulerPath:  null,
  smoothed:   null,
  svgString:  null,
};

// ── User params (all spatial params are fractions of diagonal d=√(W²+H²)) ──
const P = {
  blackPoint:       0,
  whitePoint:       255,
  gamma:            1.0,
  blurSigmaFrac:    0.006,
  cannyHighFrac:    0.15,
  cannyLowFrac:     0.05,
  minBranchFrac:    0.020,
  silhouetteBonus:  2.0,
  maxJumpFrac:      0.08,
  splineTension:    0.5,
  sampleFrac:       0.005,
  strokeWidth:      1.0,
};
```

- [ ] **Step 6.2: Replace the STEPS array**

Replace everything from `// ── Step definitions ──` to the closing `];` of the STEPS array (current lines 46–294) with:

```js
// ── Step definitions ────────────────────────────────────────────────────
function diag() { return Math.sqrt(W * W + H * H) || 1; }

const STEPS = [
  {
    num: '01', name: 'ORIGINAL IMAGE',
    desc: 'source image scaled to fit processing canvas',
    controls: [],
    run() {},
    draw(canvas) {
      if (!S.srcCanvas) return;
      canvas.width = W; canvas.height = H;
      canvas.getContext('2d').drawImage(S.srcCanvas, 0, 0);
    },
    stat() { return S.srcCanvas ? `${W} × ${H} px` : '—'; },
  },
  {
    num: '02', name: 'GRAYSCALE',
    desc: '0.299 R + 0.587 G + 0.114 B (luminosity)',
    controls: [],
    run() { S.gray = EdgeDetector.toGrayscale(S.imageData); },
    draw(canvas) {
      if (!S.gray) return;
      putImageData(canvas, EdgeDetector.toImageData(S.gray, W, H));
    },
    stat() { return S.gray ? 'luminosity weighted' : '—'; },
  },
  {
    num: '03', name: 'LEVELS',
    desc: 'remap tonal range — raise black point, lower white point, adjust gamma',
    controls: [
      { key: 'blackPoint', label: 'Black Pt',  min: 0,    max: 200,  step: 1,    firstAffected: 2 },
      { key: 'whitePoint', label: 'White Pt',  min: 55,   max: 255,  step: 1,    firstAffected: 2 },
      { key: 'gamma',      label: 'Gamma',     min: 0.25, max: 4.0,  step: 0.05, firstAffected: 2 },
    ],
    run() { S.leveled = S.gray ? EdgeDetector.levels(S.gray, P.blackPoint, P.whitePoint, P.gamma) : null; },
    draw(canvas) {
      if (!S.leveled) return;
      putImageData(canvas, EdgeDetector.toImageData(S.leveled, W, H));
    },
    stat() { return S.leveled ? `bp ${P.blackPoint}  wp ${P.whitePoint}  γ ${P.gamma.toFixed(2)}` : '—'; },
  },
  {
    num: '04', name: 'CANNY EDGES',
    desc: 'Gaussian blur → Sobel → non-max suppression → hysteresis — finds real gradient edges',
    controls: [
      { key: 'blurSigmaFrac', label: 'Blur σ',   min: 0,    max: 0.02, step: 0.001, firstAffected: 3 },
      { key: 'cannyHighFrac', label: 'High Thr',  min: 0.05, max: 0.5,  step: 0.01,  firstAffected: 3 },
      { key: 'cannyLowFrac',  label: 'Low Thr',   min: 0.01, max: 0.2,  step: 0.01,  firstAffected: 3 },
    ],
    run() {
      if (!S.leveled) return;
      const sigma  = P.blurSigmaFrac * diag();
      const blurred = EdgeDetector.gaussianBlur(S.leveled, W, H, sigma);
      const nms     = EdgeDetector.nonMaxSuppression(blurred, W, H);
      S.canny       = EdgeDetector.hysteresis(nms, W, H, P.cannyLowFrac, P.cannyHighFrac);
    },
    draw(canvas) {
      if (!S.canny) return;
      putImageData(canvas, EdgeDetector.toImageData(S.canny, W, H));
    },
    stat() {
      if (!S.canny) return '—';
      let n = 0; for (const v of S.canny) if (v) n++;
      const pxEq = (P.blurSigmaFrac * diag()).toFixed(1);
      return `${n.toLocaleString()} edge px · σ≈${pxEq}px`;
    },
  },
  {
    num: '05', name: 'SKELETON',
    desc: 'Zhang-Suen thinning — reduces edges to 1-pixel-wide centerlines, preserves topology',
    controls: [],
    run() { S.skeleton = S.canny ? Skeletonizer.thin(S.canny, W, H) : null; },
    draw(canvas) {
      if (!S.skeleton) return;
      putImageData(canvas, EdgeDetector.toImageData(S.skeleton, W, H));
    },
    stat() {
      if (!S.skeleton || !S.canny) return '—';
      const before = [...S.canny].filter(Boolean).length;
      const after  = [...S.skeleton].filter(Boolean).length;
      const pct    = before ? Math.round((1 - after / before) * 100) : 0;
      return `${after.toLocaleString()} px (↓${pct}% from ${before.toLocaleString()})`;
    },
  },
  {
    num: '06', name: 'JUNCTION GRAPH',
    desc: 'classify junctions & endpoints, trace branches, prune short ones, weight silhouette edges',
    controls: [
      { key: 'minBranchFrac',   label: 'Min Branch',      min: 0.005, max: 0.05,  step: 0.005, firstAffected: 5 },
      { key: 'silhouetteBonus', label: 'Silhouette Bonus', min: 0,     max: 5,     step: 0.5,   firstAffected: 5 },
    ],
    run() {
      if (!S.skeleton || !S.leveled) { S.graph = null; return; }
      S.graph = SkeletonGraph.build(S.skeleton, W, H, S.leveled,
        { minBranchFrac: P.minBranchFrac, silhouetteBonus: P.silhouetteBonus });
    },
    draw(canvas) {
      if (!S.graph) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1; ctx.lineCap = 'round';
      S.graph.edges.forEach((e, i) => {
        ctx.strokeStyle = e.isSilhouette
          ? '#ff9944'
          : `hsl(${(i * 137.5) % 360}, 70%, 60%)`;
        ctx.beginPath();
        ctx.moveTo(e.pixels[0].x, e.pixels[0].y);
        for (let j = 1; j < e.pixels.length; j++) ctx.lineTo(e.pixels[j].x, e.pixels[j].y);
        ctx.stroke();
      });
    },
    stat() {
      if (!S.graph) return '—';
      const sil = S.graph.edges.filter(e => e.isSilhouette).length;
      const pxEq = (P.minBranchFrac * diag()).toFixed(0);
      return `${S.graph.nodes.length} nodes · ${S.graph.edges.length} edges · ${sil} silhouette · min≈${pxEq}px`;
    },
  },
  {
    num: '07', name: 'EULER PATH',
    desc: 'MST + Chinese Postman + Hierholzer — single continuous route through all branches',
    controls: [
      { key: 'maxJumpFrac', label: 'Max Jump', min: 0.01, max: 0.3, step: 0.01, firstAffected: 6 },
    ],
    run() {
      if (!S.graph) { S.eulerPath = []; return; }
      S.eulerPath = PathPlanner.solve(S.graph, { maxJumpFrac: P.maxJumpFrac, width: W, height: H });
    },
    draw(canvas) {
      if (!S.eulerPath) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      drawGradient(ctx, S.eulerPath, 1);
    },
    stat() {
      if (!S.eulerPath) return '—';
      const pts  = S.eulerPath.filter(p => p !== null).length;
      const gaps = S.eulerPath.filter(p => p === null).length;
      const pxEq = (P.maxJumpFrac * diag()).toFixed(0);
      return `${pts.toLocaleString()} pts · ${gaps} pen-up${gaps !== 1 ? 's' : ''} · max jump≈${pxEq}px`;
    },
  },
  {
    num: '08', name: 'SMOOTH SPLINE',
    desc: 'arc-length subsampling + Catmull-Rom spline — smooth curve through skeleton path',
    controls: [
      { key: 'splineTension', label: 'Tension',     min: 0,     max: 1,    step: 0.05,  firstAffected: 8 },
      { key: 'sampleFrac',   label: 'Sample Rate', min: 0.002, max: 0.02, step: 0.001, firstAffected: 7 },
    ],
    run() {
      if (!S.eulerPath?.length) { S.smoothed = []; return; }
      const step = P.sampleFrac * diag();
      S.smoothed = BezierPathBuilder.resample(S.eulerPath, step);
    },
    draw(canvas) {
      if (!S.smoothed) return;
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.lineCap = 'round';
      ctx.beginPath();
      let penDown = false;
      for (const p of S.smoothed) {
        if (p === null) { penDown = false; continue; }
        if (!penDown) { ctx.moveTo(p.x, p.y); penDown = true; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    },
    stat() {
      if (!S.smoothed) return '—';
      const pts  = S.smoothed.filter(p => p !== null).length;
      const pxEq = (P.sampleFrac * diag()).toFixed(1);
      return `${pts.toLocaleString()} pts · step≈${pxEq}px`;
    },
  },
  {
    num: '09', name: 'SINGLE LINE OUTPUT',
    desc: 'Catmull-Rom cubic Bézier SVG — one continuous stroke from start to end',
    isSVG: true,
    controls: [
      { key: 'strokeWidth', label: 'Stroke Width', min: 0.5, max: 4, step: 0.5, firstAffected: 8 },
    ],
    run() {
      if (!S.smoothed?.length) { S.svgString = ''; return; }
      const d = BezierPathBuilder.build(S.smoothed, P.splineTension);
      S.svgString = makeSVG(d, W, H, P.strokeWidth);
    },
    draw() {},
    stat() { return S.svgString ? `${(S.svgString.length / 1024).toFixed(1)} KB` : '—'; },
  },
];
```

- [ ] **Step 6.3: Verify the helpers and rest of app.js are unchanged**

The functions `putImageData`, `drawGradient`, `makeSVG`, `scheduleRun`, `runFrom`, `tick`, `loadFile`, `loadImage`, and all UI helpers from line 297 to end of file are unchanged. Only the imports, state/params, and STEPS array changed.

Check that `createStepCards`, `showPipeline`, `exportSVG`, `init` are still present and intact.

- [ ] **Step 6.4: Delete the retired files**

```bash
rm ContourTracer.js ContourGraph.js GraphBuilder.js GraphNode.js GraphEdge.js \
   KDTreeConnector.js Eulerizer.js EulerPathSolver.js RDPSimplifier.js \
   ChaikinSmoother.js Pipeline.js
```

- [ ] **Step 6.5: Start the server and verify the pipeline loads without errors**

```bash
node server.js
```

Open `http://localhost:3333` in a browser. Expected:
- Page loads without JS console errors
- Drop-zone is visible
- All 9 step cards appear after dropping an image (no missing step cards, no "step not found" errors)

- [ ] **Step 6.6: Run a visual smoke test with a real image**

Drop `testData/images.jpeg` onto the drop-zone. Walk through each step card and verify:

| Step | Expected |
|------|----------|
| 01 Original | Image appears |
| 02 Grayscale | Grayscale version |
| 03 Levels | Adjusting sliders changes contrast |
| 04 Canny Edges | White edge lines on black, cleaner than old regionBoundaries |
| 05 Skeleton | 1-pixel-wide centerlines |
| 06 Junction Graph | Colored branches; silhouette branches in orange |
| 07 Euler Path | Gradient-colored path, few or no pen-ups |
| 08 Smooth Spline | Smooth white curve |
| 09 Output | SVG renders correctly; Export button works |

---

## Task 7: Run all tests

- [ ] **Step 7.1: Run full test suite**

```bash
node tests/test-edge-detector.js && \
node tests/test-skeletonizer.js && \
node tests/test-skeleton-graph.js && \
node tests/test-path-planner.js && \
node tests/test-bezier.js
```

Expected output:
```
EdgeDetector: 7 passed, 0 failed
Skeletonizer: 4 passed, 0 failed
SkeletonGraph: 7 passed, 0 failed
PathPlanner: 4 passed, 0 failed
BezierPathBuilder: 5 passed, 0 failed
```

---

## Known edge cases to watch for

- **Canny on very simple images** (few edges): graph may have 0 nodes/edges. All downstream steps should handle empty gracefully (already guarded with `if (!S.xxx)`).
- **PathPlanner with 1 node**: skip the Euler circuit and return the single node's coordinates.
- **gaussianBlur with large sigma** on small images: radius can exceed image dimensions. The existing clamping (`Math.max(0, Math.min(...))`) handles this.
- **Zhang-Suen on sparse skeletons**: isolated pixels (nc=0) are treated as endpoints and survive thinning. This is correct.
