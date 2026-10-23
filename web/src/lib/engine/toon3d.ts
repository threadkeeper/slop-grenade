/**
 * Tiny software 3D "toon" renderer used for the tumbling fruit.
 *
 * Pipeline (mirrored in `desktop/Engine/Toon3D.cs`):
 *  1. Rasterise a triangle mesh with a z-buffer at 2x supersampling, storing
 *     view-space normal, object-space position and material per pixel.
 *  2. Deferred cel shading per pixel (flat bands, cool hatched shadows,
 *     cartoon specular blob, velvet rim for fuzzy skins).
 *  3. Ink pass: thick silhouette outline plus thin internal lines wherever the
 *     material or depth changes.
 *  4. Box-downsample to the output sprite (straight-alpha RGBA).
 */
import { INK } from './palette';

/** Immutable triangle mesh. */
export interface Mesh {
  vertexCount: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  triCount: number;
  idx: Uint16Array;
  mat: Uint8Array;
  twoSided: Uint8Array;
  fnx: Float32Array;
  fny: Float32Array;
  fnz: Float32Array;
}

/** Shades one visible fragment and returns 0xRRGGBB. */
export interface FragmentShader {
  shade(mat: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, sx: number, sy: number): number;
}

/** Incremental mesh builder with simple primitive generators. */
export class MeshBuilder {
  private px: number[] = [];
  private py: number[] = [];
  private pz: number[] = [];
  private idx: number[] = [];
  private mats: number[] = [];
  private two: number[] = [];
  /** Optional per-vertex outward hint (centre the surface bulges away from). */
  private hx: number[] = [];
  private hy: number[] = [];
  private hz: number[] = [];

  vertex(x: number, y: number, z: number, hx: number, hy: number, hz: number): number {
    this.px.push(x);
    this.py.push(y);
    this.pz.push(z);
    this.hx.push(hx);
    this.hy.push(hy);
    this.hz.push(hz);
    return this.px.length - 1;
  }

  tri(a: number, b: number, c: number, mat: number, twoSided: boolean): void {
    this.idx.push(a, b, c);
    this.mats.push(mat);
    this.two.push(twoSided ? 1 : 0);
  }

  /**
   * Parametric closed surface. `pos(u, v)` returns [x, y, z] for u in [0,1]
   * (pole to pole) and v in [0,1) (around). `cutZ` clamps z to a cutting plane
   * and paints fully-clamped triangles with `cutMat` (halved fruit).
   */
  surface(
    rings: number,
    segs: number,
    pos: (u: number, v: number) => [number, number, number],
    mat: number,
    center: [number, number, number],
    cutZ: number | null,
    cutMat: number
  ): void {
    const start = this.px.length;
    const clamped: boolean[] = [];
    const add = (p: [number, number, number]): number => {
      let z = p[2];
      let c = false;
      if (cutZ !== null && z > cutZ) {
        z = cutZ;
        c = true;
      }
      clamped.push(c);
      return this.vertex(p[0], p[1], z, center[0], center[1], center[2]);
    };
    const top = add(pos(0, 0));
    for (let i = 1; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        add(pos(i / rings, j / segs));
      }
    }
    const bottom = add(pos(1, 0));
    const ring = (i: number, j: number): number => start + 1 + (i - 1) * segs + (j % segs);
    const isCut = (a: number, b: number, c: number): boolean =>
      clamped[a - start] && clamped[b - start] && clamped[c - start];
    for (let j = 0; j < segs; j++) {
      const a = top;
      const b = ring(1, j);
      const c = ring(1, j + 1);
      this.tri(a, b, c, isCut(a, b, c) ? cutMat : mat, false);
    }
    for (let i = 1; i < rings - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = ring(i, j);
        const b = ring(i + 1, j);
        const c = ring(i + 1, j + 1);
        const d = ring(i, j + 1);
        this.tri(a, b, c, isCut(a, b, c) ? cutMat : mat, false);
        this.tri(a, c, d, isCut(a, c, d) ? cutMat : mat, false);
      }
    }
    for (let j = 0; j < segs; j++) {
      const a = ring(rings - 1, j);
      const b = bottom;
      const c = ring(rings - 1, j + 1);
      this.tri(a, b, c, isCut(a, b, c) ? cutMat : mat, false);
    }
  }

  /** Axis-aligned ellipsoid (optionally rotated about Z by `rotZ`). */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, mat: number, rings: number, segs: number, rotZ = 0): void {
    const cr = Math.cos(rotZ);
    const sr = Math.sin(rotZ);
    this.surface(
      rings,
      segs,
      (u, v) => {
        const th = u * Math.PI;
        const ph = v * Math.PI * 2;
        const x = Math.sin(th) * Math.cos(ph) * rx;
        const y = Math.cos(th) * ry;
        const z = Math.sin(th) * Math.sin(ph) * rz;
        return [cx + x * cr - y * sr, cy + x * sr + y * cr, cz + z];
      },
      mat,
      [cx, cy, cz],
      null,
      0
    );
  }

  /** Tube along a polyline with per-point radius; ends capped with small domes. */
  tube(pts: number[][], radii: number[], mat: number, segs: number): void {
    const n = pts.length;
    const rings: number[][] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[Math.min(n - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let tx = q[0] - o[0];
      let ty = q[1] - o[1];
      let tz = q[2] - o[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      // any perpendicular
      let ax = 0;
      let ay = 0;
      let az = 1;
      if (Math.abs(tz) > 0.9) {
        ax = 1;
        az = 0;
      }
      let ux = ty * az - tz * ay;
      let uy = tz * ax - tx * az;
      let uz = tx * ay - ty * ax;
      const ul = Math.hypot(ux, uy, uz) || 1;
      ux /= ul;
      uy /= ul;
      uz /= ul;
      const wx = ty * uz - tz * uy;
      const wy = tz * ux - tx * uz;
      const wz = tx * uy - ty * ux;
      const ringIdx: number[] = [];
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const ca = Math.cos(a) * radii[i];
        const sa = Math.sin(a) * radii[i];
        ringIdx.push(this.vertex(p[0] + ux * ca + wx * sa, p[1] + uy * ca + wy * sa, p[2] + uz * ca + wz * sa, p[0], p[1], p[2]));
      }
      rings.push(ringIdx);
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = rings[i][j];
        const b = rings[i + 1][j];
        const c = rings[i + 1][(j + 1) % segs];
        const d = rings[i][(j + 1) % segs];
        this.tri(a, b, c, mat, false);
        this.tri(a, c, d, mat, false);
      }
    }
    // caps
    const capAt = (i: number, dir: number): void => {
      const p = pts[i];
      const q = pts[i - dir] ?? pts[i];
      const tx = p[0] - q[0];
      const ty = p[1] - q[1];
      const tz = p[2] - q[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      const r = radii[i];
      const tip = this.vertex(p[0] + (tx / tl) * r * 0.8, p[1] + (ty / tl) * r * 0.8, p[2] + (tz / tl) * r * 0.8, p[0], p[1], p[2]);
      for (let j = 0; j < segs; j++) {
        this.tri(rings[i][j], tip, rings[i][(j + 1) % segs], mat, false);
      }
    };
    capAt(0, -1);
    capAt(n - 1, 1);
  }

  /**
   * Two-sided leaf blade from `base` along unit `dir`, widening along unit `side`,
   * curling towards unit `up` by `curl` (fraction of length).
   */
  leaf(base: number[], dir: number[], side: number[], up: number[], length: number, width: number, curl: number, mat: number): void {
    const nu = 7;
    const nv = 2;
    const grid: number[][] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05)), 0.75);
      const row: number[] = [];
      for (let j = -nv; j <= nv; j++) {
        const v = j / nv;
        const bow = curl * length * u * u - Math.abs(v) * width * 0.25;
        const x = base[0] + dir[0] * u * length + side[0] * v * w + up[0] * bow;
        const y = base[1] + dir[1] * u * length + side[1] * v * w + up[1] * bow;
        const z = base[2] + dir[2] * u * length + side[2] * v * w + up[2] * bow;
        row.push(this.vertex(x, y, z, x - up[0], y - up[1], z - up[2]));
      }
      grid.push(row);
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv * 2; j++) {
        const a = grid[i][j];
        const b = grid[i + 1][j];
        const c = grid[i + 1][j + 1];
        const d = grid[i][j + 1];
        this.tri(a, b, c, mat, true);
        this.tri(a, c, d, mat, true);
      }
    }
  }

  build(): Mesh {
    const vc = this.px.length;
    const tc = this.mats.length;
    const m: Mesh = {
      vertexCount: vc,
      px: Float32Array.from(this.px),
      py: Float32Array.from(this.py),
      pz: Float32Array.from(this.pz),
      nx: new Float32Array(vc),
      ny: new Float32Array(vc),
      nz: new Float32Array(vc),
      triCount: tc,
      idx: Uint16Array.from(this.idx),
      mat: Uint8Array.from(this.mats),
      twoSided: Uint8Array.from(this.two),
      fnx: new Float32Array(tc),
      fny: new Float32Array(tc),
      fnz: new Float32Array(tc)
    };
    for (let t = 0; t < tc; t++) {
      const a = m.idx[t * 3];
      const b = m.idx[t * 3 + 1];
      const c = m.idx[t * 3 + 2];
      const e1x = m.px[b] - m.px[a];
      const e1y = m.py[b] - m.py[a];
      const e1z = m.pz[b] - m.pz[a];
      const e2x = m.px[c] - m.px[a];
      const e2y = m.py[c] - m.py[a];
      const e2z = m.pz[c] - m.pz[a];
      let fx = e1y * e2z - e1z * e2y;
      let fy = e1z * e2x - e1x * e2z;
      let fz = e1x * e2y - e1y * e2x;
      // orient outward using the per-vertex hint centre
      const cx = (m.px[a] + m.px[b] + m.px[c]) / 3 - (this.hx[a] + this.hx[b] + this.hx[c]) / 3;
      const cy = (m.py[a] + m.py[b] + m.py[c]) / 3 - (this.hy[a] + this.hy[b] + this.hy[c]) / 3;
      const cz = (m.pz[a] + m.pz[b] + m.pz[c]) / 3 - (this.hz[a] + this.hz[b] + this.hz[c]) / 3;
      if (fx * cx + fy * cy + fz * cz < 0) {
        fx = -fx;
        fy = -fy;
        fz = -fz;
      }
      const fl = Math.hypot(fx, fy, fz) || 1;
      m.fnx[t] = fx / fl;
      m.fny[t] = fy / fl;
      m.fnz[t] = fz / fl;
      // area-weighted accumulation (fx,fy,fz unnormalised = 2*area*normal)
      for (const v of [a, b, c]) {
        m.nx[v] += fx;
        m.ny[v] += fy;
        m.nz[v] += fz;
      }
    }
    for (let v = 0; v < vc; v++) {
      const l = Math.hypot(m.nx[v], m.ny[v], m.nz[v]) || 1;
      m.nx[v] /= l;
      m.ny[v] /= l;
      m.nz[v] /= l;
    }
    return m;
  }
}

/** Row-major 3x3 rotation matrix from a unit axis and angle. */
export function axisAngle(ax: number, ay: number, az: number, angle: number, out: Float32Array): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  out[0] = t * ax * ax + c;
  out[1] = t * ax * ay - s * az;
  out[2] = t * ax * az + s * ay;
  out[3] = t * ax * ay + s * az;
  out[4] = t * ay * ay + c;
  out[5] = t * ay * az - s * ax;
  out[6] = t * ax * az - s * ay;
  out[7] = t * ay * az + s * ax;
  out[8] = t * az * az + c;
}

/** out = a * b (row-major 3x3). */
export function mul3(a: Float32Array, b: Float32Array, out: Float32Array): void {
  const r = new Float32Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  out.set(r);
}

const LX = -0.48;
const LY = 0.62;
const LZ = 0.62;
const LLEN = Math.hypot(LX, LY, LZ);
/** Normalised key light (view space: x right, y up, z towards viewer). */
export const LIGHT = [LX / LLEN, LY / LLEN, LZ / LLEN];
const HX0 = LIGHT[0];
const HY0 = LIGHT[1];
const HZ0 = LIGHT[2] + 1;
const HLEN = Math.hypot(HX0, HY0, HZ0);
const HALF = [HX0 / HLEN, HY0 / HLEN, HZ0 / HLEN];

function mulRgb(c: number, r: number, g: number, b: number): number {
  const cr = Math.min(255, Math.round(((c >> 16) & 255) * r));
  const cg = Math.min(255, Math.round(((c >> 8) & 255) * g));
  const cb = Math.min(255, Math.round((c & 255) * b));
  return (cr << 16) | (cg << 8) | cb;
}

function mixRgb(c1: number, c2: number, t: number): number {
  const r = ((c1 >> 16) & 255) + ((((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t);
  const g = ((c1 >> 8) & 255) + ((((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t);
  const b = (c1 & 255) + (((c2 & 255) - (c1 & 255)) * t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

/**
 * Shared cel-shading model: three flat bands with a cool purple shadow,
 * hatched core shadow, cartoon specular blob (`gloss` 0..1) and velvet rim
 * light for fuzzy skins (`fuzz` 0..1).
 */
export function toonShade(albedo: number, nx: number, ny: number, nz: number, sx: number, sy: number, gloss: number, fuzz: number): number {
  const ndl = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
  let c: number;
  if (ndl > 0.6) c = mixRgb(albedo, 0xffffff, 0.22);
  else if (ndl > 0.02) c = albedo;
  else if (ndl > -0.42) c = mulRgb(albedo, 0.66, 0.58, 0.78);
  else {
    c = mulRgb(albedo, 0.46, 0.4, 0.6);
    if (((sx + sy) | 0) % 7 < 2) c = mixRgb(c, INK, 0.55);
  }
  if (fuzz > 0) {
    const rim = 1 - Math.max(0, nz);
    if (rim > 0.62) c = mixRgb(c, mixRgb(albedo, 0xffffff, 0.45), fuzz * 0.55);
  }
  if (gloss > 0) {
    const spec = nx * HALF[0] + ny * HALF[1] + nz * HALF[2];
    const edge = 1 - 0.045 * gloss;
    if (spec > edge + 0.018) c = 0xffffff;
    else if (spec > edge) c = mixRgb(c, 0xffffff, 0.55);
  }
  return c;
}

/** Re-usable 2x supersampled toon rasteriser producing a square RGBA sprite. */
export class ToonRenderer {
  readonly size: number;
  readonly ss: number;
  readonly hs: number;
  readonly out: Uint8ClampedArray<ArrayBuffer>;
  private depth: Float32Array;
  private bnx: Float32Array;
  private bny: Float32Array;
  private bnz: Float32Array;
  private box: Float32Array;
  private boy: Float32Array;
  private boz: Float32Array;
  private bmat: Int16Array;
  private ink: Uint8Array;
  private vx: Float32Array = new Float32Array(0);
  private vy: Float32Array = new Float32Array(0);
  private vz: Float32Array = new Float32Array(0);
  private wnx: Float32Array = new Float32Array(0);
  private wny: Float32Array = new Float32Array(0);
  private wnz: Float32Array = new Float32Array(0);
  private disk: Int32Array;
  private diskR: number;
  private bx0 = 0;
  private by0 = 0;
  private bx1 = -1;
  private by1 = -1;

  /** `outlinePx` is the silhouette ink thickness in output pixels. */
  constructor(size: number, ss = 2, outlinePx = 2.2) {
    this.size = size;
    this.ss = ss;
    this.hs = size * ss;
    const n = this.hs * this.hs;
    this.out = new Uint8ClampedArray(size * size * 4);
    this.depth = new Float32Array(n);
    this.bnx = new Float32Array(n);
    this.bny = new Float32Array(n);
    this.bnz = new Float32Array(n);
    this.box = new Float32Array(n);
    this.boy = new Float32Array(n);
    this.boz = new Float32Array(n);
    this.bmat = new Int16Array(n);
    this.ink = new Uint8Array(n);
    const r = outlinePx * ss;
    const ri = Math.ceil(r);
    const offs: number[] = [];
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy <= r * r) offs.push(dx, dy);
      }
    }
    this.disk = Int32Array.from(offs);
    this.diskR = ri;
    this.depth.fill(-1e9);
    this.bmat.fill(-1);
  }

  /**
   * Render `mesh` rotated by row-major matrix `rot`, where one object unit maps
   * to `unitPx` output pixels. Result is written to `out` (straight RGBA).
   */
  render(mesh: Mesh, rot: Float32Array, unitPx: number, shader: FragmentShader): void {
    const hs = this.hs;
    // clear only the region touched by the previous frame (plus ink margin)
    if (this.bx1 >= this.bx0) {
      const m = this.diskR + 1;
      const cx0 = Math.max(0, this.bx0 - m);
      const cx1 = Math.min(hs - 1, this.bx1 + m);
      const cy0 = Math.max(0, this.by0 - m);
      const cy1 = Math.min(hs - 1, this.by1 + m);
      for (let y = cy0; y <= cy1; y++) {
        const a = y * hs + cx0;
        const b = y * hs + cx1 + 1;
        this.depth.fill(-1e9, a, b);
        this.bmat.fill(-1, a, b);
        this.ink.fill(0, a, b);
      }
    }
    this.bx0 = hs;
    this.by0 = hs;
    this.bx1 = -1;
    this.by1 = -1;
    if (this.vx.length < mesh.vertexCount) {
      const vc = mesh.vertexCount;
      this.vx = new Float32Array(vc);
      this.vy = new Float32Array(vc);
      this.vz = new Float32Array(vc);
      this.wnx = new Float32Array(vc);
      this.wny = new Float32Array(vc);
      this.wnz = new Float32Array(vc);
    }
    const k = unitPx * this.ss;
    const c = hs * 0.5;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const x = mesh.px[v];
      const y = mesh.py[v];
      const z = mesh.pz[v];
      const rx = rot[0] * x + rot[1] * y + rot[2] * z;
      const ry = rot[3] * x + rot[4] * y + rot[5] * z;
      const rz = rot[6] * x + rot[7] * y + rot[8] * z;
      this.vx[v] = c + rx * k;
      this.vy[v] = c - ry * k;
      this.vz[v] = rz;
      const nx = mesh.nx[v];
      const ny = mesh.ny[v];
      const nz = mesh.nz[v];
      this.wnx[v] = rot[0] * nx + rot[1] * ny + rot[2] * nz;
      this.wny[v] = rot[3] * nx + rot[4] * ny + rot[5] * nz;
      this.wnz[v] = rot[6] * nx + rot[7] * ny + rot[8] * nz;
    }
    for (let t = 0; t < mesh.triCount; t++) {
      const fz = rot[6] * mesh.fnx[t] + rot[7] * mesh.fny[t] + rot[8] * mesh.fnz[t];
      if (fz < -0.02 && mesh.twoSided[t] === 0) continue;
      const a = mesh.idx[t * 3];
      const b = mesh.idx[t * 3 + 1];
      const d = mesh.idx[t * 3 + 2];
      this.raster(mesh, a, b, d, mesh.mat[t]);
    }
    // internal ink lines (material or depth discontinuities)
    const dzTh = 0.12;
    const lx0 = this.bx0;
    const lx1 = this.bx1;
    const ly0 = this.by0;
    const ly1 = this.by1;
    for (let y = ly0; y <= ly1; y++) {
      for (let x = lx0; x <= lx1; x++) {
        const i = y * hs + x;
        const m = this.bmat[i];
        if (m < 0) continue;
        const z = this.depth[i];
        let edge = false;
        if (x + 1 < hs) {
          const j = i + 1;
          const mj = this.bmat[j];
          if (mj >= 0 && (mj !== m || Math.abs(this.depth[j] - z) > dzTh)) edge = true;
        }
        if (!edge && y + 1 < hs) {
          const j = i + hs;
          const mj = this.bmat[j];
          if (mj >= 0 && (mj !== m || Math.abs(this.depth[j] - z) > dzTh)) edge = true;
        }
        if (edge) {
          this.ink[i] = 1;
          if (x + 1 < hs) this.ink[i + 1] = 1;
        }
      }
    }
    // silhouette ink: stamp a disk around boundary pixels into empty space
    const disk = this.disk;
    for (let y = ly0; y <= ly1; y++) {
      for (let x = lx0; x <= lx1; x++) {
        const i = y * hs + x;
        if (this.bmat[i] < 0) continue;
        const boundary =
          x === 0 || y === 0 || x === hs - 1 || y === hs - 1 ||
          this.bmat[i - 1] < 0 || this.bmat[i + 1] < 0 || this.bmat[i - hs] < 0 || this.bmat[i + hs] < 0;
        if (!boundary) continue;
        for (let o = 0; o < disk.length; o += 2) {
          const xx = x + disk[o];
          const yy = y + disk[o + 1];
          if (xx < 0 || yy < 0 || xx >= hs || yy >= hs) continue;
          const j = yy * hs + xx;
          if (this.bmat[j] < 0) this.ink[j] = 2;
        }
      }
    }
    // shade once per output pixel (representative sample), resolve coverage at hi-res
    const ss = this.ss;
    const inv = 1 / (ss * ss);
    const ir = (INK >> 16) & 255;
    const ig = (INK >> 8) & 255;
    const ib = INK & 255;
    this.out.fill(0);
    const om = Math.ceil((this.diskR + 1) / ss);
    const oy0 = Math.max(0, Math.floor(ly0 / ss) - om);
    const oy1 = Math.min(this.size - 1, Math.floor(ly1 / ss) + om);
    const ox0 = Math.max(0, Math.floor(lx0 / ss) - om);
    const ox1 = Math.min(this.size - 1, Math.floor(lx1 / ss) + om);
    for (let oy = oy0; oy <= oy1; oy++) {
      for (let ox = ox0; ox <= ox1; ox++) {
        let rep = -1;
        for (let sy = 0; sy < ss && rep < 0; sy++) {
          const row = (oy * ss + sy) * hs + ox * ss;
          for (let sx = 0; sx < ss; sx++) {
            const i = row + sx;
            if (this.bmat[i] >= 0 && this.ink[i] === 0) {
              rep = i;
              break;
            }
          }
        }
        let col = 0;
        if (rep >= 0) {
          let nx = this.bnx[rep];
          let ny = this.bny[rep];
          let nz = this.bnz[rep];
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          if (nz < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          col = shader.shade(this.bmat[rep], this.box[rep], this.boy[rep], this.boz[rep], nx, ny, nz, ox, oy);
        }
        const cr = (col >> 16) & 255;
        const cg = (col >> 8) & 255;
        const cb = col & 255;
        let r = 0;
        let g = 0;
        let b = 0;
        let cnt = 0;
        for (let sy = 0; sy < ss; sy++) {
          const row = (oy * ss + sy) * hs + ox * ss;
          for (let sx = 0; sx < ss; sx++) {
            const i = row + sx;
            if (this.ink[i] !== 0) {
              r += ir;
              g += ig;
              b += ib;
              cnt++;
            } else if (this.bmat[i] >= 0) {
              r += cr;
              g += cg;
              b += cb;
              cnt++;
            }
          }
        }
        const o = (oy * this.size + ox) * 4;
        if (cnt === 0) {
          this.out[o + 3] = 0;
          continue;
        }
        this.out[o] = r / cnt;
        this.out[o + 1] = g / cnt;
        this.out[o + 2] = b / cnt;
        this.out[o + 3] = 255 * cnt * inv;
      }
    }
  }

  private raster(mesh: Mesh, a: number, b: number, d: number, mat: number): void {
    const hs = this.hs;
    const x0 = this.vx[a];
    const y0 = this.vy[a];
    const x1 = this.vx[b];
    const y1 = this.vy[b];
    const x2 = this.vx[d];
    const y2 = this.vy[d];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area > -1e-9 && area < 1e-9) return;
    const inv = 1 / area;
    let minX = Math.floor(Math.min(x0, x1, x2));
    let maxX = Math.ceil(Math.max(x0, x1, x2));
    let minY = Math.floor(Math.min(y0, y1, y2));
    let maxY = Math.ceil(Math.max(y0, y1, y2));
    if (minX < 0) minX = 0;
    if (minY < 0) minY = 0;
    if (maxX > hs - 1) maxX = hs - 1;
    if (maxY > hs - 1) maxY = hs - 1;
    if (minX > maxX || minY > maxY) return;
    const z0 = this.vz[a];
    const z1 = this.vz[b];
    const z2 = this.vz[d];
    const a0 = (y1 - y2) * inv;
    const b0 = (x2 - x1) * inv;
    const a1 = (y2 - y0) * inv;
    const b1 = (x0 - x2) * inv;
    const sx0 = minX + 0.5;
    const sy0 = minY + 0.5;
    let w0row = ((x1 - sx0) * (y2 - sy0) - (x2 - sx0) * (y1 - sy0)) * inv;
    let w1row = ((x2 - sx0) * (y0 - sy0) - (x0 - sx0) * (y2 - sy0)) * inv;
    const eps = -1e-5;
    let touched = false;
    for (let y = minY; y <= maxY; y++) {
      let w0 = w0row;
      let w1 = w1row;
      let i = y * hs + minX;
      for (let x = minX; x <= maxX; x++, i++, w0 += a0, w1 += a1) {
        const w2 = 1 - w0 - w1;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        if (z <= this.depth[i]) continue;
        this.depth[i] = z;
        this.bmat[i] = mat;
        this.bnx[i] = w0 * this.wnx[a] + w1 * this.wnx[b] + w2 * this.wnx[d];
        this.bny[i] = w0 * this.wny[a] + w1 * this.wny[b] + w2 * this.wny[d];
        this.bnz[i] = w0 * this.wnz[a] + w1 * this.wnz[b] + w2 * this.wnz[d];
        this.box[i] = w0 * mesh.px[a] + w1 * mesh.px[b] + w2 * mesh.px[d];
        this.boy[i] = w0 * mesh.py[a] + w1 * mesh.py[b] + w2 * mesh.py[d];
        this.boz[i] = w0 * mesh.pz[a] + w1 * mesh.pz[b] + w2 * mesh.pz[d];
        touched = true;
      }
      w0row += b0;
      w1row += b1;
    }
    if (touched) {
      if (minX < this.bx0) this.bx0 = minX;
      if (maxX > this.bx1) this.bx1 = maxX;
      if (minY < this.by0) this.by0 = minY;
      if (maxY > this.by1) this.by1 = maxY;
    }
  }
}
