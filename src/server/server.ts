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

const app = express();
const PORT = Number(process.env.PORT ?? 3100);
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
});
