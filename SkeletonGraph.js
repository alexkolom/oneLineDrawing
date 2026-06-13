export class SkeletonGraph {

  // skeleton: Uint8Array (255=skeleton), gray: Uint8Array (grayscale, 255=background)
  // opts: { minBranchFrac = 0.02, silhouetteBonus = 2.0 }
  // Returns: { nodes: [{id,x,y,degree}], edges: [{id,nodeA,nodeB,pixels,length,weight,isSilhouette}] }
  static build(skeleton, width, height, gray, opts = {}) {
    const { minBranchFrac = 0.02, silhouetteBonus = 2.0 } = opts;
    const minLen = minBranchFrac * Math.sqrt(width * width + height * height);

    // 1. Count skeleton neighbors for each pixel (8-connectivity)
    const nc = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!skeleton[y * width + x]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height)
              if (skeleton[ny * width + nx]) n++;
          }
        nc[y * width + x] = n;
      }
    }

    // 2. Create nodes at endpoints (nc <= 1) and junctions (nc >= 3).
    //    Adjacent junction pixels are collapsed into a single node (cluster centroid).
    const nodeAt = new Int32Array(width * height).fill(-1);
    const nodes = [];

    // 2a. Assign endpoints directly (nc <= 1)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!skeleton[i] || nc[i] > 1) continue;
        nodeAt[i] = nodes.length;
        nodes.push({ id: nodes.length, x, y, degree: 0 });
      }
    }

    // 2b. Flood-fill junction clusters (nc >= 3), collapse each cluster to one node
    for (let startY = 0; startY < height; startY++) {
      for (let startX = 0; startX < width; startX++) {
        const startI = startY * width + startX;
        if (!skeleton[startI] || nc[startI] < 3 || nodeAt[startI] !== -1) continue;

        // BFS to collect all adjacent junction pixels
        const cluster = [];
        const queue = [startI];
        nodeAt[startI] = -2; // mark as queued
        while (queue.length) {
          const ci = queue.shift();
          cluster.push(ci);
          const cx = ci % width, cy = (ci / width) | 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = cx + dx, ny = cy + dy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const ni = ny * width + nx;
              if (!skeleton[ni] || nc[ni] < 3 || nodeAt[ni] !== -1) continue;
              nodeAt[ni] = -2; // mark queued
              queue.push(ni);
            }
          }
        }

        // Centroid of cluster
        let sumX = 0, sumY = 0;
        for (const ci of cluster) { sumX += ci % width; sumY += (ci / width) | 0; }
        const cx = Math.round(sumX / cluster.length);
        const cy = Math.round(sumY / cluster.length);

        const nid = nodes.length;
        nodes.push({ id: nid, x: cx, y: cy, degree: 0 });
        for (const ci of cluster) nodeAt[ci] = nid;
      }
    }

    // 3. Trace branches between nodes
    const pathVisited = new Uint8Array(width * height);
    const edges = [];
    // Track which (nodeA, nodeB) pairs already have an edge to avoid duplicates
    const edgeSet = new Set();

    for (let startI = 0; startI < width * height; startI++) {
      const startNid = nodeAt[startI];
      if (startNid === -1) continue;
      const sx = startI % width, sy = (startI / width) | 0;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const fx = sx + dx, fy = sy + dy;
          if (fx < 0 || fx >= width || fy < 0 || fy >= height) continue;
          const fi = fy * width + fx;
          if (!skeleton[fi]) continue;

          // Direct node-to-node edge (adjacent nodes): only add once
          if (nodeAt[fi] !== -1 && nodeAt[fi] !== startNid) {
            if (fi > startI) {
              const nA = Math.min(startNid, nodeAt[fi]);
              const nB = Math.max(startNid, nodeAt[fi]);
              const key = `${nA}-${nB}`;
              if (!edgeSet.has(key)) {
                edgeSet.add(key);
                const len = Math.hypot(fx - sx, fy - sy);
                const eid = edges.length;
                edges.push({ id: eid, nodeA: nA, nodeB: nB,
                  pixels: [{ x: sx, y: sy }, { x: fx, y: fy }],
                  length: len, weight: len, isSilhouette: false, deleted: false });
                nodes[nA].degree++;
                nodes[nB].degree++;
              }
            }
            continue;
          }

          // Skip if same cluster or already visited path pixel
          if (nodeAt[fi] === startNid) continue;
          if (pathVisited[fi]) continue;

          // Trace path: walk through path pixels until hitting another node
          const pixels = [{ x: sx, y: sy }];
          let prev = startI, cur = fi;

          while (true) {
            if (nodeAt[cur] !== -1) {
              if (nodeAt[cur] !== startNid) {
                pixels.push({ x: cur % width, y: (cur / width) | 0 });
                const len = branchLen(pixels);
                const nA = Math.min(startNid, nodeAt[cur]);
                const nB = Math.max(startNid, nodeAt[cur]);
                const key = `${nA}-${nB}`;
                if (!edgeSet.has(key)) {
                  edgeSet.add(key);
                  const eid = edges.length;
                  edges.push({ id: eid, nodeA: nA, nodeB: nB,
                    pixels, length: len, weight: len, isSilhouette: false, deleted: false });
                  nodes[nA].degree++;
                  nodes[nB].degree++;
                }
              }
              break;
            }

            pathVisited[cur] = 1;
            pixels.push({ x: cur % width, y: (cur / width) | 0 });

            // Find next: skeleton neighbor, not prev, not yet visited path pixel
            let next = -1;
            const cx = cur % width, cy = (cur / width) | 0;
            for (let ndy = -1; ndy <= 1; ndy++) {
              for (let ndx = -1; ndx <= 1; ndx++) {
                if (!ndx && !ndy) continue;
                const nnx = cx + ndx, nny = cy + ndy;
                if (nnx < 0 || nnx >= width || nny < 0 || nny >= height) continue;
                const nni = nny * width + nnx;
                if (nni === prev) continue;
                if (!skeleton[nni]) continue;
                if (pathVisited[nni] && nodeAt[nni] === -1) continue;
                next = nni;
                break;
              }
              if (next !== -1) break;
            }
            if (next === -1) break; // dead end
            prev = cur;
            cur = next;
          }
        }
      }
    }

    // 4. Prune short dangling branches iteratively
    let pruning = true;
    while (pruning) {
      pruning = false;
      for (const e of edges) {
        if (e.deleted || e.length >= minLen) continue;
        const na = nodes[e.nodeA], nb = nodes[e.nodeB];
        if (na.degree === 1 || nb.degree === 1) {
          e.deleted = true;
          na.degree--;
          nb.degree--;
          pruning = true;
        }
      }
    }

    const liveEdges = edges.filter(e => !e.deleted);

    // 5. Silhouette weighting: branch is silhouette if adjacent to background
    for (const e of liveEdges) {
      let isSil = false;
      outer: for (const { x, y } of e.pixels) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (!skeleton[ni] && gray[ni] >= 240) { isSil = true; break outer; }
          }
        }
      }
      e.isSilhouette = isSil;
      e.weight = e.length * (1 + (isSil ? silhouetteBonus : 0));
    }

    const liveNodes = nodes.filter(n => n.degree > 0);
    return { nodes: liveNodes, edges: liveEdges };
  }
}

function branchLen(pixels) {
  let len = 0;
  for (let i = 1; i < pixels.length; i++)
    len += Math.hypot(pixels[i].x - pixels[i-1].x, pixels[i].y - pixels[i-1].y);
  return len;
}
