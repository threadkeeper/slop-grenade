import { describe, expect, it, vi } from 'vitest';
import { WebAudioSfx } from './audio';

describe('effect sound reset', () => {
  it('stops active one-shots, looping and fading voices immediately while keeping sound preferences', () => {
    const sources: { stop: ReturnType<typeof vi.fn> }[] = [];
    const parameter = () => ({ value: 0, setTargetAtTime: vi.fn() });
    const node = () => {
      const result = { connect: vi.fn(), gain: parameter(), pan: parameter() };
      result.connect.mockReturnValue(result);
      return result;
    };
    const ctx = {
      currentTime: 1, resume: vi.fn(), suspend: vi.fn(),
      createGain: node, createStereoPanner: node,
      createBufferSource: () => {
        const src = { ...node(), stop: vi.fn(), start: vi.fn(), playbackRate: parameter(), disconnect: vi.fn() };
        sources.push(src);
        return src;
      }
    };
    const audio = new WebAudioSfx();
    Object.assign(audio, { ctx, master: node(), buffers: new Map([['throw', {}], ['fuse', {}]]) });
    audio.setEnabled(true);
    audio.setVolume(0.35);
    audio.play('throw', 0, 1);
    audio.loop('fuse-left', 'fuse', 0, 1);
    audio.loop('fuse-left', null, 0, 0);
    expect(sources).toHaveLength(2);
    expect(sources[1].stop).toHaveBeenLastCalledWith(1.3);
    audio.stopAll();
    for (const voice of sources) expect(voice.stop).toHaveBeenLastCalledWith();
    expect(audio.enabled).toBe(true);
    expect(audio.volume).toBe(0.35);
    audio.play('throw', 0, 1);
    expect(sources).toHaveLength(3);
  });
});
