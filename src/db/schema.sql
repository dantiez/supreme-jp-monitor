-- Supreme JP monitor schema (Neon Postgres). Applied idempotently on boot.
--
-- IDENTITY: a tracked unit is (product_handle, size). Colour is a column on
-- products, not a key part, because Supreme ships one product per colourway
-- with size as the only variant axis. See src/types.ts for the evidence.
--
-- NULLABILITY: every measured value (price, status timestamps) is nullable.
-- Only identity is NOT NULL. A schema that cannot store "we could not read
-- this" forces the writer to invent a value, and an invented stock status is a
-- false restock alert.
--
-- RETENTION: nothing here is ever deleted on sell-out. That is the entire
-- premise -- a row must survive going out of stock so its return is a RESTOCK
-- rather than a first sighting.
--
-- NAMESPACE: everything lives in the `supreme_monitor` schema, never in
-- `public`. The Neon instance is shared with another tool that already owns a
-- table called `products` with different columns -- and `CREATE TABLE IF NOT
-- EXISTS products` would find it, silently skip creation, and leave every
-- INSERT here writing against the wrong shape. A dedicated schema makes that
-- collision impossible rather than merely unlikely.

CREATE SCHEMA IF NOT EXISTS supreme_monitor;

CREATE TABLE IF NOT EXISTS supreme_monitor.products (
  handle        text PRIMARY KEY,
  external_id   text,
  name          text        NOT NULL,
  -- Product-level attribute. NOT part of the key.
  color         text,
  -- Supreme style code (e.g. "SH1"); groups colourways of one design.
  style         text,
  category      text,
  image_url     text,
  url           text        NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_style_idx ON supreme_monitor.products (style);
CREATE INDEX IF NOT EXISTS products_category_idx ON supreme_monitor.products (category);

CREATE TABLE IF NOT EXISTS supreme_monitor.variants (
  handle          text        NOT NULL REFERENCES supreme_monitor.products (handle) ON DELETE CASCADE,
  -- Size label exactly as Supreme spells it ("Large", "One Size").
  size            text        NOT NULL,
  sku             text,
  price           integer,
  -- ISO-4217, read from the page rather than assumed. jp.supreme.com sometimes
  -- serves the US store, and 14800 there is $148, not the 148 yen it becomes
  -- if the currency is taken for granted.
  currency        text,
  -- AVAILABLE | SOLD_OUT | UNKNOWN. UNKNOWN means the check failed, which is
  -- deliberately distinct from SOLD_OUT.
  status          text        NOT NULL DEFAULT 'UNKNOWN',
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (handle, size)
);

CREATE INDEX IF NOT EXISTS variants_status_idx ON supreme_monitor.variants (status);

-- Append-only log of what changed and when. The dashboard's "Latest Event"
-- column and every Discord alert are reads of this table.
CREATE TABLE IF NOT EXISTS supreme_monitor.change_events (
  id                 bigserial   PRIMARY KEY,
  handle             text        NOT NULL REFERENCES supreme_monitor.products (handle) ON DELETE CASCADE,
  -- Null for NEW_PRODUCT, which concerns the product rather than one size.
  size               text,
  event              text        NOT NULL,
  previous_status    text,
  current_status     text,
  previous_price     integer,
  current_price      integer,
  currency           text,
  detected_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_events_detected_idx ON supreme_monitor.change_events (detected_at DESC);
CREATE INDEX IF NOT EXISTS change_events_handle_idx ON supreme_monitor.change_events (handle, size);
CREATE INDEX IF NOT EXISTS change_events_event_idx ON supreme_monitor.change_events (event);

-- One row per scan, so a gap in alerts can be told apart from a scan that never
-- ran. Without this, "no restocks today" and "the cron was broken today" look
-- identical.
CREATE TABLE IF NOT EXISTS supreme_monitor.scan_runs (
  id                bigserial   PRIMARY KEY,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  products_scanned  integer     NOT NULL DEFAULT 0,
  products_failed   integer     NOT NULL DEFAULT 0,
  changes_detected  integer     NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'running',
  error             text
);

CREATE INDEX IF NOT EXISTS scan_runs_started_idx ON supreme_monitor.scan_runs (started_at DESC);

-- Migration for databases created before prices carried their currency.
-- Prices written then were labelled yen unconditionally, so any that were in
-- fact USD are now indistinguishable from JPY. They are dropped rather than
-- guessed: an unknown price is honest, a confidently mislabelled one is not,
-- and the next scan refills every row it can still reach.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='supreme_monitor' AND table_name='variants'
               AND column_name='price_jpy') THEN
    ALTER TABLE supreme_monitor.variants RENAME COLUMN price_jpy TO price;
    ALTER TABLE supreme_monitor.variants ADD COLUMN IF NOT EXISTS currency text;
    UPDATE supreme_monitor.variants SET price = NULL, currency = NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='supreme_monitor' AND table_name='change_events'
               AND column_name='previous_price_jpy') THEN
    ALTER TABLE supreme_monitor.change_events RENAME COLUMN previous_price_jpy TO previous_price;
    ALTER TABLE supreme_monitor.change_events RENAME COLUMN current_price_jpy TO current_price;
    ALTER TABLE supreme_monitor.change_events ADD COLUMN IF NOT EXISTS currency text;
  END IF;
END $$;
