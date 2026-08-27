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

import { parseCollectionPage } from '../parsers/collection-page-parser.js';
import { parseProductPage } from '../parsers/product-page-parser.js';
import { fetchPage, collectionPath, productPath } from './supreme-client.js';
import { detectChanges, DetectedChange } from './change-detector.js';
import * as repo from '../db/monitor-repository.js';
import { notifyChanges } from '../notify/discord-notifier.js';

/**
 * Collections to sweep for product discovery. `new` alone covers current drops;
 * the others catch items that age out of it.
 */
export const DEFAULT_COLLECTIONS = ['new', 'jackets', 'shirts', 'tops-sweaters', 'sweatshirts', 'pants', 'accessories', 'shoes'];

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
  discovered: number;
}

/** Discover handles across the configured collections, de-duplicated. */
async function discoverHandles(collections: string[]): Promise<string[]> {
  const handles: string[] = [];
  const seen = new Set<string>();

  for (const collection of collections) {
    const res = await fetchPage(collectionPath(collection));
    if (!res.ok) {
      console.warn(`[scan] collection "${collection}" failed: ${res.error}`);
      continue;
    }
    for (const handle of parseCollectionPage(res.html)) {
      if (seen.has(handle)) continue;
      seen.add(handle);
      handles.push(handle);
    }
  }

  return handles;
}

export async function runScan(options: ScanOptions = {}): Promise<ScanSummary> {
  const collections = options.collections ?? DEFAULT_COLLECTIONS;
  const shouldNotify = options.notify !== false;

  await repo.ensureReady();
  const runId = await repo.startScanRun();

  const summary: ScanSummary = { scanned: 0, failed: 0, changes: [], discovered: 0 };

  try {
    const handles = await discoverHandles(collections);
    summary.discovered = handles.length;

    const capped =
      options.maxProducts && options.maxProducts > 0
        ? handles.slice(0, options.maxProducts)
        : handles;

    if (capped.length < handles.length) {
      // Stated, never silent: a capped run that looked complete would make
      // "no changes" mean "we did not look".
      console.log(`[scan] capped at ${capped.length} of ${handles.length} discovered products`);
    }

    // Loaded once, before the loop, so every product is compared against the
    // same snapshot of "before" regardless of how long the scan takes.
    const knownHandles = await repo.loadKnownHandles();
    const knownVariants = await repo.loadKnownVariants();
    const firstRun = knownHandles.size === 0;

    for (const handle of capped) {
      const res = await fetchPage(productPath(handle));
      if (!res.ok) {
        summary.failed++;
        console.warn(`[scan] product "${handle}" failed: ${res.error}`);
        continue;
      }

      const product = parseProductPage(res.html);
      if (!product) {
        // Parse failure is a failure, not an empty product. Storing it as
        // "no sizes" would read as the whole product being delisted.
        summary.failed++;
        console.warn(`[scan] product "${handle}" could not be parsed`);
        continue;
      }

      const changes = detectChanges(product, knownHandles, knownVariants);
      await repo.saveProduct(product);
      await repo.recordChanges(changes);

      summary.changes.push(...changes);
      summary.scanned++;
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
