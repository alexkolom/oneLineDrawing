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

  // Laplacian smoothing: move each interior point toward the average of its neighbors.
  // Preserves endpoints and null separators. Runs `iterations` passes.
  static smooth(points, iterations = 3) {
    const out = [];
    let cur = [];
    for (const p of points) {
      if (p === null) {
        if (cur.length) { out.push(...this._smoothSeg(cur, iterations)); out.push(null); }
        cur = [];
      } else cur.push(p);
    }
    if (cur.length) out.push(...this._smoothSeg(cur, iterations));
    return out;
  }

  static _smoothSeg(pts, iterations) {
    let p = pts.slice();
    for (let iter = 0; iter < iterations; iter++) {
      const q = p.slice();
      for (let i = 1; i < p.length - 1; i++) {
        q[i] = { x: (p[i-1].x + p[i].x + p[i+1].x) / 3, y: (p[i-1].y + p[i].y + p[i+1].y) / 3 };
      }
      p = q;
    }
    return p;
  }

  // Laplacian smoothing with a continuous amount: floor(amount) full passes
  // plus a fractional final pass blended by the remainder. Lets small values
  // (e.g. 0.2) apply gentle smoothing — useful for sparse, simplified paths
  // where a single full pass is already too strong. Preserves endpoints and
  // null separators.
  static smoothFactor(points, amount) {
    if (amount <= 0) return points.slice();
    const out = [];
    let cur = [];
    for (const p of points) {
      if (p === null) {
        if (cur.length) { out.push(...this._smoothSegFactor(cur, amount)); out.push(null); }
        cur = [];
      } else cur.push(p);
    }
    if (cur.length) out.push(...this._smoothSegFactor(cur, amount));
    return out;
  }

  static _smoothSegFactor(pts, amount) {
    let p = pts.slice();
    const pass = (strength) => {
      const q = p.slice();
      for (let i = 1; i < p.length - 1; i++) {
        const ax = (p[i-1].x + p[i].x + p[i+1].x) / 3;
        const ay = (p[i-1].y + p[i].y + p[i+1].y) / 3;
        q[i] = { x: p[i].x + strength * (ax - p[i].x), y: p[i].y + strength * (ay - p[i].y) };
      }
      p = q;
    };
    const whole = Math.floor(amount);
    const frac  = amount - whole;
    for (let k = 0; k < whole; k++) pass(1);
    if (frac > 0) pass(frac);
    return p;
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
        // Catmull-Rom → cubic Bézier conversion
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
