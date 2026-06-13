export class PathPlanner {
  // segments: Array<{x,y}[]>  — one polyline per contour (output of ContourSimplifier)
  // opts:     { maxJumpFrac=0.08, width, height }
  // Returns:  (Point | null)[]  — nulls mark pen-up jumps
  static solve(segments, opts = {}) {
    const { maxJumpFrac = 0.08, width = 1, height = 1 } = opts;
    if (!segments?.length) return [];

    const maxJump = maxJumpFrac * Math.sqrt(width * width + height * height);
    const used = new Uint8Array(segments.length);
    const result = [];

    // Start with the longest segment (most detail, good anchor)
    let startIdx = 0, bestLen = -1;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].length > bestLen) { bestLen = segments[i].length; startIdx = i; }
    }

    const append = (seg) => { result.push(...seg); };

    used[startIdx] = 1;
    append(segments[startIdx]);
    let tail = segments[startIdx][segments[startIdx].length - 1];

    for (let pass = 1; pass < segments.length; pass++) {
      // Find nearest unvisited segment endpoint (either end, either direction)
      let bestDist = Infinity, bestIdx = -1, bestRev = false;
      for (let i = 0; i < segments.length; i++) {
        if (used[i]) continue;
        const seg = segments[i];
        const dH = Math.hypot(seg[0].x - tail.x, seg[0].y - tail.y);
        const dT = Math.hypot(seg[seg.length - 1].x - tail.x, seg[seg.length - 1].y - tail.y);
        if (dH < bestDist) { bestDist = dH; bestIdx = i; bestRev = false; }
        if (dT < bestDist) { bestDist = dT; bestIdx = i; bestRev = true; }
      }
      if (bestIdx < 0) break;

      used[bestIdx] = 1;
      const seg = segments[bestIdx];
      const ordered = bestRev ? [...seg].reverse() : seg;
      if (bestDist > maxJump) result.push(null);
      append(ordered);
      tail = ordered[ordered.length - 1];
    }

    return result;
  }
}
