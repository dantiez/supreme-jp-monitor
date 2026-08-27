// HTTP access to jp.supreme.com.
//
// Plain fetch, deliberately. Supreme serves collection and product pages fully
// rendered to an ordinary client -- verified before this project started -- and
// robots.txt allows /collections/ and /products/. There is no anti-bot layer to
// work around here, and this file must never grow one: if Supreme starts
// blocking, the answer is to ask them for access, not to disguise the client.
//
// PACING IS THE POINT. A stock check across a few hundred products, every few
// hours, is real load on someone else's shop. Requests are serialised with a
// delay between them, so the monitor stays a polite reader rather than a burst
// of traffic.

const BASE_URL = 'https://jp.supreme.com';

/** Identifies the client honestly rather than impersonating a browser. */
const USER_AGENT =
  process.env.SCRAPER_USER_AGENT ??
  'supreme-jp-monitor/0.1 (stock monitor; contact: repo owner)';

/** Gap between requests. Serialised, so this is the effective rate. */
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 800);

// Collection listings are large -- /collections/new is roughly 1 MB -- and a
// 20s ceiling silently timed them out on a slower link, which is how a scan
// ended up monitoring the wrong collection while reporting success.
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 60_000);
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type FetchResult =
  | { ok: true; html: string }
  | { ok: false; status: number | null; error: string };

let lastRequestAt = 0;

async function pace(): Promise<void> {
  const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
  if (lastRequestAt > 0 && wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * Fetch one page.
 *
 * Retries only transient failures (network, 5xx, 429). A 403 or 404 is a
 * settled answer and retrying it just adds load -- and if 403 ever starts
 * appearing, that is Supreme declining, which the caller should surface rather
 * than grind against.
 */
export async function fetchPage(pathname: string): Promise<FetchResult> {
  let lastError = 'unknown error';
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await pace();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${BASE_URL}${pathname}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: controller.signal
      }).finally(() => clearTimeout(timer));

      lastStatus = res.status;

      if (res.ok) return { ok: true, html: await res.text() };

      if (res.status === 404 || res.status === 403) {
        return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      }

      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = (e as Error).message;
    }

    // Back off progressively; a struggling origin should not be hammered.
    if (attempt < MAX_ATTEMPTS) await sleep(REQUEST_DELAY_MS * attempt * 2);
  }

  return { ok: false, status: lastStatus, error: lastError };
}

export const collectionPath = (handle: string) => `/collections/${handle}`;
export const productPath = (handle: string) => `/products/${handle}`;
