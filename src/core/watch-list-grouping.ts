// Sorting what a scan found into the three answers the reader acts on.
//
// THE WATCH LIST is the set of sizes that were AVAILABLE at the previous scan.
// It is not a separate table: `variants.previous_status` carries it, written
// during the scan before `status` is overwritten. Membership is therefore
// exactly `previous_status === 'AVAILABLE'`.
//
//   🟢 in the list, still available -- your listing is fine, do nothing
//   🔴 in the list, confirmed sold out -- go pull the listing
//   🔵 not in the list, now available -- you could list this too
//
// UNKNOWN IS NOT 🔴, even though the customer's rule reads "in the list and no
// longer AVAILABLE". UNKNOWN means the check failed -- nobody established that
// the size is gone. Filing it under 🔴 would tell someone to pull a listing
// that is still selling, and a network hiccup across the catalogue would empty
// the green column at once. It is counted and reported separately instead. The
// rest of this codebase has treated UNKNOWN this way from the start; the flow
// diagram simply did not consider it.
//
// A size that is neither in the list nor available appears in NONE of them.
// That is the point: it was sold out before and is sold out now, so there is
// nothing to do about it, and several hundred such rows are what buried the
// two that mattered.
//
// WHY THE BASELINE ROLLS. The customer chose "compare against the previous
// scan" over a baseline fixed at initialisation, having been shown the cost:
// a size that sells out and is not dealt with immediately drops out of 🔴 at
// the next scan, because by then it was not available at the previous one
// either. Their call, made knowingly.

/** Anything with a baseline that is not AVAILABLE is outside the list. */
const IN_LIST = 'AVAILABLE';
const SOLD_OUT = 'SOLD_OUT';

export type WatchGroup = 'still' | 'gone' | 'fresh';

export interface GroupableRow {
  status: string;
  previous_status: string | null;
}

/**
 * Which group a row belongs to, or null for "nothing to say about this".
 *
 * `previous_status === null` means the size was never tracked -- a size that
 * did not exist at the last scan. Available now, that is news (🔵); sold out
 * now, it is not.
 */
export function groupOf(row: GroupableRow): WatchGroup | null {
  const tracked = row.previous_status === IN_LIST;

  if (row.status === IN_LIST) return tracked ? 'still' : 'fresh';
  // Confirmed gone, not merely unread. See the header on why UNKNOWN stops here.
  if (row.status === SOLD_OUT && tracked) return 'gone';
  return null;
}

/** Sizes the last scan could not read. Reported, never grouped. */
export function countUnknown(rows: readonly GroupableRow[]): number {
  return rows.filter((r) => r.status === 'UNKNOWN').length;
}

export interface GroupedRows<T> {
  /** 🟢 In the list and still in stock. */
  still: T[];
  /** 🔴 In the list and no longer in stock -- the actionable column. */
  gone: T[];
  /** 🔵 Not in the list and in stock -- could be listed. */
  fresh: T[];
}

export function groupByWatchList<T extends GroupableRow>(rows: readonly T[]): GroupedRows<T> {
  const grouped: GroupedRows<T> = { still: [], gone: [], fresh: [] };
  for (const row of rows) {
    const group = groupOf(row);
    if (group) grouped[group].push(row);
  }
  return grouped;
}

/**
 * Whether the last scan moved anything the reader has to act on.
 *
 * Read off the groups rather than off an event tally, because the groups are
 * what the reader is looking at. A count that disagreed with the columns
 * beneath it would be worse than no count.
 */
export function nothingChanged<T>(grouped: GroupedRows<T>): boolean {
  return grouped.gone.length === 0 && grouped.fresh.length === 0;
}
