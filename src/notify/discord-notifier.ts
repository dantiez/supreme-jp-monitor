// Discord webhook alerts.
//
// The message building is a pure function so it can be tested without a
// webhook, and so the exact text the customer will see is pinned by tests
// rather than discovered in production.
//
// WHAT GETS SENT, AND WHY NOT EVERYTHING: a Supreme drop creates hundreds of
// changes at once. Posting all of them would push the one alert that matters --
// a restock on a size someone is waiting for -- off the top of the channel. So
// events are ordered by usefulness, capped, and the remainder is counted rather
// than dropped silently.

import { DetectedChange, ListingChange } from '../core/change-detector.js';
import { ChangeEvent } from '../types.js';

/** Discord hard limits: 10 embeds per message, 2000 characters of content. */
const MAX_EMBEDS = 10;

/**
 * Most useful first. RESTOCK leads because it is the only event a buyer can act
 * on immediately and it is the reason this tool exists; SOLD_OUT trails because
 * by the time it is read, there is nothing to do about it.
 */
const EVENT_PRIORITY: Record<ChangeEvent, number> = {
  RESTOCK: 0,
  RELISTED: 1,
  NEW_PRODUCT: 2,
  NEW_VARIANT: 3,
  PRICE_CHANGED: 4,
  SOLD_OUT: 5,
  // Last: a withdrawn product is the least actionable thing in the list.
  DELISTED: 6
};

const EVENT_LABEL: Record<ChangeEvent, string> = {
  RESTOCK: 'Back in stock',
  RELISTED: 'Listed again',
  NEW_PRODUCT: 'New product',
  NEW_VARIANT: 'New size',
  PRICE_CHANGED: 'Price changed',
  SOLD_OUT: 'Sold out',
  // "Removed", not "sold out": the shop no longer offers it at all, which is a
  // different fact from having none in stock.
  DELISTED: 'Removed from the site'
};

/** Discord embed colours, chosen so the event type is readable at a glance. */
const EVENT_COLOR: Record<ChangeEvent, number> = {
  RESTOCK: 0x2ecc71,
  RELISTED: 0x27ae60,
  NEW_PRODUCT: 0x3498db,
  NEW_VARIANT: 0x1abc9c,
  PRICE_CHANGED: 0xf1c40f,
  SOLD_OUT: 0x95a5a6,
  DELISTED: 0x7f8c8d
};

export interface DiscordEmbed {
  title: string;
  url: string;
  description: string;
  color: number;
}

export interface DiscordMessage {
  content: string;
  embeds: DiscordEmbed[];
}

/**
 * Money for an alert.
 *
 * The currency is passed in rather than assumed. jp.supreme.com sometimes
 * answers with the US store, and an alert reading "¥148" for a shirt that
 * actually costs $148 is worse than one that says nothing.
 */
function money(amount: number | null, currency: string | null): string {
  if (amount === null) return 'unknown';
  const text = amount.toLocaleString('en-US');
  if (currency === 'JPY') return `¥${text}`;
  if (currency === 'USD') return `$${text}`;
  return currency ? `${text} ${currency}` : text;
}

function describe(change: DetectedChange): string {
  const parts: string[] = [];
  if (change.color) parts.push(change.color);
  if (change.size) parts.push(`Size ${change.size}`);

  if (change.event === 'PRICE_CHANGED') {
    parts.push(
      `${money(change.previousPrice, change.currency)} -> ` +
        `${money(change.currentPrice, change.currency)}`
    );
  } else if (change.currentPrice !== null) {
    parts.push(money(change.currentPrice, change.currency));
  }

  return parts.join(' | ');
}

/**
 * Build the message for one batch of changes.
 *
 * Returns null when there is nothing to say. A monitor that posts "0 changes"
 * every two hours trains its readers to ignore it, and the next real restock
 * scrolls past unread.
 */
export function buildDiscordMessage(changes: DetectedChange[]): DiscordMessage | null {
  if (changes.length === 0) return null;

  const sorted = [...changes].sort(
    (a, b) => EVENT_PRIORITY[a.event] - EVENT_PRIORITY[b.event]
  );
  const shown = sorted.slice(0, MAX_EMBEDS);
  const hidden = sorted.length - shown.length;

  const counts = new Map<ChangeEvent, number>();
  for (const c of changes) counts.set(c.event, (counts.get(c.event) ?? 0) + 1);

  const summary = [...counts.entries()]
    .sort((a, b) => EVENT_PRIORITY[a[0]] - EVENT_PRIORITY[b[0]])
    .map(([event, n]) => `${EVENT_LABEL[event]}: ${n}`)
    .join(' | ');

  // The overflow count is stated, not swallowed: "and 40 more" tells the reader
  // to open the dashboard, whereas showing 10 of 50 silently reads as 10.
  const content = hidden > 0 ? `${summary} (showing ${shown.length}, ${hidden} more)` : summary;

  return {
    content,
    embeds: shown.map((c) => ({
      title: `${EVENT_LABEL[c.event]}: ${c.productName}`,
      url: c.url,
      description: describe(c) || EVENT_LABEL[c.event],
      color: EVENT_COLOR[c.event]
    }))
  };
}

/**
 * Post to the webhook.
 *
 * A notification failure must never fail the scan: the changes are already
 * committed, and losing an alert is far better than losing the state that makes
 * the next comparison correct. So this reports success as a boolean and logs
 * rather than throwing.
 */
export async function sendDiscordMessage(message: DiscordMessage): Promise<boolean> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[notify] DISCORD_WEBHOOK_URL is not set; skipping notification.');
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    if (!res.ok) {
      console.error(`[notify] Discord rejected the message: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[notify] Could not reach Discord:', (e as Error).message);
    return false;
  }
}

/**
 * A product leaving or rejoining the catalogue, in the shape the message
 * builder already understands.
 *
 * Listing changes concern the whole product rather than one size, so size,
 * status and price are genuinely absent -- null, not zero or a placeholder.
 */
export function listingChangeToDetected(change: ListingChange): DetectedChange {
  return {
    handle: change.handle,
    productName: change.productName,
    size: null,
    color: change.color,
    url: change.url,
    event: change.event,
    previousStatus: null,
    currentStatus: null,
    previousPrice: null,
    currentPrice: null,
    currency: null
  };
}

/**
 * Build and send, tolerating both no-ops.
 *
 * Listing changes are folded in here rather than sent as a second message.
 * They were being stored and shown on the dashboard but never announced, so a
 * product could vanish from the shop and the channel would say nothing --
 * exactly the silence the monitor exists to prevent.
 */
export async function notifyChanges(
  changes: DetectedChange[],
  listingChanges: ListingChange[] = []
): Promise<boolean> {
  const message = buildDiscordMessage([
    ...changes,
    ...listingChanges.map(listingChangeToDetected)
  ]);
  if (!message) return false;
  return sendDiscordMessage(message);
}
