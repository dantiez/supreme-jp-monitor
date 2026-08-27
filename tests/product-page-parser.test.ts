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
  toMajorUnits,
  toStatus,
  parseCurrency
} from '../src/parsers/product-page-parser.js';
import { parseCataloguePage } from '../src/parsers/catalogue-parser.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const SHORTS = 'product-0-fow3-gelgp4at.html';

describe('toMajorUnits', () => {
  it('converts Shopify minor units to whole yen', () => {
    // JPY has no minor unit, but Shopify still serves x100.
    expect(toMajorUnits(2200000)).toBe(22000);
  });

  it('returns null for a missing price rather than 0', () => {
    // 0 is a claim about the product. Missing is not that claim.
    expect(toMajorUnits(undefined)).toBeNull();
    expect(toMajorUnits(null)).toBeNull();
    expect(toMajorUnits('2200000')).toBeNull();
  });

  it('keeps a genuine zero', () => {
    expect(toMajorUnits(0)).toBe(0);
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
    expect(product!.variants.every((v) => v.price === 22000)).toBe(true);
  });

  it('builds an absolute product URL and https image URL', () => {
    expect(product!.url).toBe('https://jp.supreme.com/products/0-fow3-gelgp4at');
    // Shopify serves protocol-relative CDN paths.
    expect(product!.imageUrl?.startsWith('https://')).toBe(true);
  });
});

describe('currency is read, never assumed', () => {
  it('reads the currency the page declares', () => {
    expect(parseCurrency(read(SHORTS))).toBe('JPY');
  });

  it('returns null when the page declares none', () => {
    // Null means "we do not know what this number is". Defaulting to JPY is
    // how $148 became a shirt apparently costing 148 yen.
    expect(parseCurrency('<html></html>')).toBeNull();
  });

  it('reads USD when the US store answered', () => {
    const usPage =
      "<script>window.ShopifyAnalytics.meta.currency = 'USD';</script>" +
      '<script type="application/json" id="product-x-json">' +
      '{"handle":"x","title":"Oxford Shirt","variants":[' +
      '{"public_title":"Large","price":14800,"available":true,"sku":"S"}]}</script>';
    const p = parseProductPage(usPage);
    // 14800 minor units is $148 -- and must never be shown as 148 yen.
    expect(p!.variants[0]!.price).toBe(148);
    expect(p!.variants[0]!.currency).toBe('USD');
  });

  it('stamps every variant with the page currency', () => {
    const p = parseProductPage(read(SHORTS));
    expect(p!.variants.every((v) => v.currency === 'JPY')).toBe(true);
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

describe('parseCataloguePage on real Supreme HTML', () => {
  const page = parseCataloguePage(read('collection-new.html'));

  it('reads every product the listing declares, with its sizes', () => {
    // The listing embeds the whole catalogue -- product, colour, and each size
    // with its own stock flag -- so a scan needs no per-product requests.
    expect(page).not.toBeNull();
    expect(page!.products.length).toBeGreaterThan(200);
    expect(page!.products.every((p) => p.handle.length > 0)).toBe(true);
  });

  it('reports the total the site declares, so a short read is detectable', () => {
    // One page holds at most 250. Without this number, stopping early looks
    // exactly like a complete scan.
    expect(page!.totalCount).toBeGreaterThanOrEqual(page!.products.length);
  });

  it('carries colour as a product attribute and stock per size', () => {
    const withSizes = page!.products.find((p) => p.variants.length > 1)!;
    expect(withSizes.variants.every((v) => v.size.length > 0)).toBe(true);
    expect(
      withSizes.variants.every((v) =>
        ['AVAILABLE', 'SOLD_OUT', 'UNKNOWN'].includes(v.status)
      )
    ).toBe(true);
  });

  it('returns null when the payload is absent, never an empty catalogue', () => {
    // An empty result would read as every product in the shop being delisted.
    expect(parseCataloguePage('<html></html>')).toBeNull();
    expect(parseCataloguePage('')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(
      parseCataloguePage('<script type="application/json" id="products-json">{oops</script>')
    ).toBeNull();
  });
});
