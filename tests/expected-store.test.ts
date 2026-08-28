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

  it('names the store it got, so the log says what to fix', () => {
    try {
      assertExpectedStore('SGD');
      expect.unreachable();
    } catch (e) {
      expect((e as WrongStoreError).found).toBe('SGD');
      expect((e as Error).message).toContain('SGD');
      expect((e as Error).message).toContain('JPY');
    }
  });
});
