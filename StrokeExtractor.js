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

  // Mean normalised Sobel magnitude (0–255) sampled at each contour point.
  // Faint texture edges score low even when long; crisp structural edges high.
  static avgEdgeStrength(contour, edgeMag, width, height) {
    let sum = 0;
    for (const p of contour) {
      const x = Math.min(width - 1,  Math.max(0, Math.round(p.x)));
      const y = Math.min(height - 1, Math.max(0, Math.round(p.y)));
      sum += edgeMag[y * width + x];
    }
    return sum / contour.length;
  }

  // Importance score. √arcLength (not raw length) keeps a long faint line from
  // always out-ranking a short crisp feature like a dark eye.
  static score(contour, edgeMag, width, height) {
    const len    = ContourSimplifier.arcLength(contour);
    const eStr   = this.avgEdgeStrength(contour, edgeMag, width, height);
    const spread = this.spatialSpread(contour);
    return Math.sqrt(len) * eStr * spread;
  }

  // Greedy selection with spatial suppression so the kept strokes are
  // complementary (different regions) rather than redundant copies of the
  // same dominant edge. Returns up to `count` contours, highest score first.
  static selectDiverse(candidates, count, suppressRadius, edgeMag, width, height) {
    if (count <= 0 || !candidates.length) return [];
    const scored = candidates.map(c => ({
      contour:  c,
      score:    this.score(c, edgeMag, width, height),
      centroid: this.centroid(c),
    }));
    scored.sort((a, b) => b.score - a.score);

    const picked = [];
    for (const cand of scored) {
      if (picked.length >= count) break;
      const tooClose = picked.some(p =>
        Math.hypot(p.centroid.x - cand.centroid.x, p.centroid.y - cand.centroid.y) < suppressRadius);
      if (!tooClose) picked.push(cand);
    }
    return picked.map(p => p.contour);
  }
}
