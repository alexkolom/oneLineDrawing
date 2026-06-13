import { Skeletonizer } from '../Skeletonizer.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// Helper: create a binary image from a string grid
// '.' = 0, '#' = 255
function fromGrid(rows) {
  const height = rows.length, width = rows[0].length;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      data[y * width + x] = rows[y][x] === '#' ? 255 : 0;
  return { data, width, height };
}

function countLit(arr) { let n = 0; for (const v of arr) if (v) n++; return n; }

// A 3px-wide horizontal bar should thin to a 1px-wide line
{
  const { data, width, height } = fromGrid([
    '.............',
    '#############',
    '#############',
    '#############',
    '.............',
  ]);
  const out = Skeletonizer.thin(data, width, height);
  // All lit pixels should be in a single row
  const rows = new Set();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (out[y * width + x]) rows.add(y);
  assert(rows.size === 1, 'thin: 3px bar collapses to 1px');
  assert(countLit(out) > 0, 'thin: some pixels survive');
}

// A single pixel should survive
{
  const data = new Uint8Array(9); data[4] = 255;
  const out = Skeletonizer.thin(data, 3, 3);
  assert(out[4] === 255, 'thin: isolated pixel survives');
}

// An L-shape should remain connected after thinning
{
  const { data, width, height } = fromGrid([
    '.......',
    '.####..',
    '.####..',
    '.##....',
    '.##....',
    '.......',
  ]);
  const out = Skeletonizer.thin(data, width, height);
  assert(countLit(out) > 0, 'thin: L-shape survives');
  assert(countLit(out) < countLit(data), 'thin: L-shape reduced');
}

// Output should be binary (only 0 or 255)
{
  const data = new Uint8Array(25);
  data[6]=data[7]=data[8]=data[11]=data[12]=data[13]=data[16]=data[17]=data[18]=255;
  const out = Skeletonizer.thin(data, 5, 5);
  assert(out.every(v => v === 0 || v === 255), 'thin: output is binary');
}

console.log(`Skeletonizer: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
