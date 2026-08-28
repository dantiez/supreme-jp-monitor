// What happens when the instance that was asked to scan cannot reach the shop.
//
// This is the configuration mistake that is easiest to make: ALLOW_SCANNING is
// only read from the environment, and a Render service created by hand rather
// than from render.yaml will not have it. Getting that wrong should cost a few
// seconds, not the feature.
//
// Every dependency is mocked; this must never touch the real database.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const requestScan = vi.fn(async () => ({ id: 1, requested_at: 'now', claimed_at: null }));
const runScan = vi.fn();

vi.mock('../src/db/monitor-repository.js', () => ({
  requestScan: (...a: unknown[]) => requestScan(...a)
}));
vi.mock('../src/core/scan-runner.js', () => ({ runScan: (...a: unknown[]) => runScan(...a) }));

const { WrongStoreError } = await import('../src/core/expected-store.js');
const { startScan, getScanState } = await import('../src/server/scan-controller.js');

/** The scan runs detached; wait for it to settle. */
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('a scan asked of an instance in the wrong country', () => {
  beforeEach(() => {
    requestScan.mockClear();
    runScan.mockReset();
  });

  it('hands the request to the worker instead of failing', async () => {
    runScan.mockRejectedValue(new WrongStoreError('SGD'));
    startScan();
    await settle();

    expect(requestScan).toHaveBeenCalledOnce();
    const last = getScanState().last!;
    expect(last.queued).toBe(true);
    // Not a failure: the reader's request is still going to be served.
    expect(last.error).toBeNull();
  });

  it('does not swallow other failures the same way', async () => {
    // A parser break or a dead database is not something another machine fixes.
    runScan.mockRejectedValue(new Error('database is on fire'));
    startScan();
    await settle();

    expect(requestScan).not.toHaveBeenCalled();
    const last = getScanState().last!;
    expect(last.queued).toBe(false);
    expect(last.error).toContain('database is on fire');
  });

  it('reports honestly when it cannot even queue', async () => {
    // Both sides broken is the one case where the reader must see a failure.
    runScan.mockRejectedValue(new WrongStoreError('SGD'));
    requestScan.mockRejectedValueOnce(new Error('no database'));
    startScan();
    await settle();

    const last = getScanState().last!;
    expect(last.queued).toBe(false);
    expect(last.error).toContain('no database');
  });

  it('leaves a successful scan alone', async () => {
    runScan.mockResolvedValue({ scanned: 268, failed: 0, changes: [], listingChanges: [] });
    startScan();
    await settle();

    expect(requestScan).not.toHaveBeenCalled();
    const last = getScanState().last!;
    expect(last.ok).toBe(true);
    expect(last.queued).toBe(false);
    expect(last.scanned).toBe(268);
  });
});
