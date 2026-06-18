import { ContourSimplifier } from './ContourSimplifier.js';

export class StrokeExtractor {
  // Mean of all points — used as a stroke's location for diversity suppression.
  static centroid(contour) {
    let sx = 0, sy = 0;
    for (const p of contour) { sx += p.x; sy += p.y; }
    return { x: sx / contour.length, y: sy / contour.length };
  }

  // Bounding-box diagonal — rewards strokes that span the subject over
  // strokes curled up in a corner.
  static spatialSpread(contour) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of contour) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return Math.hypot(maxX - minX, maxY - minY);
  }

  // Importance score for a tonal-region loop. √arcLength (not raw length)
  // keeps a long winding loop from dwarfing a compact-but-significant one;
  // spatialSpread rewards loops that span the subject over tiny specks.
  static score(contour) {
    return Math.sqrt(ContourSimplifier.arcLength(contour)) * this.spatialSpread(contour);
  }

  // Greedy selection with spatial suppression so the kept strokes are
  // complementary (different regions) rather than redundant copies of the
  // same mass. `seeds` are already-chosen contours (e.g. the primary loop)
  // whose locations suppress nearby candidates but are not returned.
  // Returns up to `count` contours, highest score first.
  static selectDiverse(candidates, count, suppressRadius, seeds = []) {
    if (count <= 0 || !candidates.length) return [];
    const scored = candidates.map(c => ({
      contour:  c,
      score:    this.score(c),
      centroid: this.centroid(c),
    }));
    scored.sort((a, b) => b.score - a.score);

    const picked = seeds.map(c => ({ centroid: this.centroid(c) })); // suppression only
    const result = [];
    for (const cand of scored) {
      if (result.length >= count) break;
      const tooClose = picked.some(p =>
        Math.hypot(p.centroid.x - cand.centroid.x, p.centroid.y - cand.centroid.y) < suppressRadius);
      if (!tooClose) { picked.push(cand); result.push(cand.contour); }
    }
    return result;
  }
}
