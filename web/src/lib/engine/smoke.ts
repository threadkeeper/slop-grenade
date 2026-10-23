/**
 * Real-time smoke: a coarse "stable fluids" grid (semi-Lagrangian advection,
 * pressure projection, vorticity confinement, buoyancy). Things that move
 * through it stir the velocity field, so plumes curl and swirl around the
 * grenade and the fruit. Rendered at 2x grid resolution with soft
 * self-shadowing and fine wisp noise, then up-scaled.
 *
 * Mirrored in `desktop/Effects/SmokeField.cs`.
 */
import { valueNoise2 } from './math';

export class SmokeField {
  readonly nx: number;
  readonly ny: number;
  readonly cell: number;
  readonly viewW: number;
  readonly viewH: number;
  private readonly n: number;
  private u: Float32Array;
  private v: Float32Array;
  private u0: Float32Array;
  private v0: Float32Array;
  /** Smoke density. */
  d: Float32Array;
  private d0: Float32Array;
  /** Soot fraction (0 = pale "polish" smoke, 1 = dark explosion soot), stored premultiplied by density. */
  c: Float32Array;
  private c0: Float32Array;
  private curl: Float32Array;
  private p: Float32Array;
  private div: Float32Array;
  /** Render target: straight RGBA, (nx*3) x (ny*3). */
  readonly rw: number;
  readonly rh: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  private time = 0;
  /** Total density last step (used to sleep the sim). */
  mass = 0;
  /** Grid-cell bounding box of visible density from the last step. */
  private gi0 = 0;
  private gj0 = 0;
  private gi1 = -1;
  private gj1 = -1;
  /** Render-pixel region written by the previous render (to clear). */
  private px0 = 0;
  private py0 = 0;
  private px1 = -1;
  private py1 = -1;
  /** Bounding box of visible smoke in render pixels (inclusive) or empty. */
  bx0 = 0;
  by0 = 0;
  bx1 = -1;
  by1 = -1;

  constructor(viewW: number, viewH: number, rows = 90) {
    this.viewW = viewW;
    this.viewH = viewH;
    this.ny = rows;
    this.cell = viewH / rows;
    this.nx = Math.max(8, Math.ceil(viewW / this.cell));
    this.n = (this.nx + 2) * (this.ny + 2);
    const mk = (): Float32Array => new Float32Array(this.n);
    this.u = mk();
    this.v = mk();
    this.u0 = mk();
    this.v0 = mk();
    this.d = mk();
    this.d0 = mk();
    this.c = mk();
    this.c0 = mk();
    this.curl = mk();
    this.p = mk();
    this.div = mk();
    this.rw = this.nx * 3;
    this.rh = this.ny * 3;
    this.pixels = new Uint8ClampedArray(this.rw * this.rh * 4);
  }

  private ix(i: number, j: number): number {
    return i + (this.nx + 2) * j;
  }

  /** True when there is nothing left to simulate or draw. */
  isEmpty(): boolean {
    return this.mass < 0.02 || this.gi1 < 0;
  }

  /**
   * Inject smoke at screen (x, y): `amount` density, gaussian `radius` (px),
   * velocity (vx, vy) in px/s, `soot` 0..1 darkness.
   */
  puff(x: number, y: number, radius: number, amount: number, vx: number, vy: number, soot: number): void {
    const cs = this.cell;
    const gx = x / cs;
    const gy = y / cs;
    const gr = Math.max(0.6, radius / cs);
    const i0 = Math.max(1, Math.floor(gx - gr * 2));
    const i1 = Math.min(this.nx, Math.ceil(gx + gr * 2));
    const j0 = Math.max(1, Math.floor(gy - gr * 2));
    const j1 = Math.min(this.ny, Math.ceil(gy + gr * 2));
    const inv = 1 / (gr * gr);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i - 0.5 - gx;
        const dy = j - 0.5 - gy;
        const w = Math.exp(-(dx * dx + dy * dy) * inv);
        if (w < 0.01) continue;
        const k = this.ix(i, j);
        const add = amount * w;
        this.d[k] += add;
        this.c[k] += add * soot;
        this.u[k] += (vx / cs) * w;
        this.v[k] += (vy / cs) * w;
      }
    }
    if (i0 < this.gi0) this.gi0 = i0;
    if (i1 > this.gi1) this.gi1 = i1;
    if (j0 < this.gj0) this.gj0 = j0;
    if (j1 > this.gj1) this.gj1 = j1;
    this.mass += amount;
  }

  /** Stir the velocity field (no density) — used by moving objects. */
  stir(x: number, y: number, radius: number, vx: number, vy: number, strength: number): void {
    if (this.isEmpty()) return;
    const cs = this.cell;
    const gx = x / cs;
    const gy = y / cs;
    const gr = Math.max(0.8, radius / cs);
    const i0 = Math.max(1, Math.floor(gx - gr * 1.6));
    const i1 = Math.min(this.nx, Math.ceil(gx + gr * 1.6));
    const j0 = Math.max(1, Math.floor(gy - gr * 1.6));
    const j1 = Math.min(this.ny, Math.ceil(gy + gr * 1.6));
    const inv = 1 / (gr * gr);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i - 0.5 - gx;
        const dy = j - 0.5 - gy;
        const w = Math.exp(-(dx * dx + dy * dy) * inv) * strength;
        if (w < 0.01) continue;
        const k = this.ix(i, j);
        this.u[k] += ((vx / cs) - this.u[k]) * Math.min(1, w);
        this.v[k] += ((vy / cs) - this.v[k]) * Math.min(1, w);
      }
    }
  }

  /** Advance the simulation by dt (seconds). */
  step(dt: number): void {
    if (this.isEmpty()) {
      this.bx1 = -1;
      return;
    }
    this.time += dt;
    const N = this.nx;
    const M = this.ny;
    const W = N + 2;
    // buoyancy (smoke rises) + mild lateral drift damping
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const k = i + W * j;
        this.v[k] -= this.d[k] * 1.9 * dt;
      }
    }
    this.vorticity(dt, 2.2);
    // advect velocity
    this.u0.set(this.u);
    this.v0.set(this.v);
    this.advect(this.u, this.u0, this.u0, this.v0, dt);
    this.advect(this.v, this.v0, this.u0, this.v0, dt);
    this.bound();
    this.project(14);
    // advect density / soot
    this.d0.set(this.d);
    this.c0.set(this.c);
    this.advect(this.d, this.d0, this.u, this.v, dt);
    this.advect(this.c, this.c0, this.u, this.v, dt);
    // smoke escapes through the top of the monitor instead of pooling there
    const topK = Math.exp(-6 * dt);
    for (let j = 1; j <= 3; j++) {
      for (let i = 1; i <= N; i++) {
        const k = i + W * j;
        this.d[k] *= topK;
        this.c[k] *= topK;
      }
    }
    // dissipation
    const dk = Math.exp(-0.14 * dt);
    const vk = Math.exp(-0.55 * dt);
    const evap = 0.012 * dt;
    let mass = 0;
    let gi0 = N + 1;
    let gj0 = M + 1;
    let gi1 = -1;
    let gj1 = -1;
    for (let j = 0; j <= M + 1; j++) {
      for (let i = 0; i <= N + 1; i++) {
        const k = i + W * j;
        // exponential fade plus slow evaporation so faint haze clears for good
        this.d[k] = this.d[k] * dk - evap;
        this.c[k] *= dk;
        this.u[k] *= vk;
        this.v[k] *= vk;
        if (this.d[k] < 1e-4) {
          this.d[k] = 0;
          this.c[k] = 0;
          continue;
        }
        mass += this.d[k];
        if (this.d[k] > 0.003) {
          if (i < gi0) gi0 = i;
          if (i > gi1) gi1 = i;
          if (j < gj0) gj0 = j;
          if (j > gj1) gj1 = j;
        }
      }
    }
    this.mass = mass;
    this.gi0 = gi0;
    this.gj0 = gj0;
    this.gi1 = gi1;
    this.gj1 = gj1;
  }

  private bound(): void {
    const N = this.nx;
    const M = this.ny;
    const W = N + 2;
    for (let i = 1; i <= N; i++) {
      this.v[i] = 0;
      this.v[i + W * (M + 1)] = 0;
    }
    for (let j = 1; j <= M; j++) {
      this.u[W * j] = 0;
      this.u[N + 1 + W * j] = 0;
    }
  }

  private vorticity(dt: number, eps: number): void {
    const N = this.nx;
    const M = this.ny;
    const W = N + 2;
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const k = i + W * j;
        this.curl[k] = (this.v[k + 1] - this.v[k - 1] - (this.u[k + W] - this.u[k - W])) * 0.5;
      }
    }
    for (let j = 2; j < M; j++) {
      for (let i = 2; i < N; i++) {
        const k = i + W * j;
        const gx = (Math.abs(this.curl[k + 1]) - Math.abs(this.curl[k - 1])) * 0.5;
        const gy = (Math.abs(this.curl[k + W]) - Math.abs(this.curl[k - W])) * 0.5;
        const l = Math.sqrt(gx * gx + gy * gy) + 1e-5;
        const w = this.curl[k];
        this.u[k] += (gy / l) * w * eps * dt;
        this.v[k] -= (gx / l) * w * eps * dt;
      }
    }
  }

  private advect(dst: Float32Array, src: Float32Array, vu: Float32Array, vv: Float32Array, dt: number): void {
    const N = this.nx;
    const M = this.ny;
    const W = N + 2;
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const k = i + W * j;
        let x = i - dt * vu[k];
        let y = j - dt * vv[k];
        if (x < 0.5) x = 0.5;
        if (x > N + 0.5) x = N + 0.5;
        if (y < 0.5) y = 0.5;
        if (y > M + 0.5) y = M + 0.5;
        const i0 = Math.floor(x);
        const j0 = Math.floor(y);
        const s1 = x - i0;
        const s0 = 1 - s1;
        const t1 = y - j0;
        const t0 = 1 - t1;
        const a = i0 + W * j0;
        dst[k] = s0 * (t0 * src[a] + t1 * src[a + W]) + s1 * (t0 * src[a + 1] + t1 * src[a + 1 + W]);
      }
    }
  }

  private project(iters: number): void {
    const N = this.nx;
    const M = this.ny;
    const W = N + 2;
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const k = i + W * j;
        this.div[k] = -0.5 * (this.u[k + 1] - this.u[k - 1] + this.v[k + W] - this.v[k - W]);
        this.p[k] = 0;
      }
    }
    for (let it = 0; it < iters; it++) {
      for (let j = 1; j <= M; j++) {
        for (let i = 1; i <= N; i++) {
          const k = i + W * j;
          this.p[k] = (this.div[k] + this.p[k - 1] + this.p[k + 1] + this.p[k - W] + this.p[k + W]) * 0.25;
        }
      }
    }
    for (let j = 1; j <= M; j++) {
      for (let i = 1; i <= N; i++) {
        const k = i + W * j;
        this.u[k] -= 0.5 * (this.p[k + 1] - this.p[k - 1]);
        this.v[k] -= 0.5 * (this.p[k + W] - this.p[k - W]);
      }
    }
    this.bound();
  }

  /** Bilinear sample of a cell-centred field at grid coords (gx, gy). */
  private sample(f: Float32Array, gx: number, gy: number): number {
    const N = this.nx;
    const M = this.ny;
    const W = N + 2;
    let x = gx + 0.5;
    let y = gy + 0.5;
    if (x < 0.5) x = 0.5;
    if (y < 0.5) y = 0.5;
    if (x > N + 0.5) x = N + 0.5;
    if (y > M + 0.5) y = M + 0.5;
    const i0 = Math.floor(x);
    const j0 = Math.floor(y);
    const s1 = x - i0;
    const t1 = y - j0;
    const a = i0 + W * j0;
    return (1 - s1) * ((1 - t1) * f[a] + t1 * f[a + W]) + s1 * ((1 - t1) * f[a + 1] + t1 * f[a + 1 + W]);
  }

  /** Writes `pixels` (rw x rh straight RGBA) and the visible bounding box. */
  render(): void {
    const rw = this.rw;
    const rh = this.rh;
    const P = this.pixels;
    const t = this.time;
    const sc = 3;
    let bx0 = rw;
    let by0 = rh;
    let bx1 = -1;
    let by1 = -1;
    // clear what the previous frame wrote
    for (let y = Math.max(0, this.py0); y <= Math.min(rh - 1, this.py1); y++) {
      for (let x = Math.max(0, this.px0); x <= Math.min(rw - 1, this.px1); x++) P[(y * rw + x) * 4 + 3] = 0;
    }
    this.px1 = -1;
    if (this.isEmpty() || this.gi1 < this.gi0) {
      this.bx1 = -1;
      return;
    }
    const rx0 = Math.max(0, (this.gi0 - 2) * sc);
    const rx1 = Math.min(rw - 1, (this.gi1 + 1) * sc);
    const ry0 = Math.max(0, (this.gj0 - 2) * sc);
    const ry1 = Math.min(rh - 1, (this.gj1 + 1) * sc);
    this.px0 = rx0;
    this.px1 = rx1;
    this.py0 = ry0;
    this.py1 = ry1;
    for (let y = ry0; y <= ry1; y++) {
      const gy = (y + 0.5) / sc;
      for (let x = rx0; x <= rx1; x++) {
        const o = (y * rw + x) * 4;
        const gx = (x + 0.5) / sc;
        const dens = this.sample(this.d, gx, gy);
        if (dens < 0.004) {
          P[o + 3] = 0;
          continue;
        }
        const soot = Math.min(1, this.sample(this.c, gx, gy) / (dens + 1e-6));
        // two drifting octaves of wisp detail
        const nz = valueNoise2(x * 0.075 + t * 0.3, y * 0.075 - t * 0.45) * 0.65 + valueNoise2(x * 0.2 - t * 0.25, y * 0.2 + t * 0.18) * 0.35;
        const dd = dens * (0.5 + 1.0 * nz);
        // self-shadow from density between this point and the key light (top-left)
        const occ = this.sample(this.d, gx - 1.0, gy - 1.4);
        let lit = 1.12 - occ * 0.62;
        if (dens < 0.4 && occ < dens * 0.5) lit += 0.18;
        if (lit < 0) lit = 0;
        if (lit > 1) lit = 1;
        const alpha = 1 - Math.exp(-dd * 1.9);
        // pale blue-grey polish smoke vs warm dark soot
        const lr = 218 + (190 - 218) * soot;
        const lg = 226 + (172 - 226) * soot;
        const lb = 238 + (164 - 238) * soot;
        const dr = 88 + (40 - 88) * soot;
        const dg = 98 + (34 - 98) * soot;
        const db = 124 + (40 - 124) * soot;
        P[o] = dr + (lr - dr) * lit;
        P[o + 1] = dg + (lg - dg) * lit;
        P[o + 2] = db + (lb - db) * lit;
        P[o + 3] = Math.min(212, alpha * 230);
        if (P[o + 3] > 2) {
          if (x < bx0) bx0 = x;
          if (x > bx1) bx1 = x;
          if (y < by0) by0 = y;
          if (y > by1) by1 = y;
        }
      }
    }
    this.bx0 = bx0;
    this.by0 = by0;
    this.bx1 = bx1;
    this.by1 = by1;
  }
}
