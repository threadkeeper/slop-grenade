/**
 * Slop Grenade effects engine (browser build).
 * `World` runs the simulation; `runStage` drives it on a canvas.
 */
export { World, type EffectTier, type SfxName, type SfxSink, type WorldOptions } from './world';
export { WebAudioSfx } from './audio';
export type { Side } from './slop';

import { World, type EffectTier, type WorldOptions } from './world';
import type { Side } from './slop';

/** One live event to replay on a stage (from the daemon's event stream). */
export interface StageCue {
  seq: number;
  side: Side;
  tier?: EffectTier;
  squeegee?: boolean;
}

export interface Stage {
  world: World;
  /** Re-create the world for a new canvas size (keeps nothing). */
  resize(): void;
  reset(): void;
  stop(): void;
}

/**
 * Drive a World on a canvas with requestAnimationFrame. The loop idles
 * (no drawing) when nothing on screen is moving.
 */
export function runStage(canvas: HTMLCanvasElement, opts: WorldOptions = {}, maxDpr = 2, maxPixels = Infinity): Stage {
  if (maxPixels !== Infinity && (!Number.isSafeInteger(maxPixels) || maxPixels < 4096)) {
    throw new RangeError('maxPixels must be at least 4096 or Infinity.');
  }
  const make = (w: number, h: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const size = (): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const area = Math.max(1, r.width) * Math.max(1, r.height);
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1, Math.sqrt(maxPixels / area));
    let width = Math.max(64, Math.round(r.width * dpr));
    let height = Math.max(64, Math.round(r.height * dpr));
    if (width * height > maxPixels) {
      const factor = Math.sqrt(maxPixels / (width * height));
      width = Math.max(64, Math.floor(width * factor));
      height = Math.max(64, Math.floor(height * factor));
      if (width * height > maxPixels) {
        if (width > height) width = Math.max(64, Math.floor(maxPixels / height));
        else height = Math.max(64, Math.floor(maxPixels / width));
      }
    }
    return [width, height];
  };
  let [w, h] = size();
  canvas.width = w;
  canvas.height = h;
  const stage: Stage = {
    world: new World(w, h, opts),
    reset() {
      stage.world.reset();
      ctx.clearRect(0, 0, w, h);
      wasIdle = false;
    },
    resize() {
      const [nw, nh] = size();
      // small layout shifts just stretch the canvas; only a real size change
      // rebuilds the world (which clears what is on screen)
      const aspectChanged = Number.isFinite(maxPixels) && Math.abs(nw / nh - w / h) > (w / h) * 0.01;
      if (!aspectChanged && Math.abs(nw - w) < w * 0.25 && Math.abs(nh - h) < h * 0.25) return;
      w = nw;
      h = nh;
      canvas.width = w;
      canvas.height = h;
      const sfx = stage.world.sfx;
      const replacement = new World(w, h, { ...opts, sfx });
      stage.world.transferPendingTo(replacement);
      stage.world.dispose();
      stage.world = replacement;
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      stage.world.dispose();
    }
  };
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let running = true;
  let last = performance.now();
  let raf = 0;
  let wasIdle = false;
  const frame = (t: number) => {
    if (!running) return;
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const world = stage.world;
    world.update(dt);
    const idle = world.isIdle() && !world.left.pending && !world.right.pending;
    if (!idle || !wasIdle) world.render(ctx, make);
    wasIdle = idle;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return stage;
}
