// Tests for what the customer actually sees: the Discord alert, the exported
// spreadsheet, and the dashboard markup.
//
// The negative assertions matter most here too: silence when nothing changed,
// an empty cell rather than 0 for an unknown price, and escaped third-party
// product names.

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildDiscordMessage,
  listingChangeToDetected
} from '../src/notify/discord-notifier.js';
import { DetectedChange } from '../src/core/change-detector.js';
import {
  generateCsv,
  generateXlsxBuffer,
  buildExportFilename
} from '../src/server/export-writer.js';
import { DashboardRow } from '../src/db/monitor-repository.js';
import {
  escapeHtml,
  formatMoney,
  renderDashboard,
  thumbnailUrl,
  buildLineText
} from '../src/server/dashboard-page.js';
import { formatWhen, timeZoneLabel } from '../src/format-time.js';

function change(over: Partial<DetectedChange> = {}): DetectedChange {
  return {
    handle: 'h1',
    productName: 'Box Logo Tee',
    size: 'Large',
    color: 'Black',
    url: 'https://jp.supreme.com/products/h1',
    event: 'RESTOCK',
    previousStatus: 'SOLD_OUT',
    currentStatus: 'AVAILABLE',
    previousPrice: 15400,
    currentPrice: 15400,
    currency: 'JPY',
    ...over
  };
}

describe('Discord message', () => {
  it('says nothing when nothing changed', () => {
    // A monitor that posts "0 changes" every two hours trains its readers to
    // ignore it, and the next real restock scrolls past unread.
    expect(buildDiscordMessage([])).toBeNull();
  });

  it('puts RESTOCK first, because it is the only actionable event', () => {
    const message = buildDiscordMessage([
      change({ event: 'SOLD_OUT' }),
      change({ event: 'PRICE_CHANGED' }),
      change({ event: 'RESTOCK' })
    ]);
    expect(message!.embeds[0]!.title).toContain('Back in stock');
  });

  it('includes colour, size and price so the alert is actionable alone', () => {
    const message = buildDiscordMessage([change()]);
    expect(message!.embeds[0]!.description).toBe('Black | Size Large | ¥15,400');
    expect(message!.embeds[0]!.url).toBe('https://jp.supreme.com/products/h1');
  });

  it('shows a price move as before -> after', () => {
    const message = buildDiscordMessage([
      change({ event: 'PRICE_CHANGED', previousPrice: 15400, currentPrice: 17600 })
    ]);
    expect(message!.embeds[0]!.description).toContain('¥15,400 -> ¥17,600');
  });

  it('never prints a currency symbol against an unknown amount', () => {
    const message = buildDiscordMessage([
      change({ event: 'PRICE_CHANGED', previousPrice: null, currentPrice: 17600 })
    ]);
    expect(message!.embeds[0]!.description).toContain('unknown -> ¥17,600');
  });

  it('caps embeds at the Discord limit and counts the remainder out loud', () => {
    // A drop creates hundreds of changes. Showing 10 of 50 silently would read
    // as 10; the overflow count tells the reader to open the dashboard.
    const many = Array.from({ length: 25 }, (_, i) => change({ productName: `Item ${i}` }));
    const message = buildDiscordMessage(many);
    expect(message!.embeds).toHaveLength(10);
    expect(message!.content).toContain('15 more');
  });

  it('summarises counts across every event type', () => {
    const message = buildDiscordMessage([
      change({ event: 'RESTOCK' }),
      change({ event: 'RESTOCK' }),
      change({ event: 'SOLD_OUT' })
    ]);
    expect(message!.content).toContain('Back in stock: 2');
    expect(message!.content).toContain('Sold out: 1');
  });
});

function row(over: Partial<DashboardRow> = {}): DashboardRow {
  return {
    handle: 'h1',
    name: 'Box Logo Tee',
    color: 'Black',
    category: 'tops',
    image_url: 'https://jp.supreme.com/cdn/shop/files/tee.jpg?v=1',
    size: 'Large',
    sku: 'FW26TS1-BLK-L',
    price: 15400, currency: 'JPY',
    // Tracked by default: most rows in these tests stand for stock the reader
    // is already watching. Override to null for something outside the list.
    previous_status: 'AVAILABLE',
    status: 'AVAILABLE',
    url: 'https://jp.supreme.com/products/h1',
    delisted_at: null,
    latest_event: 'RESTOCK',
    latest_event_at: '2026-08-17T02:00:00.000Z',
    first_seen_at: '2026-08-10T02:00:00.000Z',
    last_checked_at: '2026-08-17T02:00:00.000Z',
    ...over
  };
}

describe('export', () => {
  it('writes a header plus one row per tracked size', () => {
    const csv = generateCsv([row(), row({ size: 'Medium' })]);
    expect(csv.split('\r\n')).toHaveLength(3);
  });

  it('exports an unknown price as an empty cell, never 0', () => {
    // 0 would be averaged into a total as though someone had observed it.
    const line = generateCsv([row({ price: null, currency: null })]).split('\r\n')[1]!;
    expect(line).toContain('"",');
    expect(line).not.toContain('"0"');
  });

  it('quotes fields so a comma in a product name cannot shift columns', () => {
    const line = generateCsv([row({ name: 'Tee, Box Logo "Black"' })]).split('\r\n')[1]!;
    expect(line.startsWith('"Tee, Box Logo ""Black"""')).toBe(true);
  });

  it('leads with a BOM so Excel reads Japanese names correctly', () => {
    expect(generateCsv([row()]).charCodeAt(0)).toBe(0xfeff);
  });

  it('omits unknown cells from the workbook so AVERAGE skips them', () => {
    const sheet = XLSX.read(generateXlsxBuffer([row({ price: null, currency: null })]), {
      type: 'buffer'
    }).Sheets['Supreme JP Stock']!;
    // Column G is Price.
    expect(sheet['G2']).toBeUndefined();
  });

  it('keeps a known price numeric', () => {
    const sheet = XLSX.read(generateXlsxBuffer([row()]), { type: 'buffer' })
      .Sheets['Supreme JP Stock']!;
    expect(sheet['G2'].v).toBe(15400);
    expect(sheet['G2'].t).toBe('n');
  });

  it('names the file with the run date', () => {
    expect(buildExportFilename('csv', new Date('2026-08-17T00:00:00Z'))).toBe(
      'supreme_jp_stock_20260817.csv'
    );
  });
});

describe('timestamps are shown in the display zone', () => {
  it('renders a UTC instant as Tokyo time', () => {
    // Storage stays UTC; only the reading changes. 02:00Z is 11:00 JST.
    process.env.DISPLAY_TIMEZONE = 'Asia/Tokyo';
    expect(formatWhen('2026-08-27T02:00:00.000Z')).toBe('2026-08-27 11:00');
    expect(timeZoneLabel()).toBe('GMT+9');
  });

  it('honours a different zone without touching what is stored', () => {
    process.env.DISPLAY_TIMEZONE = 'Asia/Ho_Chi_Minh';
    expect(formatWhen('2026-08-27T02:00:00.000Z')).toBe('2026-08-27 09:00');
    process.env.DISPLAY_TIMEZONE = 'Asia/Tokyo';
  });

  it('shows an em dash for a missing or broken timestamp', () => {
    // Never "Invalid Date", and never a silently wrong epoch.
    expect(formatWhen(null)).toBe('—');
    expect(formatWhen('not a date')).toBe('—');
  });

  it('names the zone in the export headers so a time is never ambiguous', () => {
    const csv = generateCsv([row()]);
    expect(csv.split('\r\n')[0]).toContain('First Seen At (GMT+9)');
  });
});

describe('dashboard rendering', () => {
  it('escapes third-party product text', () => {
    // Product names come from Supreme and land straight in the page.
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;'
    );
    const html = renderDashboard([row({ name: '<img src=x onerror=1>' })], {});
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders an unknown price as a dash, not 0', () => {
    expect(formatMoney(null, 'JPY')).toBe('—');
    expect(formatMoney(15400, 'JPY')).toBe('¥15,400');
  });

  it('splits the rows into a green column and a red one', () => {
    const html = renderDashboard(
      [row({ status: 'AVAILABLE' }), row({ size: 'Small', status: 'SOLD_OUT' })],
      {}
    );
    expect(html).toContain('Còn hàng');
    expect(html).toContain('Hết hàng');
  });

  it('puts the colour in every line, so two sizes cannot look identical', () => {
    // Supreme ships one product per colourway. "Box Logo — M" alone can name
    // several different garments, and the person copying it cannot tell which.
    expect(buildLineText(row())).toBe('Box Logo Tee — Black — Large');
  });

  it('omits a missing colour rather than printing an empty separator', () => {
    expect(buildLineText(row({ color: null }))).toBe('Box Logo Tee — Large');
  });

  it('copies exactly the text the line displays', () => {
    const html = renderDashboard([row()], {});
    // The button carries the same string the anchor renders; if these drift,
    // the reader pastes something other than what they read.
    expect(html).toContain('data-copy="Box Logo Tee — Black — Large"');
    expect(html).toContain('>Box Logo Tee — Black — Large</a>');
  });

  it('requests a thumbnail, never the full-size image', () => {
    // 834 KB original vs 11 KB at width=200; across ~300 products that is the
    // difference between 248 MB and a page that loads.
    expect(thumbnailUrl('https://cdn/x.jpg?v=1')).toBe('https://cdn/x.jpg?v=1&width=200');
    expect(thumbnailUrl('https://cdn/x.jpg')).toBe('https://cdn/x.jpg?width=200');
    expect(thumbnailUrl(null)).toBeNull();
  });

  it('never files an UNKNOWN row under sold out', () => {
    // A failed check is not a sell-out. Colouring it red would tell the reader
    // an item is gone when nobody established that.
    const html = renderDashboard([row({ status: 'UNKNOWN' })], {});
    expect(html).toContain('chưa kiểm tra được');
  });

  it('marks a restocked line so the awaited event stands out', () => {
    const html = renderDashboard([row({ latest_event: 'RESTOCK' })], {});
    expect(html).toContain('RESTOCK</span>');
  });
});

describe('listing changes reach Discord', () => {
  const listing = (event: 'DELISTED' | 'RELISTED') => ({
    handle: 'h1',
    productName: 'Box Logo Tee',
    color: 'Black',
    url: 'https://jp.supreme.com/products/h1',
    event
  });

  it('announces a product removed from the site', () => {
    // These were being stored and shown on the dashboard but never announced,
    // so a product could vanish and the channel would say nothing.
    const message = buildDiscordMessage([listingChangeToDetected(listing('DELISTED'))]);
    expect(message!.embeds[0]!.title).toContain('Removed from the site');
    expect(message!.content).toContain('Removed from the site: 1');
  });

  it('does not call a removal a sell-out', () => {
    // Sold out means the shop has none; removed means it no longer offers it.
    const message = buildDiscordMessage([listingChangeToDetected(listing('DELISTED'))]);
    expect(message!.embeds[0]!.title).not.toContain('Sold out');
  });

  it('ranks a relisting near the top, beside a restock', () => {
    const message = buildDiscordMessage([
      change({ event: 'SOLD_OUT' }),
      listingChangeToDetected(listing('RELISTED'))
    ]);
    expect(message!.embeds[0]!.title).toContain('Listed again');
  });

  it('carries no size or price, because a removal has neither', () => {
    const d = listingChangeToDetected(listing('DELISTED'));
    expect(d.size).toBeNull();
    expect(d.currentPrice).toBeNull();
    expect(d.color).toBe('Black');
  });
});

describe('the dashboard groups against the watch list', () => {
  const still = row({ previous_status: 'AVAILABLE', status: 'AVAILABLE', name: 'Still Selling' });
  const gone = row({ previous_status: 'AVAILABLE', status: 'SOLD_OUT', name: 'Sith Skateboard' });
  const fresh = row({ previous_status: 'SOLD_OUT', status: 'AVAILABLE', name: 'Brand New Cap' });
  const stale = row({ previous_status: 'SOLD_OUT', status: 'SOLD_OUT', name: 'Long Gone Tee' });

  it('puts each row in the group its watch-list membership dictates', () => {
    const html = renderDashboard([still, gone, fresh], {});
    const green = html.slice(html.indexOf('col ok'), html.indexOf('col out'));
    const red = html.slice(html.indexOf('col out'), html.indexOf('col new'));
    const blue = html.slice(html.indexOf('col new'));

    expect(green).toContain('Still Selling');
    expect(red).toContain('Sith Skateboard');
    expect(blue).toContain('Brand New Cap');
  });

  it('shows nothing that was already gone before this scan', () => {
    // Sold out then, sold out now: nothing to act on. Several hundred of these
    // are what buried the rows that mattered.
    const html = renderDashboard([still, stale], {});
    expect(html).not.toContain('Long Gone Tee');
  });

  it('says so, and empties the red column, when nothing moved', () => {
    const html = renderDashboard([still], {});
    expect(html).toContain('không có thay đổi nào');
  });

  it('stays quiet about that when something DID move', () => {
    expect(renderDashboard([still, gone], {})).not.toContain('không có thay đổi nào');
  });

  it('counts a new arrival as a change too', () => {
    // Only checking the sold-out half would call a scan that found thirty new
    // products "no changes".
    expect(renderDashboard([still, fresh], {})).not.toContain('không có thay đổi nào');
  });

  it('never files an unreadable size under sold out', () => {
    const unread = row({ previous_status: 'AVAILABLE', status: 'UNKNOWN', name: 'Unread Item' });
    const html = renderDashboard([still, unread], {});
    const red = html.slice(html.indexOf('col out'), html.indexOf('col new'));
    expect(red).not.toContain('Unread Item');
    expect(html).toContain('chưa kiểm tra được');
  });
});

describe('the three controls in the toolbar', () => {
  const tracked = row({ previous_status: 'AVAILABLE', status: 'AVAILABLE' });
  const untracked = row({ previous_status: null, status: 'AVAILABLE' });

  it('offers scan, changes and initialise at all times', () => {
    // Three separate controls. The initialise button used to be the scan
    // button wearing a different label, which meant it vanished after the
    // first run and a deliberate re-seed became impossible.
    const html = renderDashboard([tracked], {});
    expect(html).toContain('id="scan-btn"');
    expect(html).toContain('id="init-btn"');
    expect(html).toContain('href="/changes"');
    expect(html).toContain('Quét ngay');
    expect(html).toContain('Khởi tạo danh sách');
  });

  it('keeps all three before any list exists', () => {
    const html = renderDashboard([untracked], {});
    expect(html).toContain('id="scan-btn"');
    expect(html).toContain('id="init-btn"');
    expect(html).toContain('href="/changes"');
  });

  it('highlights initialise only while there is no list to lose', () => {
    expect(renderDashboard([untracked], {})).toContain('init wanted');
    expect(renderDashboard([tracked], {})).not.toContain('init wanted');
  });

  it('marks whether a list already exists, which is what gates the warning', () => {
    // The confirm fires only when re-seeding would discard a real baseline.
    expect(renderDashboard([tracked], {})).toContain('data-has-list="1"');
    expect(renderDashboard([untracked], {})).toContain('data-has-list=""');
  });

  it('does not claim "nothing changed" before a list exists', () => {
    // With no baseline every row is new, so the groups are not empty -- but
    // saying "nothing changed" against a list nobody made would be nonsense.
    const html = renderDashboard([row({ previous_status: null, status: 'SOLD_OUT' })], {});
    expect(html).not.toContain('không có thay đổi nào');
  });
});

describe('getting to the changes page', () => {
  it('offers the link whether or not the last scan found anything', () => {
    // The post-scan banner links there too, but only when there were changes.
    // On a quiet day that leaves no way through.
    for (const previous_status of [null, 'AVAILABLE', 'SOLD_OUT']) {
      expect(renderDashboard([row({ previous_status })], {})).toContain('href="/changes"');
    }
  });
});

describe('the toolbar holds three controls and nothing else', () => {
  const html = renderDashboard([row({ previous_status: 'AVAILABLE' })], {});
  const toolbar = html.slice(html.indexOf('<nav class="toolbar">'), html.indexOf('</nav>'));

  it('keeps scan, initialise and changes', () => {
    expect(toolbar).toContain('id="scan-btn"');
    expect(toolbar).toContain('id="init-btn"');
    expect(toolbar).toContain('href="/changes"');
  });

  it('carries no filters and no download links', () => {
    // Removed at the customer's request. /export still answers, so the files
    // are a URL away -- it is the buttons that are gone, not the capability.
    expect(toolbar).not.toContain('<select');
    expect(toolbar).not.toContain('/export');
    expect(html).not.toContain('Tải CSV');
    expect(html).not.toContain('Tải Excel');
  });
});
