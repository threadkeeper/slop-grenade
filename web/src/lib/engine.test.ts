import { describe, expect, it, vi } from 'vitest';
import { World, type EffectTier, type SfxName, type SfxSink } from './engine/world';
import { FRUIT_KINDS, fruitMesh } from './engine/fruitModels';
import { FRUIT_STUCK } from './engine/fruit';
import { FLY_LEAVING } from './engine/flies';
import { Rng } from './engine/math';
import { synthAll } from './engine/sfxSynth';

class RecordingSfx implements SfxSink {
  played: SfxName[] = [];
  loops = new Map<string, SfxName>();
  fuseRates: number[] = [];
  stopped = 0;
  stopAll(): void {
    this.played.length = 0;
    this.loops.clear();
    ++this.stopped;
  }
  play(name: SfxName): void {
    this.played.push(name);
  }
  loop(id: string, name: SfxName | null, _pan: number, _gain: number, rate = 1): void {
    if (name) this.loops.set(id, name);
    else this.loops.delete(id);
    if (name === 'fuse') this.fuseRates.push(rate);
  }
}

/** Step the world like the render loop does (update, then re-shade goo). */
function run(world: World, seconds: number, onFrame?: (w: World) => void): void {
  const dt = 1 / 60;
  let frame = 0;
  for (let t = 0; t < seconds; t += dt) {
    world.update(dt);
    // re-shading every other frame is plenty for collision checks
    if ((frame++ & 1) === 0) {
      world.left.flush();
      world.right.flush();
    }
    onFrame?.(world);
  }
}

function fire(world: World, tier: EffectTier, side: 'left' | 'right', times = 1): void {
  for (let i = 0; i < times; i++) world.trigger(tier, side);
}

function activeFlies(world: World): number {
  return world.flies.flies.filter((f) => f.state !== FLY_LEAVING).length;
}

describe('Slop Grenade effects engine', () => {
  it('limits mixed across-screen effects, lets sparkles pass, and drains the queue', () => {
    const sfx = new RecordingSfx();
    const world = new World(400, 240, { seed: 19, sfx, maxAcrossScreenAnimations: 2 });
    for (const tier of ['slop_grenade', 'slop_splat', 'innocent_fruit', 'peaceful_cloud', 'human_sparkle'] as const) {
      world.trigger(tier, tier === 'slop_grenade' || tier === 'peaceful_cloud' ? 'left' : 'right');
    }
    for (let i = 0; i < 10; i++) {
      world.update(0.01);
      expect(world.activeAcrossScreenAnimations).toBeLessThanOrEqual(world.maxAcrossScreenAnimations);
    }
    expect(sfx.played).toContain('twinkle');
    expect(sfx.played).not.toContain('whoosh');
    expect(sfx.played).not.toContain('smoke');
    for (let i = 0; i < 600 && (!sfx.played.includes('whoosh') || !sfx.played.includes('smoke')); i++) {
      world.update(0.05);
      expect(world.activeAcrossScreenAnimations).toBeLessThanOrEqual(world.maxAcrossScreenAnimations);
    }
    expect(sfx.played).toContain('whoosh');
    expect(sfx.played).toContain('smoke');
    world.reset();
    expect(world.activeAcrossScreenAnimations).toBe(0);
    world.trigger('peaceful_cloud', 'left');
    world.update(0.01);
    expect(world.activeAcrossScreenAnimations).toBe(1);
  }, 30000);

  it('queues and eventually launches more than twelve grenades without immediate splats', () => {
    const sfx = new RecordingSfx();
    const world = new World(400, 240, { seed: 23, sfx, maxAcrossScreenAnimations: 2 });
    fire(world, 'slop_grenade', 'left', 13);
    expect(world.left.splats).toHaveLength(0);
    for (let i = 0; i < 1200 && sfx.played.filter((name) => name === 'throw').length < 13; i++) {
      world.update(0.05);
      expect(world.activeAcrossScreenAnimations).toBeLessThanOrEqual(world.maxAcrossScreenAnimations);
    }
    expect(sfx.played.filter((name) => name === 'throw')).toHaveLength(13);
  }, 30000);

  it('counts each cloud emission, caps it by logical processors, and releases slots before smoke clears', () => {
    for (const limit of [1, 2, 4]) {
      const sfx = new RecordingSfx();
      const world = new World(400, 240, { seed: 27, sfx, maxAcrossScreenAnimations: limit });
      fire(world, 'peaceful_cloud', 'left', 4);
      for (let i = 0; i < 10; i++) world.update(0.01);
      expect(world.activeAcrossScreenAnimations).toBe(world.maxAcrossScreenAnimations);
      expect(world.maxAcrossScreenAnimations).toBeLessThanOrEqual(limit);
      for (let i = 0; i < 500 &&
        (sfx.played.filter((name) => name === 'smoke').length < 4 || world.activeAcrossScreenAnimations > 0); i++) {
        world.update(0.05);
        expect(world.activeAcrossScreenAnimations).toBeLessThanOrEqual(world.maxAcrossScreenAnimations);
      }
      expect(sfx.played.filter((name) => name === 'smoke')).toHaveLength(4);
      expect(world.activeAcrossScreenAnimations).toBe(0);
      expect(world.smoke.isEmpty()).toBe(false);
    }
    expect(() => new World(400, 240, { maxAcrossScreenAnimations: 0 })).toThrow(RangeError);
    expect(() => new World(400, 240, { maxAcrossScreenAnimations: 1.5 })).toThrow(RangeError);
  }, 30000);

  it('uses the reported processor count, or one when unavailable', () => {
    try {
      vi.stubGlobal('navigator', { hardwareConcurrency: 1 });
      expect(new World(400, 240, { maxAcrossScreenAnimations: 4 }).maxAcrossScreenAnimations).toBe(1);
      vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
      expect(new World(400, 240).maxAcrossScreenAnimations).toBe(2);
      vi.stubGlobal('navigator', undefined);
      expect(new World(400, 240).maxAcrossScreenAnimations).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses a half-resolution smoke grid that still produces visible pixels', () => {
    const world = new World(1920, 1080, { seed: 27 });
    expect(world.smoke.ny).toBe(36);
    expect(world.smoke.rh).toBe(108);
    world.trigger('peaceful_cloud', 'left');
    let visible = false;
    for (let i = 0; i < 180; i++) {
      world.update(0.05);
      world.smoke.render();
      visible ||= world.smoke.bx1 >= world.smoke.bx0;
    }
    expect(visible).toBe(true);
  });

  it('reduces effect artwork by 30% without changing grenade gravity', () => {
    const world = new World(1920, 1080, { seed: 19 });
    expect(world.s).toBeCloseTo(0.42 * 0.7, 8);
    expect(world.flyDrawScale).toBeCloseTo(0.65 * 0.5, 8);
    world.trigger('slop_grenade', 'left');
    world.trigger('human_sparkle', 'right');
    world.update(0.01);
    world.update(0.01);
    expect(world.grenades[0].gravity).toBeCloseTo(1500 * 0.42, 8);
    expect(world.twinkles[0].size).toBeGreaterThanOrEqual(26 * 0.7);
    expect(world.twinkles[0].size).toBeLessThanOrEqual(34 * 0.7);
    expect(world.particles.items[0].gravity).toBeCloseTo(1600 * 0.42, 8);
    world.reset();
    world.trigger('innocent_fruit', 'right');
    world.update(0.01);
    expect(world.fruits[0].gravity).toBeCloseTo(1100 * 0.42, 8);
    world.reset();
    world.trigger('slop_splat', 'right');
    world.update(0.01);
    const cannon = world.cannon[0];
    expect(cannon).toBeDefined();
    const vy = cannon.vy;
    world.update(0.01);
    expect(cannon.vy - vy).toBeCloseTo(1700 * 0.42 * 0.01, 8);
  });

  it('immediately resets airborne and ten queued grenades, sticky residue and sounds without recreating old splats', () => {
    const sfx = new RecordingSfx();
    const world = new World(400, 240, { seed: 7, flyDelay: 3, sfx });
    for (const tier of ['slop_grenade', 'slop_splat', 'innocent_fruit', 'peaceful_cloud', 'human_sparkle'] as const) {
      world.trigger(tier, 'left');
      world.update(0.05);
    }
    fire(world, 'slop_grenade', 'left', 10);
    world.triggerLater(10, 'slop_grenade', 'right');
    world.left.addSplat(90, 1, world.rng, 0, true);
    world.right.addSplat(120, 1, world.rng, 0, true);
    world.squeegee('left');
    expect(world.grenades).toHaveLength(1);
    expect(world.isIdle()).toBe(false);
    world.reset();
    expect(sfx.stopped).toBe(1);
    expect(sfx.loops.size).toBe(0);
    expect(world.sfx).toBe(sfx);
    expect(world.flies.delay).toBe(3);
    expect(world.slopCounts()).toEqual({ left: 0, right: 0 });
    expect(world.smoke.isEmpty()).toBe(true);
    expect(world.isIdle()).toBe(true);
    run(world, 20);
    expect(world.isIdle()).toBe(true);
    expect(world.slopCounts()).toEqual({ left: 0, right: 0 });
    expect(sfx.played).toEqual([]);
    world.trigger('human_sparkle', 'right');
    world.update(0.05);
    expect(world.twinkles.length).toBeGreaterThan(0);
  });

  it('runs the entire world at normal speed through grenade flight and impact', () => {
    const sfx = new RecordingSfx();
    const world = new World(1920, 1080, { seed: 7, sfx });
    fire(world, 'slop_grenade', 'left');
    fire(world, 'innocent_fruit', 'right');
    let sawLateFlight = false;
    let sawImpact = false;
    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) {
      const before = world.now;
      const grenade = world.grenades[0];
      const grenadeAge = grenade?.age;
      const explosion = world.explosions[0];
      const explosionAge = explosion?.age;
      world.update(dt);
      expect(world.now - before).toBeCloseTo(dt, 8);
      if (grenade && grenadeAge !== undefined) expect(grenade.age - grenadeAge).toBeCloseTo(dt, 8);
      if (explosion && explosionAge !== undefined) expect(explosion.age - explosionAge).toBeCloseTo(dt, 8);
      if (world.grenades.some((g) => g.t > 0.8)) sawLateFlight = true;
      if (sfx.played.includes('explosion')) sawImpact = true;
    }
    expect(sawLateFlight).toBe(true);
    expect(sawImpact).toBe(true);
    const counts = world.slopCounts();
    expect(counts.left).toBeGreaterThan(0);
    expect(counts.right).toBe(0);
    expect(sfx.played).toContain('throw');
    expect(sfx.played).toContain('explosion');
    expect(sfx.played.some((name) => name.startsWith('slowmo'))).toBe(false);
    expect(sfx.fuseRates.length).toBeGreaterThan(0);
    expect(sfx.fuseRates.every((rate) => rate === 1)).toBe(true);
  }, 30000);

  it('fires the ai-cannon at the sending (right) edge', () => {
    const world = new World(1920, 1080, { seed: 11 });
    fire(world, 'slop_splat', 'right');
    run(world, 5);
    const counts = world.slopCounts();
    expect(counts.right).toBeGreaterThan(0);
    expect(counts.left).toBe(0);
  }, 30000);

  it('lets fruit tumble straight past a clean edge without sticking', () => {
    const world = new World(1920, 1080, { seed: 3 });
    fire(world, 'innocent_fruit', 'left', 3);
    fire(world, 'innocent_fruit', 'right', 3);
    let sawFruit = false;
    let spun = false;
    run(world, 25, (w) => {
      for (const f of w.fruits) {
        sawFruit = true;
        if (Math.abs(f.angle) > 1) spun = true;
        expect(f.state).not.toBe(FRUIT_STUCK);
      }
    });
    expect(sawFruit).toBe(true);
    expect(spun).toBe(true);
    expect(world.fruits.length).toBe(0);
    expect(world.slopCounts()).toEqual({ left: 0, right: 0 });
  }, 30000);

  it('sticks fruit only when it hits slop', () => {
    const world = new World(1280, 720, { seed: 5 });
    const rng = new Rng(99);
    // coat the whole left edge in goo
    for (let y = 40; y < 700; y += 60) world.left.addSplat(y, 1.2, rng, 0, false);
    world.left.flush();
    fire(world, 'innocent_fruit', 'left', 3);
    fire(world, 'innocent_fruit', 'right', 1);
    run(world, 16);
    const stuck = world.fruits.filter((f) => f.state === FRUIT_STUCK);
    expect(stuck.length).toBeGreaterThan(0);
    expect(stuck.every((f) => f.side === 'left')).toBe(true);
  }, 30000);

  it('squeegees one edge clean and leaves the other alone', () => {
    const world = new World(1280, 720, { seed: 13 });
    fire(world, 'slop_grenade', 'left');
    fire(world, 'slop_splat', 'right');
    run(world, 9);
    expect(world.slopCounts().left).toBeGreaterThan(0);
    expect(world.slopCounts().right).toBeGreaterThan(0);
    world.squeegee('left');
    run(world, 5);
    expect(world.slopCounts().left).toBe(0);
    expect(world.slopCounts().right).toBeGreaterThan(0);
  }, 30000);

  it('draws flies to slop that is left alone, and they leave when it is wiped', () => {
    const world = new World(1920, 1080, { seed: 17, flyDelay: 3 });
    fire(world, 'slop_splat', 'left');
    run(world, 2);
    expect(activeFlies(world)).toBe(0);
    run(world, 12);
    expect(activeFlies(world)).toBeGreaterThan(0);
    world.squeegee('left');
    run(world, 8);
    expect(activeFlies(world)).toBe(0);
  }, 30000);

  it('lets smoke plumes and crystal twinkles fade out completely', () => {
    const world = new World(1280, 720, { seed: 19 });
    fire(world, 'peaceful_cloud', 'left');
    fire(world, 'human_sparkle', 'right');
    run(world, 2);
    expect(world.isIdle()).toBe(false);
    run(world, 40);
    expect(world.isIdle()).toBe(true);
    expect(world.slopCounts()).toEqual({ left: 0, right: 0 });
  }, 30000);

  it('models 20 distinct 3D fruit with no text labels', () => {
    expect(FRUIT_KINDS.length).toBe(20);
    expect(new Set(FRUIT_KINDS).size).toBe(20);
    for (const kind of FRUIT_KINDS) {
      const mesh = fruitMesh(kind);
      expect(mesh.triCount).toBeGreaterThan(100);
    }
    const world = new World(1280, 720, { seed: 23 });
    fire(world, 'innocent_fruit', 'left');
    run(world, 1);
    const f = world.fruits[0];
    expect(f).toBeDefined();
    expect('label' in f || 'name' in f).toBe(false);
  }, 30000);

  it('synthesises clean sound effects with a loud explosion', () => {
    const all = synthAll();
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);
    for (const [name, data] of Object.entries(all)) {
      expect(data.length, name).toBeGreaterThan(1000);
      let peak = 0;
      for (const v of data) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, name).toBeLessThanOrEqual(1);
    }
    const boom = rms(all.explosion);
    expect(boom).toBeGreaterThan(rms(all.splat));
    expect(boom).toBeGreaterThan(rms(all.twinkle) * 2);
  }, 30000);
});
