import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStage } from './index';
import { ANDROID_CANVAS_PIXEL_BUDGET, stageQuality } from './quality';

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 3 });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function canvasFor(size: { width: number; height: number }): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getBoundingClientRect: () => size,
    getContext: () => ({ clearRect: vi.fn() })
  } as unknown as HTMLCanvasElement;
}

describe('Android graphics quality', () => {
  it('renders a typical three-times-density phone at native resolution without changing effect scale', () => {
    const size = { width: 360, height: 800 };
    const baselineCanvas = canvasFor(size);
    const baseline = runStage(baselineCanvas, {}, 1);
    const canvas = canvasFor(size);
    const quality = stageQuality(true, 1);
    const stage = runStage(canvas, {}, quality.maxDpr, quality.maxPixels);
    expect([canvas.width, canvas.height]).toEqual([1080, 2400]);
    expect(stage.world.s / 3).toBeCloseTo(baseline.world.s, 8);
    expect(stage.world.motionScale / 3).toBeCloseTo(baseline.world.motionScale, 8);
    stage.stop();
    baseline.stop();
  });

  it('caps very large Android canvases and re-applies the budget after resizing', () => {
    vi.stubGlobal('window', { devicePixelRatio: 4 });
    const size = { width: 360, height: 800 };
    const canvas = canvasFor(size);
    const quality = stageQuality(true, 1);
    const stage = runStage(canvas, {}, quality.maxDpr, quality.maxPixels);
    expect([canvas.width, canvas.height]).toEqual([1080, 2400]);
    stage.world.trigger('slop_grenade', 'left');
    size.width = 800;
    size.height = 1600;
    stage.resize();
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(ANDROID_CANVAS_PIXEL_BUDGET);
    expect(canvas.width).toBeGreaterThan(size.width);
    expect(canvas.height).toBeGreaterThan(size.height);
    expect(canvas.width / canvas.height).toBeCloseTo(size.width / size.height, 3);
    stage.world.update(0.05);
    expect(stage.world.grenades).toHaveLength(1);
    stage.stop();
  });

  it.each([0, -1, 4095, 1.5, Number.NaN])('rejects invalid pixel budgets: %s', (budget) => {
    expect(() => runStage(canvasFor({ width: 360, height: 800 }), {}, 3, budget)).toThrow(RangeError);
  });

  it('retains the existing desktop overlay and preview density limits', () => {
    expect(stageQuality(false, 1)).toEqual({ maxDpr: 1, maxPixels: Infinity });
    expect(stageQuality(false, 2)).toEqual({ maxDpr: 2, maxPixels: Infinity });
    expect(stageQuality(true, 2)).toEqual({ maxDpr: 3, maxPixels: ANDROID_CANVAS_PIXEL_BUDGET });
  });
});
