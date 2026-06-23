import { ContourSimplifier } from './ContourSimplifier.js';
import { BezierPathBuilder } from './BezierPathBuilder.js';

// Builds the subject's outer silhouette as a single SVG path, reusing the
// outer-boundary loops already traced by RegionTracer (e.g. SS.massContours).
export class Silhouette {
  // Absolute polygon area via the shoelace formula. loop: array of {x,y}.
  static area(loop) {
    if (!loop || loop.length < 3) return 0;
    let a = 0;
    for (let i = 0, n = loop.length; i < n; i++) {
      const p = loop[i], q = loop[(i + 1) % n];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  // Largest-area loop plus any loop whose area >= fracOfMax * maxArea.
  // Drops smaller noise loops. Returns [] for empty input or zero area.
  static select(loops, fracOfMax = 0.5) {
    if (!loops || !loops.length) return [];
    const scored = loops.map(l => ({ l, a: this.area(l) }));
    const maxA = scored.reduce((m, o) => Math.max(m, o.a), 0);
    if (maxA <= 0) return [];
    return scored.filter(o => o.a >= fracOfMax * maxA).map(o => o.l);
  }

  // Build one SVG path `d` covering the selected silhouette loops: RDP-simplify
  // each, close it, join loops with null separators, smooth, and build a
  // Catmull-Rom path. Returns '' when there is nothing to draw.
  static buildPath(loops, { simplifyEps = 1, smooth = 1.5, tension = 0.5 } = {}) {
    const selected = this.select(loops);
    const pts = [];
    for (const loop of selected) {
      let s = ContourSimplifier.rdp(loop, simplifyEps);
      if (s.length < 2) continue;
      s = [...s, s[0]]; // close the loop
      if (pts.length) pts.push(null);
      pts.push(...s);
    }
    if (!pts.length) return '';
    const smoothed = BezierPathBuilder.smoothFactor(pts, smooth);
    return BezierPathBuilder.build(smoothed, tension);
  }
}
