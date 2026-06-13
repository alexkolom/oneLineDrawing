import { EdgeDetector } from '../EdgeDetector.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// Test: gaussianBlur accepts float sigma
{
  const gray = new Uint8Array(100); gray[50] = 255;
  const blurred = EdgeDetector.gaussianBlur(gray, 10, 10, 1.5);
  assert(blurred[50] < 255, 'gaussianBlur: centre pixel reduced by blur');
  assert(blurred[50] > 0, 'gaussianBlur: centre pixel non-zero');
  assert(blurred[49] > 0, 'gaussianBlur: neighbour gets some value');
}

// Test: gaussianBlur sigma=0 is identity
{
  const gray = new Uint8Array([10,20,30,40]);
  const out = EdgeDetector.gaussianBlur(gray, 2, 2, 0);
  assert(out[0] === 10 && out[3] === 40, 'gaussianBlur: sigma=0 is identity');
}

// Test: hysteresis — strong pixel kept
{
  const nms = new Uint8Array(9); nms[4] = 200; // centre strong
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[4] === 255, 'hysteresis: strong pixel kept');
}

// Test: hysteresis — weak pixel connected to strong is kept
{
  const nms = new Uint8Array(9);
  nms[4] = 200; // centre strong (200/255 > 0.15)
  nms[5] = 30;  // right weak (30/255 > 0.05 but < 0.15)
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[4] === 255, 'hysteresis: strong pixel kept');
  assert(out[5] === 255, 'hysteresis: weak pixel adjacent to strong kept');
}

// Test: hysteresis — weak pixel isolated is discarded
{
  const nms = new Uint8Array(9);
  nms[0] = 30; // weak, isolated
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[0] === 0, 'hysteresis: isolated weak pixel discarded');
}

// Test: hysteresis — pixel below low threshold always discarded
{
  const nms = new Uint8Array(9);
  nms[4] = 200; nms[5] = 5; // 5/255 < 0.05
  const out = EdgeDetector.hysteresis(nms, 3, 3, 0.05, 0.15);
  assert(out[5] === 0, 'hysteresis: below-low pixel discarded even adjacent to strong');
}

console.log(`EdgeDetector: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
