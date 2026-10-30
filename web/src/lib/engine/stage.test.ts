import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStage } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('stage reset', () => {
  it('clears the canvas immediately and leaves the existing animation loop and preferences intact', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const clearRect = vi.fn();
    const canvas = {
      getBoundingClientRect: () => ({ width: 400, height: 240 }),
      getContext: () => ({ clearRect })
    } as unknown as HTMLCanvasElement;
    const stage = runStage(canvas, { flyDelay: 3 });
    const world = stage.world;
    world.trigger('slop_grenade', 'left');
    stage.reset();
    expect(clearRect).toHaveBeenCalledExactlyOnceWith(0, 0, 400, 240);
    expect(stage.world).toBe(world);
    expect(world.flies.delay).toBe(3);
    expect(world.isIdle()).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    stage.stop();
    expect(cancel).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('preserves queued and scheduled animations across a substantial resize', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let width = 400;
    const canvas = {
      getBoundingClientRect: () => ({ width, height: 240 }),
      getContext: () => ({ clearRect: vi.fn() })
    } as unknown as HTMLCanvasElement;
    const stage = runStage(canvas);
    stage.world.trigger('slop_grenade', 'left');
    stage.world.triggerLater(1, 'human_sparkle', 'right');
    stage.world.update(0.05);
    stage.world.trigger('slop_grenade', 'left');
    const previous = stage.world;
    width = 800;
    stage.resize();
    expect(stage.world).not.toBe(previous);
    stage.world.update(0.05);
    expect(stage.world.grenades).toHaveLength(1);
    for (let i = 0; i < 10; i++) stage.world.update(0.05);
    expect(stage.world.twinkles).toHaveLength(0);
    for (let i = 0; i < 11; i++) stage.world.update(0.05);
    expect(stage.world.twinkles.length).toBeGreaterThan(0);
    stage.stop();
  });
});
