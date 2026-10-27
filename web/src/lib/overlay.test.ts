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
  let onSession: ((restarted: boolean) => void) | undefined;
  const connection = connectOverlay(stage, () => true, fetcher, (callback, restart) => {
    receive = callback;
    onSession = restart;
    return stop;
  });
  return { world, stage, connection, stop, open: (restarted = false) => onSession?.(restarted),
    send: (event: Partial<AnimationEvent>) => receive(event as AnimationEvent) };
}

describe('shared browser/macOS overlay reset boundary', () => {
  it.each([undefined, 0])('discards a pre-wipe delayed ledger HTTP response (legacy generation %s)', async (resetGeneration) => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(new Response(JSON.stringify({ resetGeneration, recentReports: [] })));
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

  it('preserves later scans when reconnecting to the same daemon and receiving its duplicate wipe marker', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ resetGeneration: 7, recentReports: [] })));
    const { world, stage, connection, send, open } = setup(fetcher);
    await connection.initial;
    send({ sequence: 10, resetGeneration: 7, report: report('later-scan') });
    world.update(0.05);
    open();
    send({ sequence: 1, dataWiped: true, resetGeneration: 7 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(stage.reset).toHaveBeenCalledOnce();
    expect(world.grenades).toHaveLength(1);
    connection.dispose();
  });

  it('accepts generation-zero snapshots/events after a daemon restart and rejects old in-flight work', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ resetGeneration: 0, recentReports: [report('new-daemon')] })));
    const { world, connection, send, open } = setup(fetcher);
    const trigger = vi.spyOn(world, 'trigger');
    // A generation-positive event can arrive while the initial read is pending.
    send({ sequence: 100, resetGeneration: 7, report: report('old-daemon') });
    open();
    finish(new Response(JSON.stringify({ resetGeneration: 7, recentReports: [report('late-old-daemon')] })));
    await connection.initial;
    await vi.waitFor(() => expect(trigger).toHaveBeenCalledTimes(2));
    expect(fetcher).toHaveBeenCalledTimes(2);
    world.update(0.05);
    expect(world.grenades).toHaveLength(1);
    send({ sequence: 1, resetGeneration: 0, report: report('new-live') });
    expect(trigger).toHaveBeenCalledTimes(3);
    world.update(0.05);
    // One grenade remains in flight while the second waits for the director.
    expect(world.grenades).toHaveLength(1);
    connection.dispose();
  });
});
