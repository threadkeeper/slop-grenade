/**
 * Comic-book detonation: hit flash, inked starburst, cel-shaded fireball puffs
 * that cool into hatched soot, shockwave ring, speed lines and an onomatopoeia.
 * Mirrored in `desktop/Effects/Explosion.cs`.
 */
import { clamp01, css, easeOutBack, easeOutCubic, smoothstep, type Rng } from './math';
import { INK, heatColor } from './palette';
import { hatch } from './ink';

export interface Puff {
  dx: number;
  dy: number;
  d0: number;
  d1: number;
  r0: number;
  r1: number;
  delay: number;
  life: number;
}

const WORDS_IN = ['SPLAT!', 'KA-SPLORT!', 'BLAMMO!', 'SPLOOSH!', 'KER-SLOP!'];
const WORDS_OUT = ['OOPS!', 'SELF-SLOP!', 'KA-BLOOEY!', 'YIKES!', 'SPLAT!'];

export class Explosion {
  readonly x: number;
  readonly y: number;
  readonly inward: number;
  readonly s: number;
  age = 0;
  done = false;
  readonly puffs: Puff[] = [];
  readonly spikes: number[] = [];
  readonly word: string;
  readonly wordRot: number;
  readonly size: number;

  constructor(x: number, y: number, inward: number, s: number, rng: Rng, outgoing: boolean, size = 1) {
    this.x = x;
    this.y = y;
    this.inward = inward;
    this.s = s;
    this.size = size;
    const n = Math.round(13 * size) + 3;
    for (let i = 0; i < n; i++) {
      // fan inward (the bezel is behind the blast)
      const a = (inward > 0 ? 0 : Math.PI) + rng.range(-1.9, 1.9);
      const core = i < 4;
      this.puffs.push({
        dx: Math.cos(a),
        dy: Math.sin(a),
        d0: core ? 0 : rng.range(10, 30) * s,
        d1: (core ? rng.range(20, 60) : rng.range(80, 175)) * s * size,
        r0: rng.range(16, 28) * s * size,
        r1: (core ? rng.range(78, 100) : rng.range(44, 72)) * s * size,
        delay: core ? rng.range(0, 0.04) : rng.range(0.02, 0.16),
        life: core ? rng.range(0.9, 1.2) : rng.range(1.1, 1.7)
      });
    }
    // draw cool (late) puffs first, hot core on top
    this.puffs.sort((p, q) => q.delay - p.delay || p.r1 - q.r1);
    for (let i = 0; i < 16; i++) this.spikes.push(rng.range(0.78, 1.25));
    const words = outgoing ? WORDS_OUT : WORDS_IN;
    this.word = words[rng.int(words.length)];
    this.wordRot = rng.range(-0.14, 0.1);
  }

  update(dt: number): void {
    this.age += dt;
    if (this.age > 2.3) this.done = true;
  }

  /** Approximate radius of influence (for dirty rects / smoke injection). */
  radius(): number {
    return 300 * this.s * this.size;
  }

  /** Positions of cooling puffs that should feed the fluid smoke. */
  puffState(p: Puff): { x: number; y: number; r: number; heat: number; alpha: number; u: number } {
    const u = clamp01((this.age - p.delay) / p.life);
    const grow = easeOutCubic(Math.min(1, u * 2.4));
    const r = (p.r0 + (p.r1 - p.r0) * grow) * (1 - 0.3 * smoothstep(0.55, 1, u));
    const d = p.d0 + (p.d1 - p.d0) * easeOutCubic(u);
    const rise = u * u * 70 * this.s;
    return {
      x: this.x + p.dx * d,
      y: this.y + p.dy * d - rise,
      r,
      heat: 1 - smoothstep(0.12, 0.92, u),
      alpha: 1 - smoothstep(0.62, 0.96, u),
      u
    };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.s * this.size;
    const a = this.age;
    // radial speed lines
    if (a < 0.32) {
      const k = a / 0.32;
      ctx.strokeStyle = css(INK, 0.85 * (1 - k));
      ctx.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        const ang = (i / 18) * Math.PI * 2 + 0.17;
        const r1 = (120 + 160 * easeOutCubic(k)) * s;
        const r2 = r1 + (60 + (i % 3) * 30) * s * (1 - k);
        ctx.lineWidth = (i % 2 === 0 ? 4 : 2.4) * this.s;
        ctx.beginPath();
        ctx.moveTo(this.x + Math.cos(ang) * r1, this.y + Math.sin(ang) * r1);
        ctx.lineTo(this.x + Math.cos(ang) * r2, this.y + Math.sin(ang) * r2);
        ctx.stroke();
      }
    }
    // shockwave
    if (a < 0.45) {
      const k = a / 0.45;
      const rr = (40 + 280 * easeOutCubic(k)) * s;
      ctx.lineWidth = 9 * this.s * (1 - k);
      ctx.strokeStyle = css(0xffffff, 0.9 * (1 - k));
      ctx.beginPath();
      ctx.arc(this.x, this.y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    // fireball puffs
    for (const p of this.puffs) {
      if (a < p.delay) continue;
      const st = this.puffState(p);
      if (st.alpha <= 0.01 || st.r < 1) continue;
      this.drawPuff(ctx, st.x, st.y, st.r, st.heat, st.alpha, st.u);
    }
    // starburst flash
    if (a < 0.24) {
      const k = a / 0.24;
      const R = 150 * s * easeOutBack(Math.min(1, a / 0.1));
      const alpha = 1 - smoothstep(0.55, 1, k);
      ctx.beginPath();
      const n = this.spikes.length;
      for (let i = 0; i < n * 2; i++) {
        const ang = (i / (n * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? R * this.spikes[i >> 1] : R * 0.48;
        const px = this.x + Math.cos(ang) * r;
        const py = this.y + Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = css(0xfff3a6, alpha);
      ctx.fill();
      ctx.lineJoin = 'miter';
      ctx.lineWidth = 5 * this.s;
      ctx.strokeStyle = css(INK, alpha);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.x, this.y, R * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = css(0xffffff, alpha);
      ctx.fill();
    }
    this.drawWord(ctx);
  }

  private drawPuff(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, heat: number, alpha: number, u: number): void {
    const base = heatColor(heat);
    const shadow = heatColor(heat - 0.28);
    const light = heatColor(Math.min(1, heat + 0.3));
    const lw = (3.6 - 2 * u) * this.s;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = css(shadow, alpha);
    ctx.fill();
    ctx.clip();
    ctx.beginPath();
    ctx.arc(x - r * 0.16, y - r * 0.2, r * 0.9, 0, Math.PI * 2);
    ctx.fillStyle = css(base, alpha);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.34, y - r * 0.38, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = css(light, alpha);
    ctx.fill();
    if (u > 0.35) {
      // soot hatching in the shadow side as it cools
      ctx.beginPath();
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.arc(x - r * 0.16, y - r * 0.2, r * 0.9, 0, Math.PI * 2);
      ctx.clip('evenodd');
      hatch(ctx, x - r, y - r, x + r, y + r, 5.5 * this.s, 1.4 * this.s, 0.45 * alpha);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = css(INK, alpha * 0.95);
    ctx.stroke();
  }

  private drawWord(ctx: CanvasRenderingContext2D): void {
    const a = this.age - 0.06;
    if (a <= 0 || a > 1.35) return;
    const pop = easeOutBack(Math.min(1, a / 0.28));
    const fade = 1 - smoothstep(1.0, 1.35, a);
    const size = 64 * this.s * this.size;
    ctx.save();
    ctx.translate(this.x + this.inward * 210 * this.s, this.y - 120 * this.s - a * 18 * this.s);
    ctx.rotate(this.wordRot);
    ctx.scale(pop, pop);
    ctx.font = `italic 900 ${size}px Impact, 'Arial Black', 'Bahnschrift', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // extruded ink shadow
    ctx.fillStyle = css(INK, fade);
    ctx.fillText(this.word, 5 * this.s, 6 * this.s);
    ctx.lineWidth = 9 * this.s;
    ctx.strokeStyle = css(INK, fade);
    ctx.strokeText(this.word, 0, 0);
    const g = ctx.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    g.addColorStop(0, css(0xffffff, fade));
    g.addColorStop(0.35, css(0xffe24a, fade));
    g.addColorStop(1, css(0xff7a1a, fade));
    ctx.fillStyle = g;
    ctx.fillText(this.word, 0, 0);
    ctx.restore();
  }
}
