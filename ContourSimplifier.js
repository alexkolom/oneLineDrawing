export class ContourSimplifier {
  // Keep only contours whose bounding-box area >= minArea (px²).
  static filter(contours, minArea) {
    return contours.filter(c => {
      if (c.length < 3) return false;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of c) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      return (maxX - minX) * (maxY - minY) >= minArea;
    });
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
