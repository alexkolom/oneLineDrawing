export class ContourTracer {
  static #DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
  static #DY8 = [0, 1, 1,  1,  0, -1, -1, -1];

  // binary: Uint8Array (255=foreground, 0=background), width, height
  // Returns Array<{x,y}[]> — one ordered polyline per region boundary segment
  static trace(binary, width, height) {
    // Mark border pixels: foreground pixels with ≥1 background 4-neighbour
    const border = new Uint8Array(binary.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!binary[i]) continue;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
            !binary[i - 1] || !binary[i + 1] ||
            !binary[i - width] || !binary[i + width]) {
          border[i] = 1;
        }
      }
    }

    // Greedy chain tracing: scan top-to-bottom left-to-right.
    // Start a new chain at each unvisited border pixel; follow 8-connected
    // neighbours until stuck. Dead ends simply trigger a new chain from the
    // next unvisited pixel — no pixels are abandoned.
    const visited = new Uint8Array(binary.length);
    const contours = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!border[i] || visited[i]) continue;

        const chain = [];
        let cx = x, cy = y;

        while (true) {
          const ci = cy * width + cx;
          if (visited[ci]) break;
          visited[ci] = 1;
          chain.push({ x: cx, y: cy });

          let moved = false;
          for (let d = 0; d < 8; d++) {
            const nx = cx + this.#DX8[d];
            const ny = cy + this.#DY8[d];
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (border[ni] && !visited[ni]) {
              cx = nx; cy = ny;
              moved = true;
              break;
            }
          }
          if (!moved) break;
        }

        if (chain.length >= 3) contours.push(chain);
      }
    }

    return contours;
  }
}
