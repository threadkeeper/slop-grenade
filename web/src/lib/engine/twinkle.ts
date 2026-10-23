/**
 * Barely-there crystal glints for genuinely human messages: a brief
 * multi-faceted sparkle with faint prismatic fringes. Mirrored in
 * `desktop/Effects/Twinkle.cs`.
 */
import type { Rng } from './math';

export class Twinkle {
  x: number;
  y: number;
  age: number;
  readonly life: number;
  readonly size: number;
  readonly rot: number;
  done = false;

  constructor(x: number, y: number, delay: number, s: number, rng: Rng) {
    this.x = x;
    this.y = y;
    this.age = -delay;
    this.life = rng.range(0.55, 0.8);
    this.size = rng.range(9, 15) * s;
    this.rot = rng.range(-0.25, 0.25);
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age > this.life) this.done = true;
  }

  /** 0..1 brightness envelope: sharp rise, sharp fall. */
  envelope(): number {
    if (this.age <= 0 || this.age >= this.life) return 0;
    const u = this.age / this.life;
    const e = Math.sin(Math.PI * u);
    return e * e * e;
  }

  draw(ctx: CanvasRenderingContext2D, s: number): void {
    const e = this.envelope();
    if (e <= 0.01) return;
    const L = this.size * (0.55 + 0.45 * e);
    const peak = 0.55 * e;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot + this.age * 0.6);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, L * 0.5);
    glow.addColorStop(0, `rgba(255,255,255,${(peak * 0.7).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, L * 0.5, 0, Math.PI * 2);
    ctx.fill();
    const ray = (len: number, wid: number, ang: number, color: string, alpha: number, off: number): void => {
      ctx.save();
      ctx.rotate(ang);
      ctx.translate(off, 0);
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(0, -wid);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, wid);
      ctx.closePath();
      ctx.fillStyle = color.replace('A', alpha.toFixed(3));
      ctx.fill();
      ctx.restore();
    };
    // prismatic fringes (cyan / magenta) then the white core rays
    for (const ang of [0, Math.PI / 2]) {
      ray(L, 1.3 * s, ang, 'rgba(120,230,255,A)', peak * 0.35, 0.9 * s);
      ray(L, 1.3 * s, ang, 'rgba(255,140,230,A)', peak * 0.35, -0.9 * s);
      ray(L, 1.1 * s, ang, 'rgba(255,255,255,A)', peak, 0);
    }
    for (const ang of [Math.PI / 4, -Math.PI / 4]) ray(L * 0.42, 0.8 * s, ang, 'rgba(255,255,255,A)', peak * 0.7, 0);
    ctx.beginPath();
    ctx.arc(0, 0, 1.3 * s, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, peak * 1.6).toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }
}
