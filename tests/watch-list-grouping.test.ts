// The three groups are the whole screen now, so a wrong one sends the reader
// to pull a listing that is still selling, or leaves a dead listing up.

import { describe, it, expect } from 'vitest';
import {
  groupOf,
  groupByWatchList,
  nothingChanged,
  countUnknown
} from '../src/core/watch-list-grouping.js';

const row = (previous_status: string | null, status: string) => ({ previous_status, status });

describe('groupOf', () => {
  it('🟢 in the list and still available', () => {
    expect(groupOf(row('AVAILABLE', 'AVAILABLE'))).toBe('still');
  });

  it('🔴 in the list and sold out', () => {
    expect(groupOf(row('AVAILABLE', 'SOLD_OUT'))).toBe('gone');
  });

  it('does NOT file an unreadable size under sold out', () => {
    // The flow diagram says "in the list and no longer AVAILABLE", which would
    // catch UNKNOWN too. But UNKNOWN means the check failed -- nobody
    // established the size is gone. Calling it 🔴 sends the reader to pull a
    // listing that is still selling, and one bad network moment would empty the
    // green column across the whole catalogue.
    expect(groupOf(row('AVAILABLE', 'UNKNOWN'))).toBeNull();
  });

  it('🔵 outside the list and available', () => {
    expect(groupOf(row('SOLD_OUT', 'AVAILABLE'))).toBe('fresh');
  });

  it('🔵 never tracked and available', () => {
    // A size that did not exist at the last scan. Available now, that is news.
    expect(groupOf(row(null, 'AVAILABLE'))).toBe('fresh');
  });

  it('shows nothing for stock that was not there before and is not there now', () => {
    // Sold out then, sold out now: nothing to do. Several hundred of these are
    // what buried the two rows that mattered.
    expect(groupOf(row('SOLD_OUT', 'SOLD_OUT'))).toBeNull();
    expect(groupOf(row(null, 'SOLD_OUT'))).toBeNull();
    expect(groupOf(row('UNKNOWN', 'UNKNOWN'))).toBeNull();
    expect(groupOf(row('AVAILABLE', 'UNKNOWN'))).toBeNull();
  });
});

describe('groupByWatchList', () => {
  it('splits a mixed scan into the three answers', () => {
    const grouped = groupByWatchList([
      row('AVAILABLE', 'AVAILABLE'),
      row('AVAILABLE', 'SOLD_OUT'),
      row('SOLD_OUT', 'AVAILABLE'),
      row('SOLD_OUT', 'SOLD_OUT')
    ]);
    expect(grouped.still).toHaveLength(1);
    expect(grouped.gone).toHaveLength(1);
    expect(grouped.fresh).toHaveLength(1);
  });

  it('keeps the order it was given', () => {
    // The query sorts by newest product then name; regrouping must not shuffle.
    const rows = [
      { previous_status: 'AVAILABLE', status: 'SOLD_OUT', id: 1 },
      { previous_status: 'AVAILABLE', status: 'SOLD_OUT', id: 2 }
    ];
    expect(groupByWatchList(rows).gone.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe('countUnknown', () => {
  it('counts what could not be read, whichever side of the list it is on', () => {
    expect(countUnknown([row('AVAILABLE', 'UNKNOWN'), row(null, 'UNKNOWN'), row('AVAILABLE', 'AVAILABLE')])).toBe(2);
  });
});

describe('nothingChanged', () => {
  it('is true when nothing left the list and nothing new arrived', () => {
    const grouped = groupByWatchList([row('AVAILABLE', 'AVAILABLE')]);
    expect(nothingChanged(grouped)).toBe(true);
  });

  it('is false when something sold out', () => {
    expect(nothingChanged(groupByWatchList([row('AVAILABLE', 'SOLD_OUT')]))).toBe(false);
  });

  it('is false when something new turned up', () => {
    // Both halves count. Only the sold-out half being checked would call a scan
    // that found 30 new products "no changes".
    expect(nothingChanged(groupByWatchList([row(null, 'AVAILABLE')]))).toBe(false);
  });
});
