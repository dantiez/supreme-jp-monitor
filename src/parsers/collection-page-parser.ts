// Extracts product handles from a collection listing page.
//
// The listing is server-rendered — `/collections/new` returns ~1 MB of HTML
// containing every product link — so discovery costs one request per
// collection rather than one per product.
//
// Handles only, deliberately. The listing markup does carry prices, but not the
// per-size `available` flags, and a monitor that reported stock from the
// listing would miss exactly the thing it exists to detect. The listing answers
// "which products exist"; the product page answers "what is in stock".

/**
 * `/products/<handle>`.
 *
 * Handles are lowercase alphanumeric and MAY CONTAIN UNDERSCORES as well as
 * hyphens -- e.g. `tja_r0zpybduuieh`. Leaving `_` out of the class does not
 * skip those products, it silently TRUNCATES them at the underscore, producing
 * a plausible-looking handle like `tja` that 404s on every scan. Verified
 * against the live listing.
 *
 * The listing renders products from embedded JSON rather than anchor tags, so
 * matching on the path is correct here; there are no `href="/products/..."`
 * attributes to key off.
 */
const PRODUCT_LINK_RE = /\/products\/([a-z0-9][a-z0-9_-]{2,})/g;

/**
 * Every distinct product handle on the page, in first-seen order.
 *
 * Order is preserved because Supreme lists newest first, so a caller that caps
 * the scan still gets the most recently dropped products.
 */
export function parseCollectionPage(html: string): string[] {
  const seen = new Set<string>();
  const handles: string[] = [];

  for (const match of html.matchAll(PRODUCT_LINK_RE)) {
    const handle = match[1];
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }

  return handles;
}
