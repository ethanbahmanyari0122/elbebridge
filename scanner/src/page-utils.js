'use strict';
const cfg = require('./config');

/**
 * Cookie walls are the single biggest source of garbage axe results: a modal
 * overlay makes every element behind it "hidden", so a broken site scores clean.
 * We dismiss the banner, then scan. We only ever click consent buttons.
 */
const CONSENT_TEXT = /^(alle[sn]? (akzeptieren|zustimmen|annehmen)|akzeptieren|zustimmen|einverstanden|verstanden|ich stimme zu|accept all|accept cookies|accept|allow all|agree|got it|ok)$/i;

async function dismissCookieWall(page) {
  const attempts = [];
  // 1. Common CMP-specific selectors (fast path, no text matching needed)
  const selectors = [
    '#onetrust-accept-btn-handler',
    'button#didomi-notice-agree-button',
    '.cc-allow', '.cookie-accept', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    'button[data-testid="uc-accept-all-button"]',
    '[aria-label="Accept all"]', '[aria-label="Alle akzeptieren"]',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 2000 });
        attempts.push(sel);
        await page.waitForTimeout(600);
        return { dismissed: true, via: sel };
      }
    } catch { /* keep going */ }
  }
  // 2. Text match across buttons and links, including inside iframes
  const frames = [page, ...page.frames().filter((f) => f !== page.mainFrame())];
  for (const frame of frames) {
    try {
      const buttons = await frame.locator('button, a[role="button"], input[type="submit"]').all();
      for (const b of buttons.slice(0, 60)) {
        let label = '';
        try { label = ((await b.innerText({ timeout: 300 })) || '').trim(); } catch { continue; }
        if (!label) { try { label = (await b.getAttribute('value')) || ''; } catch { /* noop */ } }
        if (CONSENT_TEXT.test(label.replace(/\s+/g, ' ').trim())) {
          try {
            await b.click({ timeout: 2000 });
            await page.waitForTimeout(600);
            return { dismissed: true, via: `text:${label}` };
          } catch { /* try next */ }
        }
      }
    } catch { /* frame detached */ }
  }
  return { dismissed: false, tried: attempts.length + selectors.length };
}

/** All same-site links with their visible text, deduped. */
async function harvestLinks(page, host) {
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]')).slice(0, 800).map((a) => ({
      href: a.href,
      text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      aria: a.getAttribute('aria-label') || '',
      title: a.getAttribute('title') || '',
    })));
  const seen = new Set();
  const out = [];
  for (const l of raw) {
    let u;
    try { u = new URL(l.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const bare = u.hostname.replace(/^www\./, '');
    if (bare !== host && !bare.endsWith('.' + host)) continue;
    const key = u.origin + u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: key, text: l.text, label: [l.text, l.aria, l.title].join(' ').trim(), path: u.pathname });
  }
  return out;
}

function matchLink(links, rx) {
  return links.find((l) => rx.test(l.label) || rx.test(decodeURIComponent(l.path))) || null;
}

/** Best guess at a product/category page, for the second axe pass. */
function pickProductPage(links, homeUrl) {
  const { PRODUCTISH } = require('./checks/patterns');
  const cand = links.filter((l) => l.url !== homeUrl && PRODUCTISH.test(l.path));
  if (cand.length) {
    // prefer deeper URLs — more likely a PDP than a category listing
    cand.sort((a, b) => b.path.split('/').length - a.path.split('/').length);
    return cand[0].url;
  }
  const fallback = links.find((l) => l.url !== homeUrl && l.path.split('/').filter(Boolean).length >= 2);
  return fallback ? fallback.url : null;
}

async function safeGoto(page, url, gate, robots) {
  const u = new URL(url);
  if (robots && !robots.allowed(u.pathname)) return { ok: false, reason: 'robots-disallow' };
  await gate();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.navTimeout });
    const status = res ? res.status() : 0;
    if (status >= 400) return { ok: false, reason: `http-${status}`, status };
    try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch { /* fine */ }
    return { ok: true, status, finalUrl: page.url() };
  } catch (e) {
    return { ok: false, reason: 'nav-error', error: String(e.message || e).split('\n')[0].slice(0, 200) };
  }
}

module.exports = { dismissCookieWall, harvestLinks, matchLink, pickProductPage, safeGoto };
