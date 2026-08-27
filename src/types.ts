// Data model for jp.supreme.com monitoring.
//
// DESIGN RULE: every value the site may not supply is `| null`. A type that
// cannot express "unknown" forces callers to invent a value, and an invented
// stock status in a restock alert is worse than no alert at all.
//
// THE KEY MODELLING DECISION — read before changing the shape:
// The requirement describes tracking `Product + Color + Size`. Supreme does not
// model it that way. Each COLOURWAY IS ITS OWN PRODUCT: the embedded product
// JSON carries `"color":"Orange"` at product level, and `"options":["Size"]` —
// size is the only variant dimension. So the natural identity of a tracked unit
// is `(product_handle, size)`, with colour a product attribute. Confirmed with
// the customer. Building colour as a variant dimension would mean inventing a
// dimension the source does not have.

/** Stock state of one size. UNKNOWN is real: a fetch can fail. */
export type StockStatus = 'AVAILABLE' | 'SOLD_OUT' | 'UNKNOWN';

export type ChangeEvent =
  | 'NEW_PRODUCT'
  | 'NEW_VARIANT'
  | 'SOLD_OUT'
  | 'RESTOCK'
  | 'PRICE_CHANGED';

/** One size of one product, as read from the site right now. */
export interface ScrapedVariant {
  /** Size label exactly as Supreme spells it ("Large", "XXLarge", "One Size"). */
  size: string;
  /** Supreme's SKU, e.g. FW26SH1-ORA-L — encodes season, style, colour, size. */
  sku: string | null;
  /**
   * Price in whole units of `currency`. Shopify serves minor units; converted
   * on parse.
   */
  price: number | null;
  /**
   * ISO-4217 code the price is quoted in, read from the page.
   *
   * NEVER ASSUMED. jp.supreme.com does not always serve the Japanese store:
   * some responses come back as the US store with USD prices, and an Oxford
   * shirt at 14800 is $148, not the 148 yen it would become if the currency
   * were taken for granted. Null when the page did not declare one, which is
   * "we do not know what this number is" and must not be printed with a symbol.
   */
  currency: string | null;
  status: StockStatus;
}

/** One product (= one colourway) with every size it lists. */
export interface ScrapedProduct {
  /** URL handle. The stable identity we track products by. */
  handle: string;
  /** Supreme's numeric product id. Informational; handle is the key. */
  externalId: string | null;
  name: string;
  /** Product-level attribute, NOT a variant dimension. See types header. */
  color: string | null;
  /** Supreme style code, e.g. "SH1". Groups colourways of one design. */
  style: string | null;
  category: string | null;
  imageUrl: string | null;
  url: string;
  variants: ScrapedVariant[];
}
