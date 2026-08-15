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

function readDomainsCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const cell = line.split(',')[0];
    if (!cell) continue;
    if (/^\s*(domain|website|url|site)\s*$/i.test(cell)) continue;
    if (/^\s*#/.test(cell)) continue;
    const d = normaliseDomain(cell);
    if (d && !seen.has(d)) { seen.add(d); out.push(d); }
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
 * Hard ceiling around one domain. A page that hangs past every internal timeout
 * must not eat the run, so we race the work against the budget and write a
 * timeout record ourselves if the budget wins.
 */
async function withBudget(fn, ms, domain, outRoot) {
  const path = require('path');
  let timer;
  const bail = new Promise((resolve) => {
    timer = setTimeout(() => {
      const rec = {
        schemaVersion: 1, domain, status: 'timeout',
        scannedAt: new Date().toISOString(), error: `exceeded ${ms}ms domain budget`,
      };
      writeJson(path.join(outRoot, domain, 'scan.json'), rec);
      log(domain, `TIMEOUT exceeded ${Math.round(ms / 1000)}s budget`);
      resolve(rec);
    }, ms);
  });
  try { return await Promise.race([fn(), bail]); } finally { clearTimeout(timer); }
}

module.exports = { sleep, makeThrottle, normaliseDomain, readDomainsCsv, ensureDir, writeJson, log, withBudget };
