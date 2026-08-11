import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Fetches NBU rates for USD and EUR across a date range and writes an idempotent SQL file.
 *
 * Run out-of-band rather than through /api/fx/backfill because that endpoint sits behind
 * Access, which is not configured yet. Uses rate_per_unit for the same reason the Worker does:
 * NBU quotes some currencies per 10 or 100 units.
 *
 * Paced deliberately — this is someone else's free public API and the range is ~2000 days.
 */

const FROM = "2021-01-01";
const TO = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const CACHE = "fx-cache.jsonl";
const OUT = "fx-backfill.sql";
const WANTED = new Set(["USD", "EUR"]);
const DELAY_MS = 90;

const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
};

// Resume from the cache so an interrupted run does not refetch what it already has.
const have = new Set();
if (existsSync(CACHE)) {
  for (const line of readFileSync(CACHE, "utf8").split("\n")) {
    if (line.trim()) have.add(JSON.parse(line).onDate);
  }
  console.log(`cache: ${have.size} dates already fetched`);
}

const dates = [];
for (let d = FROM; d <= TO; d = addDays(d, 1)) if (!have.has(d)) dates.push(d);
console.log(`fetching ${dates.length} dates (${FROM} .. ${TO})`);

let ok = 0;
const failed = [];

for (const [i, date] of dates.entries()) {
  const url = `https://bank.gov.ua/NBU_Exchange/exchange_site?date=${date.replace(/-/g, "")}&json`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error("unexpected shape");

    const rates = [];
    for (const row of rows) {
      if (!WANTED.has(row.cc)) continue;
      const perUnit =
        row.rate_per_unit ??
        (typeof row.rate === "number" && row.units > 0 ? row.rate / row.units : undefined);
      if (typeof perUnit === "number" && Number.isFinite(perUnit) && perUnit > 0) {
        rates.push({ quote: row.cc, rate: perUnit });
      }
    }
    appendFileSync(CACHE, JSON.stringify({ onDate: date, rates }) + "\n");
    ok++;
  } catch (error) {
    failed.push(date);
    console.error(`  ${date}: ${error.message}`);
  }

  if (i % 200 === 0 && i > 0) console.log(`  ${i}/${dates.length}…`);
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

console.log(`fetched ${ok}, failed ${failed.length}`);
if (failed.length) console.log(`failed dates: ${failed.slice(0, 20).join(", ")}`);

// Build the SQL. ON CONFLICT makes re-running free, matching the Worker's storeRates.
const lines = ["-- Generated FX backfill. Idempotent: re-running costs nothing."];
let rowCount = 0;
const values = [];
for (const line of readFileSync(CACHE, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const { onDate, rates } = JSON.parse(line);
  for (const { quote, rate } of rates) {
    values.push(`('${onDate}','${quote}',${rate},'nbu')`);
    rowCount++;
  }
}
// Chunked inserts: one statement with 4000 VALUES rows can exceed D1's statement limits.
const CHUNK = 500;
for (let i = 0; i < values.length; i += CHUNK) {
  lines.push(
    `INSERT INTO fx_rates (on_date, quote, rate, source) VALUES\n${values
      .slice(i, i + CHUNK)
      .join(",\n")}\nON CONFLICT(on_date, quote) DO UPDATE SET rate = excluded.rate;`,
  );
}
writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`wrote ${OUT}: ${rowCount} rate rows in ${Math.ceil(values.length / CHUNK)} statements`);
