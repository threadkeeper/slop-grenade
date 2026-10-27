/**
 * WebAudio output for the engine's procedural sound effects.
 * Sounds are synthesised once (see sfxSynth.ts), so no audio files ship
 * with the app. Off until the user switches sound on.
 */
import { SAMPLE_RATE, synthAll } from './sfxSynth';
import type { SfxName, SfxSink } from './world';

interface LoopVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  name: SfxName;
}

export class WebAudioSfx implements SfxSink {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loops = new Map<string, LoopVoice>();
  private voices = new Set<AudioBufferSourceNode>();
  private _enabled = false;
  private _volume = 0.7;

  get enabled(): boolean {
    return this._enabled;
  }

  get volume(): number {
    return this._volume;
  }

  /** Must be called from a user gesture the first time (browser autoplay rules). */
  setEnabled(on: boolean): void {
    this._enabled = on;
    if (on) {
      this.ensure();
      void this.ctx?.resume();
    } else {
      for (const id of [...this.loops.keys()]) this.stopLoop(id);
      void this.ctx?.suspend();
    }
  }

  setVolume(v: number): void {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.05);
  }

  stopAll(): void {
    for (const voice of this.voices) voice.stop();
    this.voices.clear();
    this.loops.clear();
  }

  private ensure(): void {
    if (this.ctx) return;
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    // soft limiter keeps the explosion loud but clean
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = this._volume;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    const all = synthAll();
    for (const name of Object.keys(all)) {
      const data = all[name];
      const buf = ctx.createBuffer(1, data.length, SAMPLE_RATE);
      buf.getChannelData(0).set(data);
      this.buffers.set(name, buf);
    }
  }

  play(name: SfxName, pan: number, gain: number, rate = 1): void {
    if (!this._enabled || !this.ctx || !this.master) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(this.master);
    this.track(src);
    src.start();
  }

  loop(id: string, name: SfxName | null, pan: number, gain: number, rate = 1): void {
    if (name === null || !this._enabled) {
      this.stopLoop(id);
      return;
    }
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    let v = this.loops.get(id);
    if (v && v.name !== name) {
      this.stopLoop(id);
      v = undefined;
    }
    if (!v) {
      const buf = this.buffers.get(name);
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const p = this.ctx.createStereoPanner();
      src.connect(g).connect(p).connect(this.master);
      this.track(src);
      src.start();
      v = { src, gain: g, pan: p, name };
      this.loops.set(id, v);
    }
    v.gain.gain.setTargetAtTime(gain, t, 0.06);
    v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.06);
    v.src.playbackRate.setTargetAtTime(rate, t, 0.06);
  }

  private stopLoop(id: string): void {
    const v = this.loops.get(id);
    if (!v) return;
    this.loops.delete(id);
    if (this.ctx) {
      const t = this.ctx.currentTime;
      v.gain.gain.setTargetAtTime(0, t, 0.05);
      v.src.stop(t + 0.3);
    }
  }

  private track(src: AudioBufferSourceNode): void {
    this.voices.add(src);
    src.onended = () => {
      this.voices.delete(src);
      src.disconnect();
    };
  }
}
