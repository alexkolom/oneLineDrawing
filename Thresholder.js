export class Thresholder {
  // Otsu's method: find threshold that maximises inter-class variance.
  // gray: Uint8Array of grayscale pixel values.
  // Returns integer 0–255.
  static otsu(gray) {
    const hist = new Array(256).fill(0);
    for (const v of gray) hist[v]++;
    const total = gray.length;

    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];

    let wB = 0, sumB = 0, maxVar = 0, threshold = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const v = wB * wF * (mB - mF) ** 2;
      if (v > maxVar) { maxVar = v; threshold = t; }
    }
    return threshold;
  }

  // Apply threshold: pixels <= t become 255 (foreground/dark), rest 0.
  // gray: Uint8Array. Returns Uint8Array.
  static apply(gray, t) {
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= t ? 255 : 0;
    return out;
  }
}
