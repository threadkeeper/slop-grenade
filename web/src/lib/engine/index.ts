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
  stop(): void;
}

/**
 * Drive a World on a canvas with requestAnimationFrame. The loop idles
 * (no drawing) when nothing on screen is moving.
 */
export function runStage(canvas: HTMLCanvasElement, opts: WorldOptions = {}, maxDpr = 2): Stage {
  const make = (w: number, h: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const size = (): [number, number] => {
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    return [Math.max(64, Math.round(r.width * dpr)), Math.max(64, Math.round(r.height * dpr))];
  };
  let [w, h] = size();
  canvas.width = w;
  canvas.height = h;
  const stage: Stage = {
    world: new World(w, h, opts),
    resize() {
      const [nw, nh] = size();
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      canvas.width = w;
      canvas.height = h;
      const sfx = stage.world.sfx;
      stage.world.dispose();
      stage.world = new World(w, h, { ...opts, sfx });
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
