// Dashboard and export. Read-only: scanning happens in the scheduled CLI, not
// here, so this server can sleep on a free tier without stopping the monitor.
//
// The page is server-rendered plain HTML. A React build would add a toolchain
// and a bundle to serve one table with three filters, and the table is the
// whole feature.

import '../load-env.js';
import express from 'express';
import * as repo from '../db/monitor-repository.js';
import {
  generateCsv,
  generateXlsxBuffer,
  buildExportFilename
} from './export-writer.js';
import { renderDashboard } from './dashboard-page.js';
import { renderChangesPage } from './changes-page.js';
import { startScan, getScanState } from './scan-controller.js';
import { createDashboardAuth, MissingPasswordError } from './dashboard-basic-auth.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3100);

// Loopback by default so a local run is not exposed on the network. A platform
// like Render injects PORT and needs 0.0.0.0 to route traffic to the container.
const HOST = process.env.HOST ?? '127.0.0.1';

// Whether THIS instance may scan.
//
// supreme.com serves a storefront chosen from the caller's IP, and each one
// renames every product, so a scan only means anything from a machine that
// reaches the Japanese store. The hosted dashboard does not reach it: it exists
// to be read by someone else, and the scanning runs where the store is.
//
// The scan already refuses a foreign storefront, so this is not what keeps the
// data safe -- it is what stops a reader being handed buttons that can only
// fail. Default on, because the machine that scans is the one running locally.
const SCANNING_ENABLED = process.env.ALLOW_SCANNING !== 'false';

// Guards every route, the scan trigger included -- an unprotected URL would let
// a stranger start hundred-second scans against Supreme and the database, which
// is a heavier gift than read access.
//
// Registered here, above the routes, so a route added later is covered by
// default. Opting out has to be deliberate.
let dashboardAuth;
try {
  dashboardAuth = createDashboardAuth({
    password: process.env.DASHBOARD_PASSWORD,
    host: HOST
  });
} catch (e) {
  if (e instanceof MissingPasswordError) {
    // A stack trace would bury the one sentence that matters.
    console.error(`\n[auth] ${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

// The platform probes this before it will route traffic, and it holds no
// credentials. It answers liveness and nothing else, so it stays open.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.use(dashboardAuth);

/** Only these reach a WHERE clause; anything else is ignored, not interpolated. */
const STATUSES = new Set(['AVAILABLE', 'SOLD_OUT', 'UNKNOWN']);
const EVENTS = new Set(['NEW_PRODUCT', 'NEW_VARIANT', 'SOLD_OUT', 'RESTOCK', 'PRICE_CHANGED']);

function readFilters(query: Record<string, unknown>) {
  const status = String(query.status ?? '');
  const event = String(query.event ?? '');
  const category = String(query.category ?? '').slice(0, 60);
  return {
    status: STATUSES.has(status) ? status : undefined,
    event: EVENTS.has(event) ? event : undefined,
    category: category || undefined
  };
}

// The scan is triggered from the dashboard button rather than a schedule.
//
// NOTE THE TRADE-OFF THIS ENCODES: nothing is monitored while nobody clicks. A
// size that returns at 03:00 and sells out by 05:00 is never seen, and never
// enters the history either, because no scan ran between those moments. That
// was the customer's call, made knowingly.
app.post('/api/scan', express.json(), (req, res) => {
  // Enforced at the route, not only by hiding the controls. A hidden button is
  // a suggestion: anyone can still POST, and a page cached from before the
  // setting changed still carries live ones.
  // This instance cannot scan, but the person asking is sitting in front of it,
  // not in front of the machine that can. So the ask is recorded and the worker
  // on that machine picks it up. Answered 202 rather than 200: accepted, not
  // done, which is exactly what happened.
  if (!SCANNING_ENABLED) {
    void repo
      .requestScan()
      .then((request) => {
        res.status(202).json({ ok: true, queued: true, requestedAt: request.requested_at });
      })
      .catch((e: Error) => {
        res.status(500).json({ ok: false, error: e.message });
      });
    return;
  }

  // Only ever true when the client says so explicitly. Defaulting to true on a
  // missing body would reseed the watch list on an ordinary scan and wipe the
  // baseline every change is measured against.
  const initialise = (req.body as { initialise?: unknown } | undefined)?.initialise === true;
  const result = startScan({ initialise });
  if (!result.started) {
    // Refused, not queued: a queued scan would run against state the first one
    // is still writing, and report its own predecessor's work as changes.
    return res.status(409).json({ ok: false, reason: result.reason, state: getScanState() });
  }
  res.status(202).json({ ok: true, state: getScanState() });
});

// Merges what this process knows with what the database knows.
//
// On the hosted dashboard the in-process state is always empty -- no scan ever
// starts here -- so reporting it alone would say "nothing has ever run" while a
// scan was in progress on another machine. Where this instance does scan, the
// in-process state is the fresher of the two and wins.
app.get('/api/scan/status', async (_req, res) => {
  const local = getScanState();
  if (local.running || SCANNING_ENABLED) {
    res.json({ ...local, pendingSince: null });
    return;
  }

  try {
    const remote = await repo.loadRemoteScanState();
    res.json({
      running: remote.running,
      startedAt: remote.startedAt,
      finishedAt: remote.last?.finishedAt ?? null,
      pendingSince: remote.pendingSince,
      last: remote.last
        ? { ...remote.last, startedAt: remote.startedAt ?? '', failed: 0, listingChanges: 0, error: null }
        : null
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.get('/', async (req, res) => {
  try {
    const filters = readFilters(req.query as Record<string, unknown>);
    // Categories were only ever read to fill a filter dropdown the toolbar no
    // longer has; loading them now would be a query nobody looks at.
    const rows = await repo.loadDashboardRows(filters);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderDashboard(rows, filters, { scanningEnabled: SCANNING_ENABLED }));
  } catch (e) {
    // Say what broke. A blank dashboard reads as "nothing is in stock".
    res.status(500).send(
      `<pre>Could not load the dashboard.\n\n${(e as Error).message}</pre>`
    );
  }
});

/**
 * What changed during one scan, against the scan before it.
 *
 * Per RUN rather than per day: the customer asked for it counted in scans, and
 * a daily baseline loses events -- a size that sells out at 10:00 and returns
 * at 14:00 looks identical to the morning snapshot at both 12:00 and 14:00.
 */
app.get('/changes', async (req, res) => {
  try {
    const scans = await repo.loadRecentScans(30);

    const requested = Number(req.query.scan);
    const selected =
      (Number.isFinite(requested) ? scans.find((s) => s.id === requested) : undefined) ??
      scans[0] ??
      null;

    // "The one before" is by run id, not by date. Two scans an hour apart and
    // two a day apart are compared the same way.
    const previous = selected
      ? (scans.find((s) => s.id < selected.id) ?? null)
      : null;

    const changes = selected ? await repo.loadChangesForScan(selected.id) : [];

    // Only needed for the very first scan, which has nothing to diff against.
    const inStock =
      selected && previous === null
        ? (await repo.loadDashboardRows({ status: 'AVAILABLE' })).map((r) => ({
            handle: r.handle,
            name: r.name,
            color: r.color,
            size: r.size,
            url: r.url,
            image_url: r.image_url,
            event: 'NEW_PRODUCT',
            current_price: r.price,
            previous_price: null,
            currency: r.currency,
            detected_at: r.last_checked_at
          }))
        : [];

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderChangesPage({ scans, selected, previous, changes, inStock }));
  } catch (e) {
    res.status(500).send(`<pre>Không tải được trang thay đổi.\n\n${(e as Error).message}</pre>`);
  }
});

app.get('/export', async (req, res) => {
  const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
  try {
    const rows = await repo.loadDashboardRows(readFilters(req.query as Record<string, unknown>));
    const filename = buildExportFilename(format);

    if (format === 'xlsx') {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(generateXlsxBuffer(rows));
    } else {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(generateCsv(rows));
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Apply the schema at boot, not only when a scan runs.
//
// Every read route queries columns the migrations add. On a fresh deploy the
// dashboard is the FIRST thing anyone opens -- before any scan -- and without
// this it answers 500 "column does not exist" to the person the link was just
// handed to.
//
// Failure is logged, not fatal: the routes report the problem themselves, and
// dying here would take down /healthz too and make the platform report the
// service as broken rather than as up-with-a-bad-database.
repo
  .ensureReady()
  .then(() => console.log('[db] schema ready'))
  .catch((e) => console.error('[db] schema could not be applied:', (e as Error).message));

app.listen(PORT, HOST, () => {
  console.log(`Supreme JP monitor dashboard on http://${HOST}:${PORT}`);
  if (!process.env.DATABASE_URL) {
    console.warn('[db] DATABASE_URL is not set. The dashboard will error until it is.');
  }
  console.log(
    process.env.DASHBOARD_PASSWORD
      ? '[auth] Password required.'
      : '[auth] No password -- loopback only.'
  );
  console.log(
    SCANNING_ENABLED
      ? '[scan] Scanning enabled on this instance.'
      : '[scan] View only -- scanning happens elsewhere.'
  );
});
