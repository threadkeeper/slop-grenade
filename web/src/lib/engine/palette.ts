/**
 * Art-direction palette for the Slop Grenade "ink & cel" look
 * (thick inked outlines, flat cel bands, hatched shadows).
 *
 * Mirrored in `desktop/Engine/Palette.cs`.
 */

/** Deep purple-black ink used for every outline and hatch stroke. */
export const INK = 0x1b1420;

/** Cel-shading bands for one slop colourway (incoming pink or outgoing blue). */
export interface SlopPalette {
  deep: number;
  shadow: number;
  base: number;
  light: number;
  gloss: number;
  hatch: number;
}

/** Slop received from colleagues lands on the LEFT edge in plastic pink. */
export const SLOP_PINK: SlopPalette = {
  deep: 0x7c0f4a,
  shadow: 0xd21c78,
  base: 0xff4fa8,
  light: 0xffa3d2,
  gloss: 0xffffff,
  hatch: 0x5a0836
};

/** Slop you send lands on the RIGHT edge in plastic blue. */
export const SLOP_BLUE: SlopPalette = {
  deep: 0x0d2f7c,
  shadow: 0x1f63d6,
  base: 0x3d9dff,
  light: 0xaad9ff,
  gloss: 0xffffff,
  hatch: 0x0a2160
};

export const BRASS = { dark: 0x8a5a1c, base: 0xe3a93b, light: 0xffe18c };
export const STEEL = { dark: 0x3c4a5a, base: 0x93a7bc, light: 0xe2ebf4 };

/** Explosion heat ramp, white-hot core to cooled soot. */
export const HEAT_RAMP: number[] = [
  0xffffff, 0xfff3a6, 0xffd23f, 0xff9a1f, 0xf25a1c, 0xc8402a, 0x7a6a70, 0x4e4a54
];

/** Sample the heat ramp with t in [0,1] (1 = hottest). */
export function heatColor(t: number): number {
  const k = Math.max(0, Math.min(1, 1 - t)) * (HEAT_RAMP.length - 1);
  const i = Math.floor(k);
  const f = k - i;
  const a = HEAT_RAMP[Math.min(i, HEAT_RAMP.length - 1)];
  const b = HEAT_RAMP[Math.min(i + 1, HEAT_RAMP.length - 1)];
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * f;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * f;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * f;
  return ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(bl) & 255);
}

export function slopPaletteFor(side: 'left' | 'right'): SlopPalette {
  return side === 'left' ? SLOP_PINK : SLOP_BLUE;
}
