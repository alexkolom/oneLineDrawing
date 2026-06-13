export class Skeletonizer {
  static thin(binary, width, height) {
    const n = width * height;
    const p = new Uint8Array(n);
    for (let i = 0; i < n; i++) p[i] = binary[i] ? 1 : 0;

    const get = (x, y) =>
      x < 0 || x >= width || y < 0 || y >= height ? 0 : p[y * width + x];

    let changed = true;
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        const del = [];
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (!p[y * width + x]) continue;

            const p2=get(x,y-1), p3=get(x+1,y-1), p4=get(x+1,y), p5=get(x+1,y+1);
            const p6=get(x,y+1), p7=get(x-1,y+1), p8=get(x-1,y), p9=get(x-1,y-1);

            const B = p2+p3+p4+p5+p6+p7+p8+p9;
            if (B < 2 || B > 6) continue;

            const ring = [p2,p3,p4,p5,p6,p7,p8,p9,p2];
            let A = 0;
            for (let k = 0; k < 8; k++) if (!ring[k] && ring[k+1]) A++;
            if (A !== 1) continue;

            if (pass === 0) {
              if (p2 * p4 * p6 !== 0) continue;
              if (p4 * p6 * p8 !== 0) continue;
            } else {
              if (p2 * p4 * p8 !== 0) continue;
              if (p2 * p6 * p8 !== 0) continue;
            }

            del.push(y * width + x);
          }
        }
        if (del.length) { changed = true; for (const i of del) p[i] = 0; }
      }
    }

    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = p[i] ? 255 : 0;
    return out;
  }
}
