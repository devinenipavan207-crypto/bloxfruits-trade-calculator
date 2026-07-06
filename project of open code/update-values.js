#!/usr/bin/env node
/* =========================================================
   update-values.js
   Pulls the latest Blox Fruits value list from public
   sources and rewrites fruits-data.js.

   Usage:
     npm install cheerio node-fetch@2
     node update-values.js

   The script:
     1. Fetches the wiki + mirror sites
     2. Parses fruit name + value pairs
     3. Matches them to our known list (fruits-data.js)
     4. Updates values, demand and trend
     5. Bumps LAST_UPDATED

   Sources (in priority order):
     - https://blox-fruits.fandom.com/wiki/Blox_Fruits/Values
     - https://bloxfruitsvalues.com
     - https://fruitvalues.com
     - https://elite-bloxfruits.com
   ========================================================= */

const fs   = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const SOURCES = [
  "https://blox-fruits.fandom.com/wiki/Blox_Fruits/Values",
  "https://bloxfruitsvalues.com",
  "https://fruitvalues.com",
  "https://elite-bloxfruits.com"
];

const DATA_FILE = path.join(__dirname, "fruits-data.js");
const UA = "Mozilla/5.0 (compatible; BloxFruitsValuesBot/1.0)";

async function fetchHTML(url) {
  // Lazy require so users without internet still get clear errors
  const fetch = (await import("node-fetch")).default;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
  return res.text();
}

function parseValuesFromHTML(html, url) {
  const $ = cheerio.load(html);
  const out = {};

  // Strategy: scan every table row / list item, extract
  // patterns like:   "Dragon — 5,000"   or   "Dragon: 5000"
  const moneyRe = /^[\s|]*([A-Za-z][A-Za-z0-9 ()\-']+?)[\s|]*[:—\-\|]+[\s|]*([0-9][0-9,\.]*)/;

  $("table tr, li, .fruit-row, .value-row").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const m = text.match(moneyRe);
    if (!m) return;
    const name = m[1].trim().replace(/\s+\(.+?\)/, ""); // strip "(East)" etc.
    const val  = parseInt(m[2].replace(/[, ]/g, ""), 10);
    if (isNaN(val) || val <= 0 || val > 50_000_000) return;
    if (!out[name] || val > out[name]) out[name] = val; // keep max
  });
  return out;
}

function inferDemand(value) {
  if (value >= 6000) return "extreme";
  if (value >= 4000) return "high";
  if (value >= 2000) return "medium";
  return "low";
}

function inferTrend(prev, next) {
  if (prev == null) return "stable";
  const change = (next - prev) / Math.max(1, prev);
  if (change >  0.05) return "up";
  if (change < -0.05) return "down";
  return "stable";
}

async function aggregate() {
  const tally = {};
  for (const url of SOURCES) {
    try {
      const html = await fetchHTML(url);
      const vals = parseValuesFromHTML(html, url);
      for (const [name, v] of Object.entries(vals)) {
        tally[name] = tally[name] || { sum: 0, count: 0 };
        tally[name].sum  += v;
        tally[name].count += 1;
      }
      console.log(`  ✓ ${url}  (${Object.keys(vals).length} fruits)`);
    } catch (e) {
      console.warn(`  ✗ ${url}  ${e.message}`);
    }
  }
  const out = {};
  for (const [name, t] of Object.entries(tally)) {
    out[name] = Math.round(t.sum / t.count);
  }
  return out;
}

function updateDataFile(aggregated) {
  const src = fs.readFileSync(DATA_FILE, "utf8");
  let count = 0;
  const updated = src.replace(
    /\{ name: "([^"]+)"[^}]+?value: (\d+)/g,
    (full, name, oldVal) => {
      const next = aggregated[name];
      if (next == null) return full;
      count++;
      const demand = inferDemand(next);
      const trend  = inferTrend(parseInt(oldVal, 10), next);
      return full
        .replace(/value: \d+/,  `value: ${next}`)
        .replace(/demand: "[^"]+"/, `demand: "${demand}"`)
        .replace(/trend: "[^"]+"/,  `trend: "${trend}"`)
        .replace(/perm: \d+/, `perm: ${next}`);
    }
  );

  // No-op reference to keep the regex pattern matched
  void (function () { /* fruit data is updated above */ })();

  const now = new Date().toISOString();
  const withStamp = updated.replace(
    /LAST_UPDATED: "[^"]+"/,
    `LAST_UPDATED: "${now}"`
  );

  fs.writeFileSync(DATA_FILE, withStamp);
  console.log(`\n✔ Updated ${count} fruit values.  timestamp = ${now}`);
}

(async () => {
  console.log("Aggregating Blox Fruits values from:");
  SOURCES.forEach(s => console.log("  - " + s));
  const aggregated = await aggregate();
  if (Object.keys(aggregated).length === 0) {
    console.error("\nNo values found. Aborting (file untouched).");
    process.exit(1);
  }
  updateDataFile(aggregated);
})();
