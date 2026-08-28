// What the scan RECORDS about itself, as opposed to what it finds.
//
// The dashboard reads this number back to decide whether to tell the reader
// "nothing changed". That makes it a claim, not a statistic: if it is too low,
// the tool issues a false all-clear while stock is moving.
//
// Every dependency is mocked. This test must never reach the real database --
// it would be writing scan rows into live history to check arithmetic.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const finishScanRun = vi.fn();

vi.mock('../src/db/monitor-repository.js', () => ({
  ensureReady: vi.fn(),
  startScanRun: vi.fn(async () => 1),
  finishScanRun: (...args: unknown[]) => finishScanRun(...args),
  loadKnownHandles: vi.fn(async () => new Set(['still-here', 'gone-a', 'gone-b'])),
  loadKnownVariants: vi.fn(async () => new Map()),
  // delistedAt, not delisted_at: the repository maps the column before the
  // detector sees it, and `undefined !== null` would mark every product as
  // already withdrawn.
  loadKnownProducts: vi.fn(async () => [
    { handle: 'still-here', name: 'Still Here', color: null, url: 'u', delistedAt: null },
    { handle: 'gone-a', name: 'A', color: null, url: 'u', delistedAt: null },
    { handle: 'gone-b', name: 'B', color: null, url: 'u', delistedAt: null }
  ]),
  saveProduct: vi.fn(),
  recordChanges: vi.fn(),
  applyListingChanges: vi.fn()
}));

vi.mock('../src/notify/discord-notifier.js', () => ({ notifyChanges: vi.fn() }));

// One page, one product, declaring itself complete -- so the delisting check is
// allowed to run and the two known handles it no longer contains are withdrawn.
vi.mock('../src/core/supreme-client.js', () => ({
  collectionPath: (h: string) => `/collections/${h}`,
  productPath: (h: string) => `/products/${h}`,
  // Must declare the Japanese store: the scan refuses to record a catalogue
  // served by any other storefront, currency being the only way to tell.
  fetchPage: vi.fn(async () => ({
    ok: true,
    html: "<script>window.ShopifyAnalytics.meta.currency = 'JPY';</script>",
    status: 200
  }))
}));

vi.mock('../src/parsers/catalogue-parser.js', () => ({
  parseCataloguePage: () => ({
    totalCount: 1,
    products: [
      {
        handle: 'still-here',
        name: 'Still Here',
        url: 'https://jp.supreme.com/products/still-here',
        color: null,
        category: null,
        style: null,
        imageUrl: null,
        variants: []
      }
    ]
  })
}));

const { runScan } = await import('../src/core/scan-runner.js');

describe('the change count a scan records', () => {
  beforeEach(() => finishScanRun.mockClear());

  it('counts delistings, so a vanished product is never filed as "no changes"', async () => {
    const summary = await runScan({ notify: false });

    // All three products were already known, so nothing is new; the catalogue
    // now contains only one of them, so the other two are withdrawn.
    expect(summary.changes).toHaveLength(0);
    expect(summary.listingChanges).toHaveLength(2);

    // The number that reaches the database, and therefore the dashboard.
    expect(finishScanRun).toHaveBeenCalledWith(1, expect.objectContaining({
      changes: 2,
      status: 'ok'
    }));
  });
});
