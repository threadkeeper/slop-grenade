/**
 * Procedural 3D models + cel-shading materials for the 20 "sprinkled" fruits.
 * Object space: y is up (stem end), body radius is roughly 1 unit.
 *
 * Mirrored in `desktop/Effects/FruitModels.cs`.
 */
import { clamp01, hash2, mixColor, smoothstep, valueNoise3 } from './math';
import { MeshBuilder, toonShade, type FragmentShader, type Mesh } from './toon3d';

export const FRUIT_KINDS = [
  'honeycrisp_apple',
  'bartlett_pear',
  'valencia_orange',
  'amalfi_lemon',
  'ruby_strawberry',
  'bing_cherries',
  'crimson_watermelon',
  'golden_pineapple',
  'alphonso_mango',
  'emerald_kiwi',
  'red_dragonfruit',
  'concord_grapes',
  'sun_peach',
  'royal_plum',
  'ruby_pomegranate',
  'black_mission_fig',
  'tropical_papaya',
  'starfruit_carambola',
  'blueberries_cluster',
  'passionfruit_maracuja'
] as const;

export type FruitKind = (typeof FRUIT_KINDS)[number];

/** Material slots shared by all fruit. */
const SKIN = 0;
const STEM = 1;
const LEAF = 2;
const CUT = 3;
const ACCENT = 4;

const STEM_BROWN = 0x6b3a1e;
const LEAF_GREEN = 0x37b24a;

/** Juice colour per fruit, used for splash droplets when a fruit sticks. */
export function fruitJuice(kind: FruitKind): number {
  switch (kind) {
    case 'honeycrisp_apple':
    case 'ruby_strawberry':
    case 'bing_cherries':
    case 'crimson_watermelon':
    case 'ruby_pomegranate':
    case 'red_dragonfruit':
      return 0xff4a6a;
    case 'bartlett_pear':
    case 'emerald_kiwi':
    case 'starfruit_carambola':
      return 0xb8e04a;
    case 'valencia_orange':
    case 'alphonso_mango':
    case 'sun_peach':
    case 'tropical_papaya':
      return 0xffa03a;
    case 'amalfi_lemon':
    case 'golden_pineapple':
      return 0xffe04a;
    default:
      return 0xb070e0;
  }
}

function sphereDir(u: number, v: number): [number, number, number] {
  const th = u * Math.PI;
  const ph = v * Math.PI * 2;
  return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
}

function norm3(x: number, y: number, z: number): number[] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function stemAndLeaf(mb: MeshBuilder, top: number, lean: number, leafSize: number): void {
  mb.tube(
    [
      [0, top - 0.25, 0],
      [lean * 0.4, top + 0.08, 0],
      [lean, top + 0.3, 0.02]
    ],
    [0.06, 0.05, 0.045],
    STEM,
    6
  );
  if (leafSize > 0) {
    mb.leaf([lean * 0.5, top + 0.12, 0], norm3(1, 0.32, 0.35), norm3(-0.3, 0.2, 0.95), norm3(-0.2, 1, 0), leafSize, leafSize * 0.38, -0.25, LEAF);
  }
}

/** Builds the mesh for one fruit kind. */
export function buildFruitMesh(kind: FruitKind): Mesh {
  const mb = new MeshBuilder();
  const R = 18;
  const S = 28;
  switch (kind) {
    case 'honeycrisp_apple':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const th = u * Math.PI;
        const widen = 1 + 0.07 * y;
        const yy = y * 0.9 - 0.3 * Math.exp(-(th * th) / 0.07) + 0.13 * Math.exp(-((Math.PI - th) ** 2) / 0.06);
        return [x * widen, yy, z * widen];
      }, SKIN, [0, 0, 0], null, 0);
      stemAndLeaf(mb, 0.82, 0.12, 0.55);
      break;
    case 'bartlett_pear':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const sc = 0.5 + 0.5 * smoothstep(0.75, -0.45, y);
        return [x * sc * 0.95, y * 1.18 - 0.08, z * sc * 0.95];
      }, SKIN, [0, -0.2, 0], null, 0);
      stemAndLeaf(mb, 1.2, 0.18, 0.5);
      break;
    case 'valencia_orange':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        return [x, y * 0.94, z];
      }, SKIN, [0, 0, 0], null, 0);
      mb.ellipsoid(0, 0.93, 0, 0.12, 0.05, 0.12, STEM, 6, 10);
      mb.leaf([0.05, 0.95, 0], norm3(1, 0.4, 0.2), norm3(-0.2, 0.1, 1), norm3(-0.3, 1, 0), 0.6, 0.22, -0.2, LEAF);
      break;
    case 'amalfi_lemon':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        // long axis along y so the stem/leaf sits on a tip
        const tip = 1 + 0.2 * Math.pow(Math.abs(y), 10);
        return [x * 0.74, y * 1.08 * tip, z * 0.74];
      }, SKIN, [0, 0, 0], null, 0);
      mb.leaf([0, 1.22, 0], norm3(0.9, 0.5, 0.1), norm3(0, 0.1, 1), norm3(-0.4, 1, 0), 0.62, 0.22, -0.2, LEAF);
      break;
    case 'ruby_strawberry':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const sc = (0.36 + 0.64 * smoothstep(-1.05, 0.35, y)) * (1 - 0.1 * smoothstep(0.55, 1, y));
        return [x * sc, y * 1.08, z * sc];
      }, SKIN, [0, 0, 0], null, 0);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const d = norm3(Math.cos(a), -0.25, Math.sin(a));
        const side = norm3(-Math.sin(a), 0, Math.cos(a));
        mb.leaf([d[0] * 0.12, 0.92, d[2] * 0.12], d, side, [0, 1, 0], 0.55, 0.17, 0.25, LEAF);
      }
      mb.tube([[0, 0.9, 0], [0.04, 1.15, 0], [0.1, 1.3, 0]], [0.05, 0.045, 0.04], STEM, 6);
      break;
    case 'bing_cherries': {
      mb.ellipsoid(-0.44, -0.42, 0.14, 0.56, 0.54, 0.56, SKIN, 14, 20);
      mb.ellipsoid(0.47, -0.52, -0.16, 0.54, 0.52, 0.54, SKIN, 14, 20);
      mb.tube([[-0.42, 0.08, 0.12], [-0.32, 0.55, 0.08], [0.0, 0.92, 0.02], [0.14, 1.06, 0]], [0.045, 0.04, 0.037, 0.035], STEM, 6);
      mb.tube([[0.46, -0.02, -0.15], [0.36, 0.5, -0.08], [0.2, 0.9, -0.02], [0.14, 1.06, 0]], [0.045, 0.04, 0.037, 0.035], STEM, 6);
      mb.leaf([0.14, 1.06, 0], norm3(1, 0.25, 0.3), norm3(-0.25, 0.15, 1), norm3(-0.2, 1, 0), 0.62, 0.24, -0.25, LEAF);
      break;
    }
    case 'crimson_watermelon':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        return [x * 0.98, y * 0.92, z * 0.98];
      }, SKIN, [0, 0, 0], 0.12, CUT);
      break;
    case 'golden_pineapple':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        return [x * 0.72, y * 0.98 - 0.12, z * 0.72];
      }, SKIN, [0, -0.12, 0], null, 0);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const tilt = i % 2 === 0 ? 0.35 : 0.65;
        const d = norm3(Math.cos(a) * tilt, 1, Math.sin(a) * tilt);
        const side = norm3(-Math.sin(a), 0, Math.cos(a));
        mb.leaf([Math.cos(a) * 0.1, 0.78, Math.sin(a) * 0.1], d, side, norm3(Math.cos(a), 0.2, Math.sin(a)), i % 2 === 0 ? 0.95 : 0.7, 0.13, 0.18, LEAF);
      }
      break;
    case 'alphonso_mango':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const bend = 0.2 * y * y - 0.08;
        const beak = 0.12 * Math.exp(-((y + 1) ** 2) / 0.05);
        return [x * 0.8 + bend + beak, y * 1.02, z * 0.66];
      }, SKIN, [0, 0, 0], null, 0);
      mb.tube([[0.1, 0.9, 0], [0.14, 1.12, 0]], [0.05, 0.045], STEM, 6);
      break;
    case 'emerald_kiwi':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        return [x * 0.86, y * 1.0, z * 0.86];
      }, SKIN, [0, 0, 0], 0.1, CUT);
      break;
    case 'red_dragonfruit':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        return [x * 0.8, y * 1.0, z * 0.8];
      }, SKIN, [0, 0, 0], null, 0);
      for (let i = 0; i < 11; i++) {
        const a = i * 2.4;
        const yy = -0.7 + (i / 10) * 1.55;
        const rr = Math.sqrt(Math.max(0.04, 1 - yy * yy)) * 0.8;
        const out = norm3(Math.cos(a), 0, Math.sin(a));
        const d = norm3(Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55);
        const side = norm3(-Math.sin(a), 0, Math.cos(a));
        mb.leaf([out[0] * rr * 0.93, yy, out[2] * rr * 0.93], d, side, out, 0.42, 0.16, 0.45, ACCENT);
      }
      break;
    case 'concord_grapes': {
      const rows: number[][] = [
        [0.5, 4, 0.42, 0],
        [0.12, 4, 0.36, 0.78],
        [-0.26, 3, 0.27, 0.3],
        [-0.6, 2, 0.16, 1.2],
        [-0.88, 1, 0, 0]
      ];
      for (const row of rows) {
        for (let i = 0; i < row[1]; i++) {
          const a = row[3] + (i / row[1]) * Math.PI * 2;
          mb.ellipsoid(Math.cos(a) * row[2], row[0], Math.sin(a) * row[2], 0.3, 0.31, 0.3, SKIN, 10, 14);
        }
      }
      mb.tube([[0, 0.6, 0], [0.03, 0.95, 0], [0.12, 1.2, 0]], [0.05, 0.045, 0.04], STEM, 6);
      mb.leaf([0.06, 1.0, 0], norm3(1, 0.35, 0.3), norm3(-0.3, 0.1, 1), norm3(-0.2, 1, 0), 0.75, 0.36, -0.25, LEAF);
      break;
    }
    case 'sun_peach':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const crease = 1 - 0.08 * Math.exp(-((x / 0.14) ** 2)) * smoothstep(-0.1, 0.5, z);
        const dip = -0.12 * Math.exp(-((u * Math.PI) ** 2) / 0.08);
        return [x * crease, y * 0.96 * crease + dip, z * crease];
      }, SKIN, [0, 0, 0], null, 0);
      stemAndLeaf(mb, 0.86, 0.06, 0.6);
      break;
    case 'royal_plum':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const crease = 1 - 0.04 * Math.exp(-((x / 0.12) ** 2)) * smoothstep(0, 0.6, z);
        return [x * 0.92 * crease, y * 1.0, z * 0.9];
      }, SKIN, [0, 0, 0], null, 0);
      mb.tube([[0, 0.85, 0], [0.04, 1.08, 0], [0.1, 1.2, 0]], [0.04, 0.035, 0.03], STEM, 6);
      break;
    case 'ruby_pomegranate':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const hex = 1 + 0.035 * Math.cos(v * Math.PI * 12);
        return [x * 0.96 * hex, y * 0.9, z * 0.96 * hex];
      }, SKIN, [0, 0, 0], null, 0);
      mb.tube([[0, 0.75, 0], [0, 1.0, 0]], [0.2, 0.17], ACCENT, 10);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const d = norm3(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5);
        const side = norm3(-Math.sin(a), 0, Math.cos(a));
        mb.leaf([Math.cos(a) * 0.15, 0.98, Math.sin(a) * 0.15], d, side, norm3(Math.cos(a), 0, Math.sin(a)), 0.28, 0.1, 0.4, ACCENT);
      }
      break;
    case 'black_mission_fig':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const sc = 0.42 + 0.58 * smoothstep(0.8, -0.4, y);
        return [x * sc * 0.92, y * 1.12, z * sc * 0.92];
      }, SKIN, [0, -0.2, 0], null, 0);
      mb.tube([[0, 1.0, 0], [0.05, 1.22, 0], [0.12, 1.3, 0]], [0.06, 0.05, 0.04], STEM, 6);
      break;
    case 'tropical_papaya':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const sc = 0.82 + 0.18 * smoothstep(0.6, -0.5, y);
        return [x * 0.7 * sc, y * 1.08, z * 0.7 * sc];
      }, SKIN, [0, 0, 0], 0.05, CUT);
      break;
    case 'starfruit_carambola':
      mb.surface(R + 4, 40, (u, v) => {
        const th = u * Math.PI;
        const ph = v * Math.PI * 2;
        const prof = Math.pow(Math.sin(th), 0.62);
        const star = 0.5 + 0.42 * Math.pow(0.5 + 0.5 * Math.cos(5 * ph), 1.3);
        return [Math.cos(ph) * star * prof, Math.cos(th) * 1.08, Math.sin(ph) * star * prof];
      }, SKIN, [0, 0, 0], null, 0);
      mb.tube([[0, 1.0, 0], [0.04, 1.18, 0]], [0.05, 0.04], STEM, 6);
      break;
    case 'blueberries_cluster':
      mb.ellipsoid(-0.46, -0.24, 0.12, 0.5, 0.47, 0.5, SKIN, 12, 18);
      mb.ellipsoid(0.45, -0.3, -0.12, 0.48, 0.45, 0.48, SKIN, 12, 18);
      mb.ellipsoid(0.0, 0.42, 0.0, 0.5, 0.47, 0.5, SKIN, 12, 18);
      mb.leaf([0.1, 0.85, 0], norm3(1, 0.4, 0.3), norm3(-0.3, 0.1, 1), norm3(-0.2, 1, 0), 0.55, 0.2, -0.2, LEAF);
      break;
    case 'passionfruit_maracuja':
      mb.surface(R, S, (u, v) => {
        const [x, y, z] = sphereDir(u, v);
        const w = 1 + 0.03 * (valueNoise3(x * 3 + 5, y * 3, z * 3) - 0.5);
        return [x * 0.97 * w, y * 0.94 * w, z * 0.97 * w];
      }, SKIN, [0, 0, 0], null, 0);
      mb.tube([[0, 0.85, 0], [0.06, 1.1, 0], [0.14, 1.22, 0]], [0.05, 0.045, 0.04], STEM, 6);
      break;
  }
  return mb.build();
}

/** Per-fruit material shader (albedo pattern + finish). */
export class FruitShader implements FragmentShader {
  private readonly kind: FruitKind;
  private sg = 0;
  private sf = 0;

  constructor(kind: FruitKind) {
    this.kind = kind;
  }

  shade(mat: number, ox: number, oy: number, oz: number, nx: number, ny: number, nz: number, sx: number, sy: number): number {
    let albedo = 0xffffff;
    let gloss = 0;
    let fuzz = 0;
    if (mat === STEM) {
      albedo = this.kind === 'bing_cherries' ? 0x5a8a2a : STEM_BROWN;
    } else if (mat === LEAF) {
      albedo = LEAF_GREEN;
      gloss = 0.3;
    } else if (mat === ACCENT) {
      if (this.kind === 'red_dragonfruit') {
        albedo = mixColor(0xe8287a, 0x8ad43a, smoothstep(-0.2, 0.9, oy * 0.3 + (Math.sqrt(ox * ox + oz * oz) - 0.6) * 1.4));
      } else {
        albedo = 0x9a1e24;
      }
      gloss = 0.2;
    } else {
      albedo = this.skin(mat, ox, oy, oz);
      gloss = this.sg;
      fuzz = this.sf;
    }
    return toonShade(albedo, nx, ny, nz, sx, sy, gloss, fuzz);
  }

  private skin(mat: number, ox: number, oy: number, oz: number): number {
    switch (this.kind) {
      case 'honeycrisp_apple': {
        const streak = valueNoise3(ox * 2.5, oy * 9, oz * 2.5);
        const yellow = smoothstep(0.25, -0.9, oy + (valueNoise3(ox * 2, oy * 2, oz * 2) - 0.5) * 0.8);
        const c = mixColor(0xd81e2c, 0xb0101e, streak);
        { this.sg = 1; this.sf = 0; return mixColor(c, 0xf2c83a, yellow * 0.75); }
      }
      case 'bartlett_pear': {
        const blush = smoothstep(0.1, 0.9, ox * 0.8 + oz * 0.3 + (valueNoise3(ox * 2, oy * 2, oz * 2) - 0.5));
        let c = mixColor(0xd0d84a, 0xe8723a, blush * 0.7);
        if (hash2(Math.floor((ox + 2) * 14), Math.floor((oy + 2) * 14 + oz * 9)) > 0.93) c = mixColor(c, 0x8a6a2a, 0.6);
        { this.sg = 0.5; this.sf = 0; return c; }
      }
      case 'valencia_orange': {
        const pore = valueNoise3(ox * 14, oy * 14, oz * 14);
        { this.sg = 0.6; this.sf = 0; return mixColor(0xff8c1a, 0xe86a10, pore > 0.72 ? 0.7 : 0); }
      }
      case 'amalfi_lemon': {
        const pore = valueNoise3(ox * 14, oy * 14, oz * 14);
        { this.sg = 0.6; this.sf = 0; return mixColor(0xffe03a, 0xe8b820, pore > 0.74 ? 0.7 : 0); }
      }
      case 'ruby_strawberry': {
        const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
        const th = Math.acos(Math.max(-1, Math.min(1, oy / l)));
        const ph = Math.atan2(oz, ox);
        const rows = 9;
        const ri = Math.floor((th / Math.PI) * rows);
        const cols = Math.max(3, Math.round(16 * Math.sin(((ri + 0.5) / rows) * Math.PI)));
        const off = (ri % 2) * 0.5;
        const cf = ((ph / (Math.PI * 2) + 1) * cols + off) % 1;
        const rf = ((th / Math.PI) * rows) % 1;
        const d = Math.sqrt((cf - 0.5) * 1.3 * (cf - 0.5) * 1.3 + (rf - 0.5) * (rf - 0.5));
        let c = 0xe8203a;
        if (th > 0.45) {
          if (d < 0.13) c = 0xffe08a;
          else if (d < 0.22) c = 0xa8102a;
        }
        if (oy > 0.78) c = mixColor(c, 0xf06a4a, 0.4);
        { this.sg = 0.8; this.sf = 0; return c; }
      }
      case 'bing_cherries':
        { this.sg = 1; this.sf = 0; return mixColor(0xb0102a, 0x6a0618, smoothstep(0.2, -0.6, oy)); }
      case 'crimson_watermelon': {
        if (mat === CUT) {
          const rr = Math.sqrt(ox * ox + oy * oy);
          if (rr > 0.9) { this.sg = 0.2; this.sf = 0; return 0x2e8a3a; }
          if (rr > 0.8) { this.sg = 0.2; this.sf = 0; return 0xe8f8c8; }
          const gx = Math.floor((ox + 2) * 5.5);
          const gy = Math.floor((oy + 2) * 4.2);
          const h = hash2(gx, gy);
          const cx = (gx + 0.5) / 5.5 - 2;
          const cy = (gy + 0.5) / 4.2 - 2;
          const seed = h > 0.45 && rr < 0.66 && ((ox - cx) / 0.045) ** 2 + ((oy - cy) / 0.075) ** 2 < 1;
          { this.sg = seed ? 1 : 0.35; this.sf = 0; return seed ? 0x1a1414 : 0xff3a52; }
        }
        const ph = Math.atan2(oz, ox);
        const stripe = Math.sin(ph * 9 + Math.sin(oy * 7) * 0.7 + (valueNoise3(ox * 3, oy * 3, oz * 3) - 0.5) * 1.6);
        { this.sg = 0.4; this.sf = 0; return stripe > 0.1 ? 0x1e6b2a : 0x7fcf5a; }
      }
      case 'golden_pineapple': {
        const ph = Math.atan2(oz, ox) / (Math.PI * 2);
        const a = ph * 9 + oy * 2.4;
        const b = ph * 9 - oy * 2.4;
        const fa = a - Math.floor(a);
        const fb = b - Math.floor(b);
        const edge = Math.min(fa, 1 - fa, fb, 1 - fb);
        const eye = Math.sqrt((fa - 0.5) * (fa - 0.5) + (fb - 0.5) * (fb - 0.5)) < 0.12;
        let c = mixColor(0xf2b630, 0xb8b03a, smoothstep(-0.2, -1.0, oy));
        if (edge < 0.09) c = 0x8a5a1c;
        else if (eye) c = 0x6a4a1a;
        { this.sg = 0.3; this.sf = 0; return c; }
      }
      case 'alphonso_mango': {
        const t = clamp01(0.5 + oy * 0.45 - ox * 0.25 + (valueNoise3(ox * 2, oy * 2, oz * 2) - 0.5) * 0.3);
        let c: number;
        if (t > 0.72) c = mixColor(0xff9a1f, 0xf2452a, (t - 0.72) / 0.28);
        else if (t > 0.38) c = mixColor(0xffd23f, 0xff9a1f, (t - 0.38) / 0.34);
        else c = mixColor(0x8acb3a, 0xffd23f, t / 0.38);
        { this.sg = 0.5; this.sf = 0; return c; }
      }
      case 'emerald_kiwi': {
        if (mat === CUT) {
          const rr = Math.sqrt((ox / 0.86) * (ox / 0.86) + oy * oy);
          if (rr > 0.93) { this.sg = 0; this.sf = 0.6; return 0x8a5a2a; }
          if (rr < 0.2) { this.sg = 0.2; this.sf = 0; return 0xf5f2c8; }
          const ang = Math.atan2(oy, ox);
          if (rr > 0.24 && rr < 0.38) {
            const k = Math.floor(((ang / (Math.PI * 2)) + 1) * 26);
            const fr = ((ang / (Math.PI * 2)) + 1) * 26 - k;
            if (Math.abs(fr - 0.5) < 0.22 && Math.abs(rr - 0.31 - (hash2(k, 7) - 0.5) * 0.06) < 0.035) { this.sg = 1; this.sf = 0; return 0x141010; }
          }
          const ray = ((ang / (Math.PI * 2)) + 1) * 34;
          const ray01 = ray - Math.floor(ray);
          let c = mixColor(0x8ad42a, 0x5aa81e, smoothstep(0.5, 0.92, rr));
          if (ray01 < 0.12 && rr > 0.38) c = mixColor(c, 0xd8f08a, 0.5);
          { this.sg = 0.45; this.sf = 0; return c; }
        }
        const sp = hash2(Math.floor((ox + 2) * 22), Math.floor((oy + 2) * 22 + oz * 13)) > 0.8;
        { this.sg = 0; this.sf = 1; return sp ? 0x6a421e : 0x9a6a36; }
      }
      case 'red_dragonfruit':
        { this.sg = 0.5; this.sf = 0; return mixColor(0xf0308a, 0xc81866, valueNoise3(ox * 3, oy * 3, oz * 3)); }
      case 'concord_grapes': {
        const bloom = valueNoise3(ox * 6, oy * 6, oz * 6);
        { this.sg = 0.7; this.sf = 0; return mixColor(0x5a2a8a, 0x8a6ab8, bloom * 0.45); }
      }
      case 'sun_peach': {
        const t = clamp01(0.55 + ox * 0.4 + oy * 0.25 + (valueNoise3(ox * 2.5, oy * 2.5, oz * 2.5) - 0.5) * 0.5);
        const c = t > 0.55 ? mixColor(0xffa04a, 0xe8403a, (t - 0.55) / 0.45) : mixColor(0xffd27a, 0xffa04a, t / 0.55);
        { this.sg = 0.12; this.sf = 1; return c; }
      }
      case 'royal_plum': {
        const bloom = valueNoise3(ox * 4, oy * 4, oz * 4);
        { this.sg = 0.7; this.sf = 0; return mixColor(0x4a1e6a, 0x7a5aa0, bloom * 0.5); }
      }
      case 'ruby_pomegranate': {
        const blot = valueNoise3(ox * 3, oy * 3, oz * 3);
        { this.sg = 0.5; this.sf = 0; return mixColor(0xd02030, 0x8a1420, smoothstep(0.45, 0.8, blot)); }
      }
      case 'black_mission_fig': {
        const t = smoothstep(0.2, 1.0, oy);
        { this.sg = 0.3; this.sf = 0.3; return mixColor(0x4a1e4a, 0x6a8a3a, t * 0.8); }
      }
      case 'tropical_papaya': {
        if (mat === CUT) {
          const rr = Math.sqrt((ox / 0.7) * (ox / 0.7) + (oy / 1.08) * (oy / 1.08));
          if (rr > 0.94) { this.sg = 0.2; this.sf = 0; return 0x8ab83a; }
          const cav = (ox / 0.26) ** 2 + ((oy + 0.05) / 0.55) ** 2;
          if (cav < 1) {
            const gx = Math.floor((ox + 2) * 14);
            const gy = Math.floor((oy + 2) * 14);
            const h = hash2(gx, gy);
            { this.sg = 1; this.sf = 0; return h > 0.35 ? 0x1a1414 : 0x5a2a1a; }
          }
          { this.sg = 0.35; this.sf = 0; return mixColor(0xff7a3a, 0xffa04a, smoothstep(0.3, 0.9, rr)); }
        }
        const t = smoothstep(-0.8, 0.8, oy + (valueNoise3(ox * 3, oy * 3, oz * 3) - 0.5) * 0.6);
        { this.sg = 0.4; this.sf = 0; return mixColor(0xffb83a, 0x6aa83a, t); }
      }
      case 'starfruit_carambola': {
        const ph = Math.atan2(oz, ox);
        const rib = Math.pow(0.5 + 0.5 * Math.cos(5 * ph), 6);
        { this.sg = 0.8; this.sf = 0; return mixColor(0xffd63a, 0xc8e04a, rib * 0.8); }
      }
      case 'blueberries_cluster': {
        // crown dimple on each berry: approximate per-berry centre by nearest cluster centre
        const centres = [
          [-0.46, -0.24, 0.12],
          [0.45, -0.3, -0.12],
          [0.0, 0.42, 0.0]
        ];
        let best = 0;
        let bd = 1e9;
        for (let i = 0; i < 3; i++) {
          const d = (ox - centres[i][0]) ** 2 + (oy - centres[i][1]) ** 2 + (oz - centres[i][2]) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
        const c0 = centres[best];
        const dx = ox - c0[0];
        const dy = oy - c0[1];
        const dz = oz - c0[2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        // crown faces outward from the cluster centre
        const cl = Math.hypot(c0[0], c0[1] + 0.05, c0[2] + 0.4) || 1;
        const cxv = c0[0] / cl;
        const cyv = (c0[1] + 0.05) / cl;
        const czv = (c0[2] + 0.4) / cl;
        const cosA = (dx * cxv + dy * cyv + dz * czv) / l;
        const bloom = valueNoise3(ox * 5, oy * 5, oz * 5);
        let c = mixColor(0x3a4ab8, 0x8a9ad8, bloom * 0.45);
        if (cosA > 0.93) c = 0x1e2050;
        else if (cosA > 0.88) c = 0x2a3270;
        { this.sg = 0.45; this.sf = 0; return c; }
      }
      case 'passionfruit_maracuja': {
        const sp = hash2(Math.floor((ox + 2) * 18), Math.floor((oy + 2) * 18 + oz * 11)) > 0.86;
        const wr = valueNoise3(ox * 5, oy * 5, oz * 5);
        let c = mixColor(0x5a1e5a, 0x3a1040, smoothstep(0.55, 0.75, wr));
        if (sp) c = mixColor(c, 0xd8b0d8, 0.6);
        { this.sg = 0.4; this.sf = 0; return c; }
      }
    }
    { this.sg = 0; this.sf = 0; return 0xff00ff; }
  }
}

const meshCache = new Map<FruitKind, Mesh>();

/** Lazily builds and caches the mesh for a fruit kind. */
export function fruitMesh(kind: FruitKind): Mesh {
  let m = meshCache.get(kind);
  if (!m) {
    m = buildFruitMesh(kind);
    meshCache.set(kind, m);
  }
  return m;
}
