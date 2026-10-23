/**
 * Canvas helpers for the inked, cel-shaded 2D art (grenade, swirls, explosion,
 * flies, squeegee). Mirrored by `desktop/Engine/Ink.cs` on GDI+.
 */
import { css } from './math';
import { INK } from './palette';

/** Fill the current path then stroke it with ink. */
export function fillInk(ctx: CanvasRenderingContext2D, fill: number, lineW: number, alpha = 1): void {
  ctx.fillStyle = css(fill, alpha);
  ctx.fill();
  if (lineW > 0) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lineW;
    ctx.strokeStyle = css(INK, alpha);
    ctx.stroke();
  }
}

/** Ellipse path helper. */
export function ellipsePath(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2);
}

/**
 * Cel-shaded inked ellipse: base fill, shadow crescent away from the light
 * direction (lx, ly in local space), light band, gloss dab, ink outline.
 */
export function celEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  base: number,
  shadow: number,
  light: number,
  lineW: number,
  lx: number,
  ly: number,
  gloss: boolean,
  alpha = 1
): void {
  ctx.save();
  ellipsePath(ctx, cx, cy, rx, ry);
  ctx.fillStyle = css(shadow, alpha);
  ctx.fill();
  ctx.clip();
  // lit body = ellipse shifted towards the light
  ellipsePath(ctx, cx + lx * rx * 0.22, cy + ly * ry * 0.22, rx * 0.98, ry * 0.98);
  ctx.fillStyle = css(base, alpha);
  ctx.fill();
  ellipsePath(ctx, cx + lx * rx * 0.42, cy + ly * ry * 0.42, rx * 0.55, ry * 0.5);
  ctx.fillStyle = css(light, alpha);
  ctx.fill();
  if (gloss) {
    ellipsePath(ctx, cx + lx * rx * 0.5, cy + ly * ry * 0.52, rx * 0.2, ry * 0.13, Math.atan2(ly, lx) + Math.PI / 2);
    ctx.fillStyle = css(0xffffff, alpha);
    ctx.fill();
  }
  ctx.restore();
  ellipsePath(ctx, cx, cy, rx, ry);
  ctx.lineWidth = lineW;
  ctx.strokeStyle = css(INK, alpha);
  ctx.stroke();
}

/** Diagonal ink hatching clipped to the current clip region. */
export function hatch(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, gap: number, lineW: number, alpha: number): void {
  ctx.strokeStyle = css(INK, alpha);
  ctx.lineWidth = lineW;
  ctx.beginPath();
  const h = y1 - y0;
  for (let x = x0 - h; x < x1; x += gap) {
    ctx.moveTo(x, y1);
    ctx.lineTo(x + h, y0);
  }
  ctx.stroke();
}
