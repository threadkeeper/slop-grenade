/**
 * Procedural sound effects (no audio files ship with the app). The palette is
 * soft and quiet, in the spirit of early Macintosh games: simple sine and
 * triangle tones with pitch glides, gentle filtered noise, a 22 kHz
 * "sample-and-hold" grain and a low-pass so nothing is harsh. Every effect is a
 * mono Float32Array at 44.1 kHz. The desktop overlay ports these recipes 1:1
 * in `desktop/Audio/SfxBank.cs`.
 */
export const SAMPLE_RATE = 44100;

/** Deterministic white noise. */
class Noise {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  white(): number {
    // xorshift32
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return (x / 4294967296) * 2 - 1;
  }
  uni(): number {
    return (this.white() + 1) * 0.5;
  }
}

/** RBJ biquad with per-sample coefficient updates kept cheap by the caller. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  set(type: 'lp' | 'hp' | 'bp', freq: number, q: number): void {
    const f = Math.min(freq, SAMPLE_RATE * 0.45);
    const w = (2 * Math.PI * f) / SAMPLE_RATE;
    const cw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lp') {
      b0 = (1 - cw) / 2;
      b1 = 1 - cw;
      b2 = (1 - cw) / 2;
    } else if (type === 'hp') {
      b0 = (1 + cw) / 2;
      b1 = -(1 + cw);
      b2 = (1 + cw) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function buffer(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

/** Normalise to `peak` with a gentle tanh glue (`drive` 0 = linear). */
function finish(out: Float32Array, peak: number, drive: number): Float32Array {
  if (drive > 0) {
    const k = Math.tanh(drive);
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * drive) / k;
  }
  let m = 0;
  for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
  if (m > 0) {
    const g = peak / m;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
  // 4 ms fade in/out to avoid clicks
  const f = Math.min(out.length >> 1, Math.round(SAMPLE_RATE * 0.004));
  for (let i = 0; i < f; i++) {
    out[i] *= i / f;
    out[out.length - 1 - i] *= i / f;
  }
  return out;
}


type Wave = 'sine' | 'tri' | 'square';

function osc(wave: Wave, ph: number): number {
  const u = ph / (2 * Math.PI) - Math.floor(ph / (2 * Math.PI));
  if (wave === 'sine') return Math.sin(ph);
  if (wave === 'tri') return u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
  return u < 0.5 ? 1 : -1;
}

/**
 * Add a tone gliding exponentially from f0 to f1 over `dur` seconds.
 * Envelope: linear attack, then (1 - t/dur)^decay.
 */
function tone(out: Float32Array, start: number, dur: number, f0: number, f1: number, wave: Wave, amp: number, attack: number, decay: number): void {
  const s0 = Math.round(start * SAMPLE_RATE);
  const n = Math.round(dur * SAMPLE_RATE);
  let ph = 0;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const u = t / dur;
    const f = f0 * Math.pow(f1 / f0, u);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    const env = Math.min(1, t / attack) * Math.pow(1 - u, decay);
    out[s0 + i] += osc(wave, ph) * env * amp;
  }
}

/** Add low-passed noise whose cutoff glides from c0 to c1 (Hz). */
function hush(out: Float32Array, start: number, dur: number, c0: number, c1: number, amp: number, attack: number, decay: number, nz: Noise): void {
  const s0 = Math.round(start * SAMPLE_RATE);
  const n = Math.round(dur * SAMPLE_RATE);
  const lp = new Biquad();
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const u = t / dur;
    if ((i & 31) === 0) lp.set('lp', c0 * Math.pow(c1 / c0, u), 0.7);
    const env = Math.min(1, t / attack) * Math.pow(1 - u, decay);
    out[s0 + i] += lp.run(nz.white()) * env * amp;
  }
}

/** Early-Mac grain: hold every other sample (22 kHz) then soften with a low-pass. */
function retro(out: Float32Array, cutoff: number): Float32Array {
  for (let i = 1; i < out.length; i += 2) out[i] = out[i - 1];
  const a = new Biquad();
  const b = new Biquad();
  a.set('lp', cutoff, 0.7);
  b.set('lp', cutoff, 0.7);
  for (let i = 0; i < out.length; i++) out[i] = b.run(a.run(out[i]));
  return out;
}

/** The grenade: a round, soft "pomf" with a little cartoon pop at the end. */
export function synthExplosion(seed = 7): Float32Array {
  const out = buffer(1.3);
  const nz = new Noise(seed);
  tone(out, 0, 0.9, 150, 42, 'sine', 1.0, 0.003, 1.6);
  hush(out, 0, 1.1, 2600, 160, 0.75, 0.004, 2.2, nz);
  tone(out, 0.2, 0.12, 330, 220, 'tri', 0.22, 0.004, 1.2);
  tone(out, 0.34, 0.14, 262, 175, 'tri', 0.18, 0.004, 1.2);
  return finish(retro(out, 4200), 0.78, 0.6);
}

/** Pin pulled and tossed: a light rising "whee". */
export function synthThrow(): Float32Array {
  const out = buffer(0.34);
  tone(out, 0, 0.32, 330, 880, 'tri', 0.8, 0.01, 1.4);
  tone(out, 0.02, 0.28, 660, 1320, 'sine', 0.15, 0.01, 2);
  return finish(retro(out, 5000), 0.45, 0);
}

/** Fuse: a gentle clock tick (loops). */
export function synthFuse(seed = 13): Float32Array {
  const out = buffer(0.54);
  const nz = new Noise(seed);
  for (let k = 0; k < 6; k++) tone(out, k / 12, 0.018, 1800, 1500, 'tri', 0.6, 0.001, 2);
  hush(out, 0, 0.54, 2200, 2200, 0.05, 0.001, 0, nz);
  return loopify(finish(retro(out, 5000), 0.3, 0), 0.04);
}

/** Bullet-time: a soft two-note "woo" falling a fourth. */
export function synthSlowmoIn(): Float32Array {
  const out = buffer(0.5);
  tone(out, 0, 0.48, 880, 330, 'sine', 0.7, 0.03, 1.5);
  tone(out, 0, 0.48, 660, 247, 'sine', 0.4, 0.03, 1.5);
  return finish(retro(out, 4500), 0.4, 0);
}

/** Goo landing: a round "plop". */
export function synthSplat(seed = 19): Float32Array {
  const out = buffer(0.22);
  const nz = new Noise(seed);
  tone(out, 0, 0.2, 600, 150, 'sine', 1, 0.002, 2);
  hush(out, 0, 0.05, 1800, 600, 0.25, 0.001, 2, nz);
  return finish(retro(out, 4000), 0.55, 0);
}

/** AI cannon: a soft "pomp". */
export function synthCannon(seed = 23): Float32Array {
  const out = buffer(0.32);
  const nz = new Noise(seed);
  tone(out, 0, 0.26, 260, 90, 'tri', 0.9, 0.003, 1.8);
  hush(out, 0, 0.18, 1400, 300, 0.4, 0.002, 2, nz);
  return finish(retro(out, 3800), 0.5, 0);
}

/** Fruit tossed: a breathy swish. */
export function synthWhoosh(seed = 29): Float32Array {
  const out = buffer(0.4);
  const nz = new Noise(seed);
  const bp = new Biquad();
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length;
    if ((i & 31) === 0) bp.set('bp', 500 * Math.pow(3.2, u), 1.2);
    out[i] = bp.run(nz.white()) * Math.sin(Math.PI * u);
  }
  return finish(retro(out, 4500), 0.3, 0);
}

/** Fruit sticks in the goo: two little bloops. */
export function synthSquelch(): Float32Array {
  const out = buffer(0.3);
  tone(out, 0, 0.13, 420, 160, 'sine', 1, 0.002, 1.6);
  tone(out, 0.09, 0.16, 340, 120, 'sine', 0.8, 0.002, 1.6);
  return finish(retro(out, 4000), 0.5, 0);
}

/** Smoke rolling in: a quiet airy "fooo". */
export function synthSmoke(seed = 37): Float32Array {
  const out = buffer(0.85);
  const nz = new Noise(seed);
  const lp = new Biquad();
  lp.set('lp', 900, 0.7);
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length;
    const e = Math.sin(Math.PI * u);
    out[i] = lp.run(nz.white()) * e * e;
  }
  tone(out, 0.05, 0.7, 196, 165, 'sine', 0.12, 0.15, 1);
  return finish(retro(out, 3500), 0.28, 0);
}

/** Crystal twinkle: a three-note bell arpeggio (E6, G#6, B6). */
export function synthTwinkle(): Float32Array {
  const out = buffer(0.85);
  const notes = [1318.5, 1661.2, 1975.5];
  notes.forEach((f, k) => {
    tone(out, k * 0.09, 0.6, f, f, 'sine', 0.6, 0.002, 3);
    tone(out, k * 0.09, 0.3, f * 2.76, f * 2.76, 'sine', 0.12, 0.002, 4);
  });
  return finish(retro(out, 7000), 0.4, 0);
}

/** Squeegee: rubbery squeak-squeak-squeak. */
export function synthSqueegee(): Float32Array {
  const out = buffer(0.62);
  tone(out, 0, 0.12, 1100, 1450, 'tri', 0.7, 0.01, 0.8);
  tone(out, 0.17, 0.12, 1150, 1500, 'tri', 0.7, 0.01, 0.8);
  tone(out, 0.34, 0.24, 1200, 900, 'tri', 0.6, 0.01, 1.2);
  return finish(retro(out, 3000), 0.35, 0);
}

/** Flies: a soft, low hum with a lazy wobble (loops). */
export function synthBuzz(): Float32Array {
  const out = buffer(1.04);
  const lp = new Biquad();
  lp.set('lp', 700, 0.7);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const f = 175 + 6 * Math.sin(2 * Math.PI * 4 * t) + 3 * Math.sin(2 * Math.PI * 11 * t);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    out[i] = lp.run(osc('tri', ph) * (0.85 + 0.15 * Math.sin(2 * Math.PI * 9 * t)));
  }
  return loopify(finish(retro(out, 2500), 0.25, 0), 0.04);
}

/** Crossfades the tail into the head so the buffer loops without a click. */
function loopify(x: Float32Array, seconds: number): Float32Array {
  const n = Math.round(seconds * SAMPLE_RATE);
  const out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    out[i] = x[i] * k + x[x.length - n + i] * (1 - k);
  }
  return out;
}

/** All effects keyed by the names the World uses. */
export function synthAll(): Record<string, Float32Array> {
  return {
    explosion: synthExplosion(),
    throw: synthThrow(),
    fuse: synthFuse(),
    slowmo_in: synthSlowmoIn(),
    splat: synthSplat(),
    cannon: synthCannon(),
    whoosh: synthWhoosh(),
    squelch: synthSquelch(),
    smoke: synthSmoke(),
    twinkle: synthTwinkle(),
    squeegee: synthSqueegee(),
    buzz: synthBuzz()
  };
}
