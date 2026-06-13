// tests/test-bezier.js
import { BezierPathBuilder } from '../BezierPathBuilder.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// build() still works with default tension
{
  const pts = [{ x:0,y:0 }, { x:10,y:5 }, { x:20,y:0 }];
  const d = BezierPathBuilder.build(pts);
  assert(typeof d === 'string' && d.startsWith('M'), 'build: returns SVG path string');
  assert(d.includes('C'), 'build: contains cubic bezier command');
}

// tension=0 produces different curves than tension=0.5
{
  const pts = [{ x:0,y:0 }, { x:10,y:10 }, { x:20,y:0 }, { x:30,y:10 }];
  const d1 = BezierPathBuilder.build(pts, 0.5);
  const d2 = BezierPathBuilder.build(pts, 0.1);
  assert(d1 !== d2, 'tension: different values produce different output');
}

// resample: uniform sampling along a straight line
{
  const pts = Array.from({ length: 21 }, (_, i) => ({ x: i, y: 0 }));
  const resampled = BezierPathBuilder.resample(pts, 5);
  // step=5 → approx (20/5)+1 = 5 points
  assert(resampled.length >= 3 && resampled.length <= 7, `resample: approx correct count (got ${resampled.length})`);
  assert(resampled[0].x === 0, 'resample: starts at first point');
}

// null separators: two segments produce two M commands
{
  const pts = [{ x:0,y:0 }, { x:5,y:5 }, null, { x:20,y:20 }, { x:25,y:25 }];
  const d = BezierPathBuilder.build(pts);
  const mCount = (d.match(/M /g) || []).length;
  assert(mCount === 2, 'null separator: two M commands');
}

// resample preserves first and last point approximately
{
  const pts = [{ x:0,y:0 }, { x:10,y:5 }, { x:20,y:0 }];
  const r = BezierPathBuilder.resample(pts, 3);
  assert(Math.abs(r[0].x) < 0.5, 'resample: first point preserved');
  assert(Math.abs(r[r.length-1].x - 20) < 1, 'resample: last point approximately preserved');
}

console.log(`BezierPathBuilder: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
