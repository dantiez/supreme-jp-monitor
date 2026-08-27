// The change detector decides every alert the customer receives. These tests
// care most about the alerts it must NOT send: a network failure must not read
// as a sell-out, and a first sighting must not read as a restock.

import { describe, it, expect } from 'vitest';
import {
  detectChanges,
  detectListingChanges,
  variantKey,
  KnownVariant,
  KnownProduct
} from '../src/core/change-detector.js';
import { ScrapedProduct, ScrapedVariant, StockStatus } from '../src/types.js';

function variant(over: Partial<ScrapedVariant> = {}): ScrapedVariant {
  return { size: 'Large', sku: 'FW26SH1-ORA-L', price: 22000, currency: 'JPY', status: 'AVAILABLE', ...over };
}

function product(over: Partial<ScrapedProduct> = {}): ScrapedProduct {
  return {
    handle: '0-fow3-gelgp4at',
    externalId: '7704752226654',
    name: 'Small Box Sweatshort',
    color: 'Orange',
    style: 'SH1',
    category: 'shorts',
    imageUrl: 'https://jp.supreme.com/cdn/x.jpg',
    url: 'https://jp.supreme.com/products/0-fow3-gelgp4at',
    variants: [variant()],
    ...over
  };
}

function known(over: Partial<KnownVariant> = {}): Map<string, KnownVariant> {
  const k: KnownVariant = {
    handle: '0-fow3-gelgp4at',
    size: 'Large',
    price: 22000,
    currency: 'JPY',
    status: 'AVAILABLE',
    ...over
  };
  return new Map([[variantKey(k.handle, k.size), k]]);
}

const TRACKED = new Set(['0-fow3-gelgp4at']);
const NOTHING = new Set<string>();
const NO_VARIANTS = new Map<string, KnownVariant>();

describe('NEW_PRODUCT', () => {
  it('fires for a handle never seen before', () => {
    const changes = detectChanges(product(), NOTHING, NO_VARIANTS);
    expect(changes.map((c) => c.event)).toEqual(['NEW_PRODUCT']);
  });

  it('does not repeat a NEW_VARIANT for every size of a new product', () => {
    // One drop should be one notification, not six.
    const p = product({
      variants: ['Small', 'Medium', 'Large'].map((size) => variant({ size }))
    });
    const events = detectChanges(p, NOTHING, NO_VARIANTS).map((c) => c.event);
    expect(events).toEqual(['NEW_PRODUCT']);
  });

  it('carries the product URL and colour so an alert is actionable', () => {
    const [change] = detectChanges(product(), NOTHING, NO_VARIANTS);
    expect(change!.url).toContain('jp.supreme.com/products/');
    expect(change!.color).toBe('Orange');
    expect(change!.size).toBeNull();
  });

  it('stays silent when the product is already tracked', () => {
    expect(detectChanges(product(), TRACKED, known())).toEqual([]);
  });
});

describe('NEW_VARIANT', () => {
  it('fires when a tracked product gains a size', () => {
    const p = product({ variants: [variant(), variant({ size: 'XXLarge' })] });
    const changes = detectChanges(p, TRACKED, known());
    expect(changes.map((c) => c.event)).toEqual(['NEW_VARIANT']);
    expect(changes[0]!.size).toBe('XXLarge');
  });
});

describe('SOLD_OUT and RESTOCK', () => {
  it('fires SOLD_OUT on available to sold out', () => {
    const p = product({ variants: [variant({ status: 'SOLD_OUT' })] });
    const [change] = detectChanges(p, TRACKED, known({ status: 'AVAILABLE' }));
    expect(change!.event).toBe('SOLD_OUT');
    expect(change!.previousStatus).toBe('AVAILABLE');
    expect(change!.currentStatus).toBe('SOLD_OUT');
  });

  it('fires RESTOCK on sold out to available', () => {
    // The single reason this tool exists.
    const p = product({ variants: [variant({ status: 'AVAILABLE' })] });
    const [change] = detectChanges(p, TRACKED, known({ status: 'SOLD_OUT' }));
    expect(change!.event).toBe('RESTOCK');
    expect(change!.size).toBe('Large');
  });

  it('stays silent when nothing moved', () => {
    expect(detectChanges(product(), TRACKED, known())).toEqual([]);
  });

  it('reports each size independently', () => {
    const p = product({
      variants: [
        variant({ size: 'Small', status: 'SOLD_OUT' }),
        variant({ size: 'Large', status: 'AVAILABLE' })
      ]
    });
    const knownBoth = new Map<string, KnownVariant>([
      [variantKey('0-fow3-gelgp4at', 'Small'), { handle: '0-fow3-gelgp4at', size: 'Small', price: 22000, currency: 'JPY', status: 'AVAILABLE' }],
      [variantKey('0-fow3-gelgp4at', 'Large'), { handle: '0-fow3-gelgp4at', size: 'Large', price: 22000, currency: 'JPY', status: 'SOLD_OUT' }]
    ]);
    const events = detectChanges(p, TRACKED, knownBoth).map((c) => `${c.size}:${c.event}`);
    expect(events).toEqual(['Small:SOLD_OUT', 'Large:RESTOCK']);
  });
});

describe('UNKNOWN never produces an event', () => {
  const cases: Array<[StockStatus, StockStatus]> = [
    ['AVAILABLE', 'UNKNOWN'],
    ['SOLD_OUT', 'UNKNOWN'],
    ['UNKNOWN', 'AVAILABLE'],
    ['UNKNOWN', 'SOLD_OUT'],
    ['UNKNOWN', 'UNKNOWN']
  ];

  it.each(cases)('stays silent going %s -> %s', (before, after) => {
    // A failed fetch must not alert that everything sold out, and the recovery
    // must not alert that everything came back.
    const p = product({ variants: [variant({ status: after })] });
    const changes = detectChanges(p, TRACKED, known({ status: before }));
    expect(changes.filter((c) => c.event === 'SOLD_OUT' || c.event === 'RESTOCK')).toEqual([]);
  });
});

describe('PRICE_CHANGED', () => {
  it('fires when a known price moves', () => {
    const p = product({ variants: [variant({ price: 17600, currency: 'JPY' })] });
    const [change] = detectChanges(p, TRACKED, known({ price: 15400, currency: 'JPY' }));
    expect(change!.event).toBe('PRICE_CHANGED');
    expect(change!.previousPrice).toBe(15400);
    expect(change!.currentPrice).toBe(17600);
  });

  it('fires even while the size stays sold out', () => {
    // Worth knowing before it returns to stock.
    const p = product({ variants: [variant({ status: 'SOLD_OUT', price: 17600, currency: 'JPY' })] });
    const events = detectChanges(
      p,
      TRACKED,
      known({ status: 'SOLD_OUT', price: 15400, currency: 'JPY' })
    ).map((c) => c.event);
    expect(events).toEqual(['PRICE_CHANGED']);
  });

  it('does not fire when a price appears out of null', () => {
    // That is the parser learning the field, not Supreme changing the price.
    const p = product({ variants: [variant({ price: 22000, currency: 'JPY' })] });
    const changes = detectChanges(p, TRACKED, known({ price: null }));
    expect(changes.filter((c) => c.event === 'PRICE_CHANGED')).toEqual([]);
  });

  it('does not fire when the price becomes unreadable', () => {
    const p = product({ variants: [variant({ price: null, currency: 'JPY' })] });
    const changes = detectChanges(p, TRACKED, known({ price: 22000, currency: 'JPY' }));
    expect(changes.filter((c) => c.event === 'PRICE_CHANGED')).toEqual([]);
  });

  it('does not fire when only the CURRENCY changed', () => {
    // The bug this guards. jp.supreme.com sometimes answers with the US store,
    // so a shirt recorded at 14800 JPY comes back as 148 USD while its actual
    // price never moved. Comparing the raw numbers would announce a 99% price
    // drop on a shop that changed nothing.
    const p = product({ variants: [variant({ price: 148, currency: 'USD' })] });
    const changes = detectChanges(p, TRACKED, known({ price: 14800, currency: 'JPY' }));
    expect(changes.filter((c) => c.event === 'PRICE_CHANGED')).toEqual([]);
  });

  it('does not fire when either side has no known currency', () => {
    const p = product({ variants: [variant({ price: 17600, currency: null })] });
    const changes = detectChanges(p, TRACKED, known({ price: 15400, currency: 'JPY' }));
    expect(changes.filter((c) => c.event === 'PRICE_CHANGED')).toEqual([]);
  });

  it('carries the currency on the change, so the alert can print it', () => {
    const p = product({ variants: [variant({ price: 17600, currency: 'JPY' })] });
    const [change] = detectChanges(p, TRACKED, known({ price: 15400, currency: 'JPY' }));
    expect(change!.currency).toBe('JPY');
  });

  it('reports a sell-out and a reprice in the same check', () => {
    const p = product({ variants: [variant({ status: 'SOLD_OUT', price: 17600, currency: 'JPY' })] });
    const events = detectChanges(
      p,
      TRACKED,
      known({ status: 'AVAILABLE', price: 15400, currency: 'JPY' })
    ).map((c) => c.event);
    expect(events).toEqual(['SOLD_OUT', 'PRICE_CHANGED']);
  });
});

describe('DELISTED and RELISTED', () => {
  const known = (over: Partial<KnownProduct> = {}): KnownProduct => ({
    handle: 'h1',
    name: 'Box Logo Tee',
    color: 'Black',
    url: 'https://jp.supreme.com/products/h1',
    delistedAt: null,
    ...over
  });

  it('reports a product that is no longer in the catalogue', () => {
    const changes = detectListingChanges(new Set(), [known()]);
    expect(changes.map((c) => c.event)).toEqual(['DELISTED']);
  });

  it('reports a delisted product that came back', () => {
    const changes = detectListingChanges(
      new Set(['h1']),
      [known({ delistedAt: new Date('2026-08-27T00:00:00Z') })]
    );
    expect(changes.map((c) => c.event)).toEqual(['RELISTED']);
  });

  it('stays silent while a listed product stays listed', () => {
    expect(detectListingChanges(new Set(['h1']), [known()])).toEqual([]);
  });

  it('does not report the same delisting twice', () => {
    // Already flagged on an earlier scan; repeating it every two hours would
    // bury the channel in news about something that left days ago.
    const changes = detectListingChanges(
      new Set(),
      [known({ delistedAt: new Date('2026-08-27T00:00:00Z') })]
    );
    expect(changes).toEqual([]);
  });

  it('carries the name, colour and URL so the report is readable', () => {
    const [change] = detectListingChanges(new Set(), [known()]);
    expect(change!.productName).toBe('Box Logo Tee');
    expect(change!.color).toBe('Black');
    expect(change!.url).toContain('jp.supreme.com');
  });
});
