/**
 * The cute, inked hand grenade: ballistic flight with a lit
 * fuse, then detonation at the monitor edge.
 *
 * Mirrored in `desktop/Effects/Grenade.cs`.
 */
import { css, type Rng } from './math';
import { BRASS, INK, STEEL, type SlopPalette } from './palette';
import { hatch } from './ink';

export type Expression = 'cheeky' | 'uhoh';

export class Grenade {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle = 0;
  spin: number;
  age = 0;
  readonly flightTime: number;
  readonly gravity: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly side: 'left' | 'right';
  readonly pal: SlopPalette;
  readonly s: number;
  spoonAttached = true;
  done = false;
  sparkPhase = 0;
  /** 0..1 progress through the flight (game time). */
  get t(): number {
    return Math.min(1, this.age / this.flightTime);
  }

  constructor(side: 'left' | 'right', pal: SlopPalette, viewW: number, viewH: number, scale: number, motionScale: number, rng: Rng) {
    this.side = side;
    this.pal = pal;
    this.s = scale;
    const inward = side === 'left' ? 1 : -1;
    const edge = side === 'left' ? 0 : viewW;
    this.targetX = edge + inward * 56 * scale;
    this.targetY = viewH * rng.range(0.2, 0.62);
    // launched from below the screen on the opposite half
    this.x = viewW * 0.5 + inward * viewW * rng.range(0.1, 0.32);
    this.y = viewH + 70 * scale;
    this.flightTime = rng.range(1.35, 1.6);
    this.gravity = 1500 * motionScale;
    const T = this.flightTime;
    this.vx = (this.targetX - this.x) / T;
    this.vy = (this.targetY - this.y - 0.5 * this.gravity * T * T) / T;
    this.spin = -inward * rng.range(5.5, 7.5);
  }

  /** Advance with game-time dt. Returns true on the frame it reaches the target. */
  update(dt: number): boolean {
    if (this.done) return false;
    this.age += dt;
    this.sparkPhase += dt * 40;
    if (this.age >= this.flightTime) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.done = true;
      return true;
    }
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.spin * dt;
    return false;
  }

  expression(): Expression {
    return this.t > 0.78 ? 'uhoh' : 'cheeky';
  }

  /** Screen-space bounds (for dirty rectangles). */
  radius(): number {
    return 110 * this.s;
  }
}

function eggPath(ctx: CanvasRenderingContext2D, ox: number, oy: number, k: number, begin = true): void {
  if (begin) ctx.beginPath();
  ctx.moveTo(ox + 0, oy - 34 * k);
  ctx.bezierCurveTo(ox + 18 * k, oy - 34 * k, ox + 31 * k, oy - 16 * k, ox + 31 * k, oy + 4 * k);
  ctx.bezierCurveTo(ox + 31 * k, oy + 24 * k, ox + 18 * k, oy + 36 * k, ox + 0, oy + 36 * k);
  ctx.bezierCurveTo(ox - 18 * k, oy + 36 * k, ox - 31 * k, oy + 24 * k, ox - 31 * k, oy + 4 * k);
  ctx.bezierCurveTo(ox - 31 * k, oy - 16 * k, ox - 18 * k, oy - 34 * k, ox + 0, oy - 34 * k);
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function brassPiece(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lx: number, lw: number): void {
  roundRect(ctx, x, y, w, h, 2.5);
  ctx.fillStyle = css(BRASS.dark);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = css(BRASS.base);
  ctx.fillRect(x + (lx < 0 ? -2 : w * 0.25), y - 2, w * 0.78, h + 4);
  ctx.fillStyle = css(BRASS.light);
  ctx.fillRect(x + (lx < 0 ? w * 0.12 : w * 0.6), y - 2, w * 0.16, h + 4);
  ctx.restore();
  roundRect(ctx, x, y, w, h, 2.5);
  ctx.lineWidth = lw;
  ctx.strokeStyle = css(INK);
  ctx.stroke();
}

/**
 * Draw the grenade at (x, y) rotated by `angle`. `k` scales the local art
 * (1 = 72px tall at 1080p). `look` is the screen-space direction the eyes
 * should glance towards.
 */
export function drawGrenade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  k: number,
  pal: SlopPalette,
  expr: Expression,
  spoon: boolean,
  sparkPhase: number,
  lookX: number,
  lookY: number
): void {
  const lw = 3.1 * k;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // key light (top-left in screen space) expressed in local space
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const lx = -0.62 * ca - -0.78 * sa;
  const ly = -0.62 * sa + -0.78 * ca;
  const lgx = lookX * ca - lookY * sa;
  const lgy = lookX * sa + lookY * ca;

  // --- fuse spark glow (behind everything)
  const sx = 3 * k;
  const sy = -58 * k;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 26 * k);
  glow.addColorStop(0, 'rgba(255,240,170,0.85)');
  glow.addColorStop(0.35, 'rgba(255,190,60,0.35)');
  glow.addColorStop(1, 'rgba(255,140,0,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, 26 * k, 0, Math.PI * 2);
  ctx.fill();

  // --- spoon lever (behind body edge)
  if (spoon) drawSpoon(ctx, 9 * k, -44 * k, k, lw, 0);

  // --- body
  eggPath(ctx, 0, 0, k);
  ctx.fillStyle = css(pal.shadow);
  ctx.fill();
  ctx.save();
  eggPath(ctx, 0, 0, k);
  ctx.clip();
  eggPath(ctx, lx * 7 * k, ly * 7 * k, 0.97 * k);
  ctx.fillStyle = css(pal.base);
  ctx.fill();
  // hatched core shadow: body minus the lit shape
  ctx.save();
  ctx.beginPath();
  ctx.rect(-60 * k, -60 * k, 120 * k, 120 * k);
  eggPath(ctx, lx * 10 * k, ly * 10 * k, 0.95 * k, false);
  ctx.clip('evenodd');
  hatch(ctx, -40 * k, -40 * k, 40 * k, 40 * k, 5 * k, 1.3 * k, 0.5);
  ctx.restore();
  // light band + gloss
  ctx.beginPath();
  ctx.ellipse(lx * 14 * k, ly * 15 * k, 15 * k, 11 * k, Math.atan2(ly, lx) + Math.PI / 2, 0, Math.PI * 2);
  ctx.fillStyle = css(pal.light);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(lx * 19 * k, ly * 20 * k, 7.5 * k, 3.6 * k, Math.atan2(ly, lx) + Math.PI / 2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx * 10 * k + ly * 9 * k, ly * 10 * k - lx * 9 * k, 2.2 * k, 0, Math.PI * 2);
  ctx.fill();
  // pineapple grooves (embossed)
  ctx.lineCap = 'round';
  const grooves = (dx: number, dy: number, color: string, w: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    // collar band under the fuse
    ctx.beginPath();
    ctx.ellipse(dx, -44 * k + dy, 36 * k, 24 * k, 0, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    // belly band under the mouth
    ctx.beginPath();
    ctx.ellipse(dx, -2 * k + dy, 36 * k, 30 * k, 0, 0.3 * Math.PI, 0.7 * Math.PI);
    ctx.stroke();
    // side meridians
    ctx.beginPath();
    ctx.ellipse(-46 * k + dx, 3 * k + dy, 22 * k, 36 * k, 0, -0.3 * Math.PI, 0.3 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(46 * k + dx, 3 * k + dy, 22 * k, 36 * k, 0, 0.7 * Math.PI, 1.3 * Math.PI);
    ctx.stroke();
  };
  grooves(lx * 1.6 * k, ly * 1.6 * k, css(pal.light, 0.9), 1.6 * k);
  grooves(0, 0, css(INK, 0.85), 2.2 * k);
  ctx.restore();
  eggPath(ctx, 0, 0, k);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(INK);
  ctx.stroke();

  // --- face
  drawFace(ctx, k, expr, lgx, lgy);

  // --- fuse assembly
  brassPiece(ctx, -11 * k, -44 * k, 22 * k, 11 * k, lx, lw * 0.85);
  ctx.strokeStyle = css(BRASS.dark);
  ctx.lineWidth = 1.2 * k;
  for (let i = -7; i <= 7; i += 3.5) {
    ctx.beginPath();
    ctx.moveTo(i * k, -42 * k);
    ctx.lineTo(i * k, -35 * k);
    ctx.stroke();
  }
  brassPiece(ctx, -14 * k, -50 * k, 28 * k, 8 * k, lx, lw * 0.85);
  // wick
  ctx.strokeStyle = css(INK);
  ctx.lineWidth = 2.4 * k;
  ctx.beginPath();
  ctx.moveTo(0, -50 * k);
  ctx.quadraticCurveTo(-2 * k, -55 * k, sx, sy);
  ctx.stroke();
  drawSpark(ctx, sx, sy, k, sparkPhase);
  ctx.restore();
}

/** Steel safety lever; (px, py) is its hinge at the top of the fuse. */
export function drawSpoon(ctx: CanvasRenderingContext2D, px: number, py: number, k: number, lw: number, rot: number): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(-4 * k, -2 * k);
  ctx.quadraticCurveTo(14 * k, -4 * k, 20 * k, 10 * k);
  ctx.quadraticCurveTo(26 * k, 26 * k, 22 * k, 40 * k);
  ctx.lineTo(16 * k, 39 * k);
  ctx.quadraticCurveTo(19 * k, 24 * k, 13 * k, 12 * k);
  ctx.quadraticCurveTo(8 * k, 4 * k, -3 * k, 4 * k);
  ctx.closePath();
  ctx.fillStyle = css(STEEL.base);
  ctx.fill();
  ctx.lineWidth = lw * 0.85;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(INK);
  ctx.stroke();
  ctx.strokeStyle = css(STEEL.light);
  ctx.lineWidth = 1.4 * k;
  ctx.beginPath();
  ctx.moveTo(2 * k, 0);
  ctx.quadraticCurveTo(15 * k, -1 * k, 19 * k, 12 * k);
  ctx.stroke();
  ctx.restore();
}

/** Pin ring (pulled at launch). */
export function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.lineWidth = 5.2 * k;
  ctx.strokeStyle = css(INK);
  ctx.beginPath();
  ctx.ellipse(0, 0, 9 * k, 7 * k, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.6 * k;
  ctx.strokeStyle = css(STEEL.light);
  ctx.stroke();
  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, phase: number): void {
  const n = 7;
  const flick = 0.75 + 0.25 * Math.sin(phase * 1.7) * Math.sin(phase * 0.6 + 1);
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + phase * 0.21;
    const r = (i % 2 === 0 ? 10.5 : 4.2) * k * flick * (i % 4 === 0 ? 1.15 : 1);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = '#ffd23f';
  ctx.fill();
  ctx.lineWidth = 1.6 * k;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(INK);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 3 * k * flick, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

function drawFace(ctx: CanvasRenderingContext2D, k: number, expr: Expression, lgx: number, lgy: number): void {
  const uh = expr === 'uhoh';
  // blush
  ctx.fillStyle = 'rgba(255,90,120,0.55)';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * 19 * k, 11 * k, 5.5 * k, 3.2 * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // eyes
  const ery = (uh ? 10.5 : 9.5) * k;
  const erx = (uh ? 8 : 7.4) * k;
  for (const sx of [-1, 1]) {
    const ex = sx * 10 * k;
    const ey = 0;
    ctx.beginPath();
    ctx.ellipse(ex, ey, erx, ery, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2.3 * k;
    ctx.strokeStyle = css(INK);
    ctx.stroke();
    const pr = uh ? 3.2 : 4.4;
    const px = ex + lgx * 2.6 * k;
    const py = ey + lgy * 3.2 * k + 1 * k;
    ctx.beginPath();
    ctx.ellipse(px, py, pr * k, pr * 1.3 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = css(INK);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px - 1.4 * k, py - 2 * k, 1.6 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + 1.3 * k, py + 1.6 * k, 0.8 * k, 0, Math.PI * 2);
    ctx.fill();
  }
  // brows
  ctx.strokeStyle = css(INK);
  ctx.lineWidth = 3 * k;
  ctx.lineCap = 'round';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    if (uh) {
      ctx.moveTo(sx * 16 * k, -12 * k);
      ctx.quadraticCurveTo(sx * 11 * k, -16 * k, sx * 5 * k, -14.5 * k);
    } else {
      ctx.moveTo(sx * 17 * k, -13.5 * k);
      ctx.quadraticCurveTo(sx * 11 * k, -12.5 * k, sx * 5 * k, -9.5 * k);
    }
    ctx.stroke();
  }
  // mouth
  ctx.beginPath();
  if (uh) {
    ctx.ellipse(0, 15 * k, 3.6 * k, 4.6 * k, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(-7 * k, 11 * k);
    ctx.quadraticCurveTo(0, 22 * k, 7 * k, 11 * k);
    ctx.quadraticCurveTo(0, 13.5 * k, -7 * k, 11 * k);
  }
  ctx.fillStyle = '#5a1024';
  ctx.fill();
  ctx.lineWidth = 2 * k;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = css(INK);
  ctx.stroke();
  if (!uh) {
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    ctx.ellipse(1 * k, 18 * k, 4 * k, 3 * k, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6f8f';
    ctx.fill();
    ctx.restore();
  }
}

export const GRENADE_INK = INK;
