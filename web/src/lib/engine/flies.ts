/**
 * Flies that gather around slop left on screen too long. They wander, orbit,
 * occasionally land on the goo to "groom", and scatter when it is squeegeed.
 * Mirrored in `desktop/Effects/Flies.cs`.
 */
import { css, type Rng } from './math';
import { INK } from './palette';

export const FLY_ARRIVING = 0;
export const FLY_BUZZING = 1;
export const FLY_LANDED = 2;
export const FLY_LEAVING = 3;

export class Fly {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  state = FLY_ARRIVING;
  side: 'left' | 'right' = 'left';
  splatId = 0;
  homeX = 0;
  homeY = 0;
  timer = 0;
  jitterT = 0;
  jx = 0;
  jy = 0;
  phase = 0;
  wing = 0;
  landX = 0;
  landY = 0;
  facing = 1;
  dead = false;
}

export class FlySwarm {
  readonly flies: Fly[] = [];
  /** Seconds a splat must sit before flies start to arrive. */
  delay: number;
  readonly maxFlies: number;
  private cooldown = 0;

  constructor(delaySeconds: number, maxFlies = 12) {
    this.delay = delaySeconds;
    this.maxFlies = maxFlies;
  }

  countFor(splatId: number, side: string): number {
    let n = 0;
    for (const f of this.flies) if (f.splatId === splatId && f.side === side && f.state !== FLY_LEAVING) n++;
    return n;
  }

  /** Flies for this splat id and side should scatter. */
  scatter(side: 'left' | 'right', aboveY: number, rng: Rng): void {
    for (const f of this.flies) {
      if (f.side !== side || f.state === FLY_LEAVING) continue;
      if (f.homeY > aboveY + 60) continue;
      f.state = FLY_LEAVING;
      const a = rng.range(0.25, 1.3);
      const sp = rng.range(520, 820);
      f.vx = (side === 'left' ? 1 : -1) * Math.cos(a) * sp;
      f.vy = -Math.sin(a) * sp;
    }
  }

  /**
   * Maybe spawn a fly heading for (homeX, homeY). Caller decides eligibility.
   */
  spawn(side: 'left' | 'right', splatId: number, homeX: number, homeY: number, viewW: number, viewH: number, rng: Rng): void {
    const f = new Fly();
    f.side = side;
    f.splatId = splatId;
    f.homeX = homeX;
    f.homeY = homeY;
    const fromTop = rng.chance(0.5);
    f.x = fromTop ? homeX + (side === 'left' ? 1 : -1) * rng.range(100, 500) : side === 'left' ? rng.range(200, 600) : viewW - rng.range(200, 600);
    f.y = fromTop ? -30 : viewH + 30;
    f.phase = rng.range(0, 100);
    f.state = FLY_ARRIVING;
    this.flies.push(f);
  }

  /** Whether the global spawn cooldown has elapsed. */
  canSpawn(): boolean {
    return this.cooldown <= 0 && this.flies.length < this.maxFlies;
  }

  armCooldown(rng: Rng): void {
    this.cooldown = rng.range(3, 7);
  }

  update(dt: number, s: number, viewW: number, viewH: number, rng: Rng, surfaceX: (side: 'left' | 'right', y: number) => number | null): void {
    this.cooldown -= dt;
    for (const f of this.flies) {
      f.phase += dt;
      f.wing += dt * 60;
      if (f.state === FLY_LEAVING) {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.x < -80 || f.x > viewW + 80 || f.y < -80 || f.y > viewH + 80) f.dead = true;
        continue;
      }
      if (f.state === FLY_LANDED) {
        f.timer -= dt;
        f.x = f.landX;
        f.y = f.landY;
        if (f.timer <= 0) {
          f.state = FLY_BUZZING;
          f.vy = -260 * s;
          f.vx = (f.side === 'left' ? 1 : -1) * 180 * s;
        }
        continue;
      }
      // erratic buzzing: orbit target + jittery bursts
      f.jitterT -= dt;
      if (f.jitterT <= 0) {
        f.jitterT = rng.range(0.08, 0.32);
        const a = rng.range(0, Math.PI * 2);
        const m = rng.range(500, 1300) * s;
        f.jx = Math.cos(a) * m;
        f.jy = Math.sin(a) * m;
      }
      const inward = f.side === 'left' ? 1 : -1;
      const ox = Math.cos(f.phase * 1.7) * 70 * s + Math.sin(f.phase * 0.63) * 40 * s;
      const oy = Math.sin(f.phase * 2.3) * 55 * s + Math.cos(f.phase * 0.91) * 30 * s;
      const tx = f.homeX + inward * (60 * s + Math.abs(ox)) ;
      const ty = f.homeY + oy;
      const ax = (tx - f.x) * 7 + f.jx - f.vx * 2.4;
      const ay = (ty - f.y) * 7 + f.jy - f.vy * 2.4;
      f.vx += ax * dt;
      f.vy += ay * dt;
      const sp = Math.hypot(f.vx, f.vy);
      const max = 420 * s;
      if (sp > max) {
        f.vx *= max / sp;
        f.vy *= max / sp;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (Math.abs(f.vx) > 30 * s) f.facing = f.vx > 0 ? 1 : -1;
      if (f.state === FLY_ARRIVING && Math.hypot(tx - f.x, ty - f.y) < 140 * s) f.state = FLY_BUZZING;
      if (f.state === FLY_BUZZING && rng.chance(0.18 * dt)) {
        const ly = f.homeY + rng.range(-50, 70) * s;
        const sx = surfaceX(f.side, ly);
        if (sx !== null) {
          f.state = FLY_LANDED;
          f.landX = sx - inward * 3 * s;
          f.landY = ly;
          f.timer = rng.range(1.8, 5.5);
          f.facing = rng.sign();
        }
      }
    }
    let w = 0;
    for (let i = 0; i < this.flies.length; i++) if (!this.flies[i].dead) this.flies[w++] = this.flies[i];
    this.flies.length = w;
  }

  draw(ctx: CanvasRenderingContext2D, s: number): void {
    for (const f of this.flies) drawFly(ctx, f, s);
  }
}

/** Cute cartoon fly: glossy body, big red eyes, blurred flapping wings. */
export function drawFly(ctx: CanvasRenderingContext2D, f: Fly, s: number): void {
  const k = s * 1.55;
  const landed = f.state === FLY_LANDED;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.scale(f.facing, 1);
  const tilt = landed ? 0 : Math.max(-0.5, Math.min(0.5, f.vy * 0.0012));
  ctx.rotate(tilt);
  // wings (ghosted when flapping)
  const flap = landed ? 0.15 : Math.sin(f.wing) * 0.7;
  for (let gi = 0; gi < (landed ? 1 : 2); gi++) {
    const a = gi === 0 ? flap : -flap * 0.6;
    const al = gi === 0 ? 0.55 : 0.25;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(-1 * k, -3 * k);
      ctx.rotate(-0.55 + a * side * 0.6 + (side < 0 ? -0.25 : 0.1));
      ctx.beginPath();
      ctx.ellipse(-6 * k, -2 * k, 7.5 * k, 3.6 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(214,236,255,${al})`;
      ctx.fill();
      ctx.lineWidth = 1 * k;
      ctx.strokeStyle = css(INK, al + 0.15);
      ctx.stroke();
      ctx.restore();
    }
  }
  // legs when landed
  if (landed) {
    ctx.strokeStyle = css(INK);
    ctx.lineWidth = 1.1 * k;
    const rub = Math.sin(f.phase * 14) * 1.5 * k;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 3 * k, 3 * k);
      ctx.lineTo(i * 4.5 * k + (i === 1 ? rub : 0), 7 * k);
      ctx.stroke();
    }
  }
  // body
  ctx.beginPath();
  ctx.ellipse(-2 * k, 0, 6.5 * k, 4.6 * k, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2f3a';
  ctx.fill();
  ctx.lineWidth = 1.5 * k;
  ctx.strokeStyle = css(INK);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-3.5 * k, -1.8 * k, 3 * k, 1.5 * k, -0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#5ad07a';
  ctx.fill();
  // stripes
  ctx.strokeStyle = 'rgba(10,10,14,0.7)';
  ctx.lineWidth = 1 * k;
  for (const sx of [-5, -2]) {
    ctx.beginPath();
    ctx.moveTo(sx * k, -3.6 * k);
    ctx.quadraticCurveTo((sx + 1) * k, 0, sx * k, 3.6 * k);
    ctx.stroke();
  }
  // head + big eyes
  ctx.beginPath();
  ctx.arc(5 * k, -0.5 * k, 3.4 * k, 0, Math.PI * 2);
  ctx.fillStyle = '#20242c';
  ctx.fill();
  ctx.stroke();
  for (const ey of [-2.2, 1.4]) {
    ctx.beginPath();
    ctx.arc(6.4 * k, ey * k, 2.3 * k, 0, Math.PI * 2);
    ctx.fillStyle = '#d0283a';
    ctx.fill();
    ctx.lineWidth = 0.9 * k;
    ctx.strokeStyle = css(INK);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(5.8 * k, (ey - 0.8) * k, 0.8 * k, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.restore();
}
