// Entry point for the scheduled scan. This is what GitHub Actions invokes.
//
// It is a short-lived process on purpose: it opens the database, does one
// sweep, alerts, and exits. Nothing here depends on a web server being awake,
// which is exactly why the scheduler lives in Actions rather than in the
// Render service -- a free Render instance sleeps, and a sleeping instance runs
// no cron.
//
// Usage:
//   npm run scan                       -- full sweep, notify
//   npm run scan -- --max=20           -- cap the product count
//   npm run scan -- --no-notify        -- store changes, stay silent
//   npm run scan -- --collections=new  -- restrict discovery

import '../load-env.js';
import { runScan } from '../core/scan-runner.js';
import { close } from '../db/database.js';

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const maxRaw = flag('max');
  const collectionsRaw = flag('collections');

  const started = Date.now();
  const summary = await runScan({
    maxProducts: maxRaw ? Number(maxRaw) : undefined,
    initialise: process.argv.includes('--init'),
    collections: collectionsRaw ? collectionsRaw.split(',').map((c) => c.trim()) : undefined,
    notify: !process.argv.includes('--no-notify')
  });

  const seconds = Math.round((Date.now() - started) / 1000);
  const byEvent = new Map<string, number>();
  for (const c of summary.changes) byEvent.set(c.event, (byEvent.get(c.event) ?? 0) + 1);

  console.log(
    `[scan] done in ${seconds}s: discovered ${summary.discovered}, ` +
      `checked ${summary.scanned}, failed ${summary.failed}, changes ${summary.changes.length}`
  );
  console.log(
    `[scan] listing pages read: ${summary.discovery.pagesRead}` +
      (summary.discovery.declaredTotal !== null
        ? ` (site declares ${summary.discovery.declaredTotal} products)`
        : '')
  );
  for (const [event, n] of byEvent) console.log(`         ${event}: ${n}`);

  // A scan where nothing could be read is a failure, not a quiet success --
  // exit non-zero so the Actions run goes red instead of looking healthy.
  if (summary.scanned === 0 && summary.discovered > 0) {
    throw new Error('Discovered products but could not read any of them.');
  }

  // A partial discovery is also a failure, and this is the one that bit us in
  // production: /collections/new timed out, discovery silently fell through to
  // jackets, and a green run announced thirty "new products" that were just
  // the first jackets nobody had recorded. Totals looked entirely normal. Go
  // red so the gap is seen on the day it happens, not weeks later when someone
  // wonders why a drop was never announced.
  if (summary.discovery.failed.length > 0) {
    throw new Error(
      `Listing pages could not be read: ` +
        summary.discovery.failed.map((f) => `page ${f.page} (${f.error})`).join(', ') +
        `. Their products were NOT checked; results are incomplete.`
    );
  }

  // The site states its own total. Covering less than it declares means
  // products went unchecked this run, and silence about them would read as
  // "nothing changed" rather than "we did not look".
  const declared = summary.discovery.declaredTotal;
  if (declared !== null && summary.discovered < declared) {
    throw new Error(
      `Read ${summary.discovered} products but the site declares ${declared}. ` +
        `${declared - summary.discovered} were NOT checked.`
    );
  }
}

main()
  .then(() => close())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error('[scan] failed:', (e as Error).message);
    await close().catch(() => {});
    process.exit(1);
  });
