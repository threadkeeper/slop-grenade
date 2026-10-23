/**
 * The Slop Grenade "game world": owns every effect, the event director
 * (pacing bursts of messages), bullet-time and the render order.
 *
 * The desktop overlay runs the same design in `desktop/Engine/World.cs`.
 */
import { Rng, clamp01, css } from './math';
import { INK, SLOP_BLUE, SLOP_PINK, type SlopPalette } from './palette';
import { GOO_ISO, SlopLayer, type Side } from './slop';
import { drawSwirl } from './slopDraw';
import { Grenade, drawGrenade } from './grenade';
import { Explosion } from './explosion';
import { P_GLOB, P_JUICE, P_RING, P_SPOON, ParticleSystem, type Particle } from './particles';
import { SmokeField } from './smoke';
import { FlySwarm } from './flies';
import { Twinkle } from './twinkle';
import { Squeegee } from './squeegee';
import { FRUIT_FALLING, FRUIT_FLYING, FRUIT_GONE, FRUIT_STUCK, Fruit } from './fruit';
import { FruitShader, fruitJuice, fruitMesh, type FruitKind } from './fruitModels';
import { ToonRenderer } from './toon3d';

/** The five message tiers, by their engine names. */
export type EffectTier = 'human_sparkle' | 'peaceful_cloud' | 'innocent_fruit' | 'slop_splat' | 'slop_grenade';

export type SfxName =
  | 'throw'
  | 'fuse'
  | 'slowmo_in'
  | 'slowmo_out'
  | 'explosion'
  | 'splat'
  | 'cannon'
  | 'whoosh'
  | 'squelch'
  | 'smoke'
  | 'twinkle'
  | 'squeegee'
  | 'buzz';

/** Optional sound output; every call is fire-and-forget. */
export interface SfxSink {
  play(name: SfxName, pan: number, gain: number, rate?: number): void;
  /** Start/update (name != null) or stop (name == null) a looping voice. */
  loop(id: string, name: SfxName | null, pan: number, gain: number, rate?: number): void;
}

export interface WorldOptions {
  seed?: number;
  /** Seconds before flies gather on slop (default 45). */
  flyDelay?: number;
  sfx?: SfxSink | null;
}

interface Queued {
  tier: EffectTier;
  side: Side;
}

/** Goo cannonball fired by the ai-cannon tier. */
class CannonBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly r: number;
  readonly side: Side;
  readonly targetY: number;
  done = false;
  age = 0;

  constructor(side: Side, w: number, h: number, s: number, rng: Rng) {
    this.side = side;
    const inward = side === 'left' ? 1 : -1;
    this.r = 20 * s;
    this.targetY = h * rng.range(0.15, 0.75);
    this.x = w * 0.5 + inward * w * rng.range(0.1, 0.4);
    this.y = h + 40 * s;
    const T = rng.range(0.75, 0.95);
    const g = 1700 * s;
    const tx = side === 'left' ? 0 : w;
    this.vx = (tx - this.x) / T;
    this.vy = (this.targetY - this.y - 0.5 * g * T * T) / T;
  }
}

export class World {
  readonly w: number;
  readonly h: number;
  /** Art scale (1 at 1080p). */
  readonly s: number;
  readonly rng: Rng;
  readonly left: SlopLayer;
  readonly right: SlopLayer;
  readonly grenades: Grenade[] = [];
  readonly explosions: Explosion[] = [];
  readonly particles = new ParticleSystem(700);
  readonly fruits: Fruit[] = [];
  readonly cannon: CannonBall[] = [];
  readonly smoke: SmokeField;
  readonly flies: FlySwarm;
  readonly twinkles: Twinkle[] = [];
  readonly squeegees: Squeegee[] = [];
  sfx: SfxSink | null;
  /** Game clock (seconds, slowed by bullet-time). */
  now = 0;
  /** Current bullet-time factor (1 = normal speed). */
  timeScale = 1;
  private hitStop = 0;
  private shake = 0;
  private slowmoOn = false;
  private queue: Queued[] = [];
  private sinceGrenade = 99;
  private sinceFruit = 99;
  private readonly toon: ToonRenderer;
  private readonly shaders = new Map<FruitKind, FruitShader>();
  private stripCanvas: Map<Side, { c: HTMLCanvasElement | OffscreenCanvas; version: number }> = new Map();
  private smokeCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private smokeFrame = 0;

  constructor(w: number, h: number, opts: WorldOptions = {}) {
    this.w = w;
    this.h = h;
    this.s = Math.max(0.35, Math.min(2.5, h / 1080));
    this.rng = new Rng(opts.seed ?? (Date.now() & 0xffffff));
    this.left = new SlopLayer('left', SLOP_PINK, w, h, this.s);
    this.right = new SlopLayer('right', SLOP_BLUE, w, h, this.s);
    this.smoke = new SmokeField(w, h, 72);
    this.flies = new FlySwarm(opts.flyDelay ?? 45, 12);
    this.sfx = opts.sfx ?? null;
    this.toon = new ToonRenderer(Math.ceil(46 * this.s * 2.9), 2, 2.2 * Math.max(0.6, this.s));
  }

  layer(side: Side): SlopLayer {
    return side === 'left' ? this.left : this.right;
  }

  private pan(side: Side): number {
    return side === 'left' ? -0.75 : 0.75;
  }

  /** Queue an effect for a message tier on a monitor side. */
  trigger(tier: EffectTier, side: Side): void {
    // collapse huge bursts: beyond 12 queued grenades, splat directly
    if (tier === 'slop_grenade' && this.queue.filter((q) => q.tier === 'slop_grenade').length >= 12) {
      this.layer(side).addSplat(this.h * this.rng.range(0.15, 0.8), 0.8, this.rng, this.now, true);
      return;
    }
    this.queue.push({ tier, side });
  }

  /** Wipe one edge clean with the squeegee. */
  squeegee(side: Side): void {
    const L = this.layer(side);
    this.squeegees.push(new Squeegee(side, this.w, this.h, L.stripW, L.pal));
    this.sfx?.play('squeegee', this.pan(side), 0.8);
  }

  /** Stop any looping sounds (fuse hiss, fly buzz) before this world is dropped. */
  dispose(): void {
    for (const side of ['left', 'right'] as const) {
      this.sfx?.loop('fuse-' + side, null, 0, 0);
      this.sfx?.loop('buzz-' + side, null, 0, 0);
    }
  }

  /** Persistent pieces stuck to each edge (splats + stuck fruit). */
  slopCounts(): { left: number; right: number } {
    let lf = 0;
    let rf = 0;
    for (const f of this.fruits) {
      if (f.state === FRUIT_STUCK) {
        if (f.side === 'left') lf++;
        else rf++;
      }
    }
    return { left: this.left.pieceCount() + lf, right: this.right.pieceCount() + rf };
  }

  /** True when nothing is moving (render loop may sleep). */
  isIdle(): boolean {
    return (
      this.queue.length === 0 &&
      this.grenades.length === 0 &&
      this.explosions.length === 0 &&
      this.particles.items.length === 0 &&
      this.cannon.length === 0 &&
      this.twinkles.length === 0 &&
      this.squeegees.length === 0 &&
      this.flies.flies.length === 0 &&
      this.smoke.isEmpty() &&
      !this.fruits.some((f) => f.state !== FRUIT_STUCK || f.stuckT < 1.2) &&
      this.timeScale > 0.99
    );
  }

  private startNext(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const q = this.queue[i];
      if (q.tier === 'slop_grenade') {
        if (this.grenades.length >= 2 || this.sinceGrenade < 1.1) continue;
        this.queue.splice(i, 1);
        this.launchGrenade(q.side);
        return;
      }
      if (q.tier === 'innocent_fruit') {
        const flying = this.fruits.filter((f) => f.state === FRUIT_FLYING).length;
        if (flying >= 3 || this.sinceFruit < 0.45) continue;
        this.queue.splice(i, 1);
        this.tossFruit(q.side);
        return;
      }
      this.queue.splice(i, 1);
      if (q.tier === 'slop_splat') this.fireCannon(q.side);
      else if (q.tier === 'peaceful_cloud') this.plumeSmoke(q.side);
      else this.twinkle(q.side);
      return;
    }
  }

  private launchGrenade(side: Side): void {
    const pal: SlopPalette = side === 'left' ? SLOP_PINK : SLOP_BLUE;
    const g = new Grenade(side, pal, this.w, this.h, this.s, this.rng);
    this.grenades.push(g);
    this.sinceGrenade = 0;
    // the pulled pin ring tumbles away
    const ring = this.particles.spawn(P_RING);
    ring.x = g.x;
    ring.y = this.h - 10 * this.s;
    ring.vx = -g.vx * 0.15 + this.rng.range(-80, 80) * this.s;
    ring.vy = -this.rng.range(500, 700) * this.s;
    ring.gravity = 1600 * this.s;
    ring.spin = this.rng.range(-9, 9);
    ring.life = 3;
    ring.r = this.s;
    this.sfx?.play('throw', this.pan(side) * 0.3, 0.8);
  }

  private tossFruit(side: Side): void {
    const L = this.layer(side);
    let ty = this.h * this.rng.range(0.18, 0.78);
    if (L.splats.length > 0 && this.rng.chance(0.65)) {
      const sp = L.splats[this.rng.int(L.splats.length)];
      ty = sp.y + this.rng.range(-50, 60) * this.s;
    }
    this.fruits.push(new Fruit(Fruit.randomKind(this.rng), side, this.w, this.h, this.s, this.rng, ty));
    this.sinceFruit = 0;
    this.sfx?.play('whoosh', this.pan(side) * 0.4, 0.5, 0.7);
  }

  private fireCannon(side: Side): void {
    this.cannon.push(new CannonBall(side, this.w, this.h, this.s, this.rng));
    this.sfx?.play('cannon', this.pan(side) * 0.4, 0.7);
  }

  private plumeSmoke(side: Side): void {
    const y = this.h * this.rng.range(0.3, 0.88);
    const x = side === 'left' ? 2 : this.w - 2;
    const inward = side === 'left' ? 1 : -1;
    // a rolling plume: many small puffs over ~2.6s that drift in and rise
    const n = 44;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      this.emitters.push({
        t: k * 3.2 + this.rng.range(0, 0.05),
        x,
        y: y + Math.sin(k * 7) * 18 * this.s + this.rng.range(-12, 12) * this.s,
        vx: inward * this.rng.range(240, 360) * this.s * (1 - 0.35 * k),
        vy: -this.rng.range(50, 140) * this.s,
        amount: this.rng.range(0.42, 0.6) * (1 - 0.3 * k),
        soot: 0.04
      });
    }
    this.sfx?.play('smoke', this.pan(side), 0.55);
  }

  private emitters: { t: number; x: number; y: number; vx: number; vy: number; amount: number; soot: number }[] = [];

  private twinkle(side: Side): void {
    const inward = side === 'left' ? 1 : -1;
    const ex = side === 'left' ? 0 : this.w;
    const y = this.h * this.rng.range(0.12, 0.88);
    const n = 1 + this.rng.int(3);
    for (let i = 0; i < n; i++) {
      this.twinkles.push(
        new Twinkle(ex + inward * this.rng.range(16, 70) * this.s, y + this.rng.range(-40, 40) * this.s, i * this.rng.range(0.18, 0.35), this.s, this.rng)
      );
    }
    this.sfx?.play('twinkle', this.pan(side), 0.22, this.rng.range(0.9, 1.15));
  }

  private detonate(g: Grenade): void {
    const side = g.side;
    const inward = side === 'left' ? 1 : -1;
    const L = this.layer(side);
    const s = this.s;
    this.explosions.push(new Explosion(g.x, g.y, inward, s, this.rng, side === 'right'));
    L.addSplat(g.y, 1, this.rng, this.now, true);
    // slop globs: some splatter back onto the bezel, most spray inward
    for (let i = 0; i < 30; i++) {
      const p = this.particles.spawn(P_GLOB);
      const toEdge = i < 11;
      const a = toEdge ? (inward > 0 ? Math.PI : 0) + this.rng.range(-1.1, 1.1) : (inward > 0 ? 0 : Math.PI) + this.rng.range(-1.4, 1.4);
      const sp = this.rng.range(380, 1050) * s;
      p.x = g.x + inward * this.rng.range(10, 30) * s;
      p.y = g.y + this.rng.range(-20, 20) * s;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - this.rng.range(80, 280) * s;
      p.r = this.rng.range(4, 12) * s;
      p.gravity = 1300 * s;
      p.drag = 0.6;
      p.life = 4;
      p.pal = L.pal;
      p.sticky = toEdge ? (side === 'left' ? 0 : 1) : -1;
    }
    this.particles.sparks(g.x, g.y, 34, 1100 * s, s, this.rng);
    // the blast itself dumps soot + an outward push into the smoke field
    this.smoke.puff(g.x + inward * 40 * s, g.y, 90 * s, 2.4, inward * 260 * s, -120 * s, 0.85);
    this.hitStop = 0.085;
    this.shake = 1;
    this.sfx?.loop('fuse-' + side, null, 0, 0);
    this.sfx?.play('explosion', this.pan(side), 1);
  }

  private stickFruit(f: Fruit): void {
    const L = this.layer(f.side);
    f.state = FRUIT_STUCK;
    f.stuckT = 0;
    const inward = f.side === 'left' ? 1 : -1;
    // goo lip wraps the side that hit the slop
    L.addGlob(f.y + f.R * 0.2, f.R * 0.5, this.rng);
    const juice = fruitJuice(f.kind);
    for (let i = 0; i < 10; i++) {
      const p = this.particles.spawn(P_JUICE);
      const a = (inward > 0 ? 0 : Math.PI) + this.rng.range(-1.3, 1.3) - Math.PI * 0.15 * inward;
      const sp = this.rng.range(140, 420) * this.s;
      p.x = f.leadX();
      p.y = f.y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - 120 * this.s;
      p.r = this.rng.range(2.5, 5) * this.s;
      p.gravity = 1100 * this.s;
      p.life = 1.4;
      p.color = juice;
    }
    this.sfx?.play('squelch', this.pan(f.side), 0.75, this.rng.range(0.9, 1.1));
  }

  private onGlobStick(p: Particle): void {
    const side: Side = p.sticky === 0 ? 'left' : 'right';
    this.layer(side).addGlob(p.y, p.r * 1.3, this.rng);
  }

  /** Advance everything by `dtReal` wall-clock seconds. */
  update(dtReal: number): void {
    const dtR = Math.max(0, Math.min(0.05, dtReal));
    // ---- bullet time
    let target = 1;
    for (const g of this.grenades) {
      const t = g.t;
      if (t > 0.2 && t < 0.9) target = 0.28;
    }
    if (this.hitStop > 0) {
      this.hitStop -= dtR;
      this.timeScale = 0.04;
    } else {
      const rate = target < this.timeScale ? 7 : 5;
      this.timeScale += (target - this.timeScale) * (1 - Math.exp(-rate * dtR));
    }
    if (!this.slowmoOn && this.timeScale < 0.6 && this.hitStop <= 0) {
      this.slowmoOn = true;
      this.sfx?.play('slowmo_in', 0, 0.6);
    } else if (this.slowmoOn && this.timeScale > 0.7) {
      this.slowmoOn = false;
    }
    const dt = dtR * this.timeScale;
    this.now += dt;
    this.sinceGrenade += dtR;
    this.sinceFruit += dtR;
    this.shake = Math.max(0, this.shake - dtR * 2.6);

    // ---- director
    if (this.queue.length > 0) this.startNext();

    // ---- grenades
    for (const g of this.grenades) {
      const hit = g.update(dt);
      if (g.spoonAttached && g.t > 0.12) {
        g.spoonAttached = false;
        const sp = this.particles.spawn(P_SPOON);
        sp.x = g.x;
        sp.y = g.y;
        sp.vx = g.vx * 0.6 + this.rng.range(-120, 120) * this.s;
        sp.vy = g.vy * 0.5 - 200 * this.s;
        sp.gravity = 1400 * this.s;
        sp.spin = this.rng.range(-14, 14);
        sp.life = 4;
        sp.r = this.s * 1.05;
      }
      if (!hit) {
        // trail smoke + stir
        if (this.rng.chance(0.7)) this.smoke.puff(g.x, g.y - 30 * this.s, 16 * this.s, 0.16, -g.vx * 0.15, -g.vy * 0.15, 0.35);
        this.smoke.stir(g.x, g.y, 50 * this.s, g.vx, g.vy, 0.5);
        if (this.rng.chance(0.5)) this.particles.sparks(g.x + Math.sin(g.angle) * 58 * 1.55 * this.s, g.y - Math.cos(g.angle) * 58 * 1.55 * this.s, 1, 260 * this.s, this.s, this.rng);
        this.sfx?.loop('fuse-' + g.side, 'fuse', this.pan(g.side) * g.t, 0.35, Math.max(0.5, this.timeScale));
      } else {
        this.detonate(g);
      }
    }
    for (let i = this.grenades.length - 1; i >= 0; i--) if (this.grenades[i].done) this.grenades.splice(i, 1);

    // ---- explosions (cooling puffs feed the smoke)
    for (const e of this.explosions) {
      e.update(dt);
      for (const p of e.puffs) {
        const st = e.puffState(p);
        if (st.u > 0.45 && st.u < 0.95 && this.rng.chance(0.35)) this.smoke.puff(st.x, st.y, st.r * 0.6, 0.11, 0, -40 * this.s, 0.8);
      }
    }
    for (let i = this.explosions.length - 1; i >= 0; i--) if (this.explosions[i].done) this.explosions.splice(i, 1);

    // ---- cannon balls
    for (const c of this.cannon) {
      c.age += dt;
      c.vy += 1700 * this.s * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      this.smoke.stir(c.x, c.y, 40 * this.s, c.vx, c.vy, 0.4);
      const L = this.layer(c.side);
      if ((c.side === 'left' && c.x <= L.edgeX + c.r * 0.6) || (c.side === 'right' && c.x >= L.edgeX - c.r * 0.6)) {
        c.done = true;
        L.addSplat(c.y, 0.62, this.rng, this.now, false);
        const inward = c.side === 'left' ? 1 : -1;
        for (let i = 0; i < 12; i++) {
          const p = this.particles.spawn(P_GLOB);
          const a = (inward > 0 ? 0 : Math.PI) + this.rng.range(-1.2, 1.2);
          const sp = this.rng.range(200, 600) * this.s;
          p.x = c.x;
          p.y = c.y;
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp - 150 * this.s;
          p.r = this.rng.range(3, 8) * this.s;
          p.gravity = 1300 * this.s;
          p.life = 3;
          p.pal = L.pal;
        }
        this.shake = Math.max(this.shake, 0.35);
        this.sfx?.play('splat', this.pan(c.side), 0.85);
      }
    }
    for (let i = this.cannon.length - 1; i >= 0; i--) if (this.cannon[i].done) this.cannon.splice(i, 1);

    // ---- smoke emitters
    for (const em of this.emitters) {
      em.t -= dt;
      if (em.t <= 0) this.smoke.puff(em.x, em.y, 36 * this.s, em.amount, em.vx, em.vy, em.soot);
    }
    this.emitters = this.emitters.filter((e) => e.t > 0);

    // ---- particles
    this.particles.update(dt, this.w, this.h, (p) => this.onGlobStick(p));

    // ---- fruit
    for (const f of this.fruits) {
      const wasFlying = f.state === FRUIT_FLYING;
      f.update(dt, this.w, this.h);
      if (wasFlying && f.state === FRUIT_FLYING) {
        this.smoke.stir(f.x, f.y, f.R * 1.4, f.vx, f.vy, 0.6);
        const L = this.layer(f.side);
        if (L.densityAt(f.leadX(), f.y) >= GOO_ISO * 1.05) this.stickFruit(f);
      }
    }
    for (let i = this.fruits.length - 1; i >= 0; i--) if (this.fruits[i].state === FRUIT_GONE) this.fruits.splice(i, 1);

    // ---- slop layers
    this.left.update(dt);
    this.right.update(dt);

    // ---- squeegees
    for (const q of this.squeegees) {
      q.update(dtR);
      const L = this.layer(q.side);
      q.pile += L.scrapeAbove(q.y);
      this.flies.scatter(q.side, q.y, this.rng);
      for (const f of this.fruits) {
        if (f.side === q.side && f.state === FRUIT_STUCK && f.y < q.y) {
          f.state = FRUIT_FALLING;
          f.vx = (q.side === 'left' ? 1 : -1) * this.rng.range(60, 160) * this.s;
          f.vy = -this.rng.range(80, 220) * this.s;
        }
      }
      if (q.done) L.clear();
    }
    for (let i = this.squeegees.length - 1; i >= 0; i--) if (this.squeegees[i].done) this.squeegees.splice(i, 1);

    // ---- flies gather on old slop
    for (const L of [this.left, this.right]) {
      for (const sp of L.splats) {
        const age = this.now - sp.born;
        if (age < this.flies.delay) continue;
        const want = Math.min(sp.size >= 0.9 ? 4 : 2, 1 + Math.floor((age - this.flies.delay) / 18));
        if (this.flies.countFor(sp.id, L.side) < want && this.flies.canSpawn()) {
          this.flies.spawn(L.side, sp.id, L.edgeX, sp.y, this.w, this.h, this.rng);
          this.flies.armCooldown(this.rng);
        }
      }
    }
    this.flies.update(dt, this.s, this.w, this.h, this.rng, (side, y) => this.layer(side).surfaceXAt(y));
    for (const side of ['left', 'right'] as Side[]) {
      let n = 0;
      for (const f of this.flies.flies) if (f.side === side) n++;
      this.sfx?.loop('buzz-' + side, n > 0 ? 'buzz' : null, this.pan(side), Math.min(0.32, 0.08 + n * 0.05), 0.9 + n * 0.03);
    }

    // ---- twinkles
    for (const t of this.twinkles) t.update(dt);
    for (let i = this.twinkles.length - 1; i >= 0; i--) if (this.twinkles[i].done) this.twinkles.splice(i, 1);

    // ---- smoke
    this.smoke.step(dt);
  }

  private shaderFor(kind: FruitKind): FruitShader {
    let s = this.shaders.get(kind);
    if (!s) {
      s = new FruitShader(kind);
      this.shaders.set(kind, s);
    }
    return s;
  }

  /** Draw the whole scene. `make` creates offscreen canvases. */
  render(ctx: CanvasRenderingContext2D, make: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas): void {
    const s = this.s;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.save();
    if (this.shake > 0) {
      const k = this.shake * this.shake * 9 * s;
      ctx.translate(this.rng.range(-k, k), this.rng.range(-k, k));
    }
    // smoke (re-rendered every other frame)
    if (!this.smoke.isEmpty()) {
      if ((this.smokeFrame++ & 1) === 0 || !this.smokeCanvas) {
        this.smoke.render();
        if (!this.smokeCanvas) this.smokeCanvas = make(this.smoke.rw, this.smoke.rh);
        const sc = this.smokeCanvas.getContext('2d') as CanvasRenderingContext2D;
        sc.putImageData(new ImageData(this.smoke.pixels, this.smoke.rw, this.smoke.rh), 0, 0);
      }
      if (this.smoke.bx1 >= this.smoke.bx0) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(this.smokeCanvas as CanvasImageSource, 0, 0, this.smoke.rw, this.smoke.rh, 0, 0, this.w, this.h);
      }
    }
    // slop strips + swirls
    for (const L of [this.left, this.right]) {
      L.flush();
      let entry = this.stripCanvas.get(L.side);
      if (!entry) {
        entry = { c: make(L.stripW, L.viewH), version: -1 };
        this.stripCanvas.set(L.side, entry);
      }
      if (entry.version !== L.version) {
        const rows = L.takeDirtyRows();
        const sc = entry.c.getContext('2d') as CanvasRenderingContext2D;
        if (rows) {
          const img = new ImageData(L.pixels, L.stripW, L.viewH);
          sc.putImageData(img, 0, 0, 0, rows[0], L.stripW, rows[1] - rows[0] + 1);
        }
        entry.version = L.version;
      }
      if (!L.isEmpty()) ctx.drawImage(entry.c as CanvasImageSource, L.stripX, 0);
      for (const sw of L.swirls) drawSwirl(ctx, sw, L.pal, L.inward, s);
    }
    // fruit (stuck first, then flying)
    for (const pass of [0, 1]) {
      for (const f of this.fruits) {
        const stuck = f.state === FRUIT_STUCK;
        if ((pass === 0) !== stuck) continue;
        this.drawFruit(ctx, f, make);
      }
    }
    // cannon balls
    for (const c of this.cannon) {
      const sp = Math.hypot(c.vx, c.vy);
      const ang = Math.atan2(c.vy, c.vx);
      const pal = this.layer(c.side).pal;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(ang);
      ctx.strokeStyle = css(INK, 0.5);
      ctx.lineWidth = 2.5 * s;
      for (const o of [-0.6, 0, 0.6]) {
        ctx.beginPath();
        ctx.moveTo(-c.r * 1.4, o * c.r);
        ctx.lineTo(-c.r * 1.4 - Math.min(120 * s, sp * 0.08), o * c.r);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(0, 0, c.r * 1.25, c.r * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = css(pal.base);
      ctx.fill();
      ctx.lineWidth = 3 * s;
      ctx.strokeStyle = css(INK);
      ctx.stroke();
      ctx.rotate(-ang);
      ctx.beginPath();
      ctx.ellipse(-c.r * 0.35, -c.r * 0.35, c.r * 0.4, c.r * 0.22, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = css(pal.light);
      ctx.fill();
      ctx.restore();
    }
    // grenades
    for (const g of this.grenades) {
      const lx = (g.targetX - g.x) / (Math.hypot(g.targetX - g.x, g.targetY - g.y) || 1);
      const ly = (g.targetY - g.y) / (Math.hypot(g.targetX - g.x, g.targetY - g.y) || 1);
      // motion lines
      const sp = Math.hypot(g.vx, g.vy);
      if (sp > 1) {
        const nx = g.vx / sp;
        const ny = g.vy / sp;
        ctx.strokeStyle = css(INK, 0.35);
        ctx.lineCap = 'round';
        ctx.lineWidth = 3 * s;
        for (const o of [-1, 0, 1]) {
          const px = g.x - nx * 80 * s - ny * o * 30 * s;
          const py = g.y - ny * 80 * s + nx * o * 30 * s;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - nx * (50 + Math.abs(o) * -15) * s, py - ny * (50 + Math.abs(o) * -15) * s);
          ctx.stroke();
        }
      }
      drawGrenade(ctx, g.x, g.y, g.angle, 1.55 * s, g.pal, g.expression(), g.spoonAttached, g.sparkPhase, lx, ly);
    }
    for (const e of this.explosions) e.draw(ctx);
    this.particles.draw(ctx, s);
    for (const t of this.twinkles) t.draw(ctx, s);
    for (const q of this.squeegees) q.draw(ctx, s);
    this.flies.draw(ctx, s);
    ctx.restore();
  }

  private drawFruit(ctx: CanvasRenderingContext2D, f: Fruit, make: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas): void {
    const size = this.toon.size;
    if (!f.sprite) f.sprite = make(size, size);
    const c = f.sprite as HTMLCanvasElement;
    if (f.needsRender()) {
      f.updateRotation();
      this.toon.render(fruitMesh(f.kind), f.rot, f.R, this.shaderFor(f.kind));
      (c.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(this.toon.out, size, size), 0, 0);
      f.renderedAngle = f.angle;
    }
    const sq = f.squish();
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(sq, 2 - sq);
    ctx.drawImage(c as CanvasImageSource, -size / 2, -size / 2);
    ctx.restore();
    if (f.state === FRUIT_STUCK) {
      // goo lip over the contact side so it looks embedded
      const L = this.layer(f.side);
      const inward = L.inward;
      const k = clamp01(f.stuckT / 0.25);
      ctx.beginPath();
      ctx.ellipse(f.x - inward * f.R * 0.78, f.y + f.R * 0.25, f.R * 0.42 * k, f.R * 0.62 * k, inward * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = css(L.pal.base);
      ctx.fill();
      ctx.lineWidth = 2.4 * this.s;
      ctx.strokeStyle = css(INK);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(f.x - inward * f.R * 0.86, f.y + f.R * 0.05, f.R * 0.12 * k, f.R * 0.2 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = css(L.pal.light);
      ctx.fill();
    }
  }
}
