/**
 * A 3D fruit tumbling across the screen in slow motion about a random axis.
 * It only sticks if it actually hits slop on the edge; otherwise it sails off.
 * Mirrored in `desktop/Effects/Fruit.cs`.
 */
import type { Rng } from './math';
import { axisAngle, mul3 } from './toon3d';
import { FRUIT_KINDS, type FruitKind } from './fruitModels';

export const FRUIT_FLYING = 0;
export const FRUIT_STUCK = 1;
export const FRUIT_FALLING = 2;
export const FRUIT_GONE = 3;

export class Fruit {
  readonly kind: FruitKind;
  readonly side: 'left' | 'right';
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly gravity: number;
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly omega: number;
  angle = 0;
  /** Display radius of the fruit body (px). */
  readonly R: number;
  state = FRUIT_FLYING;
  stuckT = 0;
  /** Rotation used for the last sprite render (NaN = never). */
  renderedAngle = Number.NaN;
  readonly base = new Float32Array(9);
  readonly rot = new Float32Array(9);
  private readonly tmp = new Float32Array(9);
  /** Opaque renderer-side sprite handle. */
  sprite: unknown = null;

  constructor(kind: FruitKind, side: 'left' | 'right', viewW: number, viewH: number, s: number, rng: Rng, targetY: number) {
    this.kind = kind;
    this.side = side;
    this.R = 46 * s;
    const inward = side === 'left' ? 1 : -1;
    const edge = side === 'left' ? 0 : viewW;
    // lobbed from below the far half of the screen in a lazy arc
    this.x = viewW * 0.5 + inward * viewW * rng.range(0.05, 0.35);
    this.y = viewH + this.R * 1.6;
    const T = rng.range(4.6, 6.2);
    this.gravity = 120 * s;
    // aim a little past the edge so it exits cleanly if nothing catches it
    const tx = edge - inward * this.R * 0.2;
    this.vx = (tx - this.x) / T;
    this.vy = (targetY - this.y - 0.5 * this.gravity * T * T) / T;
    // random tumble axis (uniform on the sphere)
    const z = rng.range(-1, 1);
    const t = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(1 - z * z);
    this.ax = r * Math.cos(t);
    this.ay = r * Math.sin(t);
    this.az = z;
    this.omega = rng.range(0.5, 0.95) * rng.sign();
    // random starting orientation
    axisAngle(0, 1, 0, rng.range(0, Math.PI * 2), this.tmp);
    axisAngle(1, 0, 0, rng.range(-0.7, 0.7), this.base);
    mul3(this.base, this.tmp, this.base);
    this.updateRotation();
  }

  static randomKind(rng: Rng): FruitKind {
    return FRUIT_KINDS[rng.int(FRUIT_KINDS.length)];
  }

  updateRotation(): void {
    axisAngle(this.ax, this.ay, this.az, this.angle, this.tmp);
    mul3(this.tmp, this.base, this.rot);
  }

  /** Leading point facing the target edge (for goo hit tests). */
  leadX(): number {
    return this.x - (this.side === 'left' ? 1 : -1) * this.R * 0.82;
  }

  /** Squash/stretch scale while settling into the goo. */
  squish(): number {
    if (this.state !== FRUIT_STUCK) return 1;
    return 1 + 0.16 * Math.exp(-5 * this.stuckT) * Math.sin(this.stuckT * 19);
  }

  update(dt: number, viewW: number, viewH: number): void {
    if (this.state === FRUIT_FLYING) {
      this.vy += this.gravity * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.angle += this.omega * dt;
      if (this.x < -this.R * 1.6 || this.x > viewW + this.R * 1.6 || this.y > viewH + this.R * 3) this.state = FRUIT_GONE;
    } else if (this.state === FRUIT_STUCK) {
      this.stuckT += dt;
    } else if (this.state === FRUIT_FALLING) {
      this.vy += 1500 * (this.R / 40) * dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.angle += this.omega * 6 * dt;
      if (this.y > viewH + this.R * 2) this.state = FRUIT_GONE;
    }
  }

  /** Needs a fresh sprite render (rotation moved ~2.6 degrees). */
  needsRender(): boolean {
    return Number.isNaN(this.renderedAngle) || Math.abs(this.angle - this.renderedAngle) > 0.045;
  }
}
