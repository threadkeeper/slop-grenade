/** Vector overlays for the slop layer: the soft-serve swirl mounds. */
import { easeOutBack } from './math';
import { celEllipse } from './ink';
import type { SlopPalette } from './palette';
import type { Swirl } from './slop';

const TIERS: number[][] = [
  // [y, rx, ry]
  [0, 0.5, 0.21],
  [-0.27, 0.4, 0.19],
  [-0.51, 0.29, 0.16]
];

/** Draws a cartoon soft-serve swirl leaning inward from the bezel. */
export function drawSwirl(ctx: CanvasRenderingContext2D, sw: Swirl, pal: SlopPalette, inward: number, s: number): void {
  const pop = sw.age >= 0.4 ? 1 : easeOutBack(Math.max(0, sw.age) / 0.4);
  if (pop <= 0.01) return;
  const S = 104 * sw.size * pop;
  const lw = 3 * s;
  ctx.save();
  ctx.translate(sw.x, sw.y);
  ctx.rotate(inward * 0.42);
  // light comes from top-left in screen space; express in local space
  const ang = -inward * 0.42;
  const lx = -0.55 * Math.cos(ang) + 0.64 * Math.sin(ang);
  const ly = -0.55 * Math.sin(ang) - 0.64 * Math.cos(ang);
  for (let i = 0; i < TIERS.length; i++) {
    const t = TIERS[i];
    const wob = i % 2 === 0 ? sw.flip : -sw.flip;
    celEllipse(ctx, wob * S * 0.04, t[0] * S, t[1] * S, t[2] * S, pal.base, pal.shadow, pal.light, lw, lx, ly, true);
  }
  // curled tip
  ctx.beginPath();
  const tx = sw.flip * S * 0.05;
  const ty = -0.68 * S;
  ctx.moveTo(tx - S * 0.14, ty + S * 0.1);
  ctx.quadraticCurveTo(tx - S * 0.1, ty - S * 0.12, tx + sw.flip * S * 0.12, ty - S * 0.16);
  ctx.quadraticCurveTo(tx + sw.flip * S * 0.02, ty - S * 0.02, tx + S * 0.14, ty + S * 0.1);
  ctx.closePath();
  ctx.fillStyle = `#${pal.base.toString(16).padStart(6, '0')}`;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1b1420';
  ctx.stroke();
  ctx.restore();
}
