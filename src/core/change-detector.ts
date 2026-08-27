// Compares the previous stored state against what the site says now.
//
// This is the whole product. Everything else fetches, stores or displays; this
// file decides what actually changed, and every alert the customer receives is
// its output.
//
// THE RULE THAT SHAPES EVERYTHING (requirement section 4): a variant that sells
// out is NEVER deleted. It stays with status SOLD_OUT so that its return can be
// recognised as a RESTOCK rather than as a brand-new variant. Delete on
// sell-out and the tool loses the single fact it exists to report.
//
// UNKNOWN IS NOT A TRANSITION. A failed fetch yields UNKNOWN, and no event is
// ever emitted into or out of UNKNOWN. Treating a network failure as SOLD_OUT
// would alert the customer that everything sold out every time the site
// hiccupped; treating the recovery as RESTOCK would then alert that everything
// came back. Both are false, and false alerts are how a monitor gets muted.

import { ChangeEvent, ScrapedProduct, ScrapedVariant, StockStatus } from '../types.js';

/** Stored state of one tracked size, as last written. */
export interface KnownVariant {
  handle: string;
  size: string;
  priceJpy: number | null;
  status: StockStatus;
}

/** One detected change, ready to store and to announce. */
export interface DetectedChange {
  handle: string;
  productName: string;
  /** Null for NEW_PRODUCT, which is about the product rather than one size. */
  size: string | null;
  color: string | null;
  url: string;
  event: ChangeEvent;
  previousStatus: StockStatus | null;
  currentStatus: StockStatus | null;
  previousPriceJpy: number | null;
  currentPriceJpy: number | null;
}

/** Lookup key for a tracked unit: product handle plus size. See types.ts. */
export function variantKey(handle: string, size: string): string {
  return `${handle} ${size}`;
}

function base(product: ScrapedProduct, variant: ScrapedVariant | null) {
  return {
    handle: product.handle,
    productName: product.name,
    size: variant ? variant.size : null,
    color: product.color,
    url: product.url
  };
}

/**
 * Compare one freshly scraped product against what is already known.
 *
 * `knownHandles` decides NEW_PRODUCT; `knownVariants` decides everything else.
 * Both are passed in rather than queried here so this stays a pure function -
 * it is the piece that most needs to be exhaustively testable.
 */
export function detectChanges(
  product: ScrapedProduct,
  knownHandles: ReadonlySet<string>,
  knownVariants: ReadonlyMap<string, KnownVariant>
): DetectedChange[] {
  const changes: DetectedChange[] = [];
  const isNewProduct = !knownHandles.has(product.handle);

  if (isNewProduct) {
    changes.push({
      ...base(product, null),
      event: 'NEW_PRODUCT',
      previousStatus: null,
      currentStatus: null,
      previousPriceJpy: null,
      currentPriceJpy: null
    });
  }

  for (const variant of product.variants) {
    const known = knownVariants.get(variantKey(product.handle, variant.size));

    if (!known) {
      // A size we have never seen. On a brand-new product this is expected and
      // NEW_PRODUCT already says it, so reporting each size again would turn
      // one drop into six notifications. On a product we already track, a new
      // size is genuinely news.
      if (!isNewProduct) {
        changes.push({
          ...base(product, variant),
          event: 'NEW_VARIANT',
          previousStatus: null,
          currentStatus: variant.status,
          previousPriceJpy: null,
          currentPriceJpy: variant.priceJpy
        });
      }
      continue;
    }

    // Stock transitions. Only between the two known states - see the file
    // header on why UNKNOWN never produces an event.
    if (known.status === 'AVAILABLE' && variant.status === 'SOLD_OUT') {
      changes.push({
        ...base(product, variant),
        event: 'SOLD_OUT',
        previousStatus: known.status,
        currentStatus: variant.status,
        previousPriceJpy: known.priceJpy,
        currentPriceJpy: variant.priceJpy
      });
    } else if (known.status === 'SOLD_OUT' && variant.status === 'AVAILABLE') {
      changes.push({
        ...base(product, variant),
        event: 'RESTOCK',
        previousStatus: known.status,
        currentStatus: variant.status,
        previousPriceJpy: known.priceJpy,
        currentPriceJpy: variant.priceJpy
      });
    }

    // Price is reported independently of stock: a size can be repriced while
    // staying sold out, and that is worth knowing before it returns. Both sides
    // must be known numbers - a price appearing out of null is the parser
    // learning the field, not Supreme changing the price.
    if (
      known.priceJpy !== null &&
      variant.priceJpy !== null &&
      known.priceJpy !== variant.priceJpy
    ) {
      changes.push({
        ...base(product, variant),
        event: 'PRICE_CHANGED',
        previousStatus: known.status,
        currentStatus: variant.status,
        previousPriceJpy: known.priceJpy,
        currentPriceJpy: variant.priceJpy
      });
    }
  }

  return changes;
}
