/**
 * Procedural sound effects (no audio files ship with the app). Every effect is
 * synthesised into a mono Float32Array at 44.1 kHz from noise, oscillators and
 * filters. The desktop overlay ports these recipes 1:1 in `desktop/Audio/SfxBank.cs`.
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

/** Add a pitch-dropping "bloop" (wet slop bubble). */
function bloop(out: Float32Array, start: number, f0: number, f1: number, dur: number, amp: number): void {
  const s0 = Math.round(start * SAMPLE_RATE);
  const n = Math.round(dur * SAMPLE_RATE);
  let ph = 0;
  for (let i = 0; i < n && s0 + i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const f = f1 + (f0 - f1) * Math.exp(-t * 26);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    const env = Math.sin(Math.min(1, t / 0.004) * Math.PI * 0.5) * Math.exp(-t * (6 / dur));
    out[s0 + i] += Math.sin(ph) * env * amp;
  }
}

/** The big one: sub thump, crack, roaring body, crackle debris, wet gloops, rumble tail. */
export function synthExplosion(seed = 7): Float32Array {
  const out = buffer(2.8);
  const nz = new Noise(seed);
  const body = new Biquad();
  const crack = new Biquad();
  const crackle = new Biquad();
  const wet = new Biquad();
  const rumble = new Biquad();
  crack.set('hp', 1400, 0.7);
  crackle.set('bp', 2600, 1.4);
  wet.set('bp', 700, 2.2);
  rumble.set('lp', 110, 0.8);
  let ph = 0;
  let brown = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    if ((i & 31) === 0) body.set('lp', 170 + 4600 * Math.exp(-t * 5.2), 0.9);
    const w = nz.white();
    brown = brown * 0.985 + w * 0.15;
    const attack = 1 - Math.exp(-t * 500);
    const f = 30 + 62 * Math.exp(-t * 8.5);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    const sub = Math.sin(ph) * Math.exp(-t * 3.1) * attack * 1.15;
    const roar = body.run(w * 0.7 + brown * 0.8) * Math.exp(-t * 2.1) * attack * 1.25;
    const cr = crack.run(w) * Math.exp(-t * 32) * 0.85;
    const p = 0.0045 * Math.exp(-t * 1.6);
    const imp = nz.uni() < p ? nz.white() * 1.6 : 0;
    const deb = crackle.run(imp) * 0.9;
    const we = t > 0.03 ? wet.run(w) * Math.exp(-(t - 0.03) * 8) * 0.55 : 0;
    const rb = rumble.run(brown * 3) * Math.exp(-t * 1.05) * 0.9;
    out[i] = sub + roar + cr + deb + we + rb;
  }
  bloop(out, 0.07, 420, 90, 0.16, 0.35);
  bloop(out, 0.19, 360, 80, 0.18, 0.3);
  bloop(out, 0.33, 300, 70, 0.2, 0.25);
  bloop(out, 0.52, 260, 65, 0.22, 0.18);
  return finish(out, 0.98, 1.7);
}

/** Pin "ping" + throw whoosh. */
export function synthThrow(seed = 11): Float32Array {
  const out = buffer(0.6);
  const nz = new Noise(seed);
  const bp = new Biquad();
  const T = 0.55;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    if ((i & 31) === 0) bp.set('bp', 500 + 1300 * (t / T), 1.3);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, t / T)), 2);
    let v = bp.run(nz.white()) * env * 1.2;
    const pe = Math.exp(-t * 9);
    v += (Math.sin(2 * Math.PI * 2210 * t) * 0.5 + Math.sin(2 * Math.PI * 3350 * t) * 0.32 + Math.sin(2 * Math.PI * 5120 * t) * 0.18) * pe * 0.45;
    out[i] = v;
  }
  return finish(out, 0.8, 0);
}

/** Crackly fuse hiss (loopable). */
export function synthFuse(seed = 13): Float32Array {
  const out = buffer(1.0);
  const nz = new Noise(seed);
  const hp = new Biquad();
  hp.set('hp', 2800, 0.7);
  const cr = new Biquad();
  cr.set('bp', 4200, 2);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const flutter = 0.75 + 0.25 * Math.sin(2 * Math.PI * 23 * t) * Math.sin(2 * Math.PI * 3 * t);
    const imp = nz.uni() < 0.0016 ? nz.white() * 3 : 0;
    out[i] = hp.run(nz.white()) * 0.35 * flutter + cr.run(imp);
  }
  return loopify(finish(out, 0.6, 0), 0.05);
}

/** Bullet-time "bwoooom". */
export function synthSlowmoIn(seed = 17): Float32Array {
  const out = buffer(1.3);
  const nz = new Noise(seed);
  const lp = new Biquad();
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    if ((i & 31) === 0) lp.set('lp', 300 + 2600 * Math.exp(-t * 3), 0.8);
    const f = 55 + 190 * Math.exp(-t * 3.4);
    p1 += (2 * Math.PI * f) / SAMPLE_RATE;
    p2 += (2 * Math.PI * f * 1.012) / SAMPLE_RATE;
    const tone = Math.sin(p1) + 0.6 * Math.sin(p2 * 2) + 0.35 * Math.sin(p1 * 3);
    const env = Math.min(1, t / 0.05) * Math.exp(-t * 1.6);
    const swell = Math.sin(Math.PI * Math.min(1, t / 0.9)) * 0.35;
    out[i] = lp.run(tone * env + nz.white() * swell);
  }
  return finish(out, 0.75, 1.2);
}

/** Wet slop splat (ai-cannon impact). */
export function synthSplat(seed = 19): Float32Array {
  const out = buffer(0.8);
  const nz = new Noise(seed);
  const bp = new Biquad();
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    if ((i & 31) === 0) bp.set('bp', 300 + 900 * Math.exp(-t * 6), 1.6);
    const f = 50 + 70 * Math.exp(-t * 14);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    out[i] = bp.run(nz.white()) * Math.exp(-t * 7.5) * 1.3 + Math.sin(ph) * Math.exp(-t * 9) * 0.8;
  }
  bloop(out, 0.04, 380, 85, 0.14, 0.4);
  bloop(out, 0.16, 320, 75, 0.16, 0.3);
  return finish(out, 0.9, 1.3);
}

/** Cannon "thoomp". */
export function synthCannon(seed = 23): Float32Array {
  const out = buffer(0.5);
  const nz = new Noise(seed);
  const lp = new Biquad();
  lp.set('lp', 900, 0.8);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const f = 58 + 110 * Math.exp(-t * 22);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    out[i] = Math.sin(ph) * Math.exp(-t * 10) + lp.run(nz.white()) * Math.exp(-t * 14) * 0.7;
  }
  return finish(out, 0.85, 1.4);
}

/** Soft slow whoosh (fruit lob). */
export function synthWhoosh(seed = 29): Float32Array {
  const out = buffer(1.4);
  const nz = new Noise(seed);
  const bp = new Biquad();
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    if ((i & 31) === 0) bp.set('bp', 350 + 500 * Math.sin(Math.PI * Math.min(1, t / 1.4)), 0.9);
    out[i] = bp.run(nz.white()) * Math.pow(Math.sin(Math.PI * Math.min(1, t / 1.4)), 2);
  }
  return finish(out, 0.55, 0);
}

/** Fruit sinking into goo. */
export function synthSquelch(seed = 31): Float32Array {
  const out = buffer(0.55);
  const nz = new Noise(seed);
  const lp = new Biquad();
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    if ((i & 31) === 0) lp.set('lp', 260 + 1300 * Math.exp(-t * 9), 6);
    out[i] = lp.run(nz.white()) * Math.exp(-t * 7) * 0.9;
  }
  bloop(out, 0.02, 520, 120, 0.1, 0.35);
  bloop(out, 0.11, 420, 100, 0.12, 0.25);
  return finish(out, 0.8, 1.1);
}

/** Smoke "pfffff". */
export function synthSmoke(seed = 37): Float32Array {
  const out = buffer(2.2);
  const nz = new Noise(seed);
  const lp = new Biquad();
  lp.set('lp', 650, 0.7);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const w = nz.white();
    // Paul Kellet pink-ish
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    const pink = b0 + b1 + b2 + w * 0.1848;
    const env = Math.min(1, t / 0.55) * Math.exp(-Math.max(0, t - 0.55) * 1.6);
    out[i] = lp.run(pink) * env;
  }
  return finish(out, 0.5, 0);
}

/** Crystal "tink" — almost subliminal. */
export function synthTwinkle(seed = 41): Float32Array {
  const out = buffer(0.9);
  const nz = new Noise(seed);
  const parts = [3520, 5290, 7180, 8870];
  const decay = [5, 7, 9, 12];
  const ph = parts.map(() => nz.uni() * Math.PI * 2);
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    let v = 0;
    for (let k = 0; k < parts.length; k++) v += Math.sin(2 * Math.PI * parts[k] * t + ph[k]) * Math.exp(-t * decay[k]) / (k + 1);
    out[i] = v * Math.min(1, t / 0.002);
  }
  return finish(out, 0.35, 0);
}

/** Rubber squeak + swish. */
export function synthSqueegee(seed = 43): Float32Array {
  const out = buffer(1.0);
  const nz = new Noise(seed);
  const bp = new Biquad();
  bp.set('bp', 2100, 1.2);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    const f = 880 + 260 * Math.sin(2 * Math.PI * 6.5 * t) + 60 * Math.sin(2 * Math.PI * 41 * t);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    const flutter = 0.6 + 0.4 * Math.sin(2 * Math.PI * 31 * t);
    const env = Math.sin(Math.PI * Math.min(1, t / 0.95));
    out[i] = (Math.sin(ph) * 0.5 + Math.sin(ph * 2) * 0.18) * flutter * env * 0.8 + bp.run(nz.white()) * env * 0.5;
  }
  return finish(out, 0.7, 0.8);
}

/** Fly buzz loop (2 s, seamless). */
export function synthBuzz(seed = 47): Float32Array {
  const out = buffer(2.0);
  const nz = new Noise(seed);
  const bp = new Biquad();
  bp.set('bp', 520, 0.6);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE;
    // drift built from sines whose periods divide 2s -> loops cleanly
    const f = 192 + 9 * Math.sin(2 * Math.PI * 0.5 * t) + 5 * Math.sin(2 * Math.PI * 1.5 * t + 1) + 3 * Math.sin(2 * Math.PI * 7 * t);
    ph += (2 * Math.PI * f) / SAMPLE_RATE;
    let saw = 0;
    for (let k = 1; k <= 7; k++) saw += Math.sin(ph * k) / k;
    const am = 0.8 + 0.2 * Math.sin(2 * Math.PI * 14 * t);
    out[i] = bp.run(saw * am + nz.white() * 0.05);
  }
  return loopify(finish(out, 0.5, 0), 0.04);
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
