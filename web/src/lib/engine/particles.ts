/**
 * Lightweight particle pool for sparks, slop globs, flying grenade parts and
 * juice droplets. Mirrored in `desktop/Effects/Particles.cs`.
 */
import { css, type Rng } from './math';
import { INK, type SlopPalette } from './palette';
import { drawRing, drawSpoon } from './grenade';

export const P_SPARK = 0;
export const P_GLOB = 1;
export const P_SPOON = 2;
export const P_RING = 3;
export const P_JUICE = 4;
export const P_EMBER = 5;

export class Particle {
  kind = 0;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  r = 1;
  rot = 0;
  spin = 0;
  age = 0;
  life = 1;
  gravity = 0;
  drag = 0;
  color = 0xffffff;
  pal: SlopPalette | null = null;
  /** -1 none, 0 left edge, 1 right edge (globs stick to the edge they hit). */
  sticky = -1;
  dead = false;
}

export class ParticleSystem {
  readonly items: Particle[] = [];
  private readonly max: number;

  constructor(max = 700) {
    this.max = max;
  }

  spawn(kind: number): Particle {
    const p = new Particle();
    p.kind = kind;
    if (this.items.length >= this.max) this.items.shift();
    this.items.push(p);
    return p;
  }

  /** Emits `n` spark streaks from (x, y). */
  sparks(x: number, y: number, n: number, speed: number, s: number, motionScale: number, rng: Rng, dirX = 0, dirY = 0, spread = Math.PI): void {
    const base = Math.atan2(dirY, dirX);
    for (let i = 0; i < n; i++) {
      const p = this.spawn(P_SPARK);
      const a = dirX === 0 && dirY === 0 ? rng.range(0, Math.PI * 2) : base + rng.range(-spread, spread);
      const v = speed * rng.range(0.35, 1);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.life = rng.range(0.25, 0.7);
      p.gravity = 900 * motionScale;
      p.drag = 2.2;
      p.r = rng.range(1.2, 2.4) * s;
      p.color = rng.chance(0.5) ? 0xffffff : 0xffd23f;
    }
  }

  /**
   * Advance particles. `viewW/viewH` cull off-screen ones; `onStick` is called
   * when a sticky glob reaches its edge (returns nothing; glob is removed).
   */
  update(dt: number, viewW: number, viewH: number, onStick: (p: Particle) => void): void {
    for (const p of this.items) {
      if (p.dead) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.dead = true;
        continue;
      }
      const dk = Math.exp(-p.drag * dt);
      p.vx *= dk;
      p.vy = p.vy * dk + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.sticky === 0 && p.x - p.r <= 0) {
        p.x = 0;
        onStick(p);
        p.dead = true;
      } else if (p.sticky === 1 && p.x + p.r >= viewW) {
        p.x = viewW;
        onStick(p);
        p.dead = true;
      } else if (p.y - p.r * 4 > viewH || p.x < -200 || p.x > viewW + 200) {
        p.dead = true;
      }
    }
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (!this.items[i].dead) this.items[w++] = this.items[i];
    }
    this.items.length = w;
  }

  draw(ctx: CanvasRenderingContext2D, s: number): void {
    for (const p of this.items) {
      const u = p.age / p.life;
      switch (p.kind) {
        case P_SPARK:
        case P_EMBER: {
          const len = Math.min(26 * s, Math.hypot(p.vx, p.vy) * 0.03);
          const nx = p.vx / (Math.hypot(p.vx, p.vy) || 1);
          const ny = p.vy / (Math.hypot(p.vx, p.vy) || 1);
          ctx.strokeStyle = css(p.color, 1 - u * u);
          ctx.lineWidth = p.r * (1 - u * 0.6);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - nx * len, p.y - ny * len);
          ctx.stroke();
          break;
        }
        case P_GLOB:
        case P_JUICE: {
          const sp = Math.hypot(p.vx, p.vy);
          const stretch = 1 + Math.min(0.9, sp / (1400 * s));
          const ang = Math.atan2(p.vy, p.vx);
          const base = p.pal ? p.pal.base : p.color;
          const light = p.pal ? p.pal.light : 0xffffff;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r * stretch, p.r / Math.sqrt(stretch), 0, 0, Math.PI * 2);
          ctx.fillStyle = css(base);
          ctx.fill();
          ctx.lineWidth = Math.max(1.2, p.r * 0.32);
          ctx.strokeStyle = css(INK);
          ctx.stroke();
          ctx.rotate(-ang);
          ctx.beginPath();
          ctx.ellipse(-p.r * 0.32, -p.r * 0.34, p.r * 0.3, p.r * 0.2, -0.6, 0, Math.PI * 2);
          ctx.fillStyle = css(light);
          ctx.fill();
          ctx.restore();
          break;
        }
        case P_SPOON: {
          ctx.save();
          ctx.translate(p.x, p.y);
          drawSpoon(ctx, -10 * p.r, -20 * p.r, p.r, 3.1 * p.r, p.rot);
          ctx.restore();
          break;
        }
        case P_RING:
          drawRing(ctx, p.x, p.y, p.r, p.rot);
          break;
      }
    }
  }
}
