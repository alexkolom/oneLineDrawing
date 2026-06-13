// tests/test-skeleton-graph.js
import { SkeletonGraph } from '../SkeletonGraph.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

function fromGrid(rows) {
  const h = rows.length, w = rows[0].length;
  const skel = new Uint8Array(w * h);
  const gray = new Uint8Array(w * h).fill(128); // mid-gray (not background)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (rows[y][x] === '#') skel[y * w + x] = 255;
      if (rows[y][x] === 'B') gray[y * w + x] = 255; // background
    }
  return { skel, gray, w, h };
}

// A horizontal line: 2 endpoints, 1 edge, no junctions
{
  const { skel, gray, w, h } = fromGrid([
    '.......',
    '.#####.',
    '.......',
  ]);
  const g = SkeletonGraph.build(skel, w, h, gray, { minBranchFrac: 0, silhouetteBonus: 2 });
  assert(g.nodes.length === 2, 'line: 2 endpoint nodes');
  assert(g.edges.length === 1, 'line: 1 edge');
}

// A T-junction: 1 junction node + 3 endpoints
{
  const { skel, gray, w, h } = fromGrid([
    '...#...',
    '...#...',
    '.#####.',
    '.......',
  ]);
  const g = SkeletonGraph.build(skel, w, h, gray, { minBranchFrac: 0, silhouetteBonus: 2 });
  assert(g.nodes.some(n => n.degree >= 3), 'T-junction: junction node exists');
  assert(g.edges.length === 3, 'T-junction: 3 edges');
}

// Short branches are pruned
{
  const skel2 = new Uint8Array(9 * 9);
  const gray2 = new Uint8Array(9 * 9).fill(128);
  // Long horizontal bar row 4
  for (let x = 0; x < 9; x++) skel2[4*9+x] = 255;
  // Short vertical stub col 4, rows 3-4 only (length 1)
  skel2[3*9+4] = 255;
  const g = SkeletonGraph.build(skel2, 9, 9, gray2, { minBranchFrac: 0.15, silhouetteBonus: 2 });
  // The short stub (length 1) should be pruned; remaining = horizontal bar
  assert(g.edges.length <= 2, 'pruning: short stub removed');
}

// Silhouette detection: branch adjacent to background (gray>=240) → isSilhouette
{
  // 3×3: centre pixel is skeleton, right pixel is background (255)
  const skel = new Uint8Array(9); skel[3] = skel[4] = skel[5] = 255; // middle row
  const gray = new Uint8Array(9).fill(128);
  gray[0] = gray[1] = gray[2] = 255; // top row = background
  const g = SkeletonGraph.build(skel, 3, 3, gray, { minBranchFrac: 0, silhouetteBonus: 2 });
  if (g.edges.length > 0) {
    assert(g.edges[0].isSilhouette === true, 'silhouette: branch touching background is flagged');
    assert(g.edges[0].weight > g.edges[0].length, 'silhouette: weight boosted');
  }
}

console.log(`SkeletonGraph: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
