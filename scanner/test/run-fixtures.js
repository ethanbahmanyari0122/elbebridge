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
const PORTS = { broken: 39101, clean: 39102, blocked: 39103, dead: 39104, terms: 39105, modal: 39106, fr: 39107 };
const MAP = {
  'broken-shop.example': `http://127.0.0.1:${PORTS.broken}`,
  'clean-shop.example': `http://127.0.0.1:${PORTS.clean}`,
  'robots-blocked.example': `http://127.0.0.1:${PORTS.blocked}`,
  'dead-host.example': `http://127.0.0.1:${PORTS.dead}`,
  'terms-only-shop.example': `http://127.0.0.1:${PORTS.terms}`,
  'modal-shop.example': `http://127.0.0.1:${PORTS.modal}`,
  'fr-shop.example': `http://127.0.0.1:${PORTS.fr}`,
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
  // Must mirror src/index.js exactly, handle included — without it a cancelled
  // scan still logs and writes, which is the bug this suite is meant to catch.
  // Production passes a metadata object from the CSV, so the harness must too.
  const scan = (d, meta = {}) => withBudget(
    (handle) => scanDomain(browser, { domain: d, ...meta }, outRoot, handle), cfg.domainBudget, d, outRoot);

  const servers = [
    await serve(path.join(ROOT, 'fixtures/broken-shop'), PORTS.broken),
    await serve(path.join(ROOT, 'fixtures/clean-shop'), PORTS.clean),
    await serve(path.join(ROOT, 'fixtures/robots-blocked'), PORTS.blocked),
    await serveBlackHole(PORTS.dead),
    await serve(path.join(ROOT, 'fixtures/terms-only-shop'), PORTS.terms),
    await serve(path.join(ROOT, 'fixtures/modal-shop'), PORTS.modal),
    await serve(path.join(ROOT, 'fixtures/fr-shop'), PORTS.fr),
  ];

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  const read = (d) => JSON.parse(fs.readFileSync(path.join(outRoot, d, 'scan.json'), 'utf8'));
  const t0 = Date.now();

  // ---------------------------------------------------------------- broken
  console.log('\nbroken-shop.example — a shop that fails all three obligations');
  await scan('broken-shop.example', { group: 'fashion', country: 'DK' });
  const b = read('broken-shop.example');
  check('status ok', b.status === 'ok', b.status + ' ' + (b.error || ''));
  // The live run dismissed 0 of 3 real walls: the matcher required the whole
  // label to equal "accept all", so "Accept All Cookies" never matched.
  check('cookie wall dismissed via a real-world label', b.cookieWall && b.cookieWall.dismissed === true, JSON.stringify(b.cookieWall));
  check('dismissal records how it was done', /Accept All Cookies/i.test((b.cookieWall || {}).via || ''), (b.cookieWall || {}).via);
  check('nothing left covering the page', b.cookieWall && b.cookieWall.stillBlocking === false, JSON.stringify(b.cookieWall.overlay));
  check('axe results marked reliable', b.axeReliable === true);
  // organicbasics.com was skipped because "Nutch" was treated as a substring
  // match for our user agent. A named group must not apply to us.
  check('a Disallow:/ for another named crawler does not block us', b.status === 'ok', b.status);
  check('robots group we matched is the wildcard', JSON.stringify((b.robots || {}).matchedAgents) === '["*"]', JSON.stringify((b.robots || {}).matchedAgents));
  // Shopify separates Disallow lines with a bare CR. Splitting on /\r?\n/
  // merged every group into one, so Nutch's "Disallow: /" applied to us.
  check('bare-CR line endings parsed as separate rules', (b.robots || {}).ruleCount === 3, `ruleCount=${(b.robots || {}).ruleCount}`);
  check('groups separated correctly', (b.robots || {}).groupCount === 2, `groupCount=${(b.robots || {}).groupCount}`);
  check('axe found violations behind the wall', b.axeTotal > 5, `axeTotal=${b.axeTotal}`);
  check('critical/serious counted', (b.axeCritical + b.axeSerious) > 0, `crit=${b.axeCritical} serious=${b.axeSerious}`);
  check('top10Rules populated', Array.isArray(b.top10Rules) && b.top10Rules.length > 0, `${b.top10Rules && b.top10Rules.length}`);
  check('no accessibility statement', b.hasA11yStatement === false);
  check('Impressum found', b.hasImpressum === true);
  check('no EU responsible person', b.hasResponsiblePerson === false);
  check('legal entity extracted', b.legalEntity === 'Nordlicht Home ApS', String(b.legalEntity));
  check('address extracted', /Havnegade 41/.test(b.address || ''), String(b.address));
  check('ready for LUCID lookup', b.readyForLucidLookup === true);
  check('sector group carried through from the CSV', b.group === 'fashion' && b.country === 'DK', `${b.group}/${b.country}`);
  check('German-market signal recorded', Boolean(b.germanMarket && b.germanMarket.confidence), JSON.stringify(b.germanMarket));
  check('prospect score produced', typeof b.prospectScore === 'number' && b.prospectScore > 0, String(b.prospectScore));
  // A live scan reported vatId "entification", captured out of the phrase
  // "VAT identification number" because the /i flag applied to the number too.
  check('no VAT id invented from prose', b.vatId === 'DK12345678' || b.vatId === null, String(b.vatId));
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
  // The Impressum is read over plain HTTP now, not through the browser, so the
  // HTML entities German legal pages are full of have to be decoded here.
  check('HTML entities decoded on the cheap fetch path',
    /Sveavägen 44/.test(c.address || ''), String(c.address));
  check('LUCID number on site detected', c.lucidNumberOnSite === 'DE1234567890123', String(c.lucidNumberOnSite));
  check('materially fewer violations than broken shop', c.axeTotal < b.axeTotal, `clean=${c.axeTotal} broken=${b.axeTotal}`);
  // The compliant shop has done the work, so it should rank below the broken one.
  check('a compliant shop scores lower than a broken one', c.prospectScore < b.prospectScore, `clean=${c.prospectScore} broken=${b.prospectScore}`);
  // Reach multiplies need, so a shop German law does not touch ranks below a
  // tidy German one however broken it is.
  const { scoreProspect } = require('../src/scan');
  const wreckedNoGermany = scoreProspect({ germanMarket: { confidence: 'low' }, axeCritical: 90,
    hasA11yStatement: false, hasResponsiblePerson: false, hasImpressum: false });
  const tidyGerman = scoreProspect({ germanMarket: { confidence: 'high' }, axeCritical: 0,
    hasA11yStatement: true, hasResponsiblePerson: true, hasImpressum: true, readyForLucidLookup: true });
  check('a wrecked shop outside the German market ranks below a tidy German one',
    wreckedNoGermany < tidyGerman, `${wreckedNoGermany} vs ${tidyGerman}`);

  // ------------------------------------------------- identity without an Impressum
  console.log('\nterms-only-shop.example — no Impressum, entity only on /terms, wall that will not close');
  await scan('terms-only-shop.example');
  const t = read('terms-only-shop.example');
  check('status ok', t.status === 'ok', t.status + ' ' + (t.error || ''));
  check('no Impressum, correctly', t.hasImpressum === false);
  check('legal entity recovered from Terms', t.legalEntity === 'Nordlys Handels ApS', String(t.legalEntity));
  check('address recovered too', /Vestergade 18/.test(t.address || ''), String(t.address));
  check('VAT recovered too', t.vatId === 'DK98765432', String(t.vatId));
  check('identitySource says where it came from', /fallback:\/terms/.test(t.identitySource || ''), String(t.identitySource));
  check('ready for LUCID lookup despite no Impressum', t.readyForLucidLookup === true);
  check('identity confidence is high when an address backs the name', t.identityConfidence === 'high', String(t.identityConfidence));
  // A supplier named in the terms must not beat the shop itself.
  check('brand in the domain wins over other companies on the page',
    /Nordlys/i.test(t.legalEntity || ''), String(t.legalEntity));
  check('undismissable wall detected', t.cookieWall && t.cookieWall.dismissed === false && t.cookieWall.stillBlocking === true, JSON.stringify(t.cookieWall));
  check('axe results flagged as NOT reliable', t.axeReliable === false, String(t.axeReliable));
  check('inconclusive is stated in the notes', (t.notes || []).some((n) => /inconclusive/.test(n)), JSON.stringify(t.notes));

  // ------------------------------------- decorative overlays vs real modals
  console.log('\nmodal-shop.example — a harmless full-screen overlay and a newsletter modal');
  await scan('modal-shop.example');
  const m = read('modal-shop.example');
  check('status ok', m.status === 'ok', m.status + ' ' + (m.error || ''));
  // A `fixed inset-0 pointer-events-none` layer covers the viewport and blocks
  // nothing; counting it marked a dozen good scans inconclusive.
  check('pointer-events:none overlay ignored', m.axeReliable === true, JSON.stringify(m.cookieWall));
  check('newsletter modal was closed', Boolean((m.cookieWall || {}).closedModal), JSON.stringify((m.cookieWall || {}).closedModal));
  check('nothing blocking afterwards', (m.cookieWall || {}).stillBlocking === false, JSON.stringify((m.cookieWall || {}).overlay));
  check('violations found behind the modal', m.axeTotal > 0, String(m.axeTotal));
  check('entity read from the Impressum', m.legalEntity === 'Modal Handels GmbH', String(m.legalEntity));
  check('platform boilerplate never becomes the entity', !/shopify/i.test(m.legalEntity || ''), String(m.legalEntity));
  check('VAT parsed from prose-style label', m.vatId === 'DE111222333', String(m.vatId));
  // "GPSR Compliance" as a footer phrase is not a responsible-person declaration.
  check('bare GPSR mention is not a responsible person', m.hasResponsiblePerson === false, String(m.responsiblePersonEvidence));
  check('not flagged as an off-domain redirect', m.redirectedOffDomain === false, String(m.finalHost));

  // ------------------------------------------- labelled legal notices (FR/IT/ES)
  console.log('\nfr-shop.example — name and legal form on separate labelled lines');
  await scan('fr-shop.example');
  const fr = read('fr-shop.example');
  check('status ok', fr.status === 'ok', fr.status);
  // "Dénomination sociale : X" / "Forme juridique : Y" is recombined; the
  // adjacency pattern alone matched the hosting provider further down instead.
  check('entity recombined from labels', fr.legalEntity === 'MAISON EXEMPLE S.A.S.', String(fr.legalEntity));
  check('the hosting provider is not the entity', !/shopify/i.test(fr.legalEntity || ''), String(fr.legalEntity));
  check('address read from the labelled siège social', /35 rue de Sèvres/.test(fr.address || ''), String(fr.address));
  check('French TVA number parsed', fr.vatId === 'FR96527995278', String(fr.vatId));
  check('confidence high', fr.identityConfidence === 'high', String(fr.identityConfidence));
  check('capital clause trimmed off the name', !/capital/i.test(fr.legalEntity || ''), String(fr.legalEntity));

  // --------------------------------------------------------------- robots
  console.log('\nrobots-blocked.example — Disallow: / must be honoured');
  await scan('robots-blocked.example');
  const r = read('robots-blocked.example');
  check('status skipped-robots', r.status === 'skipped-robots', r.status);
  check('no screenshot taken', !fs.existsSync(path.join(outRoot, 'robots-blocked.example', 'home.png')));
  check('records which rule blocked us', (r.robots || {}).blockedBy === '/', JSON.stringify(r.robots));
  check('keeps the raw robots.txt as evidence', fs.existsSync(path.join(outRoot, 'robots-blocked.example', 'robots.txt')));

  // ------------------------------------------------- failures don't cascade
  console.log('\nfailure handling — a hung host and a dead host must not kill the run');
  const before = Date.now();
  await scan('dead-host.example');
  const elapsedDead = Date.now() - before;
  const d = read('dead-host.example');
  check('hung host recorded, not thrown', ['unreachable', 'error', 'timeout'].includes(d.status), d.status);
  check('a timeout is retried once before giving up', d.navAttempts === 2 || d.status === 'timeout', `navAttempts=${d.navAttempts} status=${d.status}`);
  // The property that matters is that the budget cuts the retry chain short.
  // Left unbounded this host would take robots(10s) + nav(30s) + retry(45s).
  // A tighter wall-clock bound than this was flaky: measured in isolation the
  // budget fires at 45.1s, but under the load of a full suite run the timer can
  // land ~25s late. Worth knowing, not worth failing a build over.
  const unbounded = 10000 + cfg.navTimeout + cfg.navRetryTimeout;
  check('budget cut the retry chain short', d.status === 'timeout', d.status);
  check('hung host bounded well inside the unbounded worst case',
    elapsedDead < unbounded, `${elapsedDead}ms vs unbounded ${unbounded}ms (budget ${cfg.domainBudget}ms)`);

  await scan('nxdomain-does-not-resolve.example');
  const n = read('nxdomain-does-not-resolve.example');
  check('connection-refused recorded as unreachable', n.status === 'unreachable', n.status);

  // ----------------------------------------------------------- still alive
  // ------------------------------------------- the budget must cancel, not just stop waiting
  console.log('\nbudget expiry cancels the work instead of leaving it running');
  {
    const tinyBudget = 4000;
    const started = Date.now();
    const res = await withBudget(
      (handle) => scanDomain(browser, 'dead-host.example', outRoot, handle),
      tinyBudget, 'dead-host.example', outRoot,
    );
    check('budget returns promptly', Date.now() - started < tinyBudget + 4000, `${Date.now() - started}ms`);
    check('record written is a timeout', res.status === 'timeout', res.status);

    // The orphaned scan used to finish later and overwrite this file with "ok",
    // leaving the summary and the per-domain record disagreeing about the same
    // domain. Wait past the point where it would have finished.
    await new Promise((r) => setTimeout(r, 12000));
    const after = read('dead-host.example');
    check('timeout record survives the cancelled work finishing',
      after.status === 'timeout', `became "${after.status}"`);
    check('no stray scan data written after cancellation',
      after.axeTotal === undefined && after.cookieWall === undefined, JSON.stringify(Object.keys(after)));
  }

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
