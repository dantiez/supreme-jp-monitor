// Reads the whole catalogue out of a listing page.
//
// WHY THIS REPLACED FETCHING EVERY PRODUCT PAGE:
// A listing page embeds `<script type="application/json" id="products-json">`
// containing every product with its full variant list - size, sku, price and
// the per-size `available` flag. Verified against the product pages themselves:
// identical, field for field. So the entire catalogue arrives in two requests
// instead of one per product, and a scan takes seconds rather than minutes.
//
// That is not only a speed win. The previous approach scraped `/products/<handle>`
// links out of the markup and found 241 handles, while the payload declares
// `allProductsCount: 268` - twenty-seven products were silently never monitored.
// Reading the declared list removes the guesswork and the gap with it.
//
// PAGINATION IS NOT OPTIONAL. One page carries at most 250 products; the rest
// are on `?page=2`. A caller that stops at page one is back to missing products
// without being told, which is the exact failure this file exists to end.
// (`?limit=500` is refused with 403 - the page size is not ours to raise.)

import { ScrapedProduct, ScrapedVariant } from '../types.js';
import { toMajorUnits, toStatus, parseCurrency } from './product-page-parser.js';

const CATALOGUE_JSON_RE =
  /<script[^>]*type="application\/json"[^>]*id="products-json"[^>]*>([\s\S]*?)<\/script>/i;

export interface CataloguePage {
  products: ScrapedProduct[];
  /** What the site says the catalogue holds in total, across all pages. */
  totalCount: number | null;
}

function textOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function absoluteImageUrl(raw: unknown): string | null {
  const src = textOrNull(raw);
  if (!src) return null;
  return src.startsWith('//') ? `https:${src}` : src;
}

function mapVariant(raw: any, currency: string | null): ScrapedVariant | null {
  const size = textOrNull(raw?.public_title) ?? textOrNull(raw?.title);
  if (!size) return null;
  return {
    size,
    sku: textOrNull(raw?.sku),
    price: toMajorUnits(raw?.price),
    currency,
    status: toStatus(raw?.available)
  };
}

function mapProduct(raw: any, currency: string | null): ScrapedProduct | null {
  const handle = textOrNull(raw?.handle);
  if (!handle) return null;

  const images: unknown = raw?.images;
  const firstImage = Array.isArray(images) && images.length > 0 ? images[0] : null;

  return {
    handle,
    externalId: raw?.id === undefined || raw?.id === null ? null : String(raw.id),
    name: textOrNull(raw?.title) ?? handle,
    color: textOrNull(raw?.color),
    style: textOrNull(raw?.style),
    category: textOrNull(raw?.product_type),
    imageUrl: absoluteImageUrl((firstImage as any)?.src ?? raw?.image),
    url: `https://jp.supreme.com${textOrNull(raw?.url) ?? `/products/${handle}`}`,
    variants: Array.isArray(raw?.variants)
      ? raw.variants
          .map((v: any) => mapVariant(v, currency))
          .filter((v: ScrapedVariant | null): v is ScrapedVariant => v !== null)
      : []
  };
}

/**
 * Parse one listing page.
 *
 * Returns null when the payload is absent or unreadable. A caller must treat
 * that as "could not check", never as an empty catalogue - an empty result
 * would look like every product in the shop having been delisted at once.
 */
export function parseCataloguePage(html: string): CataloguePage | null {
  const match = CATALOGUE_JSON_RE.exec(html);
  if (!match || !match[1]) return null;

  let raw: any;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return null;
  }

  if (!Array.isArray(raw?.products)) return null;

  // Currency is declared once per page, and is read rather than assumed:
  // jp.supreme.com sometimes answers with the US store.
  const currency = parseCurrency(html);

  const products = raw.products
    .map((p: any) => mapProduct(p, currency))
    .filter((p: ScrapedProduct | null): p is ScrapedProduct => p !== null);

  const totalCount =
    typeof raw.allProductsCount === 'number' && Number.isFinite(raw.allProductsCount)
      ? raw.allProductsCount
      : null;

  return { products, totalCount };
}
