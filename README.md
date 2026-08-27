# Supreme JP Stock Monitor

Watches [jp.supreme.com](https://jp.supreme.com) and reports what changed: new products, new sizes, sell-outs, **restocks**, and price moves. Alerts go to Discord; the dashboard and CSV/XLSX export answer "what is in stock right now".

Node + TypeScript. Scanning runs as a short-lived CLI on a GitHub Actions schedule; the dashboard is a small Express app that only reads.

---

## Why this one was easy, and the StockX tool was not

Verified before a line was written: `jp.supreme.com` serves collection and product pages **fully rendered to an ordinary HTTP client**, and `robots.txt` allows `/collections/` and `/products/`. No browser, no proxy, no anti-bot layer, no cost.

The sibling StockX exporter faced the opposite: 403 from every datacenter IP, a real Chrome on a residential IP blocked after a handful of requests, and a ~$360–600/month residential-proxy bill to get anywhere. Same shape of problem, completely different answer — which is exactly why the source is checked first now.

Supreme's Shopify JSON APIs (`/products.json`, `/api/graphql.json`) **are** closed (403 "Access denied"), but nothing here needs them: every page embeds a complete product object in `<script type="application/json" id="product-<handle>-json">`.

---

## What it tracks

**A tracked unit is `(product handle, size)`. Colour is a product attribute, not a variant dimension.**

That is not a simplification — it is what Supreme does. Each colourway is its own product, carrying `"color":"Orange"` at product level with `"options":["Size"]`. Modelling colour as a variant axis would mean inventing a dimension the source does not have.

Events: `NEW_PRODUCT` · `NEW_VARIANT` · `SOLD_OUT` · `RESTOCK` · `PRICE_CHANGED`

**Nothing is ever deleted when it sells out.** A sold-out size keeps its row so its return is recognised as a RESTOCK rather than a first sighting. That single rule is the reason the tool exists.

**`UNKNOWN` never produces an event.** A failed fetch is UNKNOWN, not SOLD_OUT. Treating a network hiccup as a sell-out would alert that the whole catalogue vanished, and the recovery would alert that it all came back — two false alarms that teach the reader to mute the channel.

---

## Setup

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL
npm run scan -- --max=20       # first run: records state, sends no alert
npm run dev                    # dashboard on http://127.0.0.1:3100
```

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | **yes** | Neon Postgres. Tables live in the `supreme_monitor` schema |
| `DISCORD_WEBHOOK_URL` | no | Where alerts go. Without it, changes are still recorded |
| `REQUEST_DELAY_MS` | no | Gap between requests, default 800ms |
| `SCRAPER_USER_AGENT` | no | How the client identifies itself |

**The first run is silent by design.** It discovers the whole catalogue at once; announcing several hundred NEW_PRODUCTs would bury the channel and train the reader to ignore it before the first real restock ever arrives.

### Scripts

| Command | Does |
|---|---|
| `npm run scan` | One full sweep: discover, check, diff, store, alert |
| `npm run scan -- --max=50` | Cap products checked (listing order is newest-first) |
| `npm run scan -- --no-notify` | Record changes without posting |
| `npm run scan -- --collections=new,jackets` | Restrict discovery |
| `npm run dev` | Dashboard + export (local) |
| `npm start` | Same, for a hosting platform |
| `npm test` | Vitest: 58 tests |
| `npm run lint` | `tsc --noEmit` |

---

## Scheduling

`.github/workflows/scan.yml` runs the scan on GitHub Actions, **not** on the web host. A free Render instance sleeps after 15 minutes of no traffic, and a sleeping instance runs no cron; Actions fires regardless of whether anything else is awake.

- **Every 2 hours** — stock check, capped at 400 products
- **22:00 UTC daily** — full sweep, uncapped, catches new products
- **Manual** — `workflow_dispatch` with an optional cap and a notify toggle

Secrets required on the repo: `DATABASE_URL`, `DISCORD_WEBHOOK_URL`.

Runs are serialised (`concurrency: supreme-scan`). Two overlapping scans would compare against a half-written "before" and report the other run's writes as changes.

---

## Deploying the dashboard (optional)

**The monitor does not need a web host.** Scanning runs on GitHub Actions and alerts go to Discord; the dashboard only *reads* what the scan already stored. Deploy it if you want to browse and export from anywhere, and skip it otherwise.

Because nothing is scheduled here, **a free tier is enough** — a sleeping dashboard costs a slow first load and nothing else. Paying to keep it awake buys faster page loads, not extra capability. That separation is the whole reason the cron lives in Actions.

On Render: build `npm ci`, start `npm start`, and set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `HOST` | `0.0.0.0` — the container is unreachable on loopback |

`PORT` is injected. `DISCORD_WEBHOOK_URL` is **not** needed here; only the scanner posts.

**The dashboard has no authentication.** On a public host, anyone with the URL can read it and download the export. The server warns loudly at boot unless `ALLOW_PUBLIC_DASHBOARD=1` acknowledges it. Add a password before exposing anything you would not publish.

---

## Layout

```
src/
  types.ts                          data model; the colour decision is documented here
  parsers/
    collection-page-parser.ts       listing HTML -> product handles
    product-page-parser.ts          product HTML -> product + sizes + stock
  core/
    change-detector.ts              previous vs current -> events (the whole product)
    scan-runner.ts                  orchestration; per-product failure isolation
    supreme-client.ts               paced HTTP; no evasion, ever
  db/
    schema.sql                      supreme_monitor schema
    database.ts                     Neon pool
    monitor-repository.ts           all SQL; upsert-never-delete lives here
  notify/discord-notifier.ts        alert building (pure) + webhook post
  server/
    server.ts                       read-only dashboard + export routes
    dashboard-page.ts               server-rendered HTML (pure)
    export-writer.ts                CSV / XLSX
  cli/run-scan.ts                   what Actions invokes
tests/fixtures/                     real captured HTML, not hand-written
```

Parser tests run against HTML captured from the live site. A fixture I wrote myself would only prove the parser matches my assumptions.

---

## Export

Columns: `Product Name · Product URL · Category · Color · Size · SKU · Price (JPY) · Status · Latest Event · First Seen At · Last Checked At`

**An unknown price exports as an empty cell — never `0`.** A zero gets averaged into a total as though someone had observed it. Dashboard and export read the same query, so the spreadsheet can never disagree with the screen.

---

## Known gaps

- **Discovery is limited to the configured collections** (`new`, `jackets`, `shirts`, …). A product in no listed collection is never found. `/collections/new` alone returns ~241 products.
- **No per-size history chart.** Every change is stored in `change_events`; nothing plots it yet.
- **The dashboard has no auth.** Fine on loopback; it needs a password before it is exposed. The server warns at boot on a public bind.
- **Alerts cap at 10 embeds per message**, with the overflow counted in the summary line rather than dropped silently.
- **Scan duration is bounded by politeness, not by code.** ~240 products at 800ms is roughly 3–4 minutes; a full sweep across all collections is longer.

---

## Contributing

One branch per unit of work, conventional commits, a body stating *why*.

`src/core/supreme-client.ts` must never grow evasion. Supreme serves these pages to ordinary clients today; if that changes, the answer is to ask them for access, not to disguise the client.
