// Server-rendered dashboard.
//
// Kept as a pure function of (rows, categories, filters) so the markup can be
// tested without a database or a browser -- above all the escaping, since
// product names come from a third party and land directly in HTML.

import { DashboardRow } from '../db/monitor-repository.js';

/**
 * Escape before interpolation. Product names and colours are third-party text;
 * one unescaped `<` is a script tag on a page the customer trusts.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Unknown price renders as an em dash, never as 0. */
export function formatYen(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return `¥${Number(value).toLocaleString('en-US')}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

const STATUS_CLASS: Record<string, string> = {
  AVAILABLE: 'ok',
  SOLD_OUT: 'out',
  UNKNOWN: 'unknown'
};

const STATUSES = ['AVAILABLE', 'SOLD_OUT', 'UNKNOWN'];
const EVENTS = ['RESTOCK', 'NEW_PRODUCT', 'NEW_VARIANT', 'PRICE_CHANGED', 'SOLD_OUT'];

function option(value: string, selected: string | undefined, label?: string): string {
  const isSelected = selected === value ? ' selected' : '';
  return `<option value="${escapeHtml(value)}"${isSelected}>${escapeHtml(label ?? value)}</option>`;
}

export interface DashboardFilters {
  status?: string;
  event?: string;
  category?: string;
}

export function renderDashboard(
  rows: DashboardRow[],
  categories: string[],
  filters: DashboardFilters
): string {
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.event) query.set('event', filters.event);
  if (filters.category) query.set('category', filters.category);
  const exportQuery = query.toString();

  const available = rows.filter((r) => r.status === 'AVAILABLE').length;

  const body = rows
    .map(
      (row) => `<tr>
  <td><a href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(row.name)}</a></td>
  <td>${escapeHtml(row.color)}</td>
  <td>${escapeHtml(row.size)}</td>
  <td class="num">${formatYen(row.price_jpy)}</td>
  <td><span class="pill ${STATUS_CLASS[row.status] ?? 'unknown'}">${escapeHtml(row.status)}</span></td>
  <td>${escapeHtml(row.latest_event ?? '')}</td>
  <td class="dim">${formatWhen(row.last_checked_at)}</td>
</tr>`
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supreme JP Stock Monitor</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0b0f14; color:#e6edf3; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { padding:20px 24px; border-bottom:1px solid #1c2733; }
  h1 { margin:0; font-size:18px; }
  .sub { color:#7d8894; font-size:12px; margin-top:4px; }
  main { padding:20px 24px; }
  form { display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-bottom:18px; }
  label { display:block; font-size:11px; color:#7d8894; margin-bottom:4px; }
  select, button, .btn { background:#111925; color:#e6edf3; border:1px solid #23303f; border-radius:8px; padding:8px 12px; font-size:13px; }
  .btn { text-decoration:none; display:inline-block; }
  .btn.primary { background:#1f6feb; border-color:#1f6feb; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#7d8894; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid #23303f; }
  td { padding:8px 10px; border-bottom:1px solid #161f2b; }
  td a { color:#e6edf3; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .dim { color:#7d8894; }
  .pill { padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
  .pill.ok { background:rgba(46,204,113,.15); color:#3fdc86; }
  .pill.out { background:rgba(149,165,166,.15); color:#9fb0bf; }
  .pill.unknown { background:rgba(241,196,15,.15); color:#f1c40f; }
  .empty { color:#7d8894; padding:40px 0; text-align:center; }
</style>
</head>
<body>
<header>
  <h1>Supreme JP Stock Monitor</h1>
  <div class="sub">${rows.length} tracked size(s) &middot; ${available} available &middot; tracked as Product + Size, colour is a product attribute</div>
</header>
<main>
  <form method="get">
    <div>
      <label for="status">Status</label>
      <select id="status" name="status">
        <option value="">All</option>
        ${STATUSES.map((s) => option(s, filters.status)).join('')}
      </select>
    </div>
    <div>
      <label for="event">Latest event</label>
      <select id="event" name="event">
        <option value="">All</option>
        ${EVENTS.map((e) => option(e, filters.event)).join('')}
      </select>
    </div>
    <div>
      <label for="category">Category</label>
      <select id="category" name="category">
        <option value="">All</option>
        ${categories.map((c) => option(c, filters.category)).join('')}
      </select>
    </div>
    <button type="submit">Filter</button>
    <a class="btn" href="/export?format=csv${exportQuery ? '&' + exportQuery : ''}">Download CSV</a>
    <a class="btn primary" href="/export?format=xlsx${exportQuery ? '&' + exportQuery : ''}">Download Excel</a>
  </form>

  ${
    rows.length === 0
      ? '<div class="empty">Nothing tracked yet. Run <code>npm run scan</code> to populate.</div>'
      : `<table>
  <thead><tr><th>Product</th><th>Color</th><th>Size</th><th class="num">Price</th><th>Status</th><th>Latest event</th><th>Last checked</th></tr></thead>
  <tbody>
${body}
  </tbody>
</table>`
  }
</main>
</body>
</html>`;
}
