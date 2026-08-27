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
app.post('/api/scan', express.json(), (_req, res) => {
  const result = startScan();
  if (!result.started) {
    // Refused, not queued: a queued scan would run against state the first one
    // is still writing, and report its own predecessor's work as changes.
    return res.status(409).json({ ok: false, reason: result.reason, state: getScanState() });
  }
  res.status(202).json({ ok: true, state: getScanState() });
});

app.get('/api/scan/status', (_req, res) => {
  res.json(getScanState());
});

app.get('/', async (req, res) => {
  try {
    const filters = readFilters(req.query as Record<string, unknown>);
    const [rows, categories] = await Promise.all([
      repo.loadDashboardRows(filters),
      repo.loadCategories()
    ]);

    // Taken from the in-process scan first: it is the run the reader just
    // triggered. Falling back to the stored history covers a fresh server that
    // has not scanned yet but has scans behind it.
    const state = getScanState();
    let lastScanChanges: number | null = state.last
      ? state.last.changes + state.last.listingChanges
      : null;
    if (lastScanChanges === null) {
      const [recent] = await repo.loadRecentScans(1);
      lastScanChanges = recent ? recent.changes_detected : null;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderDashboard(rows, categories, filters, { lastScanChanges }));
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
});
