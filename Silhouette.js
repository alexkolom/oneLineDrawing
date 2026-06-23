import { ContourSimplifier } from './ContourSimplifier.js';
import { BezierPathBuilder } from './BezierPathBuilder.js';
import { RegionTracer } from './RegionTracer.js';
import { Morphology } from './Morphology.js';

// Builds the subject's outer silhouette as a single SVG path. The preferred
// entry point is fromMask(): it cleans the threshold mask (close + fill holes
// + slight outward dilate) so the frame is one smooth envelope sitting just
// outside the detail line, rather than a duplicate of the existing contours.
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

  // Approach B: derive a clean silhouette directly from a binary mask.
  // Morphologically close (bridge gaps + smooth), fill interior holes, then
  // dilate slightly so the frame sits just OUTSIDE the detail line. Traces the
  // single largest outer boundary and returns one smooth SVG path. Returns ''
  // when the mask is empty or yields no usable loop.
  static fromMask(binary, width, height, {
    closeRadius = 2, dilateRadius = 2, simplifyEps = 2, smooth = 2, tension = 0.5,
  } = {}) {
    if (!binary || !binary.length) return '';
    let mask = Morphology.close(binary, width, height, closeRadius);
    mask = Morphology.fillHoles(mask, width, height);
    if (dilateRadius > 0) mask = Morphology.dilate(mask, width, height, dilateRadius);

    const loops = RegionTracer.trace(mask, width, height);
    if (!loops.length) return '';
    let best = loops[0], bestA = this.area(best);
    for (const l of loops) {
      const a = this.area(l);
      if (a > bestA) { bestA = a; best = l; }
    }
    if (bestA <= 0) return '';
    // Reuse buildPath for the single largest loop (simplify → close → smooth → build).
    return this.buildPath([best], { simplifyEps, smooth, tension });
  }
}
