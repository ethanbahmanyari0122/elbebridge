'use strict';
const cfg = require('./config');

/**
 * Cookie walls are the single biggest source of garbage axe results: a modal
 * overlay makes every element behind it "hidden", so a broken site scores clean.
 * We dismiss the banner, then scan. We only ever click consent buttons.
 */
/**
 * Real consent buttons say "Accept All Cookies", "Alle Cookies akzeptieren",
 * "OK, got it". The first version of this matched the whole label exactly, so
 * it hit none of them — 0 of 3 real sites dismissed on the first live run.
 * Match on containment instead, against a curated list.
 */
const CONSENT_WORDS = [
  // English
  'accept all', 'accept cookies', 'allow all', 'allow cookies', 'i accept',
  'agree and continue', 'i agree', 'got it', 'ok, got it', 'accept',
  // German
  'alle akzeptieren', 'alle cookies akzeptieren', 'allen zustimmen',
  'alle annehmen', 'akzeptieren', 'zustimmen', 'einverstanden',
  'ich stimme zu', 'verstanden', 'auswahl bestätigen',
];

/** Never click these, even if they contain a word above. */
const CONSENT_AVOID = [
  'settings', 'einstellungen', 'preferences', 'präferenzen', 'manage',
  'verwalten', 'anpassen', 'customize', 'reject', 'ablehnen', 'decline',
  'only necessary', 'nur notwendige', 'nur erforderliche', 'necessary only',
  'more info', 'mehr erfahren', 'details', 'privacy policy', 'datenschutz',
];

function looksLikeConsent(label) {
  const t = label.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t || t.length > 40) return false;
  if (CONSENT_AVOID.some((w) => t.includes(w))) return false;
  return CONSENT_WORDS.some((w) => t.includes(w));
}

/**
 * After consent, a marketing modal is often still in the way — Klaviyo, a
 * newsletter sign-up, a country selector. Closing one is harmless: we only ever
 * press a close control, never a subscribe or submit button.
 */
const CLOSE_LABELS = [
  'close', 'close dialog', 'close modal', 'dismiss', 'no thanks', 'no, thanks',
  'not now', 'maybe later', 'schließen', 'schliessen', 'nein danke',
  'sluiten', 'fermer', 'cerrar', 'chiudi', '×', '✕', '✖', 'x',
];
const CLOSE_SELECTORS = [
  'button[aria-label*="close" i]', 'button[aria-label*="schließen" i]',
  'button[aria-label*="dismiss" i]', '[role="dialog"] button[aria-label*="close" i]',
  'button[title*="close" i]', '.klaviyo-close-form', 'button.needsclick[aria-label*="Close" i]',
  'dialog[open] button[aria-label*="close" i]',
];

async function closeBlockingModal(page) {
  for (const sel of CLOSE_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 200 })) {
        await el.click({ timeout: 2000 });
        await page.waitForTimeout(500);
        return sel;
      }
    } catch { /* next */ }
  }
  try {
    const buttons = await page.locator('button, [role="button"]').all();
    for (const b of buttons.slice(0, 80)) {
      let label = '';
      try {
        label = ((await b.innerText({ timeout: 150 })) || '').trim()
          || (await b.getAttribute('aria-label')) || '';
      } catch { continue; }
      const t = label.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!t || t.length > 20) continue;
      if (!CLOSE_LABELS.includes(t)) continue;
      try { await b.click({ timeout: 2000 }); await page.waitForTimeout(500); return `text:${t}`; }
      catch { /* next */ }
    }
  } catch { /* no frame */ }
  // Last resort: many dialogs close on Escape.
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(400); } catch { /* noop */ }
  return null;
}

const CMP_SELECTORS = [
  '#onetrust-accept-btn-handler',
  'button#didomi-notice-agree-button',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  'button[data-testid="uc-accept-all-button"]',
  '#usercentrics-root >>> button[data-testid="uc-accept-all-button"]',
  'button[mode="primary"][data-testid="uc-accept-all-button"]',
  '.cc-allow', '.cookie-accept', '#cookiescript_accept',
  'button[aria-label="Accept all"]', 'button[aria-label="Alle akzeptieren"]',
  '[data-cookieconsent="accept"]', '#truste-consent-button',
  'button.osano-cm-accept-all', '#hs-eu-confirmation-button',
  'button[data-role="all"]',                       // Klaro
  '#shopify-pc__banner__btn-accept',               // Shopify native
];

/**
 * Is something still covering the page? Even when we cannot dismiss a banner we
 * need to KNOW, because axe reports nothing behind an overlay and a broken shop
 * would come back clean.
 */
async function detectBlockingOverlay(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight, area = vw * vh;
    let worst = null;
    for (const el of Array.from(document.body.querySelectorAll('*')).slice(0, 4000)) {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      // Tailwind's `fixed inset-0 pointer-events-none` overlays cover the whole
      // viewport and block nothing at all; counting them made a dozen clean
      // scans look inconclusive.
      if (s.pointerEvents === 'none') continue;
      const op = parseFloat(s.opacity);
      if (!(op > 0.05)) continue;
      const z = parseInt(s.zIndex, 10);
      if (!(z >= 100)) continue;
      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w <= 0 || h <= 0) continue;
      const cov = (w * h) / area;
      if (cov > 0.2 && (!worst || cov > worst.coverage)) {
        worst = {
          coverage: Math.round(cov * 100) / 100,
          zIndex: z,
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: (el.className || '').toString().slice(0, 60) || null,
        };
      }
    }
    return worst;
  }).catch(() => null);
}

/**
 * Cookie walls are the single biggest source of garbage axe results: a modal
 * overlay makes every element behind it "hidden", so a broken site scores clean.
 * We dismiss the banner, then scan. We only ever click consent buttons.
 */
async function dismissCookieWall(page) {
  const attempts = [];

  // Banners frequently mount after networkidle. Give them a moment to appear.
  for (let i = 0; i < 6; i++) {
    const seen = await page.evaluate(() =>
      Boolean(document.querySelector('[id*="onetrust" i], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="usercentrics" i], [id*="didomi" i]')))
      .catch(() => false);
    if (seen) break;
    await page.waitForTimeout(400);
  }

  const finish = async (via) => {
    // Cookiebot's underlay fades out over ~1s; checking at 700ms reported a
    // dozen successful dismissals as "still blocking".
    await page.waitForTimeout(1400);
    let overlay = await detectBlockingOverlay(page);
    let closedModal = null;
    if (overlay) {
      closedModal = await closeBlockingModal(page);
      overlay = await detectBlockingOverlay(page);
    }
    return { dismissed: true, via, closedModal, stillBlocking: Boolean(overlay), overlay };
  };

  // 1. Known consent-management platforms — fastest and least ambiguous.
  for (const sel of CMP_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 250 })) {
        await el.click({ timeout: 2500 });
        attempts.push(sel);
        return await finish(sel);
      }
    } catch { /* next */ }
  }

  // 2. Text match across the main frame and any iframes, including shadow DOM
  //    (Playwright's CSS engine pierces open shadow roots).
  const frames = [page, ...page.frames().filter((f) => f !== page.mainFrame())];
  for (const frame of frames) {
    let controls;
    try {
      controls = await frame.locator('button, [role="button"], a[role="button"], input[type="button"], input[type="submit"]').all();
    } catch { continue; }
    for (const b of controls.slice(0, 120)) {
      let label = '';
      try {
        label = ((await b.innerText({ timeout: 200 })) || '').trim();
        if (!label) label = (await b.getAttribute('value')) || (await b.getAttribute('aria-label')) || '';
      } catch { continue; }
      if (!looksLikeConsent(label)) continue;
      try {
        await b.click({ timeout: 2500 });
        return await finish(`text:${label.replace(/\s+/g, ' ').trim().slice(0, 40)}`);
      } catch { /* try next */ }
    }
  }

  // No consent button found. There may still be a plain modal we can close.
  let overlay = await detectBlockingOverlay(page);
  let closedModal = null;
  if (overlay) {
    closedModal = await closeBlockingModal(page);
    overlay = await detectBlockingOverlay(page);
  }
  return {
    dismissed: false, closedModal,
    tried: attempts.length + CMP_SELECTORS.length,
    stillBlocking: Boolean(overlay), overlay,
  };
}

/**
 * Does this shop face the German market at all?
 *
 * The scan already sees the answer and was throwing it away: ten of the first
 * forty-five redirected to a /de storefront, which is proof rather than a
 * guess. Without this, a list is just domains; with it, it ranks itself.
 */
async function detectGermanMarket(page, links, homeText, finalUrl) {
  const dom = await page.evaluate(() => ({
    hreflangDe: Boolean(document.querySelector('link[rel="alternate"][hreflang^="de" i]')),
    htmlLangDe: /^de/i.test(document.documentElement.lang || ''),
  })).catch(() => ({ hreflangDe: false, htmlLangDe: false }));

  let localePath = false;
  try { localePath = /^\/de(-[a-z]{2})?(\/|$)/i.test(new URL(finalUrl).pathname); } catch { /* noop */ }

  const deLink = links.some((l) => /^\/de(-[a-z]{2})?(\/|$)/i.test(l.path));
  const text = String(homeText || '');
  const mentionsGermany = /\bDeutschland\b|\bGermany\b/i.test(text);
  const germanWords = /\b(Versand|Warenkorb|Kasse|Anmelden|Damen|Herren|Kostenloser|Lieferung|Zahlungsarten)\b/.test(text);
  const euro = /€|\bEUR\b/.test(text);

  // High: the shop itself is served in German. Medium: it offers a German
  // route or talks about Germany. Low: no sign, and probably not a prospect.
  const confidence = (localePath || dom.htmlLangDe || germanWords) ? 'high'
    : (dom.hreflangDe || deLink || mentionsGermany) ? 'medium'
      : 'low';

  return { confidence, localePath, hreflangDe: dom.hreflangDe, htmlLangDe: dom.htmlLangDe,
    deLink, mentionsGermany, germanWords, euro };
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

/** Every same-site link matching a pattern, best-first, deduped by path. */
function matchLinks(links, rx, limit = 3) {
  const out = [];
  for (const l of links) {
    if (!(rx.test(l.label) || rx.test(decodeURIComponent(l.path)))) continue;
    if (out.some((x) => x.url === l.url)) continue;
    out.push(l);
    if (out.length >= limit) break;
  }
  return out;
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

/**
 * Fetch a page as plain HTML and reduce it to text.
 *
 * Impressum, Terms and About pages are server-rendered in practice, and we only
 * ever read words off them. Driving a browser to do that cost a full navigation
 * plus up to six seconds of networkidle each — eleven of those took one shop to
 * 77 seconds and pushed another past its budget with nothing to show.
 * Same politeness rules: robots honoured, rate-limited, identifiable UA.
 */
async function fetchText(url, gate, robots, timeoutMs = 15000) {
  const u = new URL(url);
  if (robots && !robots.allowed(u.pathname)) return { ok: false, reason: 'robots-disallow' };
  await gate();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': cfg.userAgent, 'accept-language': 'de-DE,de;q=0.9,en;q=0.8' },
    });
    if (!res.ok) return { ok: false, reason: `http-${res.status}`, status: res.status };
    const ct = res.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return { ok: false, reason: `content-type:${ct.split(';')[0]}` };
    return { ok: true, status: res.status, finalUrl: res.url, text: htmlToText(await res.text()) };
  } catch (e) {
    return { ok: false, reason: 'fetch-error', error: String(e.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

// German legal pages are full of &szlig; and &uuml;; a company name that comes
// back as "Hafenstra&szlig;e" is no use to anyone.
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  szlig: 'ß', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', oslash: 'ø', Oslash: 'Ø',
  aring: 'å', Aring: 'Å', aelig: 'æ', AElig: 'Æ', ndash: '–', mdash: '—',
  laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', middot: '·',
};

function decodeEntity(whole, body) {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X'
      ? parseInt(body.slice(2), 16)
      : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  }
  const hit = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
  return hit === undefined ? whole : hit;
}

function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|address)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, decodeEntity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function safeGoto(page, url, gate, robots, timeoutMs) {
  const u = new URL(url);
  if (robots && !robots.allowed(u.pathname)) return { ok: false, reason: 'robots-disallow' };
  await gate();
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs || cfg.navTimeout });
    const status = res ? res.status() : 0;
    if (status >= 400) return { ok: false, reason: `http-${status}`, status };
    try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch { /* fine */ }
    return { ok: true, status, finalUrl: page.url() };
  } catch (e) {
    return { ok: false, reason: 'nav-error', error: String(e.message || e).split('\n')[0].slice(0, 200) };
  }
}

module.exports = { dismissCookieWall, detectBlockingOverlay, detectGermanMarket, fetchText, htmlToText, harvestLinks, matchLink, matchLinks, pickProductPage, safeGoto };
