/**
 * Gooey slop that sticks to the left/right monitor edge.
 *
 * Model: metaball "blobs", growing "drips" and cartoon soft-serve "swirls".
 * Render: the metaball field is evaluated per pixel inside a narrow edge strip
 * and cel-shaded (flat bands, gloss, hatched core shadow, thick ink contour).
 * Only rows that changed are recomputed, so a settled pile costs nothing.
 *
 * Mirrored in `desktop/Effects/SlopLayer.cs`.
 */
import { clamp01, easeOutBack, type Rng } from './math';
import { INK, type SlopPalette } from './palette';

/** Iso threshold of the metaball field. */
export const GOO_ISO = 0.3;
/** Support radius multiplier: kernel support R = visibleRadius * K. */
const SUPPORT = 1.739;

export interface GooBlob {
  x: number;
  y: number;
  r: number;
  /** Seconds since spawn (drives the splash-in pop). */
  age: number;
}

export interface Drip {
  x: number;
  y0: number;
  len: number;
  maxLen: number;
  /** Viscous approach rate (1/s). */
  rate: number;
  r: number;
}

export interface Swirl {
  x: number;
  y: number;
  size: number;
  flip: number;
  age: number;
}

/** A logical splat (for fly spawning and bookkeeping). */
export interface Splat {
  id: number;
  y: number;
  size: number;
  /** World time (seconds) the splat landed. */
  born: number;
}

export type Side = 'left' | 'right';

/** One monitor edge worth of persistent slop. */
export class SlopLayer {
  readonly side: Side;
  readonly pal: SlopPalette;
  readonly viewW: number;
  readonly viewH: number;
  readonly stripW: number;
  readonly s: number;
  blobs: GooBlob[] = [];
  drips: Drip[] = [];
  swirls: Swirl[] = [];
  splats: Splat[] = [];
  /** Metaball field (stripW x viewH). */
  readonly field: Float32Array;
  /** Straight-alpha RGBA pixels of the shaded strip. */
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
  /** Pending dirty row intervals [y0, y1, y0, y1, ...]. */
  private dirty: number[] = [];
  private nextSplatId = 1;
  /** Bumped whenever pixels change so renderers know to re-upload. */
  version = 0;
  /** Rows changed since the last `takeDirtyRows` (for partial uploads). */
  private upY0 = 1e9;
  private upY1 = -1e9;

  constructor(side: Side, pal: SlopPalette, viewW: number, viewH: number, scale: number) {
    this.side = side;
    this.pal = pal;
    this.viewW = viewW;
    this.viewH = viewH;
    this.s = scale;
    this.stripW = Math.max(64, Math.round(Math.min(viewW * 0.22, 380 * scale)));
    this.field = new Float32Array(this.stripW * viewH);
    this.pixels = new Uint8ClampedArray(this.stripW * viewH * 4);
  }

  /** Screen x of the strip's left column. */
  get stripX(): number {
    return this.side === 'left' ? 0 : this.viewW - this.stripW;
  }

  /** +1 when "inward" is towards increasing x. */
  get inward(): number {
    return this.side === 'left' ? 1 : -1;
  }

  /** Screen x of the monitor edge this layer sticks to. */
  get edgeX(): number {
    return this.side === 'left' ? 0 : this.viewW;
  }

  isEmpty(): boolean {
    return this.blobs.length === 0 && this.drips.length === 0 && this.swirls.length === 0;
  }

  /** Persistent pieces stuck on this side (used by the tray "slop count"). */
  pieceCount(): number {
    return this.splats.length;
  }

  private markDirty(y0: number, y1: number): void {
    const a = Math.max(0, Math.floor(y0));
    const b = Math.min(this.viewH - 1, Math.ceil(y1));
    if (b < a) return;
    const d = this.dirty;
    for (let i = 0; i < d.length; i += 2) {
      if (a <= d[i + 1] + 8 && b >= d[i] - 8) {
        d[i] = Math.min(d[i], a);
        d[i + 1] = Math.max(d[i + 1], b);
        return;
      }
    }
    d.push(a, b);
    if (d.length > 24) {
      let lo = d[0];
      let hi = d[1];
      for (let i = 2; i < d.length; i += 2) {
        lo = Math.min(lo, d[i]);
        hi = Math.max(hi, d[i + 1]);
      }
      this.dirty = [lo, hi];
    }
  }

  /**
   * Deposit a big splat at height `y`. `size` 1 = grenade, ~0.6 = ai-cannon.
   * Returns the splat id.
   */
  addSplat(y: number, size: number, rng: Rng, now: number, withSwirl: boolean): number {
    const s = this.s * size;
    const inw = this.inward;
    const ex = this.edgeX;
    // big rounded mass pressed against the bezel
    const core = 7 + Math.round(4 * size);
    for (let i = 0; i < core; i++) {
      const a = rng.range(-1.3, 1.3);
      const d = rng.range(0, 40) * s;
      this.blobs.push({
        x: ex + inw * (Math.cos(a) * d + 6 * s),
        y: y + Math.sin(a) * d * 1.6 + rng.range(-24, 24) * s,
        r: (34 + rng.range(0, 30)) * s,
        age: -rng.range(0, 0.1)
      });
    }
    // chunky lobes pushing inward
    const lobes = 4 + Math.round(3 * size);
    for (let i = 0; i < lobes; i++) {
      const a = rng.range(-1.0, 1.0);
      const d = rng.range(60, 112) * s;
      this.blobs.push({
        x: ex + inw * Math.cos(a) * d,
        y: y + Math.sin(a) * d * 1.15,
        r: rng.range(13, 24) * s,
        age: -rng.range(0.03, 0.15)
      });
    }
    // inward spatter, some attached some loose
    const spat = 12 + Math.round(12 * size);
    for (let i = 0; i < spat; i++) {
      const d = rng.range(85, 240) * s;
      const a = rng.range(-1.2, 1.2);
      const r = rng.range(4, 14) * s * (1.25 - d / (270 * s));
      this.blobs.push({
        x: ex + inw * Math.cos(a) * d,
        y: y + Math.sin(a) * d * 1.15,
        r: Math.max(2.6 * this.s, r),
        age: -rng.range(0.04, 0.25)
      });
    }
    // a few drips running down the bezel
    const dn = 3 + Math.round(2 * size);
    for (let i = 0; i < dn; i++) {
      this.drips.push({
        x: ex + inw * (10 + (i / Math.max(1, dn - 1)) * 80 + rng.range(-6, 6)) * s,
        y0: y + rng.range(30, 70) * s,
        len: 0,
        maxLen: rng.range(70, 280) * s,
        rate: rng.range(0.3, 0.9),
        r: rng.range(4.5, 8) * this.s * (0.7 + 0.3 * size)
      });
    }
    if (withSwirl) {
      this.swirls.push({
        x: ex + inw * 44 * s,
        y: y - 30 * s,
        size: (0.85 + rng.range(0, 0.3)) * s,
        flip: rng.sign(),
        age: 0
      });
    }
    this.markDirty(y - 320 * s, y + 520 * s);
    const id = this.nextSplatId++;
    this.splats.push({ id, y, size, born: now });
    return id;
  }

  /** A stray glob from an explosion lands on this edge. */
  addGlob(y: number, r: number, rng: Rng): void {
    const inw = this.inward;
    const ex = this.edgeX;
    this.blobs.push({ x: ex + inw * rng.range(-2, 10) * this.s, y, r, age: 0 });
    if (rng.chance(0.55)) {
      this.drips.push({
        x: ex + inw * rng.range(2, 9) * this.s,
        y0: y,
        len: 0,
        maxLen: rng.range(20, 110) * this.s,
        rate: rng.range(0.4, 1.2),
        r: Math.max(2.5 * this.s, r * 0.45)
      });
    }
    this.markDirty(y - r * 3, y + 130 * this.s);
  }

  /** Field value at a screen position (0 outside the strip). */
  densityAt(sx: number, sy: number): number {
    const lx = Math.round(sx - this.stripX);
    const ly = Math.round(sy);
    if (lx < 0 || lx >= this.stripW || ly < 0 || ly >= this.viewH) return 0;
    return this.field[ly * this.stripW + lx];
  }

  /** Closest goo surface hit while travelling towards the edge at height y. */
  surfaceXAt(y: number): number | null {
    const ly = Math.round(y);
    if (ly < 0 || ly >= this.viewH) return null;
    const row = ly * this.stripW;
    if (this.side === 'left') {
      for (let x = this.stripW - 1; x >= 0; x--) if (this.field[row + x] >= GOO_ISO) return x + this.stripX;
    } else {
      for (let x = 0; x < this.stripW; x++) if (this.field[row + x] >= GOO_ISO) return x + this.stripX;
    }
    return null;
  }

  /** Advance drips and splash-in animations. Returns true if anything moved. */
  update(dt: number): boolean {
    let moved = false;
    for (const b of this.blobs) {
      if (b.age < 0.22) {
        b.age += dt;
        this.markDirty(b.y - b.r * 2.2, b.y + b.r * 2.2);
        moved = true;
      }
    }
    for (const d of this.drips) {
      if (d.len < d.maxLen - 0.3) {
        const old = d.len;
        d.len += (d.maxLen - d.len) * (1 - Math.exp(-d.rate * dt)) + 1.5 * this.s * dt;
        if (d.len > d.maxLen) d.len = d.maxLen;
        this.markDirty(d.y0 + old - d.r * 4, d.y0 + d.len + d.r * 4);
        moved = true;
      }
    }
    for (const sw of this.swirls) {
      if (sw.age < 1) {
        sw.age += dt;
        moved = true;
      }
    }
    return moved;
  }

  /**
   * Squeegee blade at screen height `bladeY` moving down: everything above it is
   * scraped off. Returns the scraped "mass" (sum of r^2) for blade-pile visuals.
   */
  scrapeAbove(bladeY: number): number {
    let mass = 0;
    const keepB: GooBlob[] = [];
    for (const b of this.blobs) {
      if (b.y + b.r < bladeY) mass += b.r * b.r;
      else keepB.push(b);
    }
    this.blobs = keepB;
    const keepD: Drip[] = [];
    for (const d of this.drips) {
      const bottom = d.y0 + d.len;
      if (bottom < bladeY) {
        mass += d.r * d.len * 0.5;
        continue;
      }
      if (d.y0 < bladeY) {
        const cut = bladeY - d.y0;
        d.y0 = bladeY;
        d.len = Math.max(0, d.len - cut);
        d.maxLen = Math.max(d.len, d.maxLen - cut);
      }
      keepD.push(d);
    }
    this.drips = keepD;
    this.swirls = this.swirls.filter((sw) => sw.y + 40 * sw.size >= bladeY);
    this.splats = this.splats.filter((sp) => sp.y >= bladeY);
    this.markDirty(0, bladeY + 16 * this.s);
    return mass;
  }

  /** Remove everything on this edge. */
  clear(): void {
    this.blobs = [];
    this.drips = [];
    this.swirls = [];
    this.splats = [];
    this.markDirty(0, this.viewH);
  }

  /** Visible radius of a blob including its splash-in pop. */
  private blobRadius(b: GooBlob): number {
    if (b.age <= 0) return 0;
    if (b.age >= 0.22) return b.r;
    return b.r * easeOutBack(b.age / 0.22);
  }

  /** True when some rows still need re-shading (drips moving, new splats). */
  get pending(): boolean {
    return this.dirty.length > 0;
  }

  /** Recompute field + pixels for dirty rows. Returns true if pixels changed. */
  flush(): boolean {
    if (this.dirty.length === 0) return false;
    // merge overlapping intervals (they may have grown into each other)
    const list: number[][] = [];
    for (let i = 0; i < this.dirty.length; i += 2) list.push([this.dirty[i], this.dirty[i + 1]]);
    this.dirty = [];
    list.sort((p, q) => p[0] - q[0]);
    const merged: number[][] = [];
    for (const iv of list) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 8) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    for (const iv of merged) {
      // field must be recomputed 2 rows beyond the shaded rows (gradient stencil)
      const f0 = Math.max(0, iv[0] - 2);
      const f1 = Math.min(this.viewH - 1, iv[1] + 2);
      this.computeField(f0, f1);
      this.shadeRows(iv[0], iv[1]);
      if (iv[0] < this.upY0) this.upY0 = iv[0];
      if (iv[1] > this.upY1) this.upY1 = iv[1];
    }
    this.version++;
    return true;
  }

  /** Rows whose pixels changed since the last call (inclusive), or null. */
  takeDirtyRows(): [number, number] | null {
    if (this.upY1 < this.upY0) return null;
    const r: [number, number] = [Math.max(0, this.upY0), Math.min(this.viewH - 1, this.upY1)];
    this.upY0 = 1e9;
    this.upY1 = -1e9;
    return r;
  }

  private splatKernel(cx: number, cy: number, r: number, y0: number, y1: number): void {
    if (r <= 0.2) return;
    const W = this.stripW;
    const R = r * SUPPORT;
    const R2 = R * R;
    const inv = 1 / R2;
    const lx = cx - this.stripX;
    const ya = Math.max(y0, Math.floor(cy - R));
    const yb = Math.min(y1, Math.ceil(cy + R));
    const xa = Math.max(0, Math.floor(lx - R));
    const xb = Math.min(W - 1, Math.ceil(lx + R));
    for (let y = ya; y <= yb; y++) {
      const dy = y + 0.5 - cy;
      const dy2 = dy * dy;
      if (dy2 >= R2) continue;
      const row = y * W;
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - lx;
        const d2 = dx * dx + dy2;
        if (d2 >= R2) continue;
        const t = 1 - d2 * inv;
        this.field[row + x] += t * t * t;
      }
    }
  }

  private computeField(y0: number, y1: number): void {
    const W = this.stripW;
    this.field.fill(0, y0 * W, (y1 + 1) * W);
    for (const b of this.blobs) {
      const r = this.blobRadius(b);
      const R = r * SUPPORT;
      if (b.y + R < y0 || b.y - R > y1) continue;
      this.splatKernel(b.x, b.y, r, y0, y1);
    }
    for (const d of this.drips) {
      if (d.len <= 0.5) continue;
      const top = d.y0;
      const bot = d.y0 + d.len;
      const reach = d.r * SUPPORT * 1.8;
      if (bot + reach < y0 || top - reach > y1) continue;
      const step = Math.max(1.5, d.r * 0.55);
      const n = Math.max(1, Math.ceil(d.len / step));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const yy = top + d.len * f;
        // taper slightly then bulge into a droplet at the tip
        const bulb = f > 0.82 ? 1 + 0.75 * Math.sin(((f - 0.82) / 0.18) * Math.PI * 0.5) : 1 - 0.18 * f;
        const rr = d.r * bulb;
        if (yy + rr * SUPPORT < y0 || yy - rr * SUPPORT > y1) continue;
        this.splatKernel(d.x, yy, rr * 0.82, y0, y1);
      }
    }
  }

  private shadeRows(y0: number, y1: number): void {
    const W = this.stripW;
    const H = this.viewH;
    const F = this.field;
    const P = this.pixels;
    const pal = this.pal;
    const ow = 2.4 * this.s + 0.6;
    const T = GOO_ISO;
    // light from top-left (screen space, y down)
    const lx = -0.5;
    const ly = -0.64;
    const lz = 0.58;
    const hx = lx;
    const hy = ly;
    const hz = lz + 1;
    const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
    const inkR = (INK >> 16) & 255;
    const inkG = (INK >> 8) & 255;
    const inkB = INK & 255;
    const hs = 3.2 / T;
    for (let y = y0; y <= y1; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const i = row + x;
        const o = i * 4;
        const f = F[i];
        if (f < T * 0.45) {
          P[o + 3] = 0;
          continue;
        }
        const fl = x > 1 ? F[i - 2] : f;
        const fr = x < W - 2 ? F[i + 2] : f;
        const fu = y > 1 ? F[i - 2 * W] : f;
        const fd = y < H - 2 ? F[i + 2 * W] : f;
        const gx = (fr - fl) * 0.25;
        const gy = (fd - fu) * 0.25;
        const gl = Math.sqrt(gx * gx + gy * gy);
        const di = (f - T) / (gl > 1e-4 ? gl : 1e-4);
        if (di < -1) {
          P[o + 3] = 0;
          continue;
        }
        if (di < ow) {
          P[o] = inkR;
          P[o + 1] = inkG;
          P[o + 2] = inkB;
          P[o + 3] = di < 0 ? Math.round(255 * clamp01(di + 1)) : 255;
          continue;
        }
        let nx = -gx * hs;
        let ny = -gy * hs;
        let nz = 1;
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= nl;
        ny /= nl;
        nz /= nl;
        const ndl = nx * lx + ny * ly + nz * lz;
        const spec = (nx * hx + ny * hy + nz * hz) / hl;
        let c: number;
        if (spec > 0.975) c = pal.gloss;
        else if (ndl > 0.74) c = pal.light;
        else if (ndl > 0.28) c = pal.base;
        else if (ndl > -0.12) c = pal.shadow;
        else c = di > 7 * this.s && (x + y) % 6 < 2 ? pal.hatch : pal.deep;
        // a thin darker rim just inside the ink for a candy-shell feel
        if (di < ow + 0.9 * this.s && c !== pal.gloss) c = pal.shadow;
        P[o] = (c >> 16) & 255;
        P[o + 1] = (c >> 8) & 255;
        P[o + 2] = c & 255;
        P[o + 3] = 255;
      }
    }
  }
}
