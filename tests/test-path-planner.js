// tests/test-path-planner.js
import { PathPlanner } from '../PathPlanner.js';

let pass = 0, fail = 0;
function assert(cond, msg) { if (cond) { pass++; } else { fail++; console.error('FAIL:', msg); } }

// Minimal graph: 2 nodes, 1 edge → path of 2 pixels
{
  const nodes = [{ id: 0, x: 0, y: 0, degree: 1 }, { id: 1, x: 10, y: 0, degree: 1 }];
  const edges = [{ id: 0, nodeA: 0, nodeB: 1,
    pixels: [{ x:0,y:0 }, { x:5,y:0 }, { x:10,y:0 }],
    length: 10, weight: 10, isSilhouette: false }];
  const out = PathPlanner.solve({ nodes, edges }, { maxJumpFrac: 0.5, width: 100, height: 100 });
  const pts = out.filter(p => p !== null);
  assert(pts.length >= 2, 'simple: produces points');
  assert(!out.includes(null), 'simple: no pen-ups for small graph');
}

// Triangle: 3 nodes, 3 edges → Euler circuit visits all edges
{
  const nodes = [
    { id: 0, x: 0, y: 0, degree: 2 },
    { id: 1, x: 10, y: 0, degree: 2 },
    { id: 2, x: 5, y: 8, degree: 2 },
  ];
  const edges = [
    { id: 0, nodeA: 0, nodeB: 1, pixels: [{x:0,y:0},{x:10,y:0}], length:10, weight:10, isSilhouette:false },
    { id: 1, nodeA: 1, nodeB: 2, pixels: [{x:10,y:0},{x:5,y:8}], length:9,  weight:9,  isSilhouette:false },
    { id: 2, nodeA: 2, nodeB: 0, pixels: [{x:5,y:8},{x:0,y:0}],  length:9,  weight:9,  isSilhouette:false },
  ];
  const out = PathPlanner.solve({ nodes, edges }, { maxJumpFrac: 0.5, width: 100, height: 100 });
  const pts = out.filter(p => p !== null);
  assert(pts.length >= 4, 'triangle: visits all 3 edges');
}

// Disconnected graph: 2 isolated edges — output should have at most 1 null (one pen-up)
{
  const nodes = [
    { id: 0, x: 0, y: 0, degree: 1 },   { id: 1, x: 5, y: 0, degree: 1 },
    { id: 2, x: 50, y: 50, degree: 1 }, { id: 3, x: 55, y: 50, degree: 1 },
  ];
  const edges = [
    { id: 0, nodeA: 0, nodeB: 1, pixels: [{x:0,y:0},{x:5,y:0}], length:5, weight:5, isSilhouette:false },
    { id: 1, nodeA: 2, nodeB: 3, pixels: [{x:50,y:50},{x:55,y:50}], length:5, weight:5, isSilhouette:false },
  ];
  const out = PathPlanner.solve({ nodes, edges }, { maxJumpFrac: 0.9, width: 100, height: 100 });
  const nullCount = out.filter(p => p === null).length;
  assert(nullCount <= 1, 'disconnected: at most 1 pen-up to bridge components');
  assert(out.filter(p => p !== null).length >= 4, 'disconnected: all edge pixels visited');
}

// Empty graph returns empty
{
  const out = PathPlanner.solve({ nodes: [], edges: [] }, {});
  assert(Array.isArray(out) && out.length === 0, 'empty: returns []');
}

console.log(`PathPlanner: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
