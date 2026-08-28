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

Events: `NEW_PRODUCT` · `NEW_VARIANT` · `SOLD_OUT` · `RESTOCK` · `PRICE_CHANGED` · `DELISTED` · `RELISTED`

**Delisted is not sold out.** Sold out means the shop still offers the item and has none; delisted means the shop no longer offers it. Collapsing them would make a withdrawn product look like one that might come back.

**Delisting is only detected on a complete read.** A capped or partly-failed scan has not established that anything is gone — only that it did not look. Running the check anyway would withdraw hundreds of products the moment someone passes `--max`, and the alert would be indistinguishable from a real catalogue purge.

**Nothing is ever deleted when it sells out.** A sold-out size keeps its row so its return is recognised as a RESTOCK rather than a first sighting. That single rule is the reason the tool exists.

**A price change is only a price change in the same currency.** When the store switches, a shirt goes from 14800 JPY to 148 USD without Supreme touching the price; comparing those numbers would announce a 99% drop. The detector requires both sides to name the same currency before it says anything.

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
| `DISPLAY_TIMEZONE` | no | Zone for displayed times. Default `Asia/Tokyo` |
| `DASHBOARD_PASSWORD` | on a public host | Shared password. Without it the server refuses to start off loopback |
| `HOST` | no | Bind address. Default `127.0.0.1`; a platform needs `0.0.0.0` |

**The first run is silent by design.** It discovers the whole catalogue at once; announcing several hundred NEW_PRODUCTs would bury the channel and train the reader to ignore it before the first real restock ever arrives.

### Scripts

| Command | Does |
|---|---|
| `npm run scan` | One full sweep: discover, check, diff, store, alert |
| `npm run scan -- --max=50` | Cap products checked (listing order is newest-first) |
| `npm run scan -- --no-notify` | Record changes without posting |
| `npm run scan -- --init` | Seed the watch list from this scan |
| `npm run scan -- --collections=new` | Choose the listing to discover from |
| `npm run dev` | Dashboard + export, on 127.0.0.1 only |
| `npm test` | Vitest: 133 tests |
| `npm run lint` | `tsc --noEmit` |

---

## Scanning is manual

**There is no schedule.** A scan runs when someone presses **Quét ngay** on the dashboard, and at no other time.

**What that costs:** while nobody clicks, nothing is watched. A size that returns at 03:00 and sells out by 05:00 is never seen — and never enters the history either, because no scan ran between those two moments. The tool is an on-demand checker rather than a monitor. That was a deliberate choice; restoring automatic cover means putting the `schedule:` block back in `.github/workflows/scan.yml`.

The button starts the work and returns immediately; the page polls, because a full read takes roughly 100 seconds and holding a request open that long invites the browser or a proxy to give up while the scan carries on writing.

**The result is reported in terms the reader acts on.** A scan that finds something shows a banner naming what moved — "Mất hàng: 4 vừa hết hàng" — rather than a bare total. A single number is not actionable: four changes could be four restocks or four sell-outs, and for someone who has already listed these items for resale those are opposite pieces of news, one meaning stock to buy and the other a listing to pull. Reloading the list is offered as a button, never forced, since the reader may be part-way through copying a line.

**A scan that finds nothing puts the sold-out list away.** On a quiet day that list is identical to last time, and several hundred unchanged rows bury the thing the reader acts on -- what moved. The column keeps the note alone; the count goes with the rows, since those items still exist and printing 0 would be false. Nothing is deleted: the export and `/changes` still carry every one of them, and an explicit "chỉ hết hàng" filter brings them straight back.

**A scan that finds nothing says so, on the sold-out side.** The red column lists current stock rather than a diff, so it is never empty and the good news would otherwise have nowhere to land; it appears as a note above the list. "The last check found nothing" and "nothing has been checked yet" are kept apart, because only one of them is reassuring.

**The stored change count includes delistings.** A scan whose only news is that two products were pulled from the site has changed something. Recording zero would let the dashboard issue a false all-clear while stock vanished.

**One scan at a time.** A second click during a run is refused, not queued — a queued scan would compare against state the first one is still writing and report its predecessor's work as changes.

`workflow_dispatch` still exists in the workflow for running a scan without the dashboard up. It needs `DATABASE_URL` and `DISCORD_WEBHOOK_URL` as repo secrets.

---

## Sharing

**The dashboard is the product now, so it has to be reachable.** Alerts still go to Discord, but every part the customer asked for -- two columns, copy buttons, the scan button -- lives on the page. Handing someone the Discord channel is not handing them the tool.

**A password is required before it leaves loopback.** The server REFUSES TO START on a public host without `DASHBOARD_PASSWORD`. It used to print a warning and serve anyway, which is the same as no protection: a warning in a log nobody reads. What is behind it is not only the catalogue and the export -- it is `POST /api/scan`, so an unprotected URL lets a stranger start hundred-second scans against Supreme and the database, on repeat.

HTTP Basic, one shared password, no accounts. Two people share one secret; sessions and a user table would be scaffolding around a fact that fits in an environment variable. The username is not checked. Requests arriving over plain HTTP are refused rather than served, because Basic auth over cleartext hands the password to anyone on the path.

On loopback there is no password and no prompt -- the reader already owns the machine.

`/healthz` stays open: the platform probes it before routing traffic, and it answers liveness and nothing else.

### Deploying: the button is here, the scanning is there

**Where a scan runs is a correctness requirement, not a latency preference.** supreme.com serves a storefront picked from the caller's IP, and each storefront renames every product, so a scan from the wrong country records a stranger's catalogue over this one. Render has no Tokyo region -- no Render instance can ever scan.

But the reader who wants fresh data is sitting in front of the hosted dashboard, not in front of the machine that can scan. So the button records the **ask**, and the machine that can scan serves it:

```
reader presses Quét ngay  ->  hosted instance writes a row  ->  worker on the Mac claims it and scans
```

The database is already shared by both sides, which is why this needs no proxy, no open port and no second service.

| | Runs where | Does what |
|---|---|---|
| Dashboard | Render, free plan | Serves the page; queues scan requests |
| Worker | The owner's Mac | Claims requests and scans; also refreshes stale data |

`ALLOW_SCANNING=false` on the hosted instance turns `POST /api/scan` from "scan" into "record the ask", answered **202 Accepted** -- accepted, not done, which is what actually happened.

**Repeated clicks collapse onto one request.** Three impatient presses mean one scan.

**`Khởi tạo danh sách` stays on the machine that scans.** It discards the baseline, taking the red items still waiting to be acted on with it; that is not something to hand to a second reader through a queue whose consequences they cannot see.

**Status is read from the database when this instance does not scan.** The in-process state is always empty there, so reporting it alone would say "nothing has ever run" while a scan was in progress on another machine.

**A request nobody picks up says so.** After five minutes the status line reads "máy quét có thể đang tắt" instead of spinning forever -- the Mac is asleep, and a spinner that never resolves is worse than the truth.

**Installing the worker (macOS):**

```bash
cp scripts/com.supreme-jp-monitor.scan.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.supreme-jp-monitor.scan.plist
tail -f ~/Library/Logs/supreme-jp-monitor/scan.log
```

Every minute. That sounds like a lot for a job that scans every two hours, but the check exits in well under a second with nothing to do, and it is what makes the button on the other machine feel like a button. `scripts/scheduled-scan.sh` uses absolute paths throughout: launchd gives a job almost no environment, and a bare `npm` works when tested by hand and silently fails at 3am.

**One shot, not a daemon.** The worker checks once and exits. A long-lived loop would need its own supervision, restart story, and answer for a laptop that sleeps mid-wait; a process that exits has none of those, and the cost is up to a minute of latency on a job that takes two.

**What this still costs:** nothing is watched while that Mac is asleep, and a request made then waits until it wakes.

## Layout

```
src/
  types.ts                          data model; the colour decision is documented here
  format-time.ts                    UTC storage -> display-zone text, one place
  parsers/
    catalogue-parser.ts             listing HTML -> the WHOLE catalogue
    product-page-parser.ts          single product + the shared value helpers
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
    dashboard-page.ts               two-column HTML: green in stock, red not (pure)
    export-writer.ts                CSV / XLSX
  cli/run-scan.ts                   what Actions invokes
tests/fixtures/                     real captured HTML, not hand-written
```

Parser tests run against HTML captured from the live site. A fixture I wrote myself would only prove the parser matches my assumptions.

---

## Two screens

**`/` — what can I buy right now.** Two columns, green in stock and red not, one line per product-colour-size.

A **Xem thay đổi** button sits in the dashboard toolbar and the changes page links back, so the two are reachable from each other at any time. The post-scan banner also links there, but only when a scan found something -- on a quiet day that alone would leave no way through.

**`/changes` — what moved since the previous check.** Per SCAN, not per day. Scan 3 is compared with scan 2, scan 2 with scan 1. A daily baseline was considered and rejected: a size that sells out at 10:00 and returns at 14:00 looks identical to the morning snapshot at both 12:00 and 14:00, so the second restock never surfaces. Comparing against the previous run catches every transition.

The very first scan has nothing before it, so it lists what is in stock rather than an empty diff — an empty diff would read as "nothing changed" when the truth is "there was nothing to compare to".

---

## The dashboard

**Three groups against a watch list, not two against current stock.**

The watch list is the set of sizes that were AVAILABLE at the previous scan, carried in `variants.previous_status`. Membership plus current status gives the only three answers the reader acts on:

| | Meaning | What to do |
|---|---|---|
| 🟢 **Còn hàng** | in the list, still available | nothing |
| 🔴 **Hết hàng** | in the list, confirmed sold out | pull the listing |
| 🔵 **Sản phẩm mới** | not in the list, available now | could list it |

**A size that was sold out before and is sold out now appears in none of them.** That is the point: there is nothing to do about it, and several hundred such rows were what buried the two that mattered.

**The baseline is stored, not recomputed.** `status` is overwritten as the scan walks the catalogue, so by the time anyone loads the page the "before" side is gone. Storing it means the grouping survives a reload, a restart, and a second reader.

**The baseline rolls.** Scan N is compared with scan N-1, so a size that sells out and is not dealt with immediately drops out of 🔴 at the next scan. The customer chose this over a baseline fixed at initialisation, having been shown that exact cost.

**The toolbar holds three controls and nothing else** -- scan, initialise, changes. The category/event/status filters and the CSV and XLSX download buttons were removed at the customer's request. `/export` still answers, so the files are a URL away and the query parameters still work; it is the buttons that went, not the capability.

**Three controls, not two with a shape-shifting label.** `Quét ngay` measures against the list; `Khởi tạo danh sách` replaces it; `Xem thay đổi` opens the history. The initialise action used to be the scan button wearing a different name, which meant it disappeared after the first run and a deliberate re-seed became impossible. It is now always present, highlighted only while no list exists, and asks for confirmation before discarding a real baseline -- re-seeding drops the red items still waiting to be acted on.

**The baseline starts empty rather than seeded.** The migration deliberately leaves `previous_status` NULL rather than seeding it from current stock: seeding would keep the screen looking right while making the button impossible to ever see or press.

**`UNKNOWN` is never 🔴**, even though the rule reads "no longer available". A failed check has not established that anything is gone; calling it sold out sends the reader to pull a listing that is still selling, and one bad network moment would empty the green column across the catalogue. It is counted and reported separately.

**Withdrawn products are excluded.** A product that 404s is not stock. Left in, it shows as buyable -- and as 🔵, because scans no longer touch it so its baseline stays null.

**Colour is part of every line** -- `Box Logo Hooded Sweatshirt — Black — M`. Supreme ships one product per colourway, so without it two identical-looking lines are two different garments.

**Thumbnails, never the original image.** 834 KB versus 11 KB per image; across ~300 products that is 248 MB versus 3.3 MB.

## Export

Columns: `Product Name · Product URL · Category · Color · Size · SKU · Price · Currency · Status · Latest Event · First Seen At · Last Checked At`

**Currency is a column, not a header.** jp.supreme.com does not always answer with the Japanese store - some responses come back as the US store with USD prices, where an Oxford shirt reads 14800 and means $148, not the 148 yen it becomes if the currency is assumed. So every price carries the currency the page declared, and a price whose currency is unknown is exported without one rather than wearing a symbol nobody established.

**An unknown price exports as an empty cell — never `0`.** A zero gets averaged into a total as though someone had observed it. Dashboard and export read the same query, so the spreadsheet can never disagree with the screen.

---

## Known gaps

- **The storefront follows the caller's IP, and each storefront renames every product.** Diagnosed 2026-08-28. A scan from Singapore is served the SGD store, whose handles differ from the JPY store's for the same garments; since tracking is keyed on the handle, that run withdrew all 268 Japanese products and recorded 267 arrivals. The next run from elsewhere did the reverse. The data said it plainly once looked at: 996 rows in JPY all marked withdrawn, 995 in SGD all marked live.

  No request-level control exists -- verified against the live site that `/ja/` and `/en-jp/` 404, and that `?country=JP`, `Accept-Language` and a `cart_currency` cookie are all ignored.

  **The scan now refuses a foreign storefront instead of recording it**, which stops the corruption but does not obtain the right store. **Render has no Tokyo region, so no Render deploy can scan.** Serving the dashboard from Render is fine; the scan has to run where the JP store is reachable (a Tokyo-region host such as Fly.io `nrt`, or the owner's own machine). Unresolved.

- **A scan is two requests, not 268.** The listing embeds `products-json`: every product with every size and its stock flag, verified field-for-field against the individual product pages. Page one holds 250, page two the remaining 18. The site declares its own total (`allProductsCount`) and the run fails if fewer are read, so a short scan cannot pass as a complete one.
- **Times are displayed in Tokyo, stored in UTC.** `timestamptz` holds an absolute instant; only the reading is localised. Set `DISPLAY_TIMEZONE` (e.g. `Asia/Ho_Chi_Minh`) to change the frame. The zone is named in the dashboard and in the export headers so a timestamp is never ambiguous.
- **No per-size history chart.** Every change is stored in `change_events`; nothing plots it yet.
- **The dashboard has no auth.** Fine on loopback; it needs a password before it is exposed. The server warns at boot on a public bind.
- **Alerts cap at 10 embeds per message**, with the overflow counted in the summary line rather than dropped silently.
- **Scan duration is bounded by politeness, not by code.** ~240 products at 800ms is roughly 3–4 minutes; a full sweep across all collections is longer.

---

## Contributing

One branch per unit of work, conventional commits, a body stating *why*.

`src/core/supreme-client.ts` must never grow evasion. Supreme serves these pages to ordinary clients today; if that changes, the answer is to ask them for access, not to disguise the client.
