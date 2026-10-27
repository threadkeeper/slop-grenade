import { describe, expect, it, vi } from 'vitest';
import { connectOverlay } from './overlay';
import { World, type Stage } from './engine';
import type { AnimationEvent, SlopReport } from './types';

const report = (messageId: string): SlopReport => ({
  messageId, app: 'gmail', tier: 'slop_grenade', monitorSide: 'left'
} as SlopReport);

function setup(fetcher: typeof fetch) {
  const world = new World(400, 240, { seed: 7 });
  const stage: Stage = {
    world, reset: vi.fn(() => world.reset()), resize: vi.fn(), stop: vi.fn()
  };
  let receive = (_event: AnimationEvent) => {};
  const stop = vi.fn();
  const connection = connectOverlay(stage, () => true, fetcher, (callback) => {
    receive = callback;
    return stop;
  });
  return { world, stage, connection, stop, send: (event: Partial<AnimationEvent>) => receive(event as AnimationEvent) };
}

describe('shared browser/macOS overlay reset boundary', () => {
  it.each([undefined, 0])('discards a pre-wipe delayed ledger HTTP response (legacy generation %s)', async (resetGeneration) => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish = resolve; }));
    const { world, stage, connection, send } = setup(fetcher);
    for (let i = 0; i < 10; ++i) send({ sequence: i + 1, report: report(`old-${i}`) });
    world.update(0.05);
    send({ sequence: 11, dataWiped: true, resetGeneration });
    finish(new Response(JSON.stringify({ resetGeneration, recentReports: [report('stale-http')] })));
    await connection.initial;
    expect(stage.reset).toHaveBeenCalledOnce();
    for (let i = 0; i < 400; ++i) world.update(0.05);
    expect(world.isIdle()).toBe(true);
    expect(world.slopCounts()).toEqual({ left: 0, right: 0 });
    // Both the local dedup cache and engine queue were forgotten.
    send({ sequence: 12, report: report('old-0') });
    world.update(0.05);
    expect(world.grenades).toHaveLength(1);
    connection.dispose();
  });

  it('reconciles newer remote snapshots and rejects stale markers/events without clearing later scans', async () => {
    const { world, stage, connection, send } = setup(vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ resetGeneration: 7, recentReports: [] }))
    ));
    await connection.initial;
    expect(stage.reset).toHaveBeenCalledOnce();
    send({ sequence: 1, dataWiped: true, resetGeneration: 6 });
    send({ sequence: 2, resetGeneration: 6, report: report('stale') });
    expect(world.isIdle()).toBe(true);
    send({ sequence: 3, resetGeneration: 7, report: report('new-scan') });
    world.update(0.05);
    send({ sequence: 4, dataWiped: true, resetGeneration: 7 });
    expect(stage.reset).toHaveBeenCalledOnce();
    expect(world.grenades).toHaveLength(1);
    connection.dispose();
  });

  it('does not rehydrate a disposed overlay even if the HTTP responder ignores cancellation', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => { finish = resolve; }));
    const { connection, world, stop } = setup(fetcher);
    connection.dispose();
    finish(new Response(JSON.stringify({ recentReports: [report('late')] })));
    await connection.initial;
    expect(stop).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(world.isIdle()).toBe(true);
  });
});
