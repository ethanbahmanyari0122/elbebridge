/**
 * Accessibility audit of the built site. Run `npm run build` first, then this.
 * It borrows Playwright and axe from ../scanner/node_modules — the same engine
 * and the same rule set we run for clients, pointed at ourselves.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * Resolve from this package first, then from the scanner's node_modules.
 *
 * The website lives in a public repository so GitHub Pages can serve it; the
 * scanner and the report generator live in a private one. This file has to work
 * in both layouts — beside the scanner, or entirely on its own.
 */
function requireEither(name) {
  try { return require(name); } catch { /* not installed here */ }
  const sibling = path.resolve(__dirname, '../scanner/node_modules', name);
  if (fs.existsSync(sibling)) return require(sibling);
  console.error(`\nCannot find ${name}. Run "npm install" in this folder.\n`);
  process.exit(1);
}

const { chromium } = requireEither('playwright');
const AxeBuilder = requireEither('@axe-core/playwright').default;

const DIST = path.join(__dirname, 'dist');
const PORT = Number(process.env.AUDIT_PORT || 39300);
const BASE = `http://127.0.0.1:${PORT}`;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'EN-301-549'];

const PAGES = [
  '/', '/impressum/', '/privacy/', '/accessibility/',
  '/de/', '/de/impressum/', '/de/datenschutz/', '/de/barrierefreiheit/',
];

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  → ' + d : ''))); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

function serve() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(DIST, p);
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(fs.readFileSync(f));
    });
    s.listen(PORT, '127.0.0.1', () => resolve(s));
  });
}

(async () => {
  if (!fs.existsSync(DIST)) { console.error('No dist/ — run `npm run build` first.'); process.exit(1); }
  const server = await serve();
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  console.log('\n1. axe — WCAG 2.2 AA + EN 301 549, every page, both languages');
  for (const p of PAGES) {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + p, { waitUntil: 'networkidle' });
    const r = await new AxeBuilder({ page: pg }).withTags(TAGS).analyze();
    ok(`${p} — 0 violations`, r.violations.length === 0,
       r.violations.map((x) => `${x.id}(${x.nodes.length})`).join(', '));
    await ctx.close();
  }

  console.log('\n2. Reflow — 320px wide at 200% text, no horizontal scrolling (WCAG 1.4.10)');
  for (const p of PAGES) {
    const ctx = await b.newContext({ viewport: { width: 320, height: 640 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + p, { waitUntil: 'networkidle' });
    await pg.addStyleTag({ content: 'html{font-size:200% !important}' });
    await pg.waitForTimeout(150);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(`${p} — no horizontal scroll`, over <= 1, `overflows by ${over}px`);
    await ctx.close();
  }

  console.log('\n3. Language and pairing — WCAG 3.1.1 / 3.1.2, plus hreflang');
  for (const p of PAGES) {
    const ctx = await b.newContext();
    const pg = await ctx.newPage();
    await pg.goto(BASE + p, { waitUntil: 'domcontentloaded' });
    const info = await pg.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.title,
      h1: document.querySelectorAll('h1').length,
      main: document.querySelectorAll('main').length,
      alts: [...document.querySelectorAll('link[rel=alternate]')].map((l) => l.getAttribute('hreflang')),
      canonical: !!document.querySelector('link[rel=canonical]'),
      order: [...document.querySelectorAll('h1,h2,h3')].map((h) => +h.tagName[1]),
      viewportOk: !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(
        (document.querySelector('meta[name=viewport]') || {}).content || ''),
    }));
    let jump = false, prev = 0;
    for (const l of info.order) { if (prev && l > prev + 1) jump = true; prev = l; }
    ok(`${p} — lang, one h1, one main, unique title, canonical`,
       !!info.lang && info.h1 === 1 && info.main === 1 && info.title.length > 10 && info.canonical,
       JSON.stringify(info));
    ok(`${p} — heading levels never skip`, !jump, info.order.join('>'));
    ok(`${p} — hreflang en + de + x-default`,
       ['en', 'de', 'x-default'].every((x) => info.alts.includes(x)), info.alts.join(','));
    ok(`${p} — zoom not disabled`, info.viewportOk);
    await ctx.close();
  }

  console.log('\n4. Keyboard — reachable, visibly focused, skip link first');
  for (const p of ['/', '/de/']) {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + p, { waitUntil: 'networkidle' });
    const seen = []; const keys = new Set();
    for (let i = 0; i < 60; i++) {
      await pg.keyboard.press('Tab');
      const info = await pg.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(), id: el.id || null,
          href: el.getAttribute ? (el.getAttribute('href') || '') : '',
          // Unique DOM path — two links with the same label and href are
          // still two different stops in the tab order.
          key: (() => { const parts = []; let n = el;
            while (n && n !== document.body) {
              parts.unshift(n.tagName + ':' + [...(n.parentNode ? n.parentNode.children : [])].indexOf(n));
              n = n.parentElement; }
            return parts.join('/'); })(),
          text: (el.textContent || el.value || '').trim().slice(0, 32),
          outline: s.outlineStyle + ' ' + s.outlineWidth,
        };
      });
      if (!info) continue;
      if (keys.has(info.key)) break;
      keys.add(info.key); seen.push(info);
    }
    ok(`${p} — skip link is first`, seen[0] && /skip|inhalt/i.test(seen[0].text), JSON.stringify(seen[0]));
    // No form any more: the things that must be reachable are the two calls to
    // action, the language switch and every legal link.
    const hrefs = seen.map((s) => s.href || '');
    ok(`${p} — both calls to action reachable`,
       hrefs.filter((h) => h.endsWith('#check')).length >= 1 && hrefs.some((h) => h.startsWith('mailto:')),
       hrefs.filter(Boolean).slice(0, 8).join(' '));
    ok(`${p} — language switch reachable`,
       hrefs.some((h) => /^\/(de\/)?$/.test(h)), hrefs.filter(Boolean).join(' ').slice(0, 120));
    ok(`${p} — all three legal pages reachable by keyboard`,
       ['impressum', 'privacy|datenschutz', 'accessibility|barrierefreiheit']
         .every((rx) => hrefs.some((h) => new RegExp(rx).test(h))),
       hrefs.filter((h) => h.startsWith('/')).join(' '));
    ok(`${p} — every focused element shows an outline`,
       seen.every((s) => !/none/.test(s.outline)),
       seen.filter((s) => /none/.test(s.outline)).map((s) => s.tag).join(','));
    await ctx.close();
  }

  console.log('\n5. Ships no JavaScript, and works with it disabled');
  {
    const jsFiles = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.js')) jsFiles.push(full);
      }
    })(DIST);
    ok('no JavaScript files in the build', jsFiles.length === 0, jsFiles.join(', '));

    for (const p of ['/', '/de/']) {
      const html = fs.readFileSync(path.join(DIST, p, 'index.html'), 'utf8');
      ok(`${p} — no <script> tag at all`, !/<script/i.test(html));
    }

    for (const p of ['/', '/de/']) {
      const ctx = await b.newContext({ javaScriptEnabled: false });
      const pg = await ctx.newPage();
      await pg.goto(BASE + p, { waitUntil: 'domcontentloaded' });
      const len = await pg.evaluate(() => document.body.innerText.length);
      ok(`${p} — full content renders with JS disabled`, len > 1500, `${len} chars`);
      await ctx.close();
    }
  }

  console.log('\n6. The enquiry route actually works');
  for (const [p, subject] of [['/', 'Compliance check request'], ['/de/', 'Anfrage Compliance-Prüfung']]) {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + p, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(() => {
      const a = document.querySelector('.contact-card a.btn');
      return a ? { href: a.getAttribute('href'), text: a.textContent.trim() } : null;
    });
    ok(`${p} — contact button exists and is a mailto`, r && r.href.startsWith('mailto:hallo@elbebridge.com'), JSON.stringify(r && r.href.slice(0, 60)));
    ok(`${p} — subject is prefilled in the page language`,
       r && decodeURIComponent(r.href).includes(subject), decodeURIComponent((r && r.href) || '').slice(0, 120));
    // Ornella's point: half the list are brands, not shops, so we ask for a
    // website rather than a store URL.
    ok(`${p} — body asks for their website`,
       r && /Website:/.test(decodeURIComponent(r.href)), decodeURIComponent((r && r.href) || '').slice(0, 90));
    ok(`${p} — button has a visible text label`, r && r.text.length > 5, r && r.text);
    await ctx.close();
  }

  console.log('\n7. Each hero checkpoint lands on its own card');
  for (const url of ['/', '/de/']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + url, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(() => {
      const links = [...document.querySelectorAll('.checkpoints a')].map((a) => a.getAttribute('href'));
      const targets = links.map((h) => {
        const id = (h || '').split('#')[1];
        return id ? Boolean(document.getElementById(id)) : false;
      });
      return { links, targets, unique: new Set(links).size };
    });
    ok(`${url} — three checkpoints, three different targets`, r.unique === 3, r.links.join(' '));
    ok(`${url} — every checkpoint target exists on the page`, r.targets.every(Boolean), JSON.stringify(r.links));
    ok(`${url} — targets are the individual cards, not the section`,
       r.links.every((h) => /#obligation-(bfsg|gpsr|lucid)$/.test(h || '')), r.links.join(' '));
    await ctx.close();
  }

  console.log('\n8. Hero artwork and the linked list never both show');
  for (const [url, width, wantArt] of [['/', 1280, true], ['/', 390, false],
                                       ['/de/', 1280, true], ['/de/', 390, false]]) {
    const ctx = await b.newContext({ viewport: { width, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + url, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(() => {
      const art = document.querySelector('.hero-art');
      const list = document.querySelector('.journey');
      return {
        art: art ? getComputedStyle(art).display !== 'none' : false,
        list: list ? getComputedStyle(list).display !== 'none' : false,
      };
    });
    ok(`${url} at ${width}px — exactly one hero rendering visible`,
       r.art !== r.list, JSON.stringify(r));
    ok(`${url} at ${width}px — ${wantArt ? 'artwork' : 'linked list'} is the one showing`,
       r.art === wantArt, JSON.stringify(r));
    await ctx.close();
  }

  console.log('\n9. The comparison table stacks properly on a phone');
  for (const url of ['/', '/de/']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    await pg.goto(BASE + url, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(() => {
      const th = document.querySelector('.compare tbody th');
      if (!th) return null;
      const row = th.closest('tr');
      return { th: th.getBoundingClientRect().width, row: row.getBoundingClientRect().width,
        text: th.textContent.trim() };
    });
    // A row header squeezed into a narrow column hyphenates every word.
    ok(`${url} — comparison row headers use the full width`,
       r && r.th / r.row > 0.8, r ? `${Math.round(r.th)}px of ${Math.round(r.row)}px` : 'not found');
    await ctx.close();
  }

  console.log('\n10. Nothing spills out of its column, 360–1440px, both languages');
  {
    let spills = 0;
    for (const w of [1440, 1280, 1100, 900, 700, 480, 360]) {
      for (const url of ['/', '/de/']) {
        const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
        const pg = await ctx.newPage();
        await pg.goto(BASE + url, { waitUntil: 'networkidle' });
        await pg.waitForTimeout(150);
        const out = await pg.evaluate(() => {
          const bad = [];
          document.querySelectorAll('.footer-grid > *, .footer-bar > *, .hero-grid > *, .split > *').forEach((col) => {
            const cb = col.getBoundingClientRect();
            col.querySelectorAll('*').forEach((el) => {
              const r = el.getBoundingClientRect();
              if (r.width > 0 && (r.right > cb.right + 1 || r.left < cb.left - 1)) {
                bad.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0]);
              }
            });
          });
          return bad.slice(0, 4);
        });
        if (out.length) { spills++; console.log(`      ${w}px ${url} → ${out.join(', ')}`); }
        await ctx.close();
      }
    }
    ok('no element overflows its column at any width', spills === 0, `${spills} combinations`);
  }

  console.log('\n11. Palette contrast (scripts/contrast.cjs)');
  {
    const { execFileSync } = require('child_process');
    let out = '';
    let clean = true;
    try { out = execFileSync('node', [path.join(__dirname, 'scripts/contrast.cjs')], { encoding: 'utf8' }); }
    catch (e) { out = String(e.stdout || e.message); clean = false; }
    ok('every colour pair in the palette meets WCAG AA',
       clean && /All text pairs meet WCAG AA/.test(out),
       out.split('\n').filter((l) => l.startsWith('✗')).join(' | '));
  }

  console.log('\n12. Cross-page links work from the legal pages too');
  for (const p of ['/impressum/', '/de/impressum/']) {
    const ctx = await b.newContext();
    const pg = await ctx.newPage();
    await pg.goto(BASE + p, { waitUntil: 'domcontentloaded' });
    const bad = await pg.evaluate(() =>
      [...document.querySelectorAll('header a, footer a')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && h.startsWith('#') && h !== '#main'));
    ok(`${p} — no dead in-page anchors in header or footer`, bad.length === 0, bad.join(' '));

    const home = await pg.evaluate(() =>
      [...document.querySelectorAll('header a, footer a')].map((a) => a.getAttribute('href')));
    ok(`${p} — section links point back at the home page`,
       home.some((h) => /^\/(de\/)?#what-we-do$/.test(h || '')), home.filter((h) => (h || '').includes('#')).join(' '));
    await ctx.close();
  }

  console.log('\n13. Content is data, not markup');
  {
    const src = fs.readFileSync(path.join(__dirname, 'src/components/Home.astro'), 'utf8');
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/content/copy/en.json'), 'utf8'));
    ok('headline appears in the content file, not in a component',
       en.home.headline.includes('Three obligations') && !src.includes('Three obligations'));
    ok('price lives in the content file', en.home.priceAmount === '€890' && !src.includes('890'));
    // Ornella asked for the checkpoints to lead to their explanation — and each
    // one to its own card, not the top of the section.
    const hero = fs.readFileSync(path.join(__dirname, 'src/components/HeroVisual.astro'), 'utf8');
    ok('hero checkpoints link to individual obligation cards',
       /journey/.test(hero) && hero.includes('#obligation-${code.toLowerCase()}'));
    // Both locales now ship artwork with their own labels baked in; a missing
    // file would silently fall back to the list and nobody would notice.
    for (const loc of ['en', 'de']) {
      const c = JSON.parse(fs.readFileSync(path.join(__dirname, `src/content/copy/${loc}.json`), 'utf8'));
      const img = c.home.heroImage;
      ok(`${loc} — hero artwork declared and present on disk`,
         Boolean(img) && fs.existsSync(path.join(__dirname, 'public', img.src.replace(/^\//, ''))),
         JSON.stringify(img));
    }

    ok('the AI comparison lives in content, not markup',
       Array.isArray(en.home.comparison.rows) && en.home.comparison.rows.length >= 4
       && !src.includes('Why not just ask an AI'));
    ok('the price is credited against remediation',
       en.home.priceLines.some((l) => /credited in full/i.test(l)), JSON.stringify(en.home.priceLines));
    // Promising two days in one place and one in another is just a bug.
    for (const loc of ['en', 'de']) {
      const c = JSON.parse(fs.readFileSync(path.join(__dirname, `src/content/copy/${loc}.json`), 'utf8'));
      const blob = JSON.stringify(c);
      const twos = /two working days|2 working days|zwei Werktagen|2 Werktage/i.test(blob);
      ok(`${loc} — response time promised consistently as one day`, !twos,
        (c.home.trust || []).join(' / '));
    }
    ok('marketing copy avoids stating the law at people',
       !/German law applies to you/i.test(JSON.stringify(en)), 'lede');

    ok('the accent word is content, not markup',
       /==[^=]+==/.test(en.home.headline) && !src.includes('missing'));
    ok('icons are chosen in content, not hard-coded',
       en.home.obligations.every((o) => !!o.icon) && !src.includes('accessibility"'));
    const foot = fs.readFileSync(path.join(__dirname, 'src/components/SiteFooter.astro'), 'utf8');
    ok('footer columns come from content, not markup',
       en.footer.columns.length > 0 && !foot.includes('What we offer'));
    ok('header tagline comes from content',
       !!en.site.tagline && !fs.readFileSync(path.join(__dirname, 'src/components/SiteHeader.astro'), 'utf8').includes('Confidence'));

    // Nothing unfinished may reach production.
    for (const loc of ['en', 'de']) {
      const raw = fs.readFileSync(path.join(__dirname, `src/content/copy/${loc}.json`), 'utf8');
      const marks = raw.split('\n').filter((l) => l.includes('[['));
      ok(`${loc}.json contains no [[PLACEHOLDERS]]`, marks.length === 0, marks.slice(0, 3).join(' | '));
    }
    for (const f of ['index.html', 'impressum/index.html', 'privacy/index.html', 'accessibility/index.html',
                     'de/index.html', 'de/impressum/index.html', 'de/datenschutz/index.html', 'de/barrierefreiheit/index.html']) {
      const html = fs.readFileSync(path.join(DIST, f), 'utf8');
      ok(`${f} — no placeholder text shipped`, !html.includes('[['));
      // An href scheme the inline formatter does not allow is left as literal
      // markdown rather than throwing. Catch that here.
      const raw = html.match(/\[[^\]]+\]\([^)]+\)/g);
      ok(`${f} — no unrendered markdown link syntax`, !raw, (raw || []).slice(0, 2).join(' | '));
      // "/undefined/#obligations" reached production because a page forgot to
      // pass `locale` down. Any attribute containing "undefined" is a bug.
      const undef = html.match(/(?:href|src)="[^"]*undefined[^"]*"/g);
      ok(`${f} — no "undefined" in any link or source`, !undef, (undef || []).slice(0, 2).join(' | '));
    }

    // The legal pages carry facts; assert the ones that must be right.
    const imp = en.legal.find((x) => x.key === 'impressum');
    const impText = JSON.stringify(imp);
    ok('Impressum carries the address', impText.includes('Stormarner Straße 41') && impText.includes('22049 Hamburg'));
    ok('Impressum carries a phone number', /\+49\s?151\s?20277581/.test(impText));
    ok('Impressum names both representatives',
       impText.includes('Ethan Bahmanyari') && impText.includes('Ornella Buxbaum'));
    ok('Impressum has no register section (a GbR has no HRB entry)',
       !imp.sections.some((x) => /Registereintrag/.test(x.heading)));
    const priv = en.legal.find((x) => x.key === 'privacy');
    ok('privacy policy names the real host and does not claim EU-only',
       JSON.stringify(priv).includes('GitHub') && !JSON.stringify(priv).includes('stays inside the EU'));
    ok('every footer link points somewhere real',
       en.footer.columns.every((c) => c.links.every((l) => /^(\/|https:|mailto:)/.test(l.href))));
    // A bare "#section" only works on the page that has that section. From
    // /impressum/ it does nothing at all.
    for (const loc of ['en', 'de']) {
      const c = JSON.parse(fs.readFileSync(path.join(__dirname, `src/content/copy/${loc}.json`), 'utf8'));
      const bare = [...c.nav.primary, c.nav.cta, ...c.footer.columns.flatMap((x) => x.links)]
        .filter((l) => l.href.startsWith('#'));
      ok(`${loc} — no nav or footer link is a bare fragment`, bare.length === 0, JSON.stringify(bare));
    }
    ok('both locales expose the same legal page keys',
       JSON.stringify(en.legal.map((p) => p.key).sort()) ===
       JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, 'src/content/copy/de.json'), 'utf8')).legal.map((p) => p.key).sort()));
  }

  await b.close();
  server.close();
  console.log('\n─────────────────────────────');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
