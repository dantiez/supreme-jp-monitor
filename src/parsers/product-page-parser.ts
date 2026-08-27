// Turns a jp.supreme.com product page into a ScrapedProduct.
//
// WHY THIS PARSES EMBEDDED JSON RATHER THAN SCRAPING MARKUP:
// Supreme runs on Shopify and ships a complete product object inside
// `<script type="application/json" id="product-<handle>-json">`. That block
// carries title, colour, style, category, images and every size with its own
// `available` flag. Reading it is both simpler and far more stable than walking
// the DOM — class names change with every theme tweak, this payload does not.
//
// The Shopify JSON/Storefront APIs (`/products.json`, `/api/graphql.json`) are
// deliberately closed by Supreme — they answer 403 "Access denied". This
// embedded block is the supported, publicly rendered path, and robots.txt
// allows `/products/` and `/collections/`.
//
// PARSE FAILURES ARE FAILURES. A page that does not yield the block returns
// null rather than an empty product: "we could not read this" and "this product
// has no sizes" must never collapse into the same value, or a parser break
// would look like the entire catalogue selling out.

import { ScrapedProduct, ScrapedVariant, StockStatus } from '../types.js';

/** Shopify serves money in minor units; ¥22,000 arrives as 2200000. */
const MINOR_UNITS = 100;

/**
 * The store's currency, as the page itself declares it.
 *
 * Read rather than assumed: jp.supreme.com sometimes answers with the US
 * store, and treating those USD figures as yen turns $148 into a shirt
 * apparently costing 148 yen. Same defect as labelling a column JPY while it
 * holds dollars -- a wrong number wearing a confident label.
 */
const CURRENCY_RE = /ShopifyAnalytics\.meta\.currency\s*=\s*'([A-Z]{3})'/;

const PRODUCT_JSON_RE =
  /<script[^>]*type="application\/json"[^>]*id="product-[^"]*-json"[^>]*>([\s\S]*?)<\/script>/i;

function textOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Minor units to whole yen.
 *
 * Returns null for anything non-numeric rather than 0: a price of zero is a
 * claim about the product, and a missing price is not that claim.
 */
export function toMajorUnits(minorUnits: unknown): number | null {
  if (typeof minorUnits !== 'number' || !Number.isFinite(minorUnits)) return null;
  return Math.round(minorUnits / MINOR_UNITS);
}

/** Currency the page declares, or null when it declares none. */
export function parseCurrency(html: string): string | null {
  const match = CURRENCY_RE.exec(html);
  return match && match[1] ? match[1] : null;
}

/**
 * `available` is a boolean on every Shopify variant. Anything else — field
 * absent, wrong type — is UNKNOWN, never SOLD_OUT. Guessing "sold out" from a
 * malformed payload would fire a false SOLD_OUT alert on every size at once.
 */
export function toStatus(available: unknown): StockStatus {
  if (available === true) return 'AVAILABLE';
  if (available === false) return 'SOLD_OUT';
  return 'UNKNOWN';
}

/** Absolute https URL from Shopify's protocol-relative CDN paths. */
function absoluteImageUrl(raw: unknown): string | null {
  const src = textOrNull(raw);
  if (!src) return null;
  if (src.startsWith('//')) return `https:${src}`;
  return src;
}

/**
 * Parse one product page. Returns null when the payload is absent or unusable,
 * which the caller must treat as "could not check", not as "nothing in stock".
 */
export function parseProductPage(html: string): ScrapedProduct | null {
  const currency = parseCurrency(html);
  const match = PRODUCT_JSON_RE.exec(html);
  if (!match || !match[1]) return null;

  let raw: any;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const handle = textOrNull(raw?.handle);
  if (!handle) return null;

  const rawVariants: unknown = raw?.variants;
  const variants: ScrapedVariant[] = Array.isArray(rawVariants)
    ? rawVariants
        .map((v: any): ScrapedVariant | null => {
          // `public_title` is the size label; `title` repeats it for
          // single-option products but becomes "Colour / Size" if Supreme ever
          // adds a second option, so prefer the explicit field.
          const size = textOrNull(v?.public_title) ?? textOrNull(v?.title);
          if (!size) return null;
          return {
            size,
            sku: textOrNull(v?.sku),
            price: toMajorUnits(v?.price),
            currency,
            status: toStatus(v?.available)
          };
        })
        .filter((v): v is ScrapedVariant => v !== null)
    : [];

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
    variants
  };
}
