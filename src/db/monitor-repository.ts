// All SQL for the monitor. Kept in one file so the storage rules -- above all
// "never delete a variant that sold out" -- live in one place rather than being
// re-decided at each call site.
//
// Every statement is parameterised. Product names and colours come from a third
// party and reach these queries as values, never as string-concatenated SQL.

import { query, withTransaction, ensureSchema } from './database.js';
import {
  KnownVariant,
  DetectedChange,
  KnownProduct,
  ListingChange,
  variantKey
} from '../core/change-detector.js';
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
    price: number | null;
    currency: string | null;
    status: string;
  }>('SELECT handle, size, price, currency, status FROM supreme_monitor.variants');

  const map = new Map<string, KnownVariant>();
  for (const row of res.rows) {
    map.set(variantKey(row.handle, row.size), {
      handle: row.handle,
      size: row.size,
      // Postgres integer arrives as a JS number, but be explicit that null
      // survives as null rather than becoming 0.
      price: row.price === null ? null : Number(row.price),
      currency: row.currency,
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
/**
 * @param initialise Seed the watch list from THIS scan instead of carrying the
 *   previous one forward. Used by "Khởi tạo danh sách", where the point is that
 *   what is in stock right now becomes the baseline -- so it shows as "still in
 *   stock" rather than as several hundred new products.
 */
export async function saveProduct(
  product: ScrapedProduct,
  initialise = false
): Promise<void> {
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
         last_seen_at = now(),
         -- Seeing it again clears the flag; detectListingChanges turns that
         -- into a RELISTED event before this write happens.
         delisted_at = NULL`,
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
        `INSERT INTO supreme_monitor.variants (handle, size, sku, price, currency, status, previous_status, last_checked_at)
         VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7 THEN $6 ELSE NULL END, now())
         ON CONFLICT (handle, size) DO UPDATE SET
           sku             = EXCLUDED.sku,
           price           = EXCLUDED.price,
           currency        = EXCLUDED.currency,
           -- Reads the row as it stands BEFORE this statement, which is exactly
           -- the previous scan's answer. Assignment order does not affect it:
           -- every right-hand side sees the old row.
           previous_status = CASE WHEN $7 THEN EXCLUDED.status
                                  ELSE supreme_monitor.variants.status END,
           status          = EXCLUDED.status,
           last_checked_at = now()`,
        [
          product.handle,
          variant.size,
          variant.sku,
          variant.price,
          variant.currency,
          variant.status,
          initialise
        ]
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
           (handle, size, event, previous_status, current_status, previous_price, current_price, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          c.handle,
          c.size,
          c.event,
          c.previousStatus,
          c.currentStatus,
          c.previousPrice,
          c.currentPrice,
          c.currency
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
  image_url: string | null;
  size: string;
  sku: string | null;
  price: number | null;
  currency: string | null;
  status: string;
  /** What this size was at the previous scan. Null means it was not tracked. */
  previous_status: string | null;
  url: string;
  delisted_at: string | null;
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
  // Products withdrawn from the site are never stock. Left in, they appear as
  // buyable -- and under the watch-list grouping they arrive as "sản phẩm mới",
  // because the scan no longer touches them so their baseline stays null. The
  // rows are kept in the table (history depends on them); they are just not
  // offered as something to sell.
  const where: string[] = ['p.delisted_at IS NULL'];
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
    `SELECT p.handle, p.name, p.color, p.category, p.image_url, v.size, v.sku, v.price, v.currency,
            v.status, v.previous_status, p.url, p.delisted_at, latest.event AS latest_event,
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

/** Products as stored, for deciding which have vanished from the catalogue. */
export async function loadKnownProducts(): Promise<KnownProduct[]> {
  const res = await query<{
    handle: string;
    name: string;
    color: string | null;
    url: string;
    delisted_at: Date | null;
  }>('SELECT handle, name, color, url, delisted_at FROM supreme_monitor.products');

  return res.rows.map((r) => ({
    handle: r.handle,
    name: r.name,
    color: r.color,
    url: r.url,
    delistedAt: r.delisted_at
  }));
}

/**
 * Record delistings and relistings.
 *
 * The flag is set here and the event is appended, so the dashboard can both
 * stop showing a withdrawn product as buyable and report when it went.
 */
export async function applyListingChanges(changes: ListingChange[]): Promise<void> {
  if (changes.length === 0) return;

  await withTransaction(async (client) => {
    for (const c of changes) {
      if (c.event === 'DELISTED') {
        await client.query(
          `UPDATE supreme_monitor.products SET delisted_at = now() WHERE handle = $1`,
          [c.handle]
        );
      }
      // RELISTED needs no update: saveProduct already cleared delisted_at when
      // it wrote the product it had just seen.

      await client.query(
        `INSERT INTO supreme_monitor.change_events (handle, size, event)
         VALUES ($1, NULL, $2)`,
        [c.handle, c.event]
      );
    }
  });
}

/** One change, joined to enough product detail to be readable on its own. */
export interface ChangeRow {
  handle: string;
  name: string;
  color: string | null;
  size: string | null;
  url: string;
  image_url: string | null;
  event: string;
  current_price: number | null;
  previous_price: number | null;
  currency: string | null;
  detected_at: string;
}

export interface ScanRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  products_scanned: number;
  changes_detected: number;
  status: string;
}

/** Recent scans, newest first, for choosing which one to report on. */
export async function loadRecentScans(limit = 20): Promise<ScanRunRow[]> {
  const res = await query<ScanRunRow>(
    `SELECT id, started_at, finished_at, products_scanned, changes_detected, status
       FROM supreme_monitor.scan_runs
      WHERE status <> 'running'
      ORDER BY id DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );
  return res.rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * Everything that changed during one scan.
 *
 * Bounded by the scan's own start and finish rather than by a date, because
 * the report is per RUN: "what changed since the previous check", not "what
 * changed today". A run that straddles midnight still reports as one unit.
 *
 * The first scan ever has nothing before it to differ from, so it produces
 * only NEW_PRODUCT rows -- which is why the caller shows the in-stock list
 * instead of a diff in that case.
 */
export async function loadChangesForScan(scanId: number): Promise<ChangeRow[]> {
  const res = await query<ChangeRow>(
    `WITH run AS (
       SELECT started_at, coalesce(finished_at, now()) AS finished_at
         FROM supreme_monitor.scan_runs WHERE id = $1
     )
     SELECT e.handle, p.name, p.color, e.size, p.url, p.image_url, e.event,
            e.current_price, e.previous_price, e.currency, e.detected_at
       FROM supreme_monitor.change_events e
       JOIN supreme_monitor.products p ON p.handle = e.handle
       JOIN run ON e.detected_at >= run.started_at AND e.detected_at <= run.finished_at
      ORDER BY e.detected_at, p.name, e.size`,
    [scanId]
  );
  return res.rows;
}


export interface ScanRequest {
  id: number;
  requested_at: string;
  claimed_at: string | null;
}

/**
 * Record that someone asked for a scan.
 *
 * Collapses onto an existing unclaimed request rather than queueing another:
 * three impatient clicks mean one scan, not three. Returns the request that
 * now stands, whether it was just made or already waiting.
 */
export async function requestScan(): Promise<ScanRequest> {
  const existing = await query<ScanRequest>(
    `SELECT id, requested_at, claimed_at FROM supreme_monitor.scan_requests
      WHERE claimed_at IS NULL ORDER BY requested_at LIMIT 1`
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await query<ScanRequest>(
    `INSERT INTO supreme_monitor.scan_requests DEFAULT VALUES
     RETURNING id, requested_at, claimed_at`
  );
  return created.rows[0]!;
}

/** The oldest request nobody has taken, or null. */
export async function pendingScanRequest(): Promise<ScanRequest | null> {
  const res = await query<ScanRequest>(
    `SELECT id, requested_at, claimed_at FROM supreme_monitor.scan_requests
      WHERE claimed_at IS NULL ORDER BY requested_at LIMIT 1`
  );
  return res.rows[0] ?? null;
}

/**
 * Take the oldest waiting request, if there is one.
 *
 * The WHERE clause does the locking: two workers racing on the same row, only
 * one UPDATE sees claimed_at still NULL, so only one gets a row back.
 */
export async function claimScanRequest(): Promise<ScanRequest | null> {
  const res = await query<ScanRequest>(
    `UPDATE supreme_monitor.scan_requests SET claimed_at = now()
      WHERE id = (SELECT id FROM supreme_monitor.scan_requests
                   WHERE claimed_at IS NULL ORDER BY requested_at LIMIT 1)
        AND claimed_at IS NULL
  RETURNING id, requested_at, claimed_at`
  );
  return res.rows[0] ?? null;
}

export async function finishScanRequest(id: number, error: string | null): Promise<void> {
  await query(
    `UPDATE supreme_monitor.scan_requests SET finished_at = now(), error = $2 WHERE id = $1`,
    [id, error]
  );
}

/**
 * Scan state as the DATABASE sees it, for an instance that does not scan.
 *
 * The in-process state only knows about scans this process started, and on the
 * hosted dashboard that is never any of them. Without this the page would
 * report "no scan has ever run" while one was running on another machine.
 */
export async function loadRemoteScanState(): Promise<{
  running: boolean;
  startedAt: string | null;
  pendingSince: string | null;
  last: {
    ok: boolean;
    finishedAt: string;
    durationMs: number;
    scanned: number;
    changes: number;
    byEvent: Record<string, number>;
  } | null;
}> {
  const [live, pending, finished] = await Promise.all([
    query<{ started_at: string }>(
      `SELECT started_at FROM supreme_monitor.scan_runs
        WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1`
    ),
    query<{ requested_at: string }>(
      `SELECT requested_at FROM supreme_monitor.scan_requests
        WHERE claimed_at IS NULL ORDER BY requested_at LIMIT 1`
    ),
    query<{
      id: number;
      started_at: string;
      finished_at: string;
      products_scanned: number;
      changes_detected: number;
      status: string;
    }>(
      `SELECT id, started_at, finished_at, products_scanned, changes_detected, status
         FROM supreme_monitor.scan_runs
        WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`
    )
  ]);

  const run = finished.rows[0] ?? null;
  let byEvent: Record<string, number> = {};

  if (run) {
    // Events carry no run id, so they are matched by the run's time window --
    // the same join the changes page uses.
    const events = await query<{ event: string; n: number }>(
      `SELECT e.event, count(*)::int AS n
         FROM supreme_monitor.change_events e
        WHERE e.detected_at >= $1 AND e.detected_at <= $2
        GROUP BY e.event`,
      [run.started_at, run.finished_at]
    );
    byEvent = Object.fromEntries(events.rows.map((r) => [r.event, Number(r.n)]));
  }

  return {
    running: live.rows.length > 0,
    startedAt: live.rows[0]?.started_at ?? null,
    pendingSince: pending.rows[0]?.requested_at ?? null,
    last: run
      ? {
          ok: run.status === 'ok',
          finishedAt: run.finished_at,
          durationMs:
            new Date(run.finished_at).getTime() - new Date(run.started_at).getTime(),
          scanned: Number(run.products_scanned),
          changes: Number(run.changes_detected),
          byEvent
        }
      : null
  };
}
