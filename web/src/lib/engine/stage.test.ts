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
});
