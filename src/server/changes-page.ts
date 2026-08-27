// "What changed since the previous check" — one scan compared against the one
// before it.
//
// THIS IS PER SCAN, NOT PER DAY. The customer asked for it counted in runs:
// scan 2 against scan 1, scan 3 against scan 2, and so on. A daily baseline was
// considered and rejected with them, because it loses events: a size that sold
// out at 10:00 and returned at 14:00 looks identical to the morning baseline
// at both 12:00 and 14:00, so the second restock never surfaces. Comparing
// against the previous run catches every transition as it happens.
//
// The dashboard answers "what can I buy right now". This page answers "what
// moved". Two questions, two screens.

import { ChangeRow, ScanRunRow } from '../db/monitor-repository.js';
import { escapeHtml, formatMoney, thumbnailUrl } from './dashboard-page.js';
import { formatWhen, timeZoneLabel } from '../format-time.js';

/**
 * Which column an event belongs in.
 *
 * Green is "there is more to buy than before", red is "there is less". That is
 * the question the reader is asking, so a newly listed product sits beside a
 * restock, and a withdrawn one beside a sell-out.
 */
const GREEN_EVENTS = new Set(['RESTOCK', 'NEW_PRODUCT', 'NEW_VARIANT', 'RELISTED']);
const RED_EVENTS = new Set(['SOLD_OUT', 'DELISTED']);

const EVENT_LABEL: Record<string, string> = {
  RESTOCK: 'Có hàng lại',
  RELISTED: 'Lên lại sàn',
  NEW_PRODUCT: 'Sản phẩm mới',
  NEW_VARIANT: 'Size mới',
  SOLD_OUT: 'Vừa hết hàng',
  DELISTED: 'Gỡ khỏi sàn',
  PRICE_CHANGED: 'Đổi giá'
};

function lineText(row: ChangeRow): string {
  return [row.name, row.color, row.size].filter(Boolean).join(' — ');
}

function renderRow(row: ChangeRow): string {
  const text = lineText(row);
  const thumb = thumbnailUrl(row.image_url);
  const label = EVENT_LABEL[row.event] ?? row.event;

  const price =
    row.event === 'PRICE_CHANGED'
      ? `${formatMoney(row.previous_price, row.currency)} → ${formatMoney(row.current_price, row.currency)}`
      : formatMoney(row.current_price, row.currency);

  return `<li>
  ${thumb ? `<img class="thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">` : '<span class="thumb blank"></span>'}
  <span class="body">
    <a class="line" href="${escapeHtml(row.url)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>
    <span class="meta">${escapeHtml(label)} &middot; ${escapeHtml(price)}</span>
  </span>
  <button class="copy" type="button" data-copy="${escapeHtml(text)}" title="Copy tên">Copy</button>
</li>`;
}

function renderColumn(title: string, tone: 'ok' | 'out', rows: ChangeRow[]): string {
  return `<section class="col ${tone}">
  <h2><span class="dot"></span>${escapeHtml(title)} <span class="count">${rows.length}</span></h2>
  ${
    rows.length === 0
      ? '<p class="empty">Không có thay đổi nào.</p>'
      : `<ul>${rows.map(renderRow).join('\n')}</ul>`
  }
</section>`;
}

export interface ChangesPageInput {
  scans: ScanRunRow[];
  selected: ScanRunRow | null;
  /** The run immediately before the selected one, or null if none exists. */
  previous: ScanRunRow | null;
  changes: ChangeRow[];
  /** Used only for the very first scan, which has nothing to compare against. */
  inStock: ChangeRow[];
}

export function renderChangesPage(input: ChangesPageInput): string {
  const { scans, selected, previous, changes } = input;

  // The first scan ever has no predecessor. Showing an empty diff would read
  // as "nothing changed" when the truth is "there was nothing to compare to",
  // so it lists what is in stock instead - which is also what the customer
  // asked for: the first run needs no sold-out column.
  const isFirstScan = selected !== null && previous === null;

  const green = isFirstScan
    ? input.inStock
    : changes.filter((c) => GREEN_EVENTS.has(c.event));
  const red = isFirstScan ? [] : changes.filter((c) => RED_EVENTS.has(c.event));
  const priced = isFirstScan ? [] : changes.filter((c) => c.event === 'PRICE_CHANGED');

  const options = scans
    .map((s) => {
      const sel = selected && s.id === selected.id ? ' selected' : '';
      return `<option value="${s.id}"${sel}>#${s.id} · ${escapeHtml(formatWhen(s.started_at))} · ${s.changes_detected} thay đổi</option>`;
    })
    .join('');

  const subtitle = !selected
    ? 'Chưa có lần quét nào.'
    : isFirstScan
      ? `Lần quét đầu tiên (#${selected.id}) — chưa có gì để so sánh, nên đây là danh sách còn hàng.`
      : `Lần #${selected.id} (${escapeHtml(formatWhen(selected.started_at))}) so với lần #${previous!.id} (${escapeHtml(formatWhen(previous!.started_at))})`;

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Supreme JP — Thay đổi theo lần quét</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#fff; color:#111; font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { padding:18px 22px; border-bottom:1px solid #e6e6e6; }
  h1 { margin:0; font-size:17px; }
  .sub { color:#777; font-size:12px; margin-top:3px; }
  nav { padding:12px 22px; border-bottom:1px solid #eee; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  select, button, .btn { font:inherit; font-size:13px; padding:7px 11px; border:1px solid #d5d5d5; border-radius:7px; background:#fff; color:#111; }
  .btn { text-decoration:none; }
  .btn.primary { background:#111; color:#fff; border-color:#111; }
  main { display:grid; grid-template-columns:1fr 1fr; }
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
  .copy { flex:0 0 auto; cursor:pointer; color:#666; font-size:12px; padding:4px 8px; }
  .copy:hover { background:#f4f4f4; }
  .copy.done { color:#15803d; border-color:#22a447; }
  .empty { color:#999; font-size:13px; }
  .priced { padding:14px 22px; border-top:1px solid #eee; font-size:13px; color:#8a6d00; background:#fffdf5; }
  .priced ul { margin:6px 0 0; }
  .priced li { border:0; padding:2px 0; }
</style>
</head>
<body>
<header>
  <h1>Thay đổi theo lần quét</h1>
  <div class="sub">${subtitle} &middot; giờ ${escapeHtml(timeZoneLabel())}</div>
</header>

<nav>
  <form method="get" style="display:flex; gap:8px; align-items:center;">
    <select name="scan" aria-label="Lần quét" onchange="this.form.submit()">${options}</select>
    <noscript><button type="submit">Xem</button></noscript>
  </form>
  <a class="btn" href="/">Xem trạng thái hiện tại</a>
</nav>

<main>
  ${renderColumn(isFirstScan ? 'Còn hàng' : 'Thêm hàng', 'ok', green)}
  ${renderColumn('Mất hàng', 'out', red)}
</main>

${
  priced.length > 0
    ? `<div class="priced"><strong>Đổi giá (${priced.length})</strong><ul>${priced
        .map(
          (c) =>
            `<li>${escapeHtml(lineText(c))}: ${escapeHtml(formatMoney(c.previous_price, c.currency))} → ${escapeHtml(formatMoney(c.current_price, c.currency))}</li>`
        )
        .join('')}</ul></div>`
    : ''
}

<script>
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.copy');
    if (!btn) return;
    navigator.clipboard.writeText(btn.getAttribute('data-copy') || '').then(function () {
      var previous = btn.textContent;
      btn.textContent = 'Đã copy';
      btn.classList.add('done');
      setTimeout(function () { btn.textContent = previous; btn.classList.remove('done'); }, 1200);
    }).catch(function () {
      btn.textContent = 'Không copy được';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
    });
  });
</script>
</body>
</html>`;
}
