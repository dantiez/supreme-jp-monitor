// Refuse to record a catalogue that is not the Japanese store's.
//
// WHAT WENT WRONG WITHOUT THIS. supreme.com serves a different storefront
// depending on where the request comes from, and each storefront gives the SAME
// garment a DIFFERENT product handle. Tracking is keyed on the handle, so a scan
// from Singapore saw 268 unfamiliar products and concluded that the entire
// Japanese catalogue had been withdrawn and replaced. The next scan from
// elsewhere concluded the reverse. Two runs, 537 false events, the watch list
// wiped twice, and Discord told the reader every product in the shop had gone.
//
// The tell was in the data the whole time: 996 rows priced in JPY, all marked
// withdrawn; 995 rows priced in SGD, all marked live. Same shop, two currencies.
//
// NO REQUEST HEADER FIXES THIS. Verified against the live site: a locale path
// (/ja/, /en-jp/) 404s, and ?country=JP, Accept-Language and a cart_currency
// cookie are all ignored. The storefront follows the caller's IP, so the only
// controls are where the scanner runs and this check.
//
// So the check does not try to correct the store -- it refuses the scan. A run
// that recorded the wrong catalogue would be far worse than a run that did not
// happen: nothing here is lost by skipping a scan, and everything is lost by
// writing a foreign one over the watch list.

/** The store this tool exists to watch. Overridable, but never guessed. */
export const EXPECTED_CURRENCY = (process.env.EXPECTED_CURRENCY ?? 'JPY').toUpperCase();

export class WrongStoreError extends Error {
  constructor(
    readonly found: string | null,
    readonly expected: string = EXPECTED_CURRENCY
  ) {
    super(
      found === null
        ? `The listing page declared no currency, so there is no evidence it is the ${expected} store. Refusing to record it.`
        : `Served the ${found} store, not ${expected}. Each storefront gives the same product a different handle, so recording this ` +
          `would withdraw the entire ${expected} catalogue and replace it. Refusing. ` +
          `The storefront follows the caller's IP: run the scan from a location that reaches the ${expected} store.`
    );
    this.name = 'WrongStoreError';
  }
}

/**
 * Throw unless the page came from the expected store.
 *
 * A missing currency is treated as failure rather than as permission. "We could
 * not tell which store this is" is not evidence that it is the right one, and
 * the cost of being wrong is the whole catalogue.
 */
export function assertExpectedStore(currency: string | null): void {
  if (currency === null || currency.toUpperCase() !== EXPECTED_CURRENCY) {
    throw new WrongStoreError(currency);
  }
}
