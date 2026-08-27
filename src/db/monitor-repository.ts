// All SQL for the monitor. Kept in one file so the storage rules -- above all
// "never delete a variant that sold out" -- live in one place rather than being
// re-decided at each call site.
//
// Every statement is parameterised. Product names and colours come from a third
// party and reach these queries as values, never as string-concatenated SQL.

import { query, withTransaction, ensureSchema } from './database.js';
import { KnownVariant, DetectedChange, variantKey } from '../core/change-detector.js';
import { ScrapedProduct, StockStatus } from '../types.js';

/**
 * Apply the schema if needed. Called at the start of every scan rather than
 * only at boot, because the scheduled runner is a short-lived process that
 * never boots a server.
 */
export async function ensureReady(): Promise<void> {
  await ensureSchema();
}

/** Handles already tracked. Drives NEW_PRODUCT detection. */
export async function loadKnownHandles(): Promise<Set<string>> {
  const res = await query<{ handle: string }>('SELECT handle FROM supreme_monitor.products');
  return new Set(res.rows.map((r) => r.handle));
}

/** Last known state of every tracked size, keyed for the change detector. */
export async function loadKnownVariants(): Promise<Map<string, KnownVariant>> {
  const res = await query<{
    handle: string;
    size: string;
    price_jpy: number | null;
    status: string;
  }>('SELECT handle, size, price_jpy, status FROM supreme_monitor.variants');

  const map = new Map<string, KnownVariant>();
  for (const row of res.rows) {
    map.set(variantKey(row.handle, row.size), {
      handle: row.handle,
      size: row.size,
      // Postgres integer arrives as a JS number, but be explicit that null
      // survives as null rather than becoming 0.
      priceJpy: row.price_jpy === null ? null : Number(row.price_jpy),
      status: row.status as StockStatus
    });
  }
  return map;
}

/**
 * Write one scraped product and its sizes.
 *
 * UPSERT, never DELETE. A size missing from this scrape keeps its stored row
 * untouched -- Supreme hides sold-out sizes from some views, and deleting on
 * absence would make the next appearance look like a brand-new variant instead
 * of the restock it is.
 *
 * `first_seen_at` is preserved on conflict; `last_seen_at` always advances, so
 * the pair answers "when did this appear" and "is it still listed".
 */
export async function saveProduct(product: ScrapedProduct): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO supreme_monitor.products (handle, external_id, name, color, style, category, image_url, url, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (handle) DO UPDATE SET
         external_id = EXCLUDED.external_id,
         name        = EXCLUDED.name,
         color       = EXCLUDED.color,
         style       = EXCLUDED.style,
         category    = EXCLUDED.category,
         image_url   = EXCLUDED.image_url,
         url         = EXCLUDED.url,
         last_seen_at = now()`,
      [
        product.handle,
        product.externalId,
        product.name,
        product.color,
        product.style,
        product.category,
        product.imageUrl,
        product.url
      ]
    );

    for (const variant of product.variants) {
      await client.query(
        `INSERT INTO supreme_monitor.variants (handle, size, sku, price_jpy, status, last_checked_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (handle, size) DO UPDATE SET
           sku             = EXCLUDED.sku,
           price_jpy       = EXCLUDED.price_jpy,
           status          = EXCLUDED.status,
           last_checked_at = now()`,
        [product.handle, variant.size, variant.sku, variant.priceJpy, variant.status]
      );
    }
  });
}

/** Append detected changes to the immutable event log. */
export async function recordChanges(changes: DetectedChange[]): Promise<void> {
  if (changes.length === 0) return;

  await withTransaction(async (client) => {
    for (const c of changes) {
      await client.query(
        `INSERT INTO supreme_monitor.change_events
           (handle, size, event, previous_status, current_status, previous_price_jpy, current_price_jpy)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          c.handle,
          c.size,
          c.event,
          c.previousStatus,
          c.currentStatus,
          c.previousPriceJpy,
          c.currentPriceJpy
        ]
      );
    }
  });
}

export async function startScanRun(): Promise<number> {
  const res = await query<{ id: string }>(
    `INSERT INTO supreme_monitor.scan_runs (status) VALUES ('running') RETURNING id`
  );
  return Number(res.rows[0]!.id);
}

/**
 * Close out a scan run.
 *
 * Recorded even on failure, because "no alerts today" and "the scan never ran
 * today" look identical from the outside otherwise.
 */
export async function finishScanRun(
  id: number,
  stats: { scanned: number; failed: number; changes: number; status: 'ok' | 'failed'; error?: string }
): Promise<void> {
  await query(
    `UPDATE supreme_monitor.scan_runs
        SET finished_at = now(), products_scanned = $2, products_failed = $3,
            changes_detected = $4, status = $5, error = $6
      WHERE id = $1`,
    [id, stats.scanned, stats.failed, stats.changes, stats.status, stats.error ?? null]
  );
}

/** One dashboard row: a tracked size with its product and latest event. */
export interface DashboardRow {
  handle: string;
  name: string;
  color: string | null;
  category: string | null;
  size: string;
  sku: string | null;
  price_jpy: number | null;
  status: string;
  url: string;
  latest_event: string | null;
  latest_event_at: string | null;
  first_seen_at: string;
  last_checked_at: string;
}

/**
 * Dashboard and export share this query, so the spreadsheet can never disagree
 * with the screen about what is in stock.
 */
export async function loadDashboardRows(filters: {
  status?: string;
  event?: string;
  category?: string;
  limit?: number;
} = {}): Promise<DashboardRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`v.status = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    where.push(`p.category = $${params.length}`);
  }
  if (filters.event) {
    params.push(filters.event);
    where.push(`latest.event = $${params.length}`);
  }

  params.push(Math.min(Math.max(filters.limit ?? 2000, 1), 20000));

  const res = await query<DashboardRow>(
    `SELECT p.handle, p.name, p.color, p.category, v.size, v.sku, v.price_jpy,
            v.status, p.url, latest.event AS latest_event,
            latest.detected_at AS latest_event_at,
            v.first_seen_at, v.last_checked_at
       FROM supreme_monitor.variants v
       JOIN supreme_monitor.products p ON p.handle = v.handle
       -- Latest event for this exact size; product-level events (NEW_PRODUCT,
       -- which has a null size) attach to every size of the product.
       LEFT JOIN LATERAL (
         SELECT e.event, e.detected_at
           FROM supreme_monitor.change_events e
          WHERE e.handle = v.handle
            AND (e.size = v.size OR e.size IS NULL)
          ORDER BY e.detected_at DESC
          LIMIT 1
       ) latest ON true
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.first_seen_at DESC, p.name, v.size
      LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

/** Distinct categories, for the dashboard filter. */
export async function loadCategories(): Promise<string[]> {
  const res = await query<{ category: string }>(
    `SELECT DISTINCT category FROM supreme_monitor.products WHERE category IS NOT NULL ORDER BY category`
  );
  return res.rows.map((r) => r.category);
}
