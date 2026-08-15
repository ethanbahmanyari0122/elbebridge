'use strict';
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const P = require('./checks/patterns');
const { runAxe, summarise } = require('./checks/axe-check');
const { extractIdentity } = require('./checks/identity');
const { fetchRobots, isAllowed } = require('./robots');
const { dismissCookieWall, harvestLinks, matchLink, pickProductPage, safeGoto } = require('./page-utils');
const { makeThrottle, ensureDir, writeJson, log } = require('./util');

const SCHEMA_VERSION = 1;

/**
 * Scan one domain. Never throws: every failure path returns a scan.json with a
 * status field, because a crash on domain 34 that loses 35-100 is the single
 * most likely way a scanning day disappears.
 */
async function scanDomain(browser, domain, outRoot) {
  const started = Date.now();
  const dir = path.join(outRoot, domain);
  ensureDir(dir);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    domain,
    scannedAt: new Date().toISOString(),
    scannerVersion: require('../package.json').version,
    status: 'error',
    notes: [],
  };

  let context;
  try {
    const gate = makeThrottle(cfg.minGapMsPerHost);
    const origin = cfg.originFor(domain);

    // --- robots.txt -------------------------------------------------------
    const robotsRes = await fetchRobots(origin, cfg.uaToken);
    const robots = { allowed: (p) => isAllowed(robotsRes.rules, p) };
    record.robots = { fetched: robotsRes.fetched, ruleCount: robotsRes.rules.length };
    if (!robots.allowed('/')) {
      record.status = 'skipped-robots';
      record.notes.push('robots.txt disallows / for our user agent — not scanned.');
      writeJson(path.join(dir, 'scan.json'), record);
      log(domain, 'SKIP  robots.txt disallows /');
      return record;
    }

    context = await browser.newContext({
      userAgent: cfg.userAgent,
      viewport: cfg.viewport,
      locale: cfg.locale,
      timezoneId: cfg.timezone,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' },
    });
    context.setDefaultTimeout(cfg.navTimeout);
    const page = await context.newPage();

    // --- homepage ---------------------------------------------------------
    let nav = await safeGoto(page, origin, gate, robots);
    const timedOut = nav.error && /timeout/i.test(nav.error);
    if (!nav.ok && nav.reason === 'nav-error' && !timedOut) {
      nav = await safeGoto(page, origin.replace(/^https:/, 'http:'), gate, robots); // some hosts still redirect from http
      if (nav.ok) record.notes.push('https failed; reached over http');
    }
    if (!nav.ok) {
      record.status = 'unreachable';
      record.error = nav.reason + (nav.error ? `: ${nav.error}` : '');
      writeJson(path.join(dir, 'scan.json'), record);
      log(domain, `FAIL  ${record.error}`);
      return record;
    }
    record.finalUrl = nav.finalUrl;
    record.httpStatus = nav.status;
    const finalHost = new URL(nav.finalUrl).hostname.replace(/^www\./, '');
    if (finalHost !== domain) record.notes.push(`redirected to ${finalHost}`);

    const cookie = await dismissCookieWall(page);
    record.cookieWall = cookie;
    if (cookie.dismissed) await page.waitForTimeout(400);

    await page.screenshot({ path: path.join(dir, 'home.png'), fullPage: false }).catch(() => {});

    const links = await harvestLinks(page, finalHost).catch(() => []);
    record.linksFound = links.length;

    // --- checks 2, 3, 4: link-level presence ------------------------------
    const a11yLink = matchLink(links, P.A11Y_STATEMENT);
    const impLink = matchLink(links, P.IMPRESSUM);
    const privLink = matchLink(links, P.PRIVACY);

    record.hasA11yStatement = Boolean(a11yLink);
    record.a11yStatementUrl = a11yLink ? a11yLink.url : null;
    record.hasImpressum = Boolean(impLink);
    record.impressumUrl = impLink ? impLink.url : null;
    record.hasPrivacyPolicy = Boolean(privLink);

    const homeText = await page.evaluate(() => document.body.innerText || '').catch(() => '');

    // --- check 1: axe on homepage + one product page ----------------------
    const passes = [];
    try {
      passes.push(await runAxe(page, 'homepage'));
    } catch (e) {
      record.notes.push(`axe failed on homepage: ${String(e.message || e).slice(0, 160)}`);
    }

    const productUrl = pickProductPage(links, nav.finalUrl);
    record.productPageUrl = productUrl;
    let productText = '';
    if (productUrl) {
      const pnav = await safeGoto(page, productUrl, gate, robots);
      if (pnav.ok) {
        await dismissCookieWall(page).catch(() => {});
        productText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
        try {
          passes.push(await runAxe(page, 'product'));
        } catch (e) {
          record.notes.push(`axe failed on product page: ${String(e.message || e).slice(0, 160)}`);
        }
      } else {
        record.notes.push(`product page not reachable (${pnav.reason})`);
      }
    } else {
      record.notes.push('no product page identified — homepage only');
    }

    if (passes.length) {
      Object.assign(record, summarise(passes));
      writeJson(path.join(dir, 'axe-raw.json'), passes.map((p) => ({ label: p.label, url: p.url, results: p.results })));
      await captureEvidence(page, record, dir, passes);
    } else {
      record.axeTotal = null;
      record.axeCritical = null;
      record.top10Rules = [];
      record.notes.push('no axe results — treat as inconclusive, not as clean');
    }

    // --- check 3 + 5: Impressum page text ---------------------------------
    let impressumText = '';
    if (impLink) {
      const inav = await safeGoto(page, impLink.url, gate, robots);
      if (inav.ok) {
        impressumText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
        await page.screenshot({ path: path.join(dir, 'impressum.png'), fullPage: false }).catch(() => {});
      } else {
        record.notes.push(`Impressum link found but page not reachable (${inav.reason})`);
      }
    }

    // --- check 2 detail: does the statement page actually exist? ----------
    if (a11yLink) {
      const anav = await safeGoto(page, a11yLink.url, gate, robots);
      record.a11yStatementReachable = anav.ok;
      if (anav.ok) {
        const t = await page.evaluate(() => document.body.innerText || '').catch(() => '');
        record.a11yStatementWordCount = t.split(/\s+/).filter(Boolean).length;
        // A two-line "we care about accessibility" blurb is not a statement.
        record.a11yStatementLooksSubstantive = record.a11yStatementWordCount >= 120;
      }
    } else {
      record.a11yStatementReachable = null;
      record.a11yStatementWordCount = null;
      record.a11yStatementLooksSubstantive = null;
    }

    // --- check 4: EU responsible person (GPSR) ----------------------------
    const corpus = [homeText, productText, impressumText].join('\n');
    record.hasResponsiblePerson = P.RESPONSIBLE.test(corpus);
    record.responsiblePersonFoundOn = record.hasResponsiblePerson
      ? [['homepage', homeText], ['product', productText], ['impressum', impressumText]]
        .filter(([, t]) => P.RESPONSIBLE.test(t)).map(([k]) => k)
      : [];
    record.responsiblePersonEvidence = record.hasResponsiblePerson ? snippet(corpus, P.RESPONSIBLE) : null;

    // --- check 5: company identity ----------------------------------------
    Object.assign(record, extractIdentity(impressumText || homeText));
    record.identitySource = impressumText ? 'impressum' : (homeText ? 'homepage' : null);
    record.readyForLucidLookup = Boolean(record.legalEntity);

    record.status = 'ok';
    record.durationMs = Date.now() - started;
    writeJson(path.join(dir, 'scan.json'), record);
    log(domain, `OK    axe=${record.axeTotal} crit=${record.axeCritical} a11y=${yn(record.hasA11yStatement)} imp=${yn(record.hasImpressum)} rp=${yn(record.hasResponsiblePerson)} entity=${record.legalEntity ? '✓' : '✗'} (${Math.round(record.durationMs / 1000)}s)`);
    return record;
  } catch (e) {
    record.status = 'error';
    record.error = String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300);
    record.durationMs = Date.now() - started;
    writeJson(path.join(dir, 'scan.json'), record);
    log(domain, `ERROR ${record.error}`);
    return record;
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

/** Screenshots of the worst failing elements — this is page 2 of the report. */
async function captureEvidence(page, record, dir, passes) {
  const shots = [];
  const homePass = passes.find((p) => p.label === 'homepage');
  if (!homePass) return;
  if (page.url() !== homePass.url) {
    try { await page.goto(homePass.url, { waitUntil: 'domcontentloaded', timeout: cfg.navTimeout }); } catch { return; }
  }
  const candidates = record.top10Rules
    .filter((r) => r.sample && r.sample.page === 'homepage' && ['critical', 'serious'].includes(r.impact))
    .slice(0, cfg.maxEvidenceShots);
  for (const r of candidates) {
    const file = path.join(dir, `evidence-${r.id}.png`);
    try {
      const el = page.locator(r.sample.target).first();
      await el.scrollIntoViewIfNeeded({ timeout: 3000 });
      await el.screenshot({ path: file, timeout: 5000 });
      shots.push({ ruleId: r.id, impact: r.impact, file: path.basename(file), target: r.sample.target });
    } catch { /* element gone or not screenshotable — skip silently */ }
  }
  record.evidenceShots = shots;
}

function snippet(text, rx) {
  const m = text.match(rx);
  if (!m) return null;
  const i = Math.max(0, m.index - 90);
  return text.slice(i, m.index + m[0].length + 90).replace(/\s+/g, ' ').trim();
}

const yn = (v) => (v === true ? 'Y' : v === false ? 'N' : '?');

module.exports = { scanDomain, SCHEMA_VERSION };
