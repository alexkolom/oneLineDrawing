# Arc-Length Filter and Hierarchy Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add arc-length filtering and arc-length-based sorting to `ContourSimplifier` to eliminate texture noise contours and prioritise structurally important contours in the drawing output.

**Architecture:** `ContourSimplifier` gains three additions: `arcLength()` helper, extended `filter()` with optional `minArcLength` param, and `sortByLength()`. Step 06 in `app.js` calls them in order: area filter + arc-length filter → RDP simplify → sort by arc-length. A new "Min Arc" slider exposes the threshold to the user.

**Tech Stack:** Vanilla JS ES modules, browser Canvas API, no build step.

---

## File Map

| File | Change |
|------|--------|
| `ContourSimplifier.js` | Add `arcLength()`, extend `filter()`, add `sortByLength()` |
| `app.js` | Add `minArcLengthFrac` to `P`; update step 06 `run()` and `controls` |

---

## Task 1: Update ContourSimplifier.js

**Files:** Modify `/Users/alex/GitProjects/singleLine/ContourSimplifier.js`

- [ ] **Replace the entire file with this content:**

```js
export class ContourSimplifier {
  // Keep only contours whose bounding-box area >= minArea (px²)
  // and whose arc-length >= minArcLength (px). minArcLength=0 skips the check.
  static filter(contours, minArea, minArcLength = 0) {
    return contours.filter(c => {
      if (c.length < 3) return false;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of c) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      if ((maxX - minX) * (maxY - minY) < minArea) return false;
      if (minArcLength > 0 && this.arcLength(c) < minArcLength) return false;
      return true;
    });
  }

  // Sum of Euclidean distances between consecutive points.
  static arcLength(contour) {
    let len = 0;
    for (let i = 1; i < contour.length; i++) {
      len += Math.hypot(contour[i].x - contour[i - 1].x, contour[i].y - contour[i - 1].y);
    }
    return len;
  }

  // Sort contours by arc-length descending (longest = most structural first).
  // Returns a new array; does not mutate input.
  static sortByLength(contours) {
    return [...contours].sort((a, b) => this.arcLength(b) - this.arcLength(a));
  }

  // Ramer-Douglas-Peucker: reduce points while preserving shape.
  // epsilon: max allowed deviation in pixels.
  static rdp(points, epsilon) {
    if (points.length <= 2) return points.slice();
    let maxDist = 0, maxIdx = 0;
    const a = points[0], b = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = this.#ptSegDist(points[i], a, b);
      if (d > maxDist) { maxDist = d; maxIdx = i; }
    }
    if (maxDist > epsilon) {
      const L = this.rdp(points.slice(0, maxIdx + 1), epsilon);
      const R = this.rdp(points.slice(maxIdx), epsilon);
      return [...L.slice(0, -1), ...R];
    }
    return [a, b];
  }

  // Apply RDP to every contour; drop any that collapse to <2 points.
  static simplify(contours, epsilon) {
    return contours.map(c => this.rdp(c, epsilon)).filter(c => c.length >= 2);
  }

  static #ptSegDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
}
```

- [ ] **Commit:**

```bash
git -C /Users/alex/GitProjects/singleLine add ContourSimplifier.js
git -C /Users/alex/GitProjects/singleLine commit -m "feat: add arcLength helper, arc-length filter param, and sortByLength to ContourSimplifier"
```

---

## Task 2: Update app.js — param, step 06 run(), and slider

**Files:** Modify `/Users/alex/GitProjects/singleLine/app.js`

Three edits in one task since they are tightly coupled (new param must exist before slider and run() can use it).

### Edit 1: Add `minArcLengthFrac` to `P`

Find:
```js
  minContourFrac:  0.001,
  simplification:  2.5,
```

Replace with:
```js
  minContourFrac:   0.001,
  minArcLengthFrac: 0.03,
  simplification:   2.5,
```

### Edit 2: Update step 06 `run()`

Find:
```js
    run() {
      if (!S.rawContours?.length) { S.contours = []; return; }
      const minArea = P.minContourFrac * W * H;
      const filtered = ContourSimplifier.filter(S.rawContours, minArea);
      S.contours = ContourSimplifier.simplify(filtered, P.simplification);
    },
```

Replace with:
```js
    run() {
      if (!S.rawContours?.length) { S.contours = []; return; }
      const minArea      = P.minContourFrac * W * H;
      const minArcLength = P.minArcLengthFrac * diag();
      const filtered     = ContourSimplifier.filter(S.rawContours, minArea, minArcLength);
      const simplified   = ContourSimplifier.simplify(filtered, P.simplification);
      S.contours         = ContourSimplifier.sortByLength(simplified);
    },
```

### Edit 3: Add "Min Arc" slider to step 06 controls

Find:
```js
    controls: [
      { key: 'minContourFrac', label: 'Min Area',   min: 0, max: 0.005, step: 0.0001, firstAffected: 5 },
      { key: 'simplification', label: 'Simplify ε', min: 0.5, max: 15,  step: 0.5,   firstAffected: 5 },
    ],
```

Replace with:
```js
    controls: [
      { key: 'minContourFrac',   label: 'Min Area',   min: 0,   max: 0.005, step: 0.0001, firstAffected: 5 },
      { key: 'minArcLengthFrac', label: 'Min Arc',    min: 0,   max: 0.15,  step: 0.005,  firstAffected: 5 },
      { key: 'simplification',   label: 'Simplify ε', min: 0.5, max: 15,    step: 0.5,    firstAffected: 5 },
    ],
```

- [ ] **Make all three edits, then commit:**

```bash
git -C /Users/alex/GitProjects/singleLine add app.js
git -C /Users/alex/GitProjects/singleLine commit -m "feat: add minArcLengthFrac param and Min Arc slider to step 06, sort contours by arc-length"
```
