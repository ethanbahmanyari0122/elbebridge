#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cfg = require('./config');
const { scanDomain } = require('./scan');
const { readDomainsCsv, ensureDir, writeJson, withBudget } = require('./util');

function parseArgs(argv) {
  const a = { input: 'domains.csv', out: 'out', force: false, limit: 0, concurrency: cfg.domainConcurrency, headed: false };
  for (let i = 2; i < argv.length; i++) {
    const [k, v] = argv[i].includes('=') ? argv[i].split(/=(.*)/) : [argv[i], argv[i + 1]];
    switch (k) {
      case '--input': case '-i': a.input = v; if (!argv[i].includes('=')) i++; break;
      case '--out': case '-o': a.out = v; if (!argv[i].includes('=')) i++; break;
      case '--limit': a.limit = parseInt(v, 10) || 0; if (!argv[i].includes('=')) i++; break;
      case '--concurrency': case '-c': a.concurrency = Math.max(1, parseInt(v, 10) || 1); if (!argv[i].includes('=')) i++; break;
      case '--force': a.force = true; break;
      case '--headed': a.headed = true; break;
      case '--help': case '-h': usage(); process.exit(0);
    }
  }
  return a;
}

function usage() {
  console.log(`
elbebridge-scan — BFSG / GPSR / LUCID pre-check over a list of domains

  node src/index.js [options]

  -i, --input <file>    CSV, one domain per row in column 1   (default domains.csv)
  -o, --out <dir>       output root                            (default out)
  -c, --concurrency <n> domains in parallel                    (default ${cfg.domainConcurrency})
      --limit <n>       only scan the first n domains
      --force           re-scan domains that already have a clean scan.json
      --headed          show the browser (debugging only)

Every domain gets out/<domain>/scan.json. Re-running skips domains already
scanned OK, so an interrupted run resumes for free.
`);
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = path.resolve(args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input CSV not found: ${inputPath}`);
    process.exit(1);
  }

  let domains = readDomainsCsv(inputPath);
  if (args.limit) domains = domains.slice(0, args.limit);
  const outRoot = path.resolve(args.out);
  ensureDir(outRoot);

  // Resumability: a domain with an existing status:"ok" scan.json is done.
  const todo = domains.filter((d) => {
    if (args.force) return true;
    const f = path.join(outRoot, d, 'scan.json');
    if (!fs.existsSync(f)) return true;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')).status !== 'ok'; } catch { return true; }
  });

  const skipped = domains.length - todo.length;
  console.log(`\n${domains.length} domains in list · ${todo.length} to scan${skipped ? ` · ${skipped} already done` : ''} · concurrency ${args.concurrency}`);
  console.log(`User-Agent: ${cfg.userAgent}\n`);

  const t0 = Date.now();
  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const d = todo[cursor++];
      const res = await withBudget(() => scanDomain(browser, d, outRoot), cfg.domainBudget, d, outRoot);
      results.push(res);
    }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, todo.length || 1) }, worker));
  await browser.close();

  const elapsed = (Date.now() - t0) / 1000;

  // The summary is the state of the WHOLE list on disk, not just this run —
  // otherwise a resumed run hands Ornellas a worklist missing everything that
  // succeeded yesterday.
  const all = domains.map((d) => {
    const f = path.join(outRoot, d, 'scan.json');
    if (!fs.existsSync(f)) return { domain: d, status: 'not-scanned' };
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { domain: d, status: 'unreadable' }; }
  });

  const by = (s) => all.filter((r) => r.status === s).length;
  const summary = {
    generatedAt: new Date().toISOString(),
    input: inputPath,
    domainsInList: domains.length,
    scannedThisRun: results.length,
    ok: by('ok'),
    unreachable: by('unreachable'),
    errors: by('error'),
    skippedByRobots: by('skipped-robots'),
    timedOut: by('timeout'),
    notScanned: by('not-scanned'),
    elapsedSeconds: Math.round(elapsed),
    rows: all.map((r) => ({
      domain: r.domain,
      status: r.status,
      axeTotal: r.axeTotal ?? null,
      axeCritical: r.axeCritical ?? null,
      hasA11yStatement: r.hasA11yStatement ?? null,
      hasImpressum: r.hasImpressum ?? null,
      hasResponsiblePerson: r.hasResponsiblePerson ?? null,
      legalEntity: r.legalEntity ?? null,
      address: r.address ?? null,
      vatId: r.vatId ?? null,
      readyForLucidLookup: r.readyForLucidLookup ?? false,
    })),
  };
  writeJson(path.join(outRoot, '_run-summary.json'), summary);
  writeCsv(path.join(outRoot, '_run-summary.csv'), summary.rows);

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`Scanned ${results.length} this run in ${elapsed.toFixed(0)}s (${(elapsed / Math.max(results.length, 1)).toFixed(1)}s/domain)`);
  console.log(`List totals — ok ${summary.ok} · unreachable ${summary.unreachable} · error ${summary.errors} · robots-skip ${summary.skippedByRobots} · timeout ${summary.timedOut}${summary.notScanned ? ` · not scanned ${summary.notScanned}` : ''}`);
  console.log(`Ornellas' worklist: ${outRoot}/_run-summary.csv\n`);
}

function writeCsv(file, rows) {
  const cols = ['domain', 'status', 'axeTotal', 'axeCritical', 'hasA11yStatement', 'hasImpressum', 'hasResponsiblePerson', 'legalEntity', 'address', 'vatId', 'readyForLucidLookup'];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(file, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n', 'utf8');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
