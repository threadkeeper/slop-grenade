/**
 * Crystal glint for genuinely human messages: a bright four-point star with
 * a thin ink outline and a warm halo, so it reads on light and dark windows.
 * Mirrored in `desktop/Effects/Twinkle.cs`.
 */
import type { Rng } from './math';

export class Twinkle {
  x: number;
  y: number;
  age: number;
  readonly life: number;
  readonly size: number;
  readonly rot: number;
  readonly spin: number;
  done = false;

  /** `s` is the screen scale (1 at 1080p); `lead` glints are the big ones. */
  constructor(x: number, y: number, delay: number, s: number, rng: Rng, lead = true) {
    this.x = x;
    this.y = y;
    this.age = -delay;
    this.life = rng.range(1.0, 1.35);
    this.size = (lead ? rng.range(26, 34) : rng.range(14, 20)) * s;
    this.rot = rng.range(-0.3, 0.3);
    this.spin = rng.range(0.5, 1.1) * rng.sign();
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age > this.life) this.done = true;
  }

  /** 0..1 brightness: quick flare, short hold, soft fade. */
  envelope(): number {
    if (this.age <= 0 || this.age >= this.life) return 0;
    const u = this.age / this.life;
    if (u < 0.18) {
      const k = u / 0.18;
      return k * k * (3 - 2 * k);
    }
    if (u < 0.45) return 1;
    const k = (u - 0.45) / 0.55;
    return 1 - k * k * (3 - 2 * k);
  }

  /** Half-size of the area this glint can touch (for redraw bounds). */
  extent(): number {
    return this.size * 1.25 + 4;
  }

  draw(ctx: CanvasRenderingContext2D, s: number): void {
    const e = this.envelope();
    if (e <= 0.01) return;
    const L = this.size * (0.55 + 0.45 * e);
    ctx.save();
    ctx.translate(this.x, this.y);
    // warm halo
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, L * 1.05);
    halo.addColorStop(0, `rgba(255,252,230,${(0.75 * e).toFixed(3)})`);
    halo.addColorStop(0.35, `rgba(255,214,110,${(0.35 * e).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(255,214,110,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, L * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(this.rot + this.age * this.spin);
    // star: four long points, four short diagonal points, pinched waist
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const r = k % 2 === 0 ? L : L * 0.5;
      const wa = a + Math.PI / 8;
      const wr = L * 0.21;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(wa) * wr, Math.sin(wa) * wr);
    }
    ctx.closePath();
    const fill = ctx.createRadialGradient(0, 0, 0, 0, 0, L);
    fill.addColorStop(0, `rgba(255,255,255,${e.toFixed(3)})`);
    fill.addColorStop(0.45, `rgba(255,246,196,${e.toFixed(3)})`);
    fill.addColorStop(1, `rgba(255,205,80,${e.toFixed(3)})`);
    ctx.fillStyle = fill;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.2, 1.6 * s);
    ctx.strokeStyle = `rgba(27,20,32,${(0.65 * e).toFixed(3)})`;
    ctx.stroke();
    ctx.fill();
    // prismatic glints at the long tips
    const tips = ['rgba(120,230,255,A)', 'rgba(255,140,230,A)'];
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * L * 0.72, Math.sin(a) * L * 0.72, Math.max(1, 1.5 * s), 0, Math.PI * 2);
      ctx.fillStyle = tips[k % 2].replace('A', (0.9 * e).toFixed(3));
      ctx.fill();
    }
    // hot white core
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1.4, L * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${e.toFixed(3)})`;
    ctx.fill();
    ctx.restore();
  }
}
