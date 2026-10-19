// Autogen model. Cells: 0 empty, 1 catalyst A, 2 catalyst B, 3 wall. Fields: S substrate, M monomers.
// Entropy: everything degrades (catalysts decay, walls erode, monomers decay, catalysts random-walk apart).
// Process 1, reciprocal catalysis: an A next to a B, with substrate, makes a new B (and B makes A), emitting monomers.
// Process 2, self-assembly: an empty cell next to a wall becomes wall when monomers are concentrated.
// Walls block diffusion and movement. Grid is bounded; the edge is a substrate reservoir.
(function (root) {
  const DEFAULTS = {
    W: 120, H: 90,
    sDiffuse: 0.5, sRain: 0, sMax: 1, sWallPerm: 0.3, sAmb: 0, sRelax: 0, // substrate spreads; walls are porous to it (sWallPerm) but not to catalysts or monomers
    mDiffuse: 0.5, mDecay: 0.005,
    catDecay: 0.0003, catMove: 0.25, catRate: 0.5, catCost: 0.3, mEmit: 1.0, partnerMin: 1,
    wallTheta: 0.8, wallCost: 0.5, wallRate: 0.5, wallErode: 0.0002, wallRelease: 0.3, wallCrowd: 2,
    seed: 1,
  };
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  class Autogen {
    constructor(opts) {
      this.p = Object.assign({}, DEFAULTS, opts || {});
      const { W, H } = this.p; this.W = W; this.H = H; const N = W * H;
      this.c = new Uint8Array(N); this.S = new Float32Array(N); this.M = new Float32Array(N);
      this.S2 = new Float32Array(N); this.M2 = new Float32Array(N);
      this.rand = mulberry32(this.p.seed); this.t = 0; this.births = 0; this.wallGrowth = 0;
    }
    idx(x, y) { return y * this.W + x; }
    inb(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
    clear() { this.c.fill(0); this.S.fill(0); this.M.fill(0); this.t = 0; }
    flood(amount) { for (let i = 0; i < this.S.length; i++) this.S[i] = Math.min(this.p.sMax, this.S[i] + amount); }
    placeFood(cx, cy, r, amount) { amount = amount == null ? 1 : amount; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (this.inb(x, y) && Math.hypot(x - cx, y - cy) <= r) { const i = this.idx(x, y); if (this.c[i] !== 3) this.S[i] = Math.min(1, this.S[i] + amount); } }
    placeCatalysts(cx, cy, r, density) {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
        if (this.inb(x, y) && Math.hypot(x - cx, y - cy) <= r && this.rand() < (density == null ? 0.6 : density)) { const i = this.idx(x, y); if (this.c[i] !== 3) this.c[i] = this.rand() < 0.5 ? 1 : 2; }
    }
    placeSeed(cx, cy, puddle, pr) { // a small wall nucleus with its own monomer puddle (its initial gradient)
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (this.inb(cx + dx, cy + dy)) this.c[this.idx(cx + dx, cy + dy)] = 3;
      pr = pr == null ? 4 : pr; puddle = puddle == null ? 1.5 : puddle;
      for (let y = cy - pr; y <= cy + pr; y++) for (let x = cx - pr; x <= cx + pr; x++) if (this.inb(x, y)) { const d = Math.hypot(x - cx, y - cy); if (d <= pr) this.M[this.idx(x, y)] += puddle * (1 - d / (pr + 1)); }
    }
    erase(cx, cy, r) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (this.inb(x, y) && Math.hypot(x - cx, y - cy) <= r) this.c[this.idx(x, y)] = 0; }
    eraseWalls(cx, cy, r) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (this.inb(x, y) && Math.hypot(x - cx, y - cy) <= r) { const i = this.idx(x, y); if (this.c[i] === 3) this.c[i] = 0; } }
    step() {
      const { W, H } = this, p = this.p, c = this.c, rand = this.rand;
      // 1. fields: diffusion through non-wall cells, boundary = reservoir of substrate, sink of monomers
      const S = this.S, M = this.M, S2 = this.S2, M2 = this.M2;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; const wall = c[i] === 3;
        let s = S[i], m = M[i], ds = 0, dm = 0;
        for (const [dx, dy] of N4) {
          const xx = x + dx, yy = y + dy;
          if (!this.inb(xx, yy)) continue; // no flux through the boundary
          const j = yy * W + xx; const wj = c[j] === 3;
          ds += (wall || wj ? p.sWallPerm : 1) * (S[j] - s);
          if (!wall && !wj) dm += M[j] - m;
        }
        s += p.sDiffuse * 0.25 * ds; if (p.sRain) s = Math.min(p.sMax, s + p.sRain); if (p.sRelax) s += p.sRelax * (p.sAmb - s);
        if (wall) { S2[i] = s; M2[i] = 0; continue; }
        m += p.mDiffuse * 0.25 * dm; m *= 1 - p.mDecay;
        S2[i] = s; M2[i] = m;
      }
      this.S = S2; this.S2 = S; this.M = M2; this.M2 = M;
      const Sf = this.S, Mf = this.M;
      // 2. cells, asynchronous in raster order with random decisions
      let births = 0, wallGrowth = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, v = c[i];
        if (v === 3) { if (rand() < p.wallErode) { c[i] = 0; Mf[i] = p.wallRelease; } continue; }
        if (v === 0) {
          if (Mf[i] >= p.wallTheta && rand() < p.wallRate) {
            let nw = false, crowd = 0; for (const [dx, dy] of N8) { const xx = x + dx, yy = y + dy; if (!this.inb(xx, yy)) continue; const u = c[yy * W + xx]; if (u === 3) nw = true; else if (u) crowd++; }
            if (nw && crowd <= p.wallCrowd) { c[i] = 3; Mf[i] -= p.wallCost; wallGrowth++; } // crystals need room: no wall inside a dense cluster
          }
          continue;
        }
        // catalyst
        if (rand() < p.catDecay) { c[i] = 0; if (p.massReturn) Sf[i] += p.catCost; continue; }
        const partner = v === 1 ? 2 : 1;
        if (Sf[i] >= p.catCost && rand() < p.catRate * Sf[i]) {
          let partners = 0; const empties = [];
          for (const [dx, dy] of N8) { const xx = x + dx, yy = y + dy; if (!this.inb(xx, yy)) continue; const j = yy * W + xx; if (c[j] === partner) partners++; else if (c[j] === 0) empties.push(j); }
          if (partners >= p.partnerMin && empties.length) { const j = empties[(rand() * empties.length) | 0]; c[j] = partner; Sf[i] -= p.catCost; Mf[i] += p.mEmit; births++; }
        }
        if (rand() < p.catMove) { const [dx, dy] = N4[(rand() * 4) | 0]; const xx = x + dx, yy = y + dy; if (this.inb(xx, yy)) { const j = yy * W + xx; if (c[j] === 0) { c[j] = c[i]; c[i] = 0; } } }
      }
      this.t++; this.births = births; this.wallGrowth = wallGrowth;
    }
    // catalysts not reachable from the boundary through non-wall cells are enclosed
    enclosure() { const { W, H, c } = this; const seen = new Uint8Array(W * H); const stack = [];
      for (let x = 0; x < W; x++) { stack.push(x, W * (H - 1) + x); } for (let y = 0; y < H; y++) { stack.push(y * W, y * W + W - 1); }
      while (stack.length) { const i = stack.pop(); if (seen[i] || c[i] === 3) continue; seen[i] = 1; const x = i % W, y = (i / W) | 0;
        if (x > 0) stack.push(i - 1); if (x < W - 1) stack.push(i + 1); if (y > 0) stack.push(i - W); if (y < H - 1) stack.push(i + W); }
      let inside = 0, total = 0; for (let i = 0; i < c.length; i++) if (c[i] === 1 || c[i] === 2) { total++; if (!seen[i]) inside++; }
      return { inside, total }; }
    counts() { let a = 0, b = 0, w = 0; for (const v of this.c) { if (v === 1) a++; else if (v === 2) b++; else if (v === 3) w++; } return { a, b, w }; }
    // how spread out the catalysts are: rms distance from their centroid
    spread() { let n = 0, sx = 0, sy = 0; const { W, H, c } = this; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = c[y * W + x]; if (v === 1 || v === 2) { n++; sx += x; sy += y; } } if (!n) return 0; const cx = sx / n, cy = sy / n; let d = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = c[y * W + x]; if (v === 1 || v === 2) d += (x - cx) ** 2 + (y - cy) ** 2; } return Math.sqrt(d / n); }
    ascii() { let s = ''; for (let y = 0; y < this.H; y++) { let r = ''; for (let x = 0; x < this.W; x++) { const v = this.c[y * this.W + x]; r += v === 3 ? '#' : v === 1 ? 'a' : v === 2 ? 'b' : (this.M[y * this.W + x] > 0.3 ? ':' : this.S[y * this.W + x] < 0.3 ? '.' : ' '); } s += r + '\n'; } return s; }
  }
  root.AutogenModel = { Autogen, DEFAULTS };
})(typeof module !== 'undefined' ? module.exports : window);
