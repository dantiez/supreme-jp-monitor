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
    // Written for the person who sees it, which is whoever pressed the button
    // -- not necessarily the person who deployed this. It has to say what
    // happened, that nothing was damaged, and what to do, in that order. The
    // previous wording was three lines of English about product handles, which
    // told a non-technical reader only that something had broken.
    super(
      found === null
        ? `Trang Supreme không cho biết đơn vị tiền tệ, nên không xác nhận được đây là cửa hàng Nhật. ` +
          `Đã dừng, chưa ghi gì cả.`
        : `Máy chủ này đang vào cửa hàng ${found}, không phải cửa hàng Nhật (${expected}). ` +
          `Supreme chọn cửa hàng theo vị trí máy gọi, và mỗi cửa hàng đặt mã sản phẩm khác nhau — ` +
          `ghi vào sẽ xoá sạch toàn bộ danh sách hàng Nhật. ` +
          `Đã dừng, dữ liệu vẫn nguyên vẹn. Hãy chạy quét từ máy vào được cửa hàng Nhật.`
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
