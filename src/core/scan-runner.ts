// Orchestrates one scan: discover products, check each one, diff, store, alert.
//
// ORDER MATTERS AND IS DELIBERATE. For each product: detect changes against the
// stored state FIRST, then write the new state. Writing first would overwrite
// the very "before" the comparison needs, and every change would vanish.
//
// FAILURE IS PER-PRODUCT. One unreadable page must not abort the scan (§21 of
// the sibling spec, and plain sense): the other few hundred products still have
// news. A failed product is counted, left untouched in storage, and retried on
// the next run -- never written as SOLD_OUT, which would fire a false alert.

import { parseCataloguePage } from '../parsers/catalogue-parser.js';
import { fetchPage, collectionPath } from './supreme-client.js';
import {
  detectChanges,
  detectListingChanges,
  DetectedChange,
  ListingChange
} from './change-detector.js';
import { ScrapedProduct } from '../types.js';
import * as repo from '../db/monitor-repository.js';
import { notifyChanges } from '../notify/discord-notifier.js';

/**
 * Collections to sweep for discovery. ONE is enough, and that is a measurement
 * rather than an assumption.
 *
 * Supreme ignores the collection path: /collections/new, /collections/jackets
 * and /collections/shoes all return the SAME 241 products carrying every
 * product_type (jackets, shirts, sweatshirts, pants, shorts, ...). Listing
 * eight of them meant eight identical ~1 MB fetches per scan, seven of which
 * bought nothing but load on someone else's shop.
 *
 * It also means discovery is complete: one request sees the whole catalogue,
 * so no product can be missed by being in an unlisted collection.
 *
 * Kept configurable in case Supreme starts honouring the path.
 */
export const DEFAULT_COLLECTIONS = ['new'];

export interface ScanOptions {
  collections?: string[];
  /** Cap on products checked in one run. Listing order is newest-first. */
  maxProducts?: number;
  /** Skip the Discord post (used when backfilling an empty database). */
  notify?: boolean;
}

export interface ScanSummary {
  scanned: number;
  failed: number;
  changes: DetectedChange[];
  /** Products that left or returned to the catalogue. Empty on a partial scan. */
  listingChanges: ListingChange[];
  discovered: number;
  /** Per-collection discovery outcome. Empty `failed` is the healthy case. */
  discovery: DiscoveryResult;
}

export interface DiscoveryResult {
  /** Every product the catalogue declared, with its sizes and stock. */
  products: ScrapedProduct[];
  /** Pages that answered, with how many products each carried. */
  pagesRead: number;
  /** What the site says the catalogue holds. Null when it did not say. */
  declaredTotal: number | null;
  failed: Array<{ page: number; error: string }>;
}

/** One listing page carries at most this many; the rest need ?page=N. */
const PAGE_SIZE = 250;

/** Stop rather than page forever if the site keeps returning full pages. */
const MAX_PAGES = 20;

/**
 * Read the whole catalogue.
 *
 * Every product with every size and its stock flag arrives inside the listing
 * payload, so this is two requests for ~268 products rather than one request
 * per product. See catalogue-parser.ts for the verification against the
 * individual product pages.
 *
 * Paging continues until the declared total is reached or a page comes back
 * short. Stopping at page one silently dropped the last eighteen products,
 * which is the failure mode this whole path was rebuilt to remove.
 */
async function readCatalogue(collection: string): Promise<DiscoveryResult> {
  const products: ScrapedProduct[] = [];
  const seen = new Set<string>();
  const failed: DiscoveryResult['failed'] = [];
  let declaredTotal: number | null = null;
  let pagesRead = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const path = page === 1 ? collectionPath(collection) : `${collectionPath(collection)}?page=${page}`;
    const res = await fetchPage(path);

    if (!res.ok) {
      console.error(`[scan] FAILED listing page ${page}: ${res.error}`);
      failed.push({ page, error: res.error });
      break;
    }

    const parsed = parseCataloguePage(res.html);
    if (!parsed) {
      // "Could not read" must never become "the catalogue is empty".
      console.error(`[scan] FAILED to parse listing page ${page}`);
      failed.push({ page, error: 'catalogue payload missing or unreadable' });
      break;
    }

    pagesRead++;
    if (parsed.totalCount !== null) declaredTotal = parsed.totalCount;

    for (const product of parsed.products) {
      if (seen.has(product.handle)) continue;
      seen.add(product.handle);
      products.push(product);
    }

    console.log(`[scan] listing page ${page}: ${parsed.products.length} product(s)`);

    // A short page is the last page. A full one means there is more to fetch.
    if (parsed.products.length < PAGE_SIZE) break;
    if (declaredTotal !== null && products.length >= declaredTotal) break;
  }

  return { products, pagesRead, declaredTotal, failed };
}

export async function runScan(options: ScanOptions = {}): Promise<ScanSummary> {
  const collections = options.collections ?? DEFAULT_COLLECTIONS;
  const shouldNotify = options.notify !== false;

  await repo.ensureReady();
  const runId = await repo.startScanRun();

  const summary: ScanSummary = {
    scanned: 0,
    failed: 0,
    changes: [],
    listingChanges: [],
    discovered: 0,
    discovery: { products: [], pagesRead: 0, declaredTotal: null, failed: [] }
  };

  try {
    const discovery = await readCatalogue(collections[0] ?? 'new');
    summary.discovery = discovery;
    summary.discovered = discovery.products.length;

    if (discovery.products.length === 0) {
      throw new Error(
        `The catalogue could not be read (${discovery.failed
          .map((f) => `page ${f.page}: ${f.error}`)
          .join('; ') || 'no products returned'})`
      );
    }

    // The site states its own total. Reading fewer than it declares means
    // products went unchecked, and a scan that quietly covers less than the
    // shop holds is how a restock is never announced.
    if (
      discovery.declaredTotal !== null &&
      discovery.products.length < discovery.declaredTotal
    ) {
      console.error(
        `[scan] INCOMPLETE: read ${discovery.products.length} of ` +
          `${discovery.declaredTotal} declared products.`
      );
    }

    const capped =
      options.maxProducts && options.maxProducts > 0
        ? discovery.products.slice(0, options.maxProducts)
        : discovery.products;

    if (capped.length < discovery.products.length) {
      // Stated, never silent: a capped run that looked complete would make
      // "no changes" mean "we did not look".
      console.log(`[scan] capped at ${capped.length} of ${discovery.products.length} products`);
    }

    // Loaded once, before the loop, so every product is compared against the
    // same snapshot of "before".
    const knownHandles = await repo.loadKnownHandles();
    const knownVariants = await repo.loadKnownVariants();
    const firstRun = knownHandles.size === 0;

    for (const product of capped) {
      const changes = detectChanges(product, knownHandles, knownVariants);
      await repo.saveProduct(product);
      await repo.recordChanges(changes);

      summary.changes.push(...changes);
      summary.scanned++;
    }

    // Products that vanished from the shop.
    //
    // ONLY ON A COMPLETE READ. A capped run, or one whose second listing page
    // failed, did not establish that anything is gone -- it established that it
    // did not look. Running this on a partial scan would delist hundreds of
    // products at once and the alert would be indistinguishable from the shop
    // actually clearing its catalogue.
    const readEverything =
      discovery.failed.length === 0 &&
      capped.length === discovery.products.length &&
      (discovery.declaredTotal === null ||
        discovery.products.length >= discovery.declaredTotal);

    if (readEverything) {
      const seen = new Set(discovery.products.map((p) => p.handle));
      const knownProducts = await repo.loadKnownProducts();
      summary.listingChanges = detectListingChanges(seen, knownProducts);
      await repo.applyListingChanges(summary.listingChanges);
      if (summary.listingChanges.length > 0) {
        console.log(`[scan] listing changes: ${summary.listingChanges.length}`);
      }
    } else {
      console.log(
        '[scan] partial read - skipping delist detection (it would report ' +
          'products as gone that were simply not looked at)'
      );
    }

    // The first run discovers the entire catalogue at once. Announcing several
    // hundred NEW_PRODUCTs would bury the channel and teach the reader to mute
    // it before the first real restock ever arrives.
    if (shouldNotify && !firstRun && summary.changes.length > 0) {
      await notifyChanges(summary.changes);
    } else if (firstRun) {
      console.log(`[scan] first run: ${summary.changes.length} products recorded, notification suppressed`);
    }

    await repo.finishScanRun(runId, {
      scanned: summary.scanned,
      failed: summary.failed,
      changes: summary.changes.length,
      status: 'ok'
    });

    return summary;
  } catch (e) {
    await repo.finishScanRun(runId, {
      scanned: summary.scanned,
      failed: summary.failed,
      changes: summary.changes.length,
      status: 'failed',
      error: (e as Error).message
    });
    throw e;
  }
}
