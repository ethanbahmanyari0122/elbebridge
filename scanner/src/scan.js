'use strict';
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const P = require('./checks/patterns');
const { runAxe, summarise } = require('./checks/axe-check');
const { extractIdentity } = require('./checks/identity');
const { fetchRobots, decide } = require('./robots');
const { dismissCookieWall, detectGermanMarket, fetchText, harvestLinks, matchLink, matchLinks, pickProductPage, safeGoto } = require('./page-utils');
const { makeThrottle, ensureDir, writeJson, log } = require('./util');

const SCHEMA_VERSION = 1;

/**
 * Scan one domain. Never throws: every failure path returns a scan.json with a
 * status field, because a crash on domain 34 that loses 35-100 is the single
 * most likely way a scanning day disappears.
 */
async function scanDomain(browser, entry, outRoot, handle) {
  const domain = typeof entry === 'string' ? entry : entry.domain;
  const meta = typeof entry === 'string' ? {} : entry;
  const started = Date.now();
  const dir = path.join(outRoot, domain);
  ensureDir(dir);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    domain,
    group: meta.group || null,
    country: meta.country || null,
    scannedAt: new Date().toISOString(),
    scannerVersion: require('../package.json').version,
    status: 'error',
    notes: [],
  };

  // Every write goes through here. Once the budget has cancelled us, the
  // timeout record on disk is authoritative and must not be overwritten.
  const cancelled = () => Boolean(handle && handle.cancelled);
  const save = () => {
    if (cancelled()) return false;
    writeJson(path.join(dir, 'scan.json'), record);
    return true;
  };
  /** Silent once cancelled: a line printed after the run summary is just noise. */
  const say = (msg) => { if (!cancelled()) log(domain, msg); };

  let context;
  try {
    const gate = makeThrottle(cfg.minGapMsPerHost);
    const origin = cfg.originFor(domain);
    const brand = domain.split('.')[0];   // "charlietemple" from charlietemple.nl

    // --- robots.txt -------------------------------------------------------
    const robotsRes = await fetchRobots(origin, cfg.uaToken);
    const robots = { allowed: (p) => decide(robotsRes.rules, p).allow };
    record.robots = {
      fetched: robotsRes.fetched,
      status: robotsRes.status ?? null,
      ruleCount: robotsRes.rules.length,
      groupCount: robotsRes.groupCount ?? null,
      matchedAgents: robotsRes.matchedAgents ?? [],
    };
    const rootDecision = decide(robotsRes.rules, '/');
    if (!rootDecision.allow) {
      record.status = 'skipped-robots';
      // Record exactly which line blocked us and under which user-agent group.
      // A wrong skip silently loses a prospect, so it must be diagnosable.
      record.robots.blockedBy = rootDecision.rule ? rootDecision.rule.path : null;
      record.notes.push(`robots.txt disallows / — matched "Disallow: ${rootDecision.rule && rootDecision.rule.path}" in the group for [${(robotsRes.matchedAgents || []).join(', ')}]`);
      writeJson(path.join(dir, 'robots.txt'), { url: `${origin}/robots.txt`, body: robotsRes.raw });
      save();
      say(`SKIP  robots.txt disallows / (group: ${(robotsRes.matchedAgents || []).join(',')})`);
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
    // Hand the context to the budget timer so it can kill the work on expiry.
    if (handle) handle.context = context;
    context.setDefaultTimeout(cfg.navTimeout);
    const page = await context.newPage();

    // --- homepage ---------------------------------------------------------
    let nav = await safeGoto(page, origin, gate, robots);
    record.navAttempts = 1;

    // A single slow first byte cost us a real prospect on the first live run.
    // Bot-protection challenges and cold CDNs routinely blow 30s once and then
    // load fine. One retry, still inside the 120s domain budget.
    if (!nav.ok && nav.error && /timeout/i.test(nav.error)) {
      record.navAttempts = 2;
      record.notes.push('first navigation timed out; retried once');
      nav = await safeGoto(page, origin, gate, robots, cfg.navRetryTimeout);
    }

    const timedOut = nav.error && /timeout/i.test(nav.error);
    if (!nav.ok && nav.reason === 'nav-error' && !timedOut) {
      nav = await safeGoto(page, origin.replace(/^https:/, 'http:'), gate, robots); // some hosts still redirect from http
      if (nav.ok) record.notes.push('https failed; reached over http');
    }
    if (!nav.ok) {
      record.status = 'unreachable';
      record.error = nav.reason + (nav.error ? `: ${nav.error}` : '');
      save();
      say(`FAIL  ${record.error}`);
      return record;
    }
    record.finalUrl = nav.finalUrl;
    record.httpStatus = nav.status;
    const finalHost = new URL(nav.finalUrl).hostname.replace(/^www\./, '');
    record.finalHost = finalHost;
    // A redirect within the same registrable domain is routine (locale paths,
    // www). A redirect to a *different* domain means we are looking at another
    // company: represent.com now serves cameo.com. Sending that report would be
    // worse than sending none, so it is flagged, not buried in a note.
    record.redirectedOffDomain = isDifferentCompany(domain, finalHost);
    if (finalHost !== domain) record.notes.push(`redirected to ${finalHost}`);
    if (record.redirectedOffDomain) {
      record.notes.push(`DIFFERENT COMPANY: ${domain} resolves to ${finalHost} — do not send a report for this row without checking`);
    }

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
    record.germanMarket = await detectGermanMarket(page, links, homeText, nav.finalUrl);

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
      // An overlay hides everything behind it from axe, so a broken shop scores
      // clean. If one is still up, the numbers are a floor, not a finding.
      record.axeReliable = !record.cookieWall.stillBlocking;
      if (!record.axeReliable) {
        record.notes.push(`an overlay still covers ${Math.round((record.cookieWall.overlay?.coverage || 0) * 100)}% of the viewport — axe totals are a floor, treat as inconclusive rather than clean`);
      }
      writeJson(path.join(dir, 'axe-raw.json'), passes.map((p) => ({ label: p.label, url: p.url, results: p.results })));
      await captureEvidence(page, record, dir, passes);
    } else {
      record.axeTotal = null;
      record.axeCritical = null;
      record.top10Rules = [];
      record.notes.push('no axe results — treat as inconclusive, not as clean');
    }

    // Some shops have an Impressum but do not surface it in a link we harvest —
    // it sits behind a menu, or a locale switcher. Probe the handful of paths
    // Shopify and friends actually use before concluding there is none.
    let impUrl = impLink ? impLink.url : null;
    let impressumTextPrefetched = '';
    if (!impUrl) {
      const base = new URL(nav.finalUrl);
      const localePrefix = base.pathname.match(/^\/[a-z]{2}(-[a-z]{2})?(?=\/|$)/i);
      const prefixes = localePrefix ? [localePrefix[0], ''] : [''];
      const probes = [];
      for (const pre of prefixes) {
        for (const p of ['/impressum', '/pages/impressum', '/pages/legal-notice', '/policies/legal-notice']) {
          probes.push(`${base.origin}${pre}${p}`);
        }
      }
      record.impressumProbes = [];
      for (const url of probes.slice(0, 6)) {
        const res = await fetchText(url, gate, robots);
        record.impressumProbes.push(`${new URL(url).pathname} (${res.ok ? 'found' : res.reason})`);
        if (!res.ok) continue;
        if (P.IMPRESSUM.test(res.text.slice(0, 400)) || extractIdentity(res.text, brand).legalEntity) {
          impUrl = url;
          record.hasImpressum = true;
          record.impressumUrl = url;
          impressumTextPrefetched = res.text;
          record.notes.push(`Impressum found by probing ${new URL(url).pathname}, not linked from the pages we saw`);
          break;
        }
      }
    }

    // --- check 3 + 5: Impressum page text ---------------------------------
    let impressumText = impressumTextPrefetched;
    if (impUrl && !impressumText) {
      const res = await fetchText(impUrl, gate, robots);
      if (res.ok && res.text.length > 200) {
        impressumText = res.text;
      } else {
        // Too little text back — the page probably renders client-side, so it
        // is worth one browser navigation.
        const inav = await safeGoto(page, impUrl, gate, robots);
        if (inav.ok) {
          impressumText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
          await page.screenshot({ path: path.join(dir, 'impressum.png'), fullPage: false }).catch(() => {});
        } else {
          record.notes.push(`Impressum found but not readable (${res.reason || inav.reason})`);
        }
      }
    }

    // --- check 2 detail: does the statement page actually exist? ----------
    if (a11yLink) {
      const ares = await fetchText(a11yLink.url, gate, robots);
      record.a11yStatementReachable = ares.ok;
      if (ares.ok) {
        const t = ares.text;
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
    // Impressum first. Most foreign shops do not have one — that is the finding
    // — but Ornella still needs the legal entity to search LUCID, so fall back
    // to Terms, Legal, About or the privacy page before giving up.
    let identity = extractIdentity(impressumText || '', brand);
    record.identitySource = identity.legalEntity ? 'impressum' : null;

    if (!identity.legalEntity) {
      // Shopify disallows /policies/ in robots.txt, and those pages match the
      // fallback pattern. Counting them against the budget meant a German
      // storefront with a perfectly good Datenschutz page yielded nothing.
      // Only successful fetches count.
      const candidates = matchLinks(links, P.IDENTITY_FALLBACK, 10)
        .filter((l) => l.url !== nav.finalUrl);
      let visited = 0;
      const tried = [];
      for (const cand of candidates) {
        if (visited >= cfg.maxIdentityPages) break;
        const res = await fetchText(cand.url, gate, robots);
        if (!res.ok) { tried.push(`${new URL(cand.url).pathname} (${res.reason})`); continue; }
        visited++;
        const found = extractIdentity(res.text, brand);
        tried.push(`${new URL(cand.url).pathname} (${found.legalEntity ? 'hit' : 'no entity'})`);
        if (found.legalEntity) {
          identity = found;
          record.identitySource = `fallback:${new URL(cand.url).pathname}`;
          break;
        }
      }
      record.identityPagesTried = tried;
    }
    if (!identity.legalEntity) {
      const found = extractIdentity(homeText, brand);
      if (found.legalEntity) { identity = found; record.identitySource = 'homepage'; }
    }

    Object.assign(record, identity);
    // A company name with no address behind it is a guess, and a wrong entity
    // sends her hunting the wrong company in the register.
    if (record.identitySource === 'homepage' && record.identityConfidence === 'medium') {
      record.identityConfidence = 'low';   // prose on a homepage is the weakest source
    }
    // A correct name with no address is still searchable in the register; only
    // homepage guesses are withheld.
    record.readyForLucidLookup = ['high', 'medium'].includes(record.identityConfidence);
    if (!record.legalEntity) {
      record.notes.push('no legal entity found on Impressum, Terms, Legal, About or the homepage — Ornella will need a manual lookup');
    }

    record.prospectScore = scoreProspect(record);
    record.status = 'ok';
    record.durationMs = Date.now() - started;
    save();
    say(`OK    axe=${record.axeTotal} crit=${record.axeCritical} a11y=${yn(record.hasA11yStatement)} imp=${yn(record.hasImpressum)} rp=${yn(record.hasResponsiblePerson)} entity=${record.legalEntity ? '✓' : '✗'} (${Math.round(record.durationMs / 1000)}s)`);
    return record;
  } catch (e) {
    record.status = 'error';
    record.error = String(e && e.message ? e.message : e).split('\n')[0].slice(0, 300);
    record.durationMs = Date.now() - started;
    save();
    say(`ERROR ${record.error}`);
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

/** Two-part public suffixes we actually meet, so brand.co.uk != other.co.uk. */
const MULTI_SUFFIX = new Set([
  'co.uk', 'org.uk', 'me.uk', 'com.au', 'co.nz', 'co.jp', 'com.br', 'com.tr',
  'co.za', 'com.mx', 'com.es', 'com.pl', 'com.pt',
]);

function registrable(host) {
  const parts = host.toLowerCase().split('.');
  if (parts.length < 3) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_SUFFIX.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/**
 * A redirect to another registrable domain means we are looking at a different
 * company. Raw IPs are excluded: they carry no company identity either way, and
 * the fixture suite serves from 127.0.0.1.
 */
function isDifferentCompany(requested, final) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(final) || final.includes(':')) return false;
  return registrable(final) !== registrable(requested);
}

/**
 * How worth a phone call is this shop?
 *
 * Two halves, and they multiply rather than add. "Need" is how much they have
 * got wrong; "reach" is whether German law touches them at all. An addition
 * ranked a wrecked shop with no German presence above a tidy German one, which
 * is backwards: the first is not a customer at any price.
 */
function scoreProspect(r) {
  let need = 0;
  need += Math.min(35, Math.round((r.axeCritical || 0) / 3));
  if (r.hasA11yStatement === false) need += 20;
  if (r.hasResponsiblePerson === false) need += 15;
  if (r.hasImpressum === true) need += 10;   // already knows German law applies
  if (r.readyForLucidLookup) need += 5;      // Ornella can act on it today

  const g = (r.germanMarket || {}).confidence;
  const reach = g === 'high' ? 1 : g === 'medium' ? 0.55 : 0.1;

  let score = Math.min(100, Math.round(need * 1.15)) * reach;
  // An unreliable scan is a floor, not a finding; do not rank hard on it.
  if (r.axeReliable === false) score *= 0.7;
  return Math.max(0, Math.min(100, Math.round(score)));
}

const yn = (v) => (v === true ? 'Y' : v === false ? 'N' : '?');

module.exports = { scanDomain, scoreProspect, SCHEMA_VERSION };
