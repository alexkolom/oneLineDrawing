export class EdgeDetector {

  static toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const a = data[i * 4 + 3];
      if (a < 128) {
        gray[i] = 255; // transparent → white background
      } else {
        const t = a / 255;
        gray[i] = Math.round(
          (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * t +
          255 * (1 - t)
        );
      }
    }
    return gray;
  }

  static levels(gray, blackPoint, whitePoint, gamma) {
    const out   = new Uint8Array(gray.length);
    const range = Math.max(1, whitePoint - blackPoint);
    const inv   = 1 / Math.max(0.01, gamma);
    for (let i = 0; i < gray.length; i++) {
      let v = (gray[i] - blackPoint) / range;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (gamma !== 1.0) v = Math.pow(v, inv);
      out[i] = Math.round(v * 255);
    }
    return out;
  }

  static posterize(gray, levels) {
    if (levels <= 1) return new Uint8Array(gray);
    const out  = new Uint8Array(gray.length);
    const step = 255 / (levels - 1);
    for (let i = 0; i < gray.length; i++) {
      out[i] = Math.round(Math.round(gray[i] / step) * step);
    }
    return out;
  }

  // Edge-preserving smoothing: replaces each pixel with the median of its
  // neighbourhood. Kills salt-and-pepper texture without blurring hard edges.
  static medianFilter(gray, width, height, radius) {
    if (radius === 0) return new Uint8Array(gray);
    const out  = new Uint8Array(gray.length);
    const size = 2 * radius + 1;
    const kLen = size * size;
    const buf  = new Uint8Array(kLen);
    const mid  = kLen >> 1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let k = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx < 0 ? 0 : x + dx >= width  ? width  - 1 : x + dx;
            const ny = y + dy < 0 ? 0 : y + dy >= height ? height - 1 : y + dy;
            buf[k++] = gray[ny * width + nx];
          }
        }
        // Insertion sort — fast for small fixed-size kernels (9 or 25 elements)
        for (let i = 1; i < kLen; i++) {
          const v = buf[i]; let j = i - 1;
          while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
          buf[j + 1] = v;
        }
        out[y * width + x] = buf[mid];
      }
    }
    return out;
  }

  // Detects boundaries between posterized regions.
  // A pixel is a boundary if any 4-connected neighbour has a different value.
  // Output is binary (255 = boundary, 0 = interior) — same format as threshold().
  static regionBoundaries(gray, width, height) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const v   = gray[idx];
        if (
          (x > 0          && gray[idx - 1]     !== v) ||
          (x < width - 1  && gray[idx + 1]     !== v) ||
          (y > 0          && gray[idx - width] !== v) ||
          (y < height - 1 && gray[idx + width] !== v)
        ) out[idx] = 255;
      }
    }
    return out;
  }

  static gaussianBlur(gray, width, height, sigma = 1.0) {
    if (sigma <= 0) return new Uint8Array(gray);
    const radius = Math.max(1, Math.ceil(3 * sigma));
    const size = 2 * radius + 1;
    const kernel = new Float32Array(size);
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const x = i - radius;
      kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
      sum += kernel[i];
    }
    for (let i = 0; i < size; i++) kernel[i] /= sum;

    // Separable convolution: horizontal pass
    const tmp = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let val = 0;
        for (let k = 0; k < size; k++) {
          const nx = Math.max(0, Math.min(width - 1, x + k - radius));
          val += kernel[k] * gray[y * width + nx];
        }
        tmp[y * width + x] = Math.round(val);
      }
    }

    // Vertical pass
    const result = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let val = 0;
        for (let k = 0; k < size; k++) {
          const ny = Math.max(0, Math.min(height - 1, y + k - radius));
          val += kernel[k] * tmp[ny * width + x];
        }
        result[y * width + x] = Math.round(val);
      }
    }

    return result;
  }

  static sobel(gray, width, height) {
    const { magnitude } = this._sobelFull(gray, width, height);
    return magnitude;
  }

  // Non-maximum suppression: thins edges to 1-pixel width.
  // Compares each pixel's gradient magnitude with its two neighbours
  // along the gradient direction; suppresses non-maxima.
  static nonMaxSuppression(gray, width, height) {
    const { magRaw, gxRaw, gyRaw, maxMag } = this._sobelFull(gray, width, height);
    if (maxMag === 0) return new Uint8Array(width * height);

    const thin = new Uint8Array(width * height);

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const m = magRaw[idx];
        if (m === 0) continue;

        const angle = Math.atan2(gyRaw[idx], gxRaw[idx]) * 180 / Math.PI;
        const a = ((angle % 180) + 180) % 180; // normalise to [0, 180)

        let q, r;
        if (a < 22.5 || a >= 157.5) {
          q = magRaw[y * width + (x + 1)];
          r = magRaw[y * width + (x - 1)];
        } else if (a < 67.5) {
          q = magRaw[(y - 1) * width + (x + 1)];
          r = magRaw[(y + 1) * width + (x - 1)];
        } else if (a < 112.5) {
          q = magRaw[(y - 1) * width + x];
          r = magRaw[(y + 1) * width + x];
        } else {
          q = magRaw[(y + 1) * width + (x + 1)];
          r = magRaw[(y - 1) * width + (x - 1)];
        }

        thin[idx] = (m >= q && m >= r) ? Math.round((m / maxMag) * 255) : 0;
      }
    }

    return thin;
  }

  static _sobelFull(gray, width, height) {
    const magRaw = new Float32Array(width * height);
    const gxRaw  = new Float32Array(width * height);
    const gyRaw  = new Float32Array(width * height);
    let maxMag = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const tl = gray[(y - 1) * width + (x - 1)];
        const tc = gray[(y - 1) * width +  x];
        const tr = gray[(y - 1) * width + (x + 1)];
        const ml = gray[ y      * width + (x - 1)];
        const mr = gray[ y      * width + (x + 1)];
        const bl = gray[(y + 1) * width + (x - 1)];
        const bc = gray[(y + 1) * width +  x];
        const br = gray[(y + 1) * width + (x + 1)];

        const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
        const m  = Math.sqrt(gx * gx + gy * gy);

        gxRaw[y * width + x]  = gx;
        gyRaw[y * width + x]  = gy;
        magRaw[y * width + x] = m;
        if (m > maxMag) maxMag = m;
      }
    }

    // Normalised 0-255 magnitude for display
    const magnitude = new Uint8Array(width * height);
    if (maxMag > 0) {
      for (let i = 0; i < magnitude.length; i++) {
        magnitude[i] = Math.round((magRaw[i] / maxMag) * 255);
      }
    }

    return { magnitude, magRaw, gxRaw, gyRaw, maxMag };
  }

  static threshold(edgeMag, thr) {
    const binary = new Uint8Array(edgeMag.length);
    for (let i = 0; i < edgeMag.length; i++) {
      binary[i] = edgeMag[i] >= thr ? 255 : 0;
    }
    return binary;
  }

  // Canny hysteresis: keep strong edges (>= highFrac*255) unconditionally;
  // keep weak edges (>= lowFrac*255) only if 8-connected to a strong edge.
  static hysteresis(nms, width, height, lowFrac = 0.05, highFrac = 0.15) {
    const low  = lowFrac  * 255;
    const high = highFrac * 255;
    const out  = new Uint8Array(nms.length);
    const q    = [];

    for (let i = 0; i < nms.length; i++) {
      if (nms[i] >= high) { out[i] = 255; q.push(i); }
    }

    let head = 0;
    while (head < q.length) {
      const i = q[head++];
      const x = i % width, y = (i / width) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const ni = ny * width + nx;
          if (!out[ni] && nms[ni] >= low) { out[ni] = 255; q.push(ni); }
        }
      }
    }
    return out;
  }

  // Morphological closing (dilation then erosion) on a binary image.
  // Fills gaps up to ~2*radius pixels wide without significantly growing edges.
  static morphClose(binary, width, height, radius) {
    if (radius < 1) return binary;
    const r = Math.round(radius);

    // Dilation: pixel on if any neighbor within r is on
    const dilated = new Uint8Array(binary.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let on = false;
        outer1: for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (binary[ny * width + nx]) { on = true; break outer1; }
          }
        }
        if (on) dilated[y * width + x] = 255;
      }
    }

    // Erosion: pixel on only if all neighbors within r are on in dilated
    const result = new Uint8Array(binary.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let allOn = true;
        outer2: for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            if (!dilated[ny * width + nx]) { allOn = false; break outer2; }
          }
        }
        if (allOn) result[y * width + x] = 255;
      }
    }
    return result;
  }

  // Returns blackPoint and whitePoint by clipping at lowPct/highPct percentiles of the histogram.
  // Uses 5/95 percentiles to avoid amplifying subtle texture on well-lit images.
  static analyzeHistogram(gray, lowPct = 5, highPct = 95) {
    const hist = new Int32Array(256);
    for (const v of gray) hist[v]++;
    const total = gray.length;
    const lowCount  = total * lowPct  / 100;
    const highCount = total * highPct / 100;
    let cum = 0, blackPoint = 0, whitePoint = 255;
    for (let i = 0; i < 256; i++) {
      cum += hist[i];
      if (blackPoint === 0 && cum >= lowCount)  blackPoint = i;
      if (cum >= highCount) { whitePoint = i; break; }
    }
    // If the image already spans most of the tonal range, don't force a stretch
    if (whitePoint - blackPoint > 180) return { blackPoint: 0, whitePoint: 255 };
    return { blackPoint, whitePoint };
  }

  // Returns cannyHighFrac and cannyLowFrac derived from the gradient distribution of the image.
  // Uses 90th/75th percentile — biased high to avoid treating texture as structure.
  static autoCannyFracs(gray, width, height) {
    const { magnitude } = this._sobelFull(gray, width, height);
    // Build a histogram of magnitudes and find percentiles
    const hist = new Int32Array(256);
    for (const v of magnitude) hist[v]++;
    const total = magnitude.length;
    const p90count = total * 0.90, p75count = total * 0.75;
    let cum = 0, p90 = 255, p75 = 0;
    for (let i = 0; i < 256; i++) {
      cum += hist[i];
      if (p75 === 0 && cum >= p75count) p75 = i;
      if (cum >= p90count) { p90 = i; break; }
    }
    const highFrac = Math.max(0.08, Math.min(0.8, p90 / 255));
    const lowFrac  = Math.max(0.02, Math.min(highFrac * 0.45, p75 / 255));
    return { highFrac, lowFrac };
  }

  static toImageData(values, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const v = values[i];
      data[i * 4]     = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    return new ImageData(data, width, height);
  }
}
