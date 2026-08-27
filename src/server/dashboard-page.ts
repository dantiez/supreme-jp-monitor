// Server-rendered dashboard: two columns, green for what can be bought and red
// for what cannot.
//
// Kept as a pure function of (rows, categories, filters) so the markup can be
// tested without a database or a browser -- above all the escaping, since
// product names come from a third party and land directly in HTML.
//
// WHY A FLAT LIST RATHER THAN CARDS PER PRODUCT: the reader wants to copy a
// line and paste it somewhere. Text lines select cleanly; a card grid does not.
// One line per (product, colour, size) is also the shape the data already has.
//
// WHY COLOUR IS IN EVERY LINE: Supreme ships one product per colourway, so
// "Box Logo Hooded Sweatshirt — M" can name several different garments. Without
// the colour, two identical-looking lines are two different things to buy, and
// the person copying one has no way to tell which.

import { DashboardRow } from '../db/monitor-repository.js';
import { formatWhen, timeZoneLabel } from '../format-time.js';

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

/**
 * Unknown price renders as an em dash, never as 0.
 *
 * The currency comes from the row, never from an assumption: jp.supreme.com
 * sometimes serves the US store, and printing $148 as "¥148" is the same
 * defect as a column headed JPY holding dollars.
 */
export function formatMoney(value: number | null, currency: string | null): string {
  if (value === null || value === undefined) return '—';
  const amount = Number(value).toLocaleString('en-US');
  if (currency === 'JPY') return `¥${amount}`;
  if (currency === 'USD') return `$${amount}`;
  return currency ? `${amount} ${currency}` : amount;
}

/**
 * A small thumbnail rather than the original image.
 *
 * Shopify's CDN resizes on request, and the difference is not cosmetic: the
 * full-size file is 834 KB, the 200px one is 11 KB. Across ~300 products that
 * is 248 MB versus 3.3 MB -- the page simply does not load without this.
 *
 * The URL already carries a `?v=` cache-buster, so the parameter is appended.
 */
export function thumbnailUrl(imageUrl: string | null, width = 200): string | null {
  if (!imageUrl) return null;
  const separator = imageUrl.includes('?') ? '&' : '?';
  return `${imageUrl}${separator}width=${width}`;
}

/**
 * The line the reader copies: product, colour, size.
 *
 * Built here rather than in the template so the copy button and the visible
 * text can never drift apart -- copying something different from what is on
 * screen is worse than having no button.
 */
export function buildLineText(row: DashboardRow): string {
  return [row.name, row.color, row.size].filter(Boolean).join(' — ');
}

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

function renderLine(row: DashboardRow): string {
  const text = buildLineText(row);
  const thumb = thumbnailUrl(row.image_url);
  // A restock is the one event the reader is waiting for, so it gets a marker.
  // Everything else stays plain -- a badge on every line marks nothing.
  const restocked = row.latest_event === 'RESTOCK' ? '<span class="badge" title="Vừa có hàng lại">RESTOCK</span>' : '';

  return `<li>
  ${thumb ? `<img class="thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">` : '<span class="thumb blank"></span>'}
  <span class="body">
    <a class="line" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>${restocked}
    <span class="meta">${escapeHtml(formatMoney(row.price, row.currency))}</span>
  </span>
  <button class="copy" type="button" data-copy="${escapeHtml(text)}" title="Copy tên">Copy</button>
</li>`;
}

function renderColumn(title: string, tone: 'ok' | 'out', rows: DashboardRow[]): string {
  return `<section class="col ${tone}">
  <h2><span class="dot"></span>${escapeHtml(title)} <span class="count">${rows.length}</span></h2>
  ${
    rows.length === 0
      ? '<p class="empty">Không có mục nào.</p>'
      : `<ul>${rows.map(renderLine).join('\n')}</ul>`
  }
</section>`;
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

  const available = rows.filter((r) => r.status === 'AVAILABLE');
  const soldOut = rows.filter((r) => r.status === 'SOLD_OUT');
  // UNKNOWN means the check failed, which is NOT sold out. Putting it in the
  // red column would tell the reader an item is gone when nobody established
  // that, so it gets its own line rather than being folded into either side.
  const unknown = rows.filter((r) => r.status === 'UNKNOWN');

  const lastChecked = rows.reduce<string | null>(
    (latest, r) => (!latest || r.last_checked_at > latest ? r.last_checked_at : latest),
    null
  );

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supreme JP — Còn hàng / Hết hàng</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; color:#111; font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { padding:18px 22px; border-bottom:1px solid #e6e6e6; }
  h1 { margin:0; font-size:17px; }
  .sub { color:#777; font-size:12px; margin-top:3px; }
  form { display:flex; gap:8px; flex-wrap:wrap; align-items:center; padding:14px 22px; border-bottom:1px solid #eee; }
  select, button, .btn { font:inherit; font-size:13px; padding:7px 11px; border:1px solid #d5d5d5; border-radius:7px; background:#fff; color:#111; }
  .btn { text-decoration:none; }
  .btn.primary { background:#111; color:#fff; border-color:#111; }
  main { display:grid; grid-template-columns:1fr 1fr; gap:0; }
  @media (max-width: 860px) { main { grid-template-columns:1fr; } }
  .col { padding:16px 22px; min-width:0; }
  .col + .col { border-left:1px solid #eee; }
  @media (max-width: 860px) { .col + .col { border-left:0; border-top:1px solid #eee; } }
  h2 { font-size:13px; letter-spacing:.03em; text-transform:uppercase; margin:0 0 12px; display:flex; align-items:center; gap:8px; }
  .dot { width:11px; height:11px; border-radius:50%; display:inline-block; }
  .col.ok .dot { background:#22a447; }
  .col.out .dot { background:#dc2626; }
  .count { color:#888; font-weight:400; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid #f2f2f2; }
  .thumb { width:40px; height:40px; object-fit:cover; border-radius:5px; background:#f4f4f4; flex:0 0 40px; }
  .thumb.blank { display:inline-block; }
  .body { flex:1; min-width:0; }
  .line { display:block; text-decoration:none; font-weight:500; overflow-wrap:anywhere; }
  .col.ok .line { color:#15803d; }
  .col.out .line { color:#b91c1c; }
  .meta { font-size:12px; color:#888; }
  .badge { font-size:10px; font-weight:700; color:#15803d; border:1px solid #22a447; border-radius:4px; padding:0 4px; margin-left:6px; vertical-align:1px; }
  .copy { flex:0 0 auto; cursor:pointer; color:#666; font-size:12px; padding:4px 8px; }
  .copy:hover { background:#f4f4f4; }
  .copy.done { color:#15803d; border-color:#22a447; }
  .empty { color:#999; font-size:13px; }
  .note { padding:12px 22px; color:#9a6b00; background:#fff8e6; border-top:1px solid #f0e0b0; font-size:13px; }
</style>
</head>
<body>
<header>
  <h1>Supreme JP — Còn hàng / Hết hàng</h1>
  <div class="sub">${rows.length} mục &middot; cập nhật ${escapeHtml(formatWhen(lastChecked))} (${escapeHtml(timeZoneLabel())}) &middot; mỗi màu là một sản phẩm riêng</div>
</header>

<form method="get">
  <select name="category" aria-label="Danh mục">
    <option value="">Tất cả danh mục</option>
    ${categories.map((c) => option(c, filters.category)).join('')}
  </select>
  <select name="event" aria-label="Sự kiện">
    <option value="">Mọi sự kiện</option>
    ${EVENTS.map((e) => option(e, filters.event)).join('')}
  </select>
  <select name="status" aria-label="Trạng thái">
    <option value="">Cả hai cột</option>
    ${STATUSES.map((s) => option(s, filters.status)).join('')}
  </select>
  <button type="submit">Lọc</button>
  <a class="btn" href="/export?format=csv${exportQuery ? '&' + exportQuery : ''}">Tải CSV</a>
  <a class="btn primary" href="/export?format=xlsx${exportQuery ? '&' + exportQuery : ''}">Tải Excel</a>
</form>

<main>
  ${renderColumn('Còn hàng', 'ok', available)}
  ${renderColumn('Hết hàng', 'out', soldOut)}
</main>

${
  unknown.length > 0
    ? `<p class="note">${unknown.length} mục chưa kiểm tra được ở lần quét gần nhất. Chúng <strong>không</strong> được xếp vào "hết hàng" — chưa ai xác nhận điều đó.</p>`
    : ''
}

<script>
  // Copies the same string the line displays. The text lives in a data
  // attribute built server-side, so what is copied and what is read can never
  // drift apart.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy');
    if (!btn) return;
    var text = btn.getAttribute('data-copy') || '';
    navigator.clipboard.writeText(text).then(function () {
      var previous = btn.textContent;
      btn.textContent = 'Đã copy';
      btn.classList.add('done');
      setTimeout(function () { btn.textContent = previous; btn.classList.remove('done'); }, 1200);
    }).catch(function () {
      // Clipboard needs a secure context. Say so rather than failing silently.
      btn.textContent = 'Không copy được';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
    });
  });
</script>
</body>
</html>`;
}
