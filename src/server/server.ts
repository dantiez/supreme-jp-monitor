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

const app = express();
const PORT = Number(process.env.PORT ?? 3100);

// Loopback by default so a local run is not exposed on the network. A platform
// like Render injects PORT and needs 0.0.0.0 to route traffic to the container.
const HOST = process.env.HOST ?? '127.0.0.1';

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

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/', async (req, res) => {
  try {
    const filters = readFilters(req.query as Record<string, unknown>);
    const [rows, categories] = await Promise.all([
      repo.loadDashboardRows(filters),
      repo.loadCategories()
    ]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderDashboard(rows, categories, filters));
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
  // Say it out loud rather than leaving it to be discovered. This dashboard has
  // no authentication: on a public HOST, anyone with the URL reads the data.
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !process.env.ALLOW_PUBLIC_DASHBOARD) {
    console.warn(
      '[auth] Bound to a public interface with NO authentication. Anyone with ' +
        'the URL can read the dashboard and download the export. Set ' +
        'ALLOW_PUBLIC_DASHBOARD=1 to acknowledge, or add a password first.'
    );
  }
});
