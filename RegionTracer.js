export class RegionTracer {
  // 8-neighbourhood offsets, clockwise starting at East.
  static #N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

  static #dirIndex(dx, dy) {
    const N = this.#N8;
    for (let i = 0; i < 8; i++) if (N[i][0] === dx && N[i][1] === dy) return i;
    return 4; // fall back to West
  }

  // Moore-neighbour trace of one component's outer boundary, starting at its
  // topmost-leftmost pixel (sx, sy). Returns a closed loop of {x,y} points.
  // Because s is topmost-leftmost, its west neighbour is background, which we
  // use as the initial backtrack pixel.
  static #traceBoundary(binary, width, height, sx, sy) {
    const N8 = this.#N8;
    const contour = [{ x: sx, y: sy }];
    let bx = sx - 1, by = sy; // backtrack (background)
    let px = sx, py = sy;
    const maxSteps = width * height * 2;

    for (let step = 0; step < maxSteps; step++) {
      const bd = this.#dirIndex(bx - px, by - py);
      let found = false;
      for (let k = 1; k <= 8; k++) {
        const d  = N8[(bd + k) % 8];
        const nx = px + d[0], ny = py + d[1];
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && binary[ny * width + nx]) {
          const pd = N8[(bd + k - 1) % 8]; // last background cell checked
          bx = px + pd[0]; by = py + pd[1];
          px = nx; py = ny;
          found = true;
          break;
        }
      }
      if (!found) break;                          // isolated pixel
      if (px === sx && py === sy) break;          // returned to start → closed
      contour.push({ x: px, y: py });
    }
    return contour;
  }

  // Flood-fill (8-connected) marking a whole component as done, so we never
  // re-start tracing inside an already-traced region.
  static #fillComponent(binary, done, width, height, sx, sy) {
    const stack = [sy * width + sx];
    while (stack.length) {
      const i = stack.pop();
      if (done[i] || !binary[i]) continue;
      done[i] = 1;
      const x = i % width, y = (i / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (binary[ni] && !done[ni]) stack.push(ni);
        }
      }
    }
  }

  // binary: Uint8Array (non-zero = foreground). Returns one clean closed
  // boundary loop per connected foreground region (outer boundaries only).
  static trace(binary, width, height) {
    const done  = new Uint8Array(binary.length);
    const loops = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!binary[i] || done[i]) continue;
        // First-seen pixel of a new component is its topmost-leftmost → on the boundary.
        const loop = this.#traceBoundary(binary, width, height, x, y);
        if (loop.length >= 3) loops.push(loop);
        this.#fillComponent(binary, done, width, height, x, y);
      }
    }
    return loops;
  }
}
