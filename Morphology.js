// Binary morphology on flat Uint8Array masks (non-zero = foreground).
// Used to turn a noisy threshold mask into a clean, gap-free silhouette
// before tracing its outer boundary.
export class Morphology {
  // Grow foreground by `iterations` 3x3 passes (≈ radius in pixels).
  static dilate(bin, w, h, iterations = 1) {
    let cur = bin;
    for (let it = 0; it < iterations; it++) {
      const out = new Uint8Array(cur.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (cur[i]) { out[i] = 1; continue; }
          let on = 0;
          for (let dy = -1; dy <= 1 && !on; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
              if (cur[ny * w + nx]) { on = 1; break; }
            }
          }
          out[i] = on;
        }
      }
      cur = out;
    }
    return cur;
  }

  // Shrink foreground by `iterations` 3x3 passes. Out-of-bounds counts as
  // background, so foreground touching the border erodes inward.
  static erode(bin, w, h, iterations = 1) {
    let cur = bin;
    for (let it = 0; it < iterations; it++) {
      const out = new Uint8Array(cur.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (!cur[i]) { out[i] = 0; continue; }
          let all = 1;
          for (let dy = -1; dy <= 1 && all; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h) { all = 0; break; }
              if (!cur[ny * w + nx]) { all = 0; break; }
            }
          }
          out[i] = all;
        }
      }
      cur = out;
    }
    return cur;
  }

  // Morphological close: dilate then erode by the same radius. Bridges small
  // gaps and smooths the boundary without changing overall size much.
  static close(bin, w, h, radius = 1) {
    if (radius <= 0) return bin.slice();
    return this.erode(this.dilate(bin, w, h, radius), w, h, radius);
  }

  // Fill background regions not reachable from the image border (interior
  // holes) so tracing yields a solid silhouette.
  static fillHoles(bin, w, h) {
    const reach = new Uint8Array(bin.length); // background reachable from border
    const stack = [];
    const push = (x, y) => {
      const i = y * w + x;
      if (!bin[i] && !reach[i]) { reach[i] = 1; stack.push(i); }
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
    const out = bin.slice();
    for (let i = 0; i < bin.length; i++) if (!bin[i] && !reach[i]) out[i] = 1;
    return out;
  }
}
