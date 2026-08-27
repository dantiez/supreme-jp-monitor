// Parser tests run against HTML captured from the live site, not hand-written
// markup. A fixture I invented would only prove the parser matches my
// assumptions; a real page proves it matches Supreme.
//
// Re-capture with:
//   curl -H 'User-Agent: Mozilla/5.0 ...' https://jp.supreme.com/products/<handle>

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  parseProductPage,
  toYen,
  toStatus
} from '../src/parsers/product-page-parser.js';
import { parseCollectionPage } from '../src/parsers/collection-page-parser.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const SHORTS = 'product-0-fow3-gelgp4at.html';

describe('toYen', () => {
  it('converts Shopify minor units to whole yen', () => {
    // JPY has no minor unit, but Shopify still serves x100.
    expect(toYen(2200000)).toBe(22000);
  });

  it('returns null for a missing price rather than 0', () => {
    // 0 is a claim about the product. Missing is not that claim.
    expect(toYen(undefined)).toBeNull();
    expect(toYen(null)).toBeNull();
    expect(toYen('2200000')).toBeNull();
  });

  it('keeps a genuine zero', () => {
    expect(toYen(0)).toBe(0);
  });
});

describe('toStatus', () => {
  it('maps the boolean Shopify actually sends', () => {
    expect(toStatus(true)).toBe('AVAILABLE');
    expect(toStatus(false)).toBe('SOLD_OUT');
  });

  it('treats anything else as UNKNOWN, never SOLD_OUT', () => {
    // Guessing "sold out" from a malformed payload would fire a false SOLD_OUT
    // alert on every size of every product at once.
    expect(toStatus(undefined)).toBe('UNKNOWN');
    expect(toStatus(null)).toBe('UNKNOWN');
    expect(toStatus('false')).toBe('UNKNOWN');
    expect(toStatus(0)).toBe('UNKNOWN');
  });
});

describe('parseProductPage on real Supreme HTML', () => {
  const product = parseProductPage(read(SHORTS));

  it('reads product identity', () => {
    expect(product).not.toBeNull();
    expect(product!.handle).toBe('0-fow3-gelgp4at');
    expect(product!.name).toBe('Small Box Sweatshort');
    expect(product!.category).toBe('shorts');
    expect(product!.style).toBe('SH1');
  });

  it('reads colour as a PRODUCT attribute, not a variant dimension', () => {
    // The decision this whole schema rests on. Supreme ships one product per
    // colourway, with size as the only variant axis.
    expect(product!.color).toBe('Orange');
  });

  it('reads every size with its own stock flag', () => {
    const sizes = product!.variants.map((v) => v.size);
    expect(sizes).toEqual(['Small', 'Medium', 'Large', 'XLarge', 'XXLarge']);

    const byStatus = product!.variants.map((v) => `${v.size}:${v.status}`);
    expect(byStatus).toEqual([
      'Small:SOLD_OUT',
      'Medium:SOLD_OUT',
      'Large:AVAILABLE',
      'XLarge:SOLD_OUT',
      'XXLarge:SOLD_OUT'
    ]);
  });

  it('reads the SKU, which encodes season, style, colour and size', () => {
    expect(product!.variants.map((v) => v.sku)).toEqual([
      'FW26SH1-ORA-S',
      'FW26SH1-ORA-M',
      'FW26SH1-ORA-L',
      'FW26SH1-ORA-XL',
      'FW26SH1-ORA-XXL'
    ]);
  });

  it('converts price to whole yen on every variant', () => {
    expect(product!.variants.every((v) => v.priceJpy === 22000)).toBe(true);
  });

  it('builds an absolute product URL and https image URL', () => {
    expect(product!.url).toBe('https://jp.supreme.com/products/0-fow3-gelgp4at');
    // Shopify serves protocol-relative CDN paths.
    expect(product!.imageUrl?.startsWith('https://')).toBe(true);
  });
});

describe('parseProductPage failure handling', () => {
  it('returns null when the payload is absent', () => {
    // "Could not read this page" must never look like "this product has no
    // sizes" - otherwise a parser break reads as the catalogue selling out.
    expect(parseProductPage('<html><body>Access denied</body></html>')).toBeNull();
    expect(parseProductPage('')).toBeNull();
  });

  it('returns null on malformed JSON rather than a half-built product', () => {
    const broken =
      '<script type="application/json" id="product-x-json">{"handle":</script>';
    expect(parseProductPage(broken)).toBeNull();
  });

  it('returns null when the payload carries no handle to track by', () => {
    const noHandle =
      '<script type="application/json" id="product-x-json">{"title":"X"}</script>';
    expect(parseProductPage(noHandle)).toBeNull();
  });

  it('keeps a product whose variants are unreadable, with no sizes', () => {
    // The product exists and was seen; it just told us nothing about stock.
    const odd =
      '<script type="application/json" id="product-x-json">' +
      '{"handle":"x","title":"X","variants":"nope"}</script>';
    const p = parseProductPage(odd);
    expect(p).not.toBeNull();
    expect(p!.variants).toEqual([]);
  });
});

describe('parseCollectionPage on real Supreme HTML', () => {
  const handles = parseCollectionPage(read('collection-new.html'));

  it('finds the products the listing renders server-side', () => {
    expect(handles.length).toBeGreaterThan(100);
  });

  it('returns each handle once', () => {
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('preserves listing order, so a capped scan gets the newest drops first', () => {
    const html = '<a href="/products/zzz-aaa"><a href="/products/aaa-bbb">';
    expect(parseCollectionPage(html)).toEqual(['zzz-aaa', 'aaa-bbb']);
  });

  it('ignores non-product paths', () => {
    expect(parseCollectionPage('<a href="/collections/new">')).toEqual([]);
  });

  it('keeps underscores in handles instead of truncating at them', () => {
    // Regression. Supreme handles look like `tja_r0zpybduuieh`. A character
    // class without `_` does not skip those products -- it silently truncates
    // them to `tja`, which looks like a valid handle and 404s on every scan.
    expect(parseCollectionPage('<a href="/products/tja_r0zpybduuieh">')).toEqual([
      'tja_r0zpybduuieh'
    ]);
  });

  it('extracts exactly the handles the page declares', () => {
    // Ground truth: the listing's embedded JSON carries a "handle" field for
    // every product. Path extraction must agree with it exactly -- one short is
    // a product never checked, one extra is a guaranteed 404.
    const html = read('collection-new.html');
    const declared = new Set(
      [...html.matchAll(/"handle":"([a-z0-9][a-z0-9_-]+)"/g)].map((m) => m[1]!)
    );
    expect(new Set(handles)).toEqual(declared);
  });
});
