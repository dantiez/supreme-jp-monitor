// Tests for what the customer actually sees: the Discord alert, the exported
// spreadsheet, and the dashboard markup.
//
// The negative assertions matter most here too: silence when nothing changed,
// an empty cell rather than 0 for an unknown price, and escaped third-party
// product names.

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildDiscordMessage } from '../src/notify/discord-notifier.js';
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
    const html = renderDashboard([row({ name: '<img src=x onerror=1>' })], [], {});
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
      [],
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
    const html = renderDashboard([row()], [], {});
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
    const html = renderDashboard([row({ status: 'UNKNOWN' })], [], {});
    expect(html).toContain('chưa kiểm tra được');
  });

  it('marks a restocked line so the awaited event stands out', () => {
    const html = renderDashboard([row({ latest_event: 'RESTOCK' })], [], {});
    expect(html).toContain('RESTOCK</span>');
  });

  it('carries active filters into the export links', () => {
    const html = renderDashboard([row()], ['tops'], { status: 'AVAILABLE' });
    expect(html).toContain('/export?format=csv&status=AVAILABLE');
    expect(html).toContain('/export?format=xlsx&status=AVAILABLE');
  });
});
