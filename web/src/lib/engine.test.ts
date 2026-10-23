import { describe, expect, it } from 'vitest';
import { World, type EffectTier, type SfxName, type SfxSink } from './engine/world';
import { FRUIT_KINDS, fruitMesh } from './engine/fruitModels';
import { FRUIT_STUCK } from './engine/fruit';
import { FLY_LEAVING } from './engine/flies';
import { Rng } from './engine/math';
import { synthAll } from './engine/sfxSynth';

class RecordingSfx implements SfxSink {
  played: SfxName[] = [];
  loops = new Map<string, SfxName>();
  play(name: SfxName): void {
    this.played.push(name);
  }
  loop(id: string, name: SfxName | null): void {
    if (name) this.loops.set(id, name);
    else this.loops.delete(id);
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
  it('lobs a grenade in slow motion and splatters slop on the receiving (left) edge only', () => {
    const sfx = new RecordingSfx();
    const world = new World(1920, 1080, { seed: 7, sfx });
    fire(world, 'slop_grenade', 'left');
    let minScale = 1;
    run(world, 7, (w) => (minScale = Math.min(minScale, w.timeScale)));
    expect(minScale).toBeLessThan(0.4);
    const counts = world.slopCounts();
    expect(counts.left).toBeGreaterThan(0);
    expect(counts.right).toBe(0);
    expect(sfx.played).toContain('throw');
    expect(sfx.played).toContain('explosion');
    // back to normal speed once the bang is over
    expect(world.timeScale).toBeGreaterThan(0.95);
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
    expect(boom).toBeGreaterThan(rms(all.twinkle) * 3);
  }, 30000);
});
