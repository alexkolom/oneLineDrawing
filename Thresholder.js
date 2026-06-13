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

  // 3-class Otsu: exhaustive (t1, t2) search for two thresholds that
  // maximise total inter-class variance. Returns [t1, t2] where t1 < t2.
  static otsu3(gray) {
    const hist = new Array(256).fill(0);
    for (const v of gray) hist[v]++;
    const N = gray.length;

    // Prefix sums: cn[i+1] = pixel count for values 0..i; cs[i+1] = their sum
    const cn = new Float64Array(257);
    const cs = new Float64Array(257);
    for (let i = 0; i < 256; i++) {
      cn[i + 1] = cn[i] + hist[i];
      cs[i + 1] = cs[i] + i * hist[i];
    }
    const μ = cs[256] / N;

    let maxVar = -1, t1Best = 85, t2Best = 170;

    for (let t1 = 1; t1 < 254; t1++) {
      const w0 = cn[t1 + 1];
      if (w0 === 0) continue;
      const μ0 = cs[t1 + 1] / w0;

      for (let t2 = t1 + 1; t2 < 255; t2++) {
        const w1 = cn[t2 + 1] - cn[t1 + 1];
        if (w1 === 0) continue;
        const w2 = N - cn[t2 + 1];
        if (w2 === 0) continue;

        const μ1 = (cs[t2 + 1] - cs[t1 + 1]) / w1;
        const μ2 = (cs[256] - cs[t2 + 1]) / w2;

        const v = w0 * (μ0 - μ) ** 2 + w1 * (μ1 - μ) ** 2 + w2 * (μ2 - μ) ** 2;
        if (v > maxVar) { maxVar = v; t1Best = t1; t2Best = t2; }
      }
    }

    return [t1Best, t2Best]; // class boundaries: ≤t1, t1<…≤t2, >t2
  }

  // Apply threshold: pixels <= t become 255 (foreground/dark), rest 0.
  // gray: Uint8Array. Returns Uint8Array.
  static apply(gray, t) {
    const out = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) out[i] = gray[i] <= t ? 255 : 0;
    return out;
  }
}
