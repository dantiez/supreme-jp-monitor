// The change detector decides every alert the customer receives. These tests
// care most about the alerts it must NOT send: a network failure must not read
// as a sell-out, and a first sighting must not read as a restock.

import { describe, it, expect } from 'vitest';
import {
  detectChanges,
  variantKey,
  KnownVariant
} from '../src/core/change-detector.js';
import { ScrapedProduct, ScrapedVariant, StockStatus } from '../src/types.js';

function variant(over: Partial<ScrapedVariant> = {}): ScrapedVariant {
  return { size: 'Large', sku: 'FW26SH1-ORA-L', priceJpy: 22000, status: 'AVAILABLE', ...over };
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
    priceJpy: 22000,
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
      [variantKey('0-fow3-gelgp4at', 'Small'), { handle: '0-fow3-gelgp4at', size: 'Small', priceJpy: 22000, status: 'AVAILABLE' }],
      [variantKey('0-fow3-gelgp4at', 'Large'), { handle: '0-fow3-gelgp4at', size: 'Large', priceJpy: 22000, status: 'SOLD_OUT' }]
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
    const p = product({ variants: [variant({ priceJpy: 17600 })] });
    const [change] = detectChanges(p, TRACKED, known({ priceJpy: 15400 }));
    expect(change!.event).toBe('PRICE_CHANGED');
    expect(change!.previousPriceJpy).toBe(15400);
    expect(change!.currentPriceJpy).toBe(17600);
  });

  it('fires even while the size stays sold out', () => {
    // Worth knowing before it returns to stock.
    const p = product({ variants: [variant({ status: 'SOLD_OUT', priceJpy: 17600 })] });
    const events = detectChanges(
      p,
      TRACKED,
      known({ status: 'SOLD_OUT', priceJpy: 15400 })
    ).map((c) => c.event);
    expect(events).toEqual(['PRICE_CHANGED']);
  });

  it('does not fire when a price appears out of null', () => {
    // That is the parser learning the field, not Supreme changing the price.
    const p = product({ variants: [variant({ priceJpy: 22000 })] });
    const changes = detectChanges(p, TRACKED, known({ priceJpy: null }));
    expect(changes.filter((c) => c.event === 'PRICE_CHANGED')).toEqual([]);
  });

  it('does not fire when the price becomes unreadable', () => {
    const p = product({ variants: [variant({ priceJpy: null })] });
    const changes = detectChanges(p, TRACKED, known({ priceJpy: 22000 }));
    expect(changes.filter((c) => c.event === 'PRICE_CHANGED')).toEqual([]);
  });

  it('reports a sell-out and a reprice in the same check', () => {
    const p = product({ variants: [variant({ status: 'SOLD_OUT', priceJpy: 17600 })] });
    const events = detectChanges(
      p,
      TRACKED,
      known({ status: 'AVAILABLE', priceJpy: 15400 })
    ).map((c) => c.event);
    expect(events).toEqual(['SOLD_OUT', 'PRICE_CHANGED']);
  });
});
