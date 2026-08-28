// Serves scan requests made from the hosted dashboard.
//
// The reader who wants fresh data sits in front of the hosted dashboard, which
// is in Singapore and is served the SGD storefront -- it can never scan. This
// runs on the machine that reaches the Japanese store, takes the request that
// reader made, and does the work.
//
// ONE SHOT, NOT A DAEMON. It checks once and exits, and launchd runs it every
// minute. A long-lived loop would need its own supervision, its own restart
// story, and its own answer for a laptop that sleeps mid-wait; a process that
// exits has none of those problems, and the cost is up to a minute of latency
// on a job that takes two.
//
// Also runs the scheduled refresh: with --or-schedule it scans when nobody has
// asked but the data is older than the interval. One entry point rather than
// two jobs racing each other for the same single-flight lock.

import '../load-env.js';
import * as repo from '../db/monitor-repository.js';
import { close } from '../db/database.js';
import { runScan } from '../core/scan-runner.js';

/** How stale the data may get before the scheduled path scans anyway. */
const DEFAULT_MAX_AGE_MINUTES = 120;

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

function minutesSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return (Date.now() - new Date(iso).getTime()) / 60_000;
}

async function main(): Promise<void> {
  await repo.ensureReady();

  const request = await repo.claimScanRequest();
  const orSchedule = process.argv.includes('--or-schedule');
  const maxAge = Number(flag('max-age') ?? DEFAULT_MAX_AGE_MINUTES);

  let reason: string;

  if (request) {
    reason = `yêu cầu #${request.id} lúc ${request.requested_at}`;
  } else if (orSchedule) {
    const [recent] = await repo.loadRecentScans(1);
    const age = minutesSince(recent?.finished_at ?? null);
    if (age < maxAge) {
      console.log(`[worker] không có yêu cầu, dữ liệu mới ${Math.round(age)} phút — bỏ qua`);
      return;
    }
    reason = `dữ liệu đã cũ ${Math.round(age)} phút`;
  } else {
    console.log('[worker] không có yêu cầu nào đang chờ');
    return;
  }

  console.log(`[worker] bắt đầu quét — ${reason}`);

  let error: string | null = null;
  try {
    const summary = await runScan();
    console.log(
      `[worker] xong: ${summary.scanned} sản phẩm, ${summary.changes.length + summary.listingChanges.length} thay đổi`
    );
  } catch (e) {
    // Captured, not rethrown, so the request is always closed out. A request
    // left claimed-but-unfinished would look like a scan still running, and
    // the dashboard would spin forever over a job that died.
    error = (e as Error).message;
    console.error('[worker] quét LỖI:', error);
  } finally {
    if (request) await repo.finishScanRequest(request.id, error);
  }

  if (error) process.exitCode = 1;
}

await main();
await close();
