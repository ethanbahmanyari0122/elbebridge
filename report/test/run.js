'use strict';
/**
 * Acceptance tests for the findings report.
 * Runs the real generator over real scans, then asserts on the PDFs.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { build, ragFor, lucidStateFor } = require('../src/model');
const { render } = require('../src/render');

const SCANS = process.env.SCANS || path.resolve(__dirname, '../../scanner/out');
const COPY = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/report.en.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  → ' + d : ''))); };
const countPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

function gen(domain, out) {
  execFileSync('node', [path.join(__dirname, '../src/generate.js'),
    '--domain', domain, '--scans', SCANS, '--out', out], { stdio: 'pipe' });
  const f = fs.readdirSync(out).find((x) => x.includes(domain) && x.endsWith('.pdf'));
  return f ? fs.readFileSync(path.join(out, f)) : null;
}

(async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
  const scans = fs.readdirSync(SCANS).filter((d) => fs.existsSync(path.join(SCANS, d, 'scan.json')));
  const all = scans.map((d) => JSON.parse(fs.readFileSync(path.join(SCANS, d, 'scan.json'), 'utf8')));
  const usable = all.filter((s) => s.status === 'ok' && !s.redirectedOffDomain);

  console.log(`\n1. Every reportable scan produces exactly three pages (${usable.length} domains)`);
  let wrong = [];
  for (const s of usable) {
    const buf = gen(s.domain, out);
    const n = buf ? countPages(buf) : 0;
    if (n !== 3) wrong.push(`${s.domain}:${n}`);
  }
  ok(`all ${usable.length} are three pages`, wrong.length === 0, wrong.join(', '));

  console.log('\n2. Words we will not publish never reach a report');
  const banned = /\b(compliant|guaranteed?|fine[- ]proof|abmahnungssicher|rechtssicher|certified)\b/i;
  let hits = [];
  for (const s of usable) {
    const html = render(build(s, COPY, {}), COPY, { evidenceCount: 3 }).replace(/<[^>]+>/g, ' ');
    const m = html.match(banned);
    if (m) hits.push(`${s.domain}:${m[0]}`);
  }
  ok('no banned words in any report', hits.length === 0, hits.join(', '));

  console.log('\n3. The traffic lights say what we can actually support');
  const byDomain = Object.fromEntries(all.map((s) => [s.domain, s]));
  const ridge = byDomain['ridge.com'];
  if (ridge) {
    const r = ragFor(ridge, COPY);
    ok('a site with zero violations but no statement is amber, never green',
      r.bfsg === 'amber' && ridge.axeTotal === 0, `${r.bfsg}, axeTotal=${ridge.axeTotal}`);
  }
  const fp = byDomain['fillingpieces.com'];
  if (fp) ok('a named EU responsible person turns GPSR green', ragFor(fp, COPY).gpsr === 'green');
  const anyNoLucid = usable.find((s) => !s.lucidNumberOnSite);
  ok('packaging is never asserted as missing, only as pending a register check',
    ragFor(anyNoLucid, COPY).lucid === 'unknown', ragFor(anyNoLucid, COPY).lucid);

  console.log("\n4. Ornella's register result changes the report");
  {
    const base = usable[0];
    const none = ragFor(base, COPY, null);
    ok('with no result, packaging is pending, never asserted', none.lucid === 'unknown', none.lucid);

    const reg = ragFor(base, COPY, { [base.domain]: { lucidStatus: 'registered', lucidNumber: 'DE471122', checkedOn: '2026-08-16' } });
    ok('registered turns it green', reg.lucid === 'green', reg.lucid);

    const nf = ragFor(base, COPY, { [base.domain]: { lucidStatus: 'not_found', checkedOn: '2026-08-16' } });
    ok('not found turns it red', nf.lucid === 'red', nf.lucid);

    const un = ragFor(base, COPY, { [base.domain]: { lucidStatus: 'unclear', checkedOn: '2026-08-16' } });
    ok('unclear stays open rather than guessing', un.lucid === 'unknown', un.lucid);

    const m = build(base, COPY, { lucid: { [base.domain]: { lucidStatus: 'not_found', checkedOn: '2026-08-16' } } });
    ok('the report says when the register was searched', /searched the public LUCID register on 2026-08-16/i.test(m.rows.find((r) => r.key === 'lucid').sentence),
      m.rows.find((r) => r.key === 'lucid').sentence);
    ok('registration only appears as a fix when we know it is missing',
      m.remediation.some((r) => r.key === 'lucid-register'), JSON.stringify(m.remediation.map((r) => r.key)));
    const m2 = build(base, COPY, { lucid: { [base.domain]: { lucidStatus: 'registered' } } });
    ok('and never when they are already registered',
      !m2.remediation.some((r) => r.key === 'lucid-register'), JSON.stringify(m2.remediation.map((r) => r.key)));
  }

  console.log('\n5. Reports we must refuse to generate');
  const offdomain = all.find((s) => s.redirectedOffDomain);
  if (offdomain) {
    let refused = false;
    try { gen(offdomain.domain, out); } catch { refused = true; }
    ok(`refuses a domain that redirects to another company (${offdomain.domain})`, refused);
  }
  const broken = all.find((s) => s.status !== 'ok');
  if (broken) {
    let refused = false;
    try { gen(broken.domain, out); } catch { refused = true; }
    ok(`refuses an unreachable domain (${broken.domain}, ${broken.status})`, refused);
  }

  console.log('\n6. Every report carries the disclaimer and a version');
  const sample = build(byDomain[usable[0].domain], COPY, {});
  const html = render(sample, COPY, {});
  ok('disclaimer present', html.includes('not legal or tax advice'));
  ok('version and date present', /Version/.test(html) && html.includes(sample.reportDate));
  ok('vendor identified', html.includes('elbebridge GbR'));

  console.log('\n─────────────────────────────');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
