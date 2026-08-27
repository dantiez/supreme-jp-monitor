// CSV and XLSX export, built server-side from the same query the dashboard
// reads, so the spreadsheet can never disagree with the screen.
//
// THE NULL RULE, carried over from the sibling exporter because it was learned
// the hard way there: an unknown value exports as an EMPTY CELL. Never 0 -- a
// spreadsheet will average a zero into a total as though someone observed it --
// and never a dash, which turns a numeric column into text.

import * as XLSX from 'xlsx';
import { DashboardRow } from '../db/monitor-repository.js';

export type ExportFormat = 'csv' | 'xlsx';

type Cell = string | number | null;

const HEADERS = [
  'Product Name',
  'Product URL',
  'Category',
  'Color',
  'Size',
  'SKU',
  'Price (JPY)',
  'Status',
  'Latest Event',
  'First Seen At',
  'Last Checked At'
];

function isoOrNull(value: string | null): Cell {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toCells(row: DashboardRow): Cell[] {
  return [
    row.name,
    row.url,
    row.category,
    row.color,
    row.size,
    row.sku,
    // Price stays a number so the column stays numeric; null stays null.
    row.price_jpy === null ? null : Number(row.price_jpy),
    row.status,
    row.latest_event,
    isoOrNull(row.first_seen_at),
    isoOrNull(row.last_checked_at)
  ];
}

function buildSheet(rows: DashboardRow[]): Cell[][] {
  return [HEADERS, ...rows.map(toCells)];
}

/**
 * CSV text.
 *
 * Every field is quoted and inner quotes doubled, so a product name containing
 * a comma cannot shift the remaining columns. Leads with a UTF-8 BOM: without
 * it Excel renders Japanese product names as mojibake.
 */
export function generateCsv(rows: DashboardRow[]): string {
  const body = buildSheet(rows)
    .map((row) =>
      row
        .map((cell) => `"${(cell === null ? '' : String(cell)).replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\r\n');

  return '﻿' + body;
}

/**
 * XLSX workbook as a Buffer.
 *
 * null becomes undefined, and `aoa_to_sheet` omits undefined cells entirely --
 * that is what makes AVERAGE skip an unknown price instead of counting it zero.
 */
export function generateXlsxBuffer(rows: DashboardRow[]): Buffer {
  const sheet = buildSheet(rows).map((row) =>
    row.map((cell) => (cell === null ? undefined : cell))
  );
  const worksheet = XLSX.utils.aoa_to_sheet(sheet);

  worksheet['!cols'] = HEADERS.map((h) => ({ wch: Math.max(h.length + 3, 14) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Supreme JP Stock');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * `supreme_jp_stock_20260817.csv`.
 *
 * The date is stamped by the caller rather than read here so the filename is
 * deterministic in tests.
 */
export function buildExportFilename(format: ExportFormat, now: Date = new Date()): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `supreme_jp_stock_${stamp}.${format}`;
}
