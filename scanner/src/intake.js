#!/usr/bin/env node
'use strict';
/**
 * Adds candidates to the list without ever adding one twice.
 *
 * Paste anything — a trade-fair exhibitor page, a column of URLs, a messy
 * export. This pulls the domains out, drops everything already on the list,
 * already scanned, or already in the pipeline, and appends only what is new.
 */
const fs = require('fs');
const path = require('path');
const { normaliseDomain, readDomainsCsv } = require('./util');

/** Platforms, CDNs and boilerplate that appear on every page and are never prospects. */
const NOISE = new RegExp('(^|\\.)(' + [
  'facebook', 'instagram', 'twitter', 'x', 'linkedin', 'youtube', 'tiktok', 'pinterest',
  'google', 'gstatic', 'googleapis', 'gmail', 'apple', 'microsoft', 'bing',
  'shopify', 'shopifycdn', 'myshopify', 'wixsite', 'squarespace', 'cloudfront',
  'cloudflare', 'akamai', 'amazonaws', 'cdn', 'jsdelivr', 'unpkg', 'fontawesome',
  'paypal', 'klarna', 'stripe', 'trustpilot', 'messefrankfurt', 'ispo', '10times',
  'wikipedia', 'w3', 'schema', 'creativecommons', 'gov', 'europa',
].join('|') + ')\\.', 'i');

const FILE_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|json|xml|pdf|ico|woff2?)$/i;

function extract(text) {
  const out = [];
  const seen = new Set();
  // Domains inside URLs, plain text, or "Brand — brand.com, Denmark" rows.
  const rx = /(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/gi;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const raw = m[1];
    if (FILE_EXT.test(raw)) continue;
    const d = normaliseDomain(raw);
    if (!d) continue;
    if (NOISE.test(`${d}.`)) continue;
    if (!/\.[a-z]{2,}$/i.test(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function readPipeline(file) {
  if (!fs.existsSync(file)) return new Map();
  const map = new Map();
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const header = (lines.shift() || '').split(',').map((h) => h.trim());
  const iDom = header.indexOf('domain');
  const iStage = header.indexOf('stage');
  const iDate = header.indexOf('updated');
  for (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const c = line.split(',');
    const d = normaliseDomain(c[iDom]);
    if (d) map.set(d, { stage: (c[iStage] || '').trim(), updated: (c[iDate] || '').trim() });
  }
  return map;
}

function usage() {
  console.log(`
elbebridge-intake — add candidates without ever adding one twice

  node src/intake.js --group <name> --source "<where from>" [--file <path>]

  --group <name>    sector group the new rows belong to   (required)
  --source <text>   where the list came from, for the note column
  --file <path>     input file; omit to read from stdin
  --list <file>     the domain list                       (default domains.csv)
  --scans <dir>     scan output root                      (default out)
  --pipeline <f>    contact tracker                       (default pipeline.csv)
  --country <cc>    country code for the new rows
  --dry-run         report what would happen, change nothing

  cat paste.txt | node src/intake.js --group sport --source "ISPO 2026"
`);
}

function main() {
  const a = { list: 'domains.csv', scans: 'out', pipeline: 'pipeline.csv' };
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const [k, v] = argv[i].includes('=') ? argv[i].split(/=(.*)/) : [argv[i], argv[i + 1]];
    const step = () => { if (!argv[i].includes('=')) i++; };
    if (k === '--group' || k === '-g') { a.group = v; step(); }
    else if (k === '--source') { a.source = v; step(); }
    else if (k === '--file' || k === '-f') { a.file = v; step(); }
    else if (k === '--list') { a.list = v; step(); }
    else if (k === '--scans') { a.scans = v; step(); }
    else if (k === '--pipeline') { a.pipeline = v; step(); }
    else if (k === '--country') { a.country = v; step(); }
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
  }
  if (!a.group) { usage(); process.exit(1); }

  const text = a.file ? fs.readFileSync(a.file, 'utf8') : fs.readFileSync(0, 'utf8');
  const found = extract(text);
  if (!found.length) {
    console.log('\nNo domains found in that input.\n');
    process.exit(0);
  }

  const onList = new Set(readDomainsCsv(a.list).map((e) => e.domain));
  const scanned = new Set(
    fs.existsSync(a.scans)
      ? fs.readdirSync(a.scans).filter((d) => fs.existsSync(path.join(a.scans, d, 'scan.json')))
      : []);
  const pipeline = readPipeline(a.pipeline);

  const buckets = { new: [], onList: [], scanned: [], contacted: [] };
  for (const d of found) {
    if (pipeline.has(d)) buckets.contacted.push(d);
    else if (onList.has(d)) buckets.onList.push(d);
    else if (scanned.has(d)) buckets.scanned.push(d);
    else buckets.new.push(d);
  }

  console.log(`\nRead ${found.length} candidate${found.length === 1 ? '' : 's'}${a.file ? ` from ${a.file}` : ''}`);
  const line = (n, label) => { if (n) console.log(`  ${String(n).padStart(4)}  ${label}`); };
  line(buckets.onList.length, 'already on the list');
  line(buckets.scanned.length, 'already scanned');
  line(buckets.contacted.length, 'already in the pipeline — do not contact again');
  for (const d of buckets.contacted) {
    const p = pipeline.get(d);
    console.log(`        ${d} (${p.stage || 'unknown stage'}${p.updated ? `, ${p.updated}` : ''})`);
  }
  line(buckets.new.length, `new${a.dryRun ? '' : ` → appended under group "${a.group}"`}`);

  if (!buckets.new.length) {
    console.log('\nNothing new to add.\n');
    return;
  }

  if (a.dryRun) {
    console.log(`\nDry run. Would add:\n${buckets.new.map((d) => `  ${d}`).join('\n')}\n`);
    return;
  }

  const note = a.source ? a.source.replace(/,/g, ';') : '';
  const block = `\n# added ${new Date().toISOString().slice(0, 10)}`
    + `${a.source ? ` from ${note}` : ''}\n`
    + buckets.new.map((d) => `${d},${a.group},${a.country || ''},${note}`).join('\n') + '\n';
  fs.appendFileSync(a.list, block, 'utf8');

  console.log(`\n${buckets.new.length} added to ${a.list}`);
  console.log(`Next: node src/index.js --group ${a.group}\n`);
}

if (require.main === module) main();
module.exports = { extract, readPipeline };
