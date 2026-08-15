'use strict';
/**
 * Acceptance test for the scanner. Spins up four local sites that stand in for
 * the four things the real web will do to us, runs the real scanner against
 * them, and asserts on the resulting scan.json.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const { serve, serveBlackHole } = require('./fixture-server');

const ROOT = path.join(__dirname, '..');
const PORTS = { broken: 39101, clean: 39102, blocked: 39103, dead: 39104 };
const MAP = {
  'broken-shop.example': `http://127.0.0.1:${PORTS.broken}`,
  'clean-shop.example': `http://127.0.0.1:${PORTS.clean}`,
  'robots-blocked.example': `http://127.0.0.1:${PORTS.blocked}`,
  'dead-host.example': `http://127.0.0.1:${PORTS.dead}`,
  'nxdomain-does-not-resolve.example': 'http://127.0.0.1:39199',
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `  → ${detail}` : ''}`); }
}

(async () => {
  process.env.SCAN_TEST_ORIGINS = JSON.stringify(MAP);
  const cfg = require('../src/config');
  cfg.domainBudget = 45000;
  cfg.minGapMsPerHost = 50;          // fixtures are local; politeness gate tested separately
  const { scanDomain } = require('../src/scan');
  const { withBudget } = require('../src/util');
  // Production runs every domain through withBudget; the test must too.
  const scan = (d) => withBudget(() => scanDomain(browser, d, outRoot), cfg.domainBudget, d, outRoot);

  const servers = [
    await serve(path.join(ROOT, 'fixtures/broken-shop'), PORTS.broken),
    await serve(path.join(ROOT, 'fixtures/clean-shop'), PORTS.clean),
    await serve(path.join(ROOT, 'fixtures/robots-blocked'), PORTS.blocked),
    await serveBlackHole(PORTS.dead),
  ];

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  const read = (d) => JSON.parse(fs.readFileSync(path.join(outRoot, d, 'scan.json'), 'utf8'));
  const t0 = Date.now();

  // ---------------------------------------------------------------- broken
  console.log('\nbroken-shop.example — a shop that fails all three obligations');
  await scan('broken-shop.example');
  const b = read('broken-shop.example');
  check('status ok', b.status === 'ok', b.status + ' ' + (b.error || ''));
  check('cookie wall dismissed', b.cookieWall && b.cookieWall.dismissed === true, JSON.stringify(b.cookieWall));
  check('axe found violations behind the wall', b.axeTotal > 5, `axeTotal=${b.axeTotal}`);
  check('critical/serious counted', (b.axeCritical + b.axeSerious) > 0, `crit=${b.axeCritical} serious=${b.axeSerious}`);
  check('top10Rules populated', Array.isArray(b.top10Rules) && b.top10Rules.length > 0, `${b.top10Rules && b.top10Rules.length}`);
  check('no accessibility statement', b.hasA11yStatement === false);
  check('Impressum found', b.hasImpressum === true);
  check('no EU responsible person', b.hasResponsiblePerson === false);
  check('legal entity extracted', b.legalEntity === 'Nordlicht Home ApS', String(b.legalEntity));
  check('address extracted', /Havnegade 41/.test(b.address || ''), String(b.address));
  check('ready for LUCID lookup', b.readyForLucidLookup === true);
  check('product page scanned too', (b.pagesScanned || []).some((p) => p.label === 'product'), JSON.stringify(b.pagesScanned));
  check('homepage screenshot written', fs.existsSync(path.join(outRoot, 'broken-shop.example', 'home.png')));
  check('axe-raw.json written', fs.existsSync(path.join(outRoot, 'broken-shop.example', 'axe-raw.json')));
  check('evidence screenshots captured', (b.evidenceShots || []).length > 0, `${(b.evidenceShots || []).length} shots`);

  // ----------------------------------------------------------------- clean
  console.log('\nclean-shop.example — a shop that has done the work');
  await scan('clean-shop.example');
  const c = read('clean-shop.example');
  check('status ok', c.status === 'ok', c.status + ' ' + (c.error || ''));
  check('accessibility statement found', c.hasA11yStatement === true);
  check('statement reachable', c.a11yStatementReachable === true);
  check('statement judged substantive', c.a11yStatementLooksSubstantive === true, `words=${c.a11yStatementWordCount}`);
  check('Impressum found', c.hasImpressum === true);
  check('EU responsible person found', c.hasResponsiblePerson === true);
  check('responsible person evidence quoted', Boolean(c.responsiblePersonEvidence), String(c.responsiblePersonEvidence));
  check('legal entity extracted', c.legalEntity === 'Helle Waren AB', String(c.legalEntity));
  check('LUCID number on site detected', c.lucidNumberOnSite === 'DE1234567890123', String(c.lucidNumberOnSite));
  check('materially fewer violations than broken shop', c.axeTotal < b.axeTotal, `clean=${c.axeTotal} broken=${b.axeTotal}`);

  // --------------------------------------------------------------- robots
  console.log('\nrobots-blocked.example — Disallow: / must be honoured');
  await scan('robots-blocked.example');
  const r = read('robots-blocked.example');
  check('status skipped-robots', r.status === 'skipped-robots', r.status);
  check('no screenshot taken', !fs.existsSync(path.join(outRoot, 'robots-blocked.example', 'home.png')));

  // ------------------------------------------------- failures don't cascade
  console.log('\nfailure handling — a hung host and a dead host must not kill the run');
  const before = Date.now();
  await scan('dead-host.example');
  const elapsedDead = Date.now() - before;
  const d = read('dead-host.example');
  check('hung host recorded, not thrown', ['unreachable', 'error', 'timeout'].includes(d.status), d.status);
  check('hung host bounded by the domain budget', elapsedDead < cfg.domainBudget + 5000, `${elapsedDead}ms vs budget ${cfg.domainBudget}ms`);

  await scan('nxdomain-does-not-resolve.example');
  const n = read('nxdomain-does-not-resolve.example');
  check('connection-refused recorded as unreachable', n.status === 'unreachable', n.status);

  // ----------------------------------------------------------- still alive
  console.log('\nrun continues after failures');
  await scan('broken-shop.example');
  check('scanner still works after two failures', read('broken-shop.example').status === 'ok');

  // ------------------------------------------------------------ idempotent
  console.log('\nre-running does not duplicate output');
  const dir = path.join(outRoot, 'broken-shop.example');
  const filesBefore = fs.readdirSync(dir).sort().join(',');
  await scan('broken-shop.example');
  check('same file set after re-scan', fs.readdirSync(dir).sort().join(',') === filesBefore);
  check('schemaVersion stable', read('broken-shop.example').schemaVersion === 1);

  await browser.close();
  servers.forEach((s) => s.close());

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`${pass} passed, ${fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`artefacts: ${outRoot}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('test harness crashed:', e); process.exit(1); });
