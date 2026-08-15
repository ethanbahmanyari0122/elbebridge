'use strict';
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Politeness gate: guarantees >= minGapMs between successive requests to one host. */
function makeThrottle(minGapMs) {
  let last = 0;
  return async function gate() {
    const wait = last + minGapMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

function normaliseDomain(raw) {
  let d = String(raw || '').trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

/**
 * Reads the domain list. Column 1 is the domain; any further columns
 * (group, country, note) travel through to the worklist so Ornella can work
 * one sector at a time.
 */
function readDomainsCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',');
    const cell = cells[0];
    if (!cell) continue;
    if (/^\s*(domain|website|url|site)\s*$/i.test(cell)) continue;
    if (/^\s*#/.test(cell)) continue;
    const d = normaliseDomain(cell);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push({
      domain: d,
      group: (cells[1] || '').trim() || null,
      country: (cells[2] || '').trim() || null,
      note: (cells[3] || '').trim() || null,
    });
  }
  return out;
}

const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function log(domain, msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[${t}] ${String(domain).padEnd(26)} ${msg}`);
}

/**
 * Hard ceiling around one domain.
 *
 * Racing a promise against a timer stops us *waiting*, but the work carries on.
 * On the first 5-domain live run that produced a domain recorded as `timeout`
 * in the summary and `ok` in its own scan.json twenty-nine seconds later, after
 * the summary had already been written — plus a log line printed after the run
 * had finished. The two files disagreed about the same domain.
 *
 * So the timer now cancels: it closes the browser context, which rejects every
 * in-flight Playwright call, and sets a flag the scan checks before it writes.
 */
async function withBudget(fn, ms, domain, outRoot) {
  const path = require('path');
  const handle = { cancelled: false, context: null };
  let timer;

  const bail = new Promise((resolve) => {
    timer = setTimeout(() => {
      handle.cancelled = true;

      // Record and resolve FIRST. Closing a context whose page is mid-flight to
      // a host that accepts the connection and never answers can itself hang,
      // and awaiting it here meant the timeout record was never written at all.
      const rec = {
        schemaVersion: 1, domain, status: 'timeout',
        scannedAt: new Date().toISOString(), error: `exceeded ${ms}ms domain budget`,
      };
      writeJson(path.join(outRoot, domain, 'scan.json'), rec);
      log(domain, `TIMEOUT exceeded ${Math.round(ms / 1000)}s budget`);
      resolve(rec);

      // Then tear down in the background, bounded, so a stuck close cannot
      // hold the run open.
      if (handle.context) {
        Promise.race([
          handle.context.close().catch(() => {}),
          new Promise((r) => setTimeout(r, 5000)),
        ]).catch(() => {});
      }
    }, ms);
  });

  try {
    return await Promise.race([fn(handle), bail]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sleep, makeThrottle, normaliseDomain, readDomainsCsv, ensureDir, writeJson, log, withBudget };
