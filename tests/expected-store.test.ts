// The guard that stands between a mis-routed request and the watch list.
//
// Without it, one scan from the wrong country recorded 268 withdrawals and 267
// arrivals for a shop that had changed nothing.

import { describe, it, expect } from 'vitest';
import { assertExpectedStore, WrongStoreError } from '../src/core/expected-store.js';

describe('assertExpectedStore', () => {
  it('passes the store the tool exists to watch', () => {
    expect(() => assertExpectedStore('JPY')).not.toThrow();
    expect(() => assertExpectedStore('jpy')).not.toThrow();
  });

  it('refuses another storefront', () => {
    // Singapore is the one that actually happened, from a Render instance.
    expect(() => assertExpectedStore('SGD')).toThrow(WrongStoreError);
    expect(() => assertExpectedStore('USD')).toThrow(WrongStoreError);
  });

  it('refuses a page that names no currency at all', () => {
    // "We cannot tell which store this is" is not evidence that it is the right
    // one, and the cost of being wrong is the entire catalogue.
    expect(() => assertExpectedStore(null)).toThrow(WrongStoreError);
  });

  it('tells the reader what happened, that nothing broke, and what to do', () => {
    // Whoever pressed the button sees this, and they did not necessarily
    // deploy the thing. Three lines of English about product handles told a
    // non-technical reader only that something had broken.
    try {
      assertExpectedStore('SGD');
      expect.unreachable();
    } catch (e) {
      const message = (e as Error).message;
      expect((e as WrongStoreError).found).toBe('SGD');
      expect(message).toContain('SGD');
      expect(message).toContain('JPY');
      // Nothing was damaged -- the first thing the reader needs to know.
      expect(message).toContain('nguyên vẹn');
      // And the way out.
      expect(message).toContain('cửa hàng Nhật');
    }
  });
});
