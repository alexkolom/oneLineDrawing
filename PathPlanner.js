export class PathPlanner {

  // graph: { nodes: [{id,x,y,degree}], edges: [{id,nodeA,nodeB,pixels,length,weight,isSilhouette}] }
  // opts: { maxJumpFrac=0.08, width, height }
  // Returns: Point[] with null separators for pen-ups
  static solve(graph, opts = {}) {
    const { maxJumpFrac = 0.08, width = 1, height = 1 } = opts;
    const maxJump = maxJumpFrac * Math.sqrt(width * width + height * height);
    const { nodes, edges } = graph;
    if (!nodes.length || !edges.length) return [];

    // Stable index map: node.id → position in nodes array
    const nodeIdx = new Map(nodes.map((n, i) => [n.id, i]));
    const N = nodes.length;

    // 1. Maximum spanning tree (Kruskal's)
    const uf = new UF(N);
    const mst = [];
    for (const e of [...edges].sort((a, b) => b.weight - a.weight)) {
      const a = nodeIdx.get(e.nodeA), b = nodeIdx.get(e.nodeB);
      if (a == null || b == null) continue;
      if (uf.find(a) !== uf.find(b)) { uf.union(a, b); mst.push(e); }
    }

    // 2. Connect disjoint components with ghost edges (nearest-pair)
    const compOf = i => uf.find(i);
    const allRoots = [...new Set(nodes.map((_, i) => compOf(i)))];

    for (let c = 1; c < allRoots.length; c++) {
      const root0 = compOf(0);
      let best = Infinity, bi = -1, bj = -1;
      for (let i = 0; i < N; i++) {
        if (compOf(i) !== root0) continue;
        for (let j = 0; j < N; j++) {
          if (compOf(j) === root0) continue;
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (d < best) { best = d; bi = i; bj = j; }
        }
      }
      if (bi === -1) break;
      uf.union(bi, bj);
      mst.push({
        id: -c, nodeA: nodes[bi].id, nodeB: nodes[bj].id,
        pixels: [{ x: nodes[bi].x, y: nodes[bi].y }, { x: nodes[bj].x, y: nodes[bj].y }],
        length: best, weight: 0, isSilhouette: false, isGhost: true
      });
    }

    // 3. Chinese Postman: find odd-degree nodes in MST and pair them
    const mstDeg = new Map(nodes.map(n => [n.id, 0]));
    for (const e of mst) {
      mstDeg.set(e.nodeA, (mstDeg.get(e.nodeA) || 0) + 1);
      mstDeg.set(e.nodeB, (mstDeg.get(e.nodeB) || 0) + 1);
    }
    const odd = nodes.filter(n => (mstDeg.get(n.id) || 0) % 2 === 1);

    // Greedy nearest-neighbor matching of odd-degree nodes
    const pairs = []; // each entry: [i, j] indices into odd[]
    {
      const paired = new Set();
      for (let i = 0; i < odd.length; i++) {
        if (paired.has(i)) continue;
        let best = Infinity, bestJ = -1;
        for (let j = i + 1; j < odd.length; j++) {
          if (paired.has(j)) continue;
          const d = Math.hypot(odd[i].x - odd[j].x, odd[i].y - odd[j].y);
          if (d < best) { best = d; bestJ = j; }
        }
        if (bestJ === -1) continue;
        paired.add(i); paired.add(bestJ);
        pairs.push([i, bestJ]);
      }
    }

    // 2-opt improvement: for every two pairs (a,b) and (c,d),
    // try rewiring as (a,c)+(b,d) or (a,d)+(b,c) and keep if shorter total.
    let improved = true;
    while (improved) {
      improved = false;
      for (let p = 0; p < pairs.length; p++) {
        for (let q = p + 1; q < pairs.length; q++) {
          const [a, b] = pairs[p], [c, d] = pairs[q];
          const cur = Math.hypot(odd[a].x-odd[b].x, odd[a].y-odd[b].y)
                    + Math.hypot(odd[c].x-odd[d].x, odd[c].y-odd[d].y);
          const alt1 = Math.hypot(odd[a].x-odd[c].x, odd[a].y-odd[c].y)
                     + Math.hypot(odd[b].x-odd[d].x, odd[b].y-odd[d].y);
          const alt2 = Math.hypot(odd[a].x-odd[d].x, odd[a].y-odd[d].y)
                     + Math.hypot(odd[b].x-odd[c].x, odd[b].y-odd[c].y);
          if (alt1 < cur - 0.001) { pairs[p] = [a, c]; pairs[q] = [b, d]; improved = true; }
          else if (alt2 < cur - 0.001) { pairs[p] = [a, d]; pairs[q] = [b, c]; improved = true; }
        }
      }
    }

    const ghostEdges = pairs.map(([ i, j ], idx) => ({
      id: -(1000 + idx),
      nodeA: odd[i].id, nodeB: odd[j].id,
      pixels: [{ x: odd[i].x, y: odd[i].y }, { x: odd[j].x, y: odd[j].y }],
      length: Math.hypot(odd[i].x-odd[j].x, odd[i].y-odd[j].y),
      weight: 0, isSilhouette: false, isGhost: true
    }));

    // 4. Build adjacency list for Hierholzer
    const allEdges = [...mst, ...ghostEdges];
    const adj = new Map(nodes.map(n => [n.id, []]));
    for (const e of allEdges) {
      if (!adj.has(e.nodeA)) adj.set(e.nodeA, []);
      if (!adj.has(e.nodeB)) adj.set(e.nodeB, []);
      adj.get(e.nodeA).push({ neighbor: e.nodeB, edge: e });
      adj.get(e.nodeB).push({ neighbor: e.nodeA, edge: e });
    }
    // Sort: real edges first (longest first), ghost last
    for (const [, list] of adj) {
      list.sort((a, b) => {
        if (!!a.edge.isGhost !== !!b.edge.isGhost) return a.edge.isGhost ? 1 : -1;
        return b.edge.length - a.edge.length;
      });
    }

    // 5. Hierholzer's algorithm
    const usedEdge = new Set();
    const adjPtr = new Map(nodes.map(n => [n.id, 0]));

    // Prefer to start from a silhouette node
    const startNode =
      allEdges.find(e => e.isSilhouette)?.nodeA ??
      nodes[0]?.id;

    const stack = [startNode];
    const circuit = [];

    while (stack.length) {
      const v = stack[stack.length - 1];
      const list = adj.get(v) || [];
      const ptr = adjPtr.get(v) || 0;
      let moved = false;
      for (let i = ptr; i < list.length; i++) {
        adjPtr.set(v, i + 1);
        const { neighbor, edge } = list[i];
        if (!usedEdge.has(edge.id)) {
          usedEdge.add(edge.id);
          stack.push(neighbor);
          moved = true;
          break;
        }
      }
      if (!moved) circuit.push(stack.pop());
    }
    circuit.reverse();

    // 6. Build output point array from circuit
    const edgeUsedDir = new Map();
    const output = [];

    for (let i = 0; i < circuit.length - 1; i++) {
      const fromId = circuit[i], toId = circuit[i + 1];
      const list = adj.get(fromId) || [];
      let found = null;
      for (const { neighbor, edge } of list) {
        if (neighbor === toId && !edgeUsedDir.has(edge.id)) {
          edgeUsedDir.set(edge.id, true);
          found = { edge, forward: edge.nodeA === fromId };
          break;
        }
      }
      if (!found) continue;

      const { edge, forward } = found;
      const pts = forward ? edge.pixels : [...edge.pixels].reverse();

      if (edge.isGhost) {
        const jumpLen = Math.hypot(
          pts[pts.length - 1].x - pts[0].x,
          pts[pts.length - 1].y - pts[0].y
        );
        if (jumpLen > maxJump && output.length) {
          output.push(null);
          output.push(...pts);
          continue;
        }
      }

      if (output.length === 0 || output[output.length - 1] === null) {
        output.push(...pts);
      } else {
        output.push(...pts.slice(1));
      }
    }

    return output;
  }
}

class UF {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
    this.r = new Array(n).fill(0);
  }
  find(x) { return this.p[x] === x ? x : (this.p[x] = this.find(this.p[x])); }
  union(x, y) {
    const [px, py] = [this.find(x), this.find(y)];
    if (px === py) return;
    if (this.r[px] < this.r[py]) this.p[px] = py;
    else if (this.r[px] > this.r[py]) this.p[py] = px;
    else { this.p[py] = px; this.r[px]++; }
  }
}
