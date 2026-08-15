#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { build } = require('./model');
const { render } = require('./render');

const SCANNER = path.resolve(__dirname, '../../scanner/node_modules');
const { chromium } = require(path.join(SCANNER, 'playwright'));

function usage() {
  console.log(`
elbebridge-report — one scan.json in, one three-page PDF out

  node src/generate.js --domain <domain> [options]

  --domain <d>     required; must exist under the scan output directory
  --scans <dir>    scanner output root                (default ../scanner/out)
  --out <dir>      where to write the report          (default ./reports)
  --brand <name>   display name                       (default the domain)
  --lucid <file>   Ornella's completed register worklist  (default ./lucid-results.csv)
  --keep-html      also keep the intermediate .html
`);
}

function parseArgs(argv) {
  const a = { scans: path.resolve(__dirname, '../../scanner/out'), out: path.resolve(__dirname, '../reports') };
  for (let i = 2; i < argv.length; i++) {
    const [k, v] = argv[i].includes('=') ? argv[i].split(/=(.*)/) : [argv[i], argv[i + 1]];
    const step = () => { if (!argv[i].includes('=')) i++; };
    if (k === '--domain') { a.domain = v; step(); }
    else if (k === '--scans') { a.scans = path.resolve(v); step(); }
    else if (k === '--out') { a.out = path.resolve(v); step(); }
    else if (k === '--brand') { a.brand = v; step(); }
    else if (k === '--lucid') { a.lucid = path.resolve(v); step(); }
    else if (k === '--keep-html') a.keepHtml = true;
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
  }
  return a;
}

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv);
  if (!args.domain) { usage(); process.exit(1); }

  const scanPath = path.join(args.scans, args.domain, 'scan.json');
  if (!fs.existsSync(scanPath)) {
    console.error(`No scan for ${args.domain} at ${scanPath}`);
    process.exit(1);
  }
  const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  if (scan.status !== 'ok') {
    console.error(`${args.domain} has status "${scan.status}" — nothing to report on.`);
    process.exit(1);
  }
  if (scan.redirectedOffDomain) {
    console.error(`${args.domain} redirects to ${scan.finalHost} — a different company. Refusing to generate.`);
    process.exit(1);
  }

  const copy = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/report.en.json'), 'utf8'));

  // Ornella's register results, if she has sent them back. One row per domain.
  const lucidPath = args.lucid || path.resolve(__dirname, '../lucid-results.csv');
  let lucid = null;
  if (fs.existsSync(lucidPath)) {
    lucid = {};
    const lines = fs.readFileSync(lucidPath, 'utf8').split(/\r?\n/);
    const head = (lines.shift() || '').split(',').map((h) => h.trim());
    const at = (c) => head.indexOf(c);
    for (const line of lines) {
      if (!line.trim() || line.startsWith('#')) continue;
      const cells = line.split(',');
      const d = (cells[at('domain')] || '').trim().toLowerCase().replace(/^www\./, '');
      if (!d) continue;
      lucid[d] = {
        lucidStatus: (cells[at('lucidStatus')] || '').trim(),
        lucidNumber: (cells[at('lucidNumber')] || '').trim(),
        checkedOn: (cells[at('checkedOn')] || '').trim(),
        note: (cells[at('note')] || '').trim(),
      };
    }
    const done = Object.values(lucid).filter((v) => v.lucidStatus).length;
    console.log(`Register results: ${done} completed row${done === 1 ? '' : 's'} from ${path.basename(lucidPath)}`);
  }

  // Build in a scratch dir beside the assets so relative CSS, fonts and the
  // screenshot all resolve from a file:// URL.
  const work = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ebreport-'));
  for (const f of ['report.css']) fs.copyFileSync(path.join(__dirname, '../assets', f), path.join(work, f));
  fs.mkdirSync(path.join(work, 'fonts'));
  for (const f of ['inter.woff2', 'serif.woff2']) {
    fs.copyFileSync(path.join(__dirname, '../assets/fonts', f), path.join(work, 'fonts', f));
  }

  const homeSrc = path.join(args.scans, args.domain, 'home.png');
  let homeShot = null;
  if (fs.existsSync(homeSrc)) {
    fs.copyFileSync(homeSrc, path.join(work, 'home.png'));
    homeShot = 'home.png';
  }

  const model = build(scan, copy, { brand: args.brand, homeShot, lucid });

  // Sending a report with the packaging line still open, when the search has
  // been done, looks like we did not finish the job.
  if (model.lucidState.state === 'pending' && lucid && lucid[scan.domain]) {
    console.warn(`  note: ${scan.domain} is in the register worklist but its lucidStatus is empty`);
  }
  const htmlPath = path.join(work, 'report.html');

  fs.mkdirSync(args.out, { recursive: true });
  const stamp = model.reportDate.replace(/-/g, '');
  const base = `elbebridge-findings-${args.domain.replace(/[^a-z0-9.]/gi, '-')}-${stamp}`;
  const pdfPath = path.join(args.out, `${base}.pdf`);

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  // The report is three pages by definition. Rather than tune the CSS to one
  // shop and watch it break on the next, render with as much evidence as fits
  // and step down until it does. Measured at the real print column width —
  // measuring at the default viewport under-reports height badly, because text
  // wraps far less than it does on paper.
  const MM = (v) => Math.round((v / 25.4) * 96);
  const USABLE_MM = 297 - 16 - 18;
  const ctx = await browser.newContext({ viewport: { width: MM(210 - 28), height: MM(USABLE_MM) } });
  const page = await ctx.newPage();

  // Count pages in the produced PDF rather than trusting a height proxy: the
  // proxy rejected a layout that actually rendered fine and dropped the report
  // to one finding with 27mm of the page left empty.
  const pdfOptions = {
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="width:100%;font-size:7pt;color:#4c5768;padding:0 14mm;
      font-family:sans-serif;display:flex;justify-content:space-between;">
      <span>elbebridge &middot; findings report &middot; ${model.domain} &middot; v${model.version}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
  };
  const countPages = (buf) => {
    const s = buf.toString('latin1');
    return (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
  };

  let evidenceCount = 3;
  let pdf = null;
  for (; evidenceCount >= 1; evidenceCount--) {
    fs.writeFileSync(htmlPath, render(model, copy, { evidenceCount }), 'utf8');
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    const buf = await page.pdf(pdfOptions);
    if (countPages(buf) <= 3) { pdf = buf; break; }
  }
  if (!pdf) {
    console.error('Could not fit the report onto three pages even with one finding shown.');
    await browser.close();
    process.exit(1);
  }
  fs.writeFileSync(pdfPath, pdf);
  await browser.close();

  if (args.keepHtml) fs.copyFileSync(htmlPath, path.join(args.out, `${base}.html`));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${pdfPath}`);
  console.log(`  ${model.brand} · ${model.rows.map((r) => `${r.key}:${r.status}`).join(' · ')}`);
  console.log(`  ${model.findings.length} rule groups · ${model.remediation.length} remediation items`);
  console.log(`  3 pages · ${evidenceCount} finding${evidenceCount === 1 ? '' : 's'} shown in full`);
  console.log(`  generated in ${secs}s\n`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
