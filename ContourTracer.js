export class ContourTracer {
  static #DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
  static #DY8 = [0, 1, 1,  1,  0, -1, -1, -1];

  // binary: Uint8Array (255=foreground, 0=background), width, height
  // Returns Array<{x,y}[]> — one ordered polyline per region boundary
  static trace(binary, width, height) {
    // Step 1: find border pixels (foreground with ≥1 background 4-neighbour)
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

    // Step 2: BFS to group border pixels into 8-connected components
    const comp = new Int32Array(binary.length).fill(-1);
    const components = [];
    for (let i = 0; i < border.length; i++) {
      if (!border[i] || comp[i] >= 0) continue;
      const label = components.length;
      const pixels = [];
      const queue = [i];
      comp[i] = label;
      while (queue.length) {
        const idx = queue.pop();
        pixels.push(idx);
        const cx = idx % width, cy = (idx / width) | 0;
        for (let d = 0; d < 8; d++) {
          const nx = cx + this.#DX8[d], ny = cy + this.#DY8[d];
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (!border[ni] || comp[ni] >= 0) continue;
          comp[ni] = label;
          queue.push(ni);
        }
      }
      components.push(pixels);
    }

    // Step 3: order each component as a greedy 8-connected chain
    return components.map(pixels => this.#orderChain(pixels, width));
  }

  static #orderChain(pixels, width) {
    if (pixels.length <= 2) {
      return pixels.map(i => ({ x: i % width, y: (i / width) | 0 }));
    }

    // Build lookup set and sort to find topmost-leftmost start
    const inSet = new Uint8Set(pixels);
    pixels.sort((a, b) => ((a / width) | 0) - ((b / width) | 0) || a % width - b % width);

    const visited = new Uint8Set([]);
    const chain = [];
    let cur = pixels[0];

    while (cur !== undefined) {
      visited.add(cur);
      chain.push({ x: cur % width, y: (cur / width) | 0 });
      const cx = cur % width, cy = (cur / width) | 0;
      cur = undefined;
      for (let d = 0; d < 8; d++) {
        const nx = cx + ContourTracer.#DX8[d], ny = cy + ContourTracer.#DY8[d];
        const ni = ny * width + nx;
        if (inSet.has(ni) && !visited.has(ni)) { cur = ni; break; }
      }
    }
    return chain;
  }
}

// Minimal integer set backed by Uint8Array for performance
class Uint8Set {
  #data;
  constructor(items) {
    this.#data = new Map();
    for (const v of items) this.#data.set(v, 1);
  }
  has(v) { return this.#data.has(v); }
  add(v) { this.#data.set(v, 1); }
}
