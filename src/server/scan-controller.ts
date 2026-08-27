// Runs a scan on demand, from a button, without blocking the HTTP response.
//
// WHY IT CANNOT JUST AWAIT THE SCAN: a full catalogue read takes roughly 100
// seconds. Holding a request open that long invites the browser, and any proxy
// in between, to give up halfway -- and the user would see a failure while the
// scan carried on writing. So the request starts the work and returns; the page
// polls for the result.
//
// SINGLE FLIGHT, ALWAYS. Two overlapping scans compare against a half-written
// "before" and report each other's writes as changes. The GitHub workflow
// prevented that with a concurrency group; in-process it needs this lock. A
// second click while one is running is answered honestly rather than queued,
// because a queued scan would run against state the first one just changed.

import { runScan, ScanSummary } from '../core/scan-runner.js';

export interface ScanState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Result of the most recent finished scan, successful or not. */
  last: {
    ok: boolean;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    scanned: number;
    failed: number;
    changes: number;
    listingChanges: number;
    error: string | null;
  } | null;
}

let running = false;
let startedAt: string | null = null;
let last: ScanState['last'] = null;

export function getScanState(): ScanState {
  return { running, startedAt, finishedAt: last?.finishedAt ?? null, last };
}

export type StartResult =
  | { started: true }
  | { started: false; reason: 'already-running' };

/**
 * Begin a scan if one is not already in flight.
 *
 * Returns as soon as the work is scheduled. Errors are captured into `last`
 * rather than thrown, because nobody is awaiting this promise -- an unhandled
 * rejection here would take the whole server down over one failed scan.
 */
export function startScan(): StartResult {
  if (running) return { started: false, reason: 'already-running' };

  running = true;
  const began = Date.now();
  startedAt = new Date(began).toISOString();

  void (async () => {
    let summary: ScanSummary | null = null;
    let error: string | null = null;

    try {
      summary = await runScan();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      const ended = Date.now();
      last = {
        ok: error === null,
        startedAt: startedAt!,
        finishedAt: new Date(ended).toISOString(),
        durationMs: ended - began,
        scanned: summary?.scanned ?? 0,
        failed: summary?.failed ?? 0,
        changes: summary?.changes.length ?? 0,
        listingChanges: summary?.listingChanges.length ?? 0,
        error
      };
      running = false;
      startedAt = null;

      if (error) console.error('[scan] on-demand scan failed:', error);
    }
  })();

  return { started: true };
}
