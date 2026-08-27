// One place where a stored instant becomes text a person reads.
//
// STORAGE STAYS UTC, DISPLAY IS LOCAL. Postgres `timestamptz` holds an absolute
// instant; the `+00` in a raw query result is just how the client renders it,
// not a loss of information. Storing local time instead would be the actual
// mistake -- GitHub Actions runs in UTC, the shop is in Japan, and the readers
// are in Vietnam, so any single "local" choice at the storage layer would make
// two of those three wrong and comparisons between rows unreliable.
//
// The default display zone is Tokyo because that is where the events happen:
// a drop is announced for 11:00 JST, and a restock is a fact about the
// Japanese shop's day. Override with DISPLAY_TIMEZONE for a different frame,
// e.g. Asia/Ho_Chi_Minh.

/** IANA zone used for every human-facing timestamp. */
export function displayTimeZone(): string {
  return process.env.DISPLAY_TIMEZONE || 'Asia/Tokyo';
}

/** Short label for the zone, e.g. "JST", so a time is never ambiguous. */
export function timeZoneLabel(when: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: displayTimeZone(),
      timeZoneName: 'short'
    }).formatToParts(when);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? displayTimeZone();
  } catch {
    return displayTimeZone();
  }
}

/**
 * `2026-08-27 18:45` in the display zone.
 *
 * Returns an em dash for anything unparseable rather than "Invalid Date" or a
 * silently wrong epoch, so a broken timestamp cannot read as a real moment.
 */
export function formatWhen(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: displayTimeZone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  } catch {
    // An invalid DISPLAY_TIMEZONE must not take the page down; fall back to a
    // form that is at least unambiguous about being UTC.
    return date.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
  }
}
