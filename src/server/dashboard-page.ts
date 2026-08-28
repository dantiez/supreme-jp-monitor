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
import {
  groupByWatchList,
  nothingChanged as noChanges,
  countUnknown
} from '../core/watch-list-grouping.js';

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

interface ColumnOptions {
  note?: string;
  /**
   * Show the note alone and leave the list out.
   *
   * The count goes with it: these rows still exist, so printing 0 would be a
   * lie, and printing 472 above nothing would be a dangling number.
   */
  collapsed?: boolean;
}

function renderColumn(
  title: string,
  tone: 'ok' | 'out' | 'new',
  rows: DashboardRow[],
  options: ColumnOptions = {}
): string {
  const { note, collapsed = false } = options;

  return `<section class="col ${tone}">
  <h2><span class="dot"></span>${escapeHtml(title)}${
    collapsed ? '' : ` <span class="count">${rows.length}</span>`
  }</h2>
  ${note ? `<p class="col-note">${escapeHtml(note)}</p>` : ''}
  ${
    collapsed
      ? ''
      : rows.length === 0
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

  // Three groups against the watch list, not two against current stock. See
  // core/watch-list-grouping.ts for what each one means and why a size that was
  // sold out before and is sold out now appears in none of them.
  const groups = groupByWatchList(rows);

  // No baseline anywhere means nobody has pressed "Khởi tạo danh sách" yet.
  // Distinct from an empty database: rows can exist with no list behind them,
  // and telling those two apart is the difference between "press the button"
  // and "something is wrong".
  const needsInit = rows.length > 0 && rows.every((r) => r.previous_status === null);
  const noData = rows.length === 0;

  // Read off the groups the reader is looking at rather than an event tally.
  // A count disagreeing with the columns under it is worse than no count.
  const quiet = !needsInit && !noData && noChanges(groups);

  // Never grouped, always reported: a failed check is not a sell-out.
  const unknownCount = countUnknown(rows);

  const goneNote = quiet ? 'Lần quét gần nhất: không có thay đổi nào.' : undefined;

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
  main.three { grid-template-columns:1fr 1fr 1fr; }
  /* Three columns need more room than two before they turn into slivers. */
  @media (max-width: 1200px) { main.three { grid-template-columns:1fr 1fr; } }
  @media (max-width: 860px) { main, main.three { grid-template-columns:1fr; } }
  .col { padding:16px 22px; min-width:0; }
  .col + .col { border-left:1px solid #eee; }
  @media (max-width: 860px) { .col + .col { border-left:0; border-top:1px solid #eee; } }
  h2 { font-size:13px; letter-spacing:.03em; text-transform:uppercase; margin:0 0 12px; display:flex; align-items:center; gap:8px; }
  .dot { width:11px; height:11px; border-radius:50%; display:inline-block; }
  .col.ok .dot { background:#22a447; }
  .col.out .dot { background:#dc2626; }
  .col.new .dot { background:#2563eb; }
  .count { color:#888; font-weight:400; }
  ul { list-style:none; margin:0; padding:0; }
  li { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid #f2f2f2; }
  .thumb { width:40px; height:40px; object-fit:cover; border-radius:5px; background:#f4f4f4; flex:0 0 40px; }
  .thumb.blank { display:inline-block; }
  .body { flex:1; min-width:0; }
  .line { display:block; text-decoration:none; font-weight:500; overflow-wrap:anywhere; }
  .col.ok .line { color:#15803d; }
  .col.out .line { color:#b91c1c; }
  .col.new .line { color:#1d4ed8; }
  .meta { font-size:12px; color:#888; }
  .badge { font-size:10px; font-weight:700; color:#15803d; border:1px solid #22a447; border-radius:4px; padding:0 4px; margin-left:6px; vertical-align:1px; }
  .copy { flex:0 0 auto; cursor:pointer; color:#666; font-size:12px; padding:4px 8px; }
  .copy:hover { background:#f4f4f4; }
  .copy.done { color:#15803d; border-color:#22a447; }
  .empty { color:#999; font-size:13px; }
  .scan { background:#15803d; color:#fff; border-color:#15803d; cursor:pointer; display:inline-flex; align-items:center; gap:7px; }
  .scan:disabled { background:#9ccbaa; border-color:#9ccbaa; cursor:default; }
  .init { cursor:pointer; display:inline-flex; align-items:center; gap:7px; }
  .init:disabled { color:#aaa; border-color:#e4e4e4; cursor:default; }
  /* Highlighted only while no list exists -- the one moment it is the thing to
     press. Never disabled, so a deliberate re-seed stays possible. */
  .init.wanted { border-color:#2563eb; color:#1d4ed8; font-weight:600; }
  .init .spin { border-color:rgba(0,0,0,.2); border-top-color:#333; }
  /* Turns for as long as the SERVER says it is scanning, so the motion tracks
     real work rather than an open request. */
  .spin { width:13px; height:13px; border:2px solid rgba(255,255,255,.45); border-top-color:#fff;
          border-radius:50%; display:inline-block; animation:spin .8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  /* Motion is the only cue for readers who suppress animation, so the disabled
     button and its "Đang quét…" label have to carry the message alone. */
  @media (prefers-reduced-motion: reduce) { .spin { animation:none; } }
  .scan-status { font-size:12px; color:#666; }
  .col-note { margin:-4px 0 10px; font-size:13px; color:#666; background:#f6f8f6; border:1px solid #e4eae4; border-radius:6px; padding:6px 10px; }
  /* A result with changes must not look like a result without any. Someone who
     has listed these items for resale needs to notice, not scan past. */
  #scan-result { display:none; padding:12px 22px; border-bottom:1px solid #eee; font-size:14px; }
  #scan-result.show { display:block; }
  #scan-result.changed { background:#fff7e6; border-bottom-color:#f0d9a0; }
  #scan-result.quiet { background:#f6f8f6; color:#555; }
  #scan-result .lost { color:#b91c1c; font-weight:600; }
  #scan-result .gained { color:#15803d; font-weight:600; }
  #scan-result a, #scan-result button { margin-left:10px; font-size:13px; }
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
  <button type="button" id="scan-btn" class="scan">Quét ngay</button>
  <!-- Its own control rather than a label the scan button borrows. The two do
       different things -- one measures against the list, the other replaces it
       -- and a button that silently changes meaning is the harder one to trust.
       The highlight class only draws the eye; it stays clickable either way,
       because re-seeding after acting on a batch is a real thing to want. -->
  <button type="button" id="init-btn" class="btn init${
    needsInit || noData ? ' wanted' : ''
  }" data-has-list="${needsInit || noData ? '' : '1'}">Khởi tạo danh sách</button>
  <span id="scan-status" class="scan-status"></span>
  <!-- Always present, not only after a scan that found something. The banner's
       "Xem chi tiết" link appears only when there were changes, so without this
       there is no way to reach the history from here on a quiet day. -->
  <a class="btn" href="/changes">Xem thay đổi</a>
  <a class="btn" href="/export?format=csv${exportQuery ? '&' + exportQuery : ''}">Tải CSV</a>
  <a class="btn primary" href="/export?format=xlsx${exportQuery ? '&' + exportQuery : ''}">Tải Excel</a>
</form>

<div id="scan-result"></div>

${
  needsInit
    ? `<p class="note">Chưa có danh sách theo dõi. Bấm <strong>Khởi tạo danh sách</strong> để chốt danh sách hàng đang còn — từ lần quét sau, mọi thay đổi sẽ được so với danh sách này.</p>`
    : ''
}

<main class="three">
  ${renderColumn('Còn hàng', 'ok', groups.still)}
  ${renderColumn('Hết hàng', 'out', groups.gone, { note: goneNote, collapsed: quiet })}
  ${renderColumn('Sản phẩm mới', 'new', groups.fresh)}
</main>

${
  unknownCount > 0
    ? `<p class="note">${unknownCount} mục chưa kiểm tra được ở lần quét gần nhất. Chúng <strong>không</strong> được xếp vào "hết hàng" — chưa ai xác nhận điều đó.</p>`
    : ''
}

<script>
  // The scan takes about 100 seconds, so the button starts it and the page
  // polls. The spinner is driven by the polled running flag, never by an open
  // request -- it has to mean "the server is scanning", which survives a
  // reload, a second tab, and this page being closed and reopened mid-scan.
  (function () {
    var btn = document.getElementById('scan-btn');
    var initBtn = document.getElementById('init-btn');
    var out = document.getElementById('scan-status');
    if (!btn || !out) return;

    var buttons = [btn, initBtn];
    // Captured before anything is overwritten: setBusy puts each label back
    // where it found it, so neither button can end up wearing the other's name.
    var labels = new Map();
    buttons.forEach(function (b) { if (b) labels.set(b, b.textContent); });
    var active = btn;
    var timer = null;

    var banner = document.getElementById('scan-result');

    // Names the reader thinks in, not the event codes the database stores.
    var LOST = { SOLD_OUT: 'vừa hết hàng', DELISTED: 'bị gỡ khỏi sàn' };
    var GAINED = { RESTOCK: 'có hàng lại', RELISTED: 'lên lại sàn',
                   NEW_PRODUCT: 'sản phẩm mới', NEW_VARIANT: 'size mới' };

    function parts(map, byEvent) {
      var out = [];
      for (var key in map) {
        if (byEvent[key]) out.push(byEvent[key] + ' ' + map[key]);
      }
      return out;
    }

    function showResult(l) {
      if (!banner) return;
      if (!l.ok) {
        banner.className = 'show changed';
        banner.innerHTML = '<span class="lost">Lần quét LỖI:</span> ' + (l.error || 'không rõ');
        return;
      }

      var lost = parts(LOST, l.byEvent || {});
      var gained = parts(GAINED, l.byEvent || {});
      var priced = (l.byEvent || {}).PRICE_CHANGED || 0;

      if (!lost.length && !gained.length && !priced) {
        // Said plainly rather than left blank: "nothing changed" is a real
        // answer, and a blank banner reads as the scan not having run.
        banner.className = 'show quiet';
        banner.textContent = 'Đã quét ' + l.scanned + ' sản phẩm — không có gì thay đổi so với lần trước.';
        return;
      }

      var html = '';
      if (lost.length) html += '<span class="lost">Mất hàng: ' + lost.join(', ') + '</span>. ';
      if (gained.length) html += '<span class="gained">Thêm hàng: ' + gained.join(', ') + '</span>. ';
      if (priced) html += priced + ' món đổi giá. ';
      html += '<a href="/changes">Xem chi tiết</a>' +
              '<button type="button" id="reload-btn">Tải lại danh sách</button>';

      banner.className = 'show changed';
      banner.innerHTML = html;
      var rb = document.getElementById('reload-btn');
      // Reloading is offered, never forced: the reader may be part-way through
      // copying a line, and yanking the page out from under them to show a
      // fresher one is not an improvement.
      if (rb) rb.addEventListener('click', function () { location.reload(); });
    }

    function describe(state) {
      if (state.running) return 'Đang quét… (khoảng 100 giây)';
      if (!state.last) return '';
      var l = state.last;
      if (!l.ok) return 'Lần quét trước lỗi.';
      return 'Xong sau ' + Math.round(l.durationMs / 1000) + 's.';
    }

    var shownFinish = null;

    function render(state) {
      buttons.forEach(function (b) { if (b) b.disabled = state.running; });
      setBusy(active, state.running);
      out.textContent = describe(state);

      // Only announce a result once. Polling repeats the same finished state,
      // and re-rendering it would reset the banner while it is being read.
      if (!state.running && state.last && state.last.finishedAt !== shownFinish) {
        shownFinish = state.last.finishedAt;
        showResult(state.last);
      }
      if (!state.running && timer) { clearInterval(timer); timer = null; }

      // Once any scan has run there is a list, so stop shouting about the
      // initialise button. It stays clickable -- only the highlight goes.
      if (!state.running && state.last && initBtn) {
        initBtn.classList.remove('wanted');
        initBtn.setAttribute('data-has-list', '1');
      }
    }

    function poll() {
      fetch('/api/scan/status').then(function (r) { return r.json(); }).then(render).catch(function () {});
    }

    // Spinner on the button that was actually pressed; the other only greys
    // out. Turning both would say two scans are running when one is.
    function setBusy(button, busy) {
      if (!button) return;
      button.innerHTML = busy
        ? '<span class="spin" aria-hidden="true"></span>Đang quét…'
        : labels.get(button);
      // Read aloud by screen readers, which cannot see a turning circle.
      button.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    function start(button, initialise) {
      buttons.forEach(function (b) { if (b) b.disabled = true; });
      active = button;
      // Immediately, without waiting for the first poll: a button that sits
      // still for three seconds after a click reads as a click that missed.
      setBusy(button, true);
      out.textContent = 'Đang bắt đầu…';

      fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialise: initialise })
      })
        .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
        .then(function (r) {
          if (r.status === 409) out.textContent = 'Đã có một lần quét đang chạy.';
          if (r.body && r.body.state) render(r.body.state);
          if (!timer) timer = setInterval(poll, 3000);
        })
        .catch(function () {
          // Stop the spinner too, or it turns forever over a scan that never
          // started -- the one thing worse than no feedback is false feedback.
          buttons.forEach(function (b) { if (b) b.disabled = false; });
          setBusy(button, false);
          out.textContent = 'Không gọi được máy chủ.';
        });
    }

    btn.addEventListener('click', function () { start(btn, false); });

    if (initBtn) {
      initBtn.addEventListener('click', function () {
        // Re-seeding throws away the comparison baseline: everything in stock
        // becomes green and the red items still waiting to be pulled disappear
        // without being dealt with. Worth asking about. The first run, where
        // there is nothing to lose, is not.
        if (
          initBtn.getAttribute('data-has-list') === '1' &&
          !window.confirm(
            'Việc này chốt lại danh sách theo dõi bằng hàng đang còn.' +
              String.fromCharCode(10, 10) +
              'Các món đang ở cột ĐỎ sẽ biến mất khỏi đó mà chưa được xử lý.' +
              String.fromCharCode(10, 10) + 'Tiếp tục?'
          )
        ) {
          return;
        }
        start(initBtn, true);
      });
    }

    // A scan may already be running when the page loads.
    poll();
  })();

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
