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
  price: number | null;
  /** Currency the stored price is in. Null means unknown, never assumed. */
  currency: string | null;
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
  previousPrice: number | null;
  currentPrice: number | null;
  /** Currency both prices are in. Null when they cannot be compared. */
  currency: string | null;
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
      previousPrice: null,
      currentPrice: null,
      currency: null
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
          previousPrice: null,
          currentPrice: variant.price,
          currency: variant.currency
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
        previousPrice: known.price,
        currentPrice: variant.price,
        currency: variant.currency
      });
    } else if (known.status === 'SOLD_OUT' && variant.status === 'AVAILABLE') {
      changes.push({
        ...base(product, variant),
        event: 'RESTOCK',
        previousStatus: known.status,
        currentStatus: variant.status,
        previousPrice: known.price,
        currentPrice: variant.price,
        currency: variant.currency
      });
    }

    // Price is reported independently of stock: a size can be repriced while
    // staying sold out, and that is worth knowing before it returns. Both sides
    // must be known numbers - a price appearing out of null is the parser
    // learning the field, not Supreme changing the price.
    // The currency guard is not pedantry. jp.supreme.com sometimes answers with
    // the US store, so a size can go from 14800 JPY to 148 USD between scans
    // while its actual price never moved. Comparing those numbers would fire a
    // "price dropped 99%" alert on a shop that changed nothing.
    if (
      known.price !== null &&
      variant.price !== null &&
      known.currency !== null &&
      variant.currency !== null &&
      known.currency === variant.currency &&
      known.price !== variant.price
    ) {
      changes.push({
        ...base(product, variant),
        event: 'PRICE_CHANGED',
        previousStatus: known.status,
        currentStatus: variant.status,
        previousPrice: known.price,
        currentPrice: variant.price,
        currency: variant.currency
      });
    }
  }

  return changes;
}

/** A product the store no longer lists, or lists again. */
export interface ListingChange {
  handle: string;
  productName: string;
  color: string | null;
  url: string;
  event: 'DELISTED' | 'RELISTED';
}

/** What the database knows about a product, for reporting its disappearance. */
export interface KnownProduct {
  handle: string;
  name: string;
  color: string | null;
  url: string;
  /** Set when a previous scan found it gone. Null while it is listed. */
  delistedAt: Date | null;
}

/**
 * Products that vanished from the catalogue, and ones that came back.
 *
 * ONLY EVER CALL THIS ON A COMPLETE READ. A capped or partly-failed scan does
 * not know that a product is gone -- it knows it did not look. Reporting the
 * difference anyway would delist hundreds of products the moment someone runs
 * a scan with `--max`, and the alert would be indistinguishable from a real
 * catalogue purge. The caller enforces this; see scan-runner.
 *
 * Delisting is deliberately NOT modelled as selling out. Sold out means the
 * shop still offers the item and has none; delisted means the shop no longer
 * offers it. Collapsing them would make a withdrawn product look like one that
 * might come back into stock.
 */
export function detectListingChanges(
  seenHandles: ReadonlySet<string>,
  knownProducts: readonly KnownProduct[]
): ListingChange[] {
  const changes: ListingChange[] = [];

  for (const product of knownProducts) {
    const isListed = seenHandles.has(product.handle);
    const wasDelisted = product.delistedAt !== null;

    if (!isListed && !wasDelisted) {
      changes.push({
        handle: product.handle,
        productName: product.name,
        color: product.color,
        url: product.url,
        event: 'DELISTED'
      });
    } else if (isListed && wasDelisted) {
      changes.push({
        handle: product.handle,
        productName: product.name,
        color: product.color,
        url: product.url,
        event: 'RELISTED'
      });
    }
  }

  return changes;
}
