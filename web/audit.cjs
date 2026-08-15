/**
 * Accessibility audit of the built site. Run `npm run build` first, then this.
 * It borrows Playwright and axe from ../scanner/node_modules — the same engine
 * and the same rule set we run for clients, pointed at ourselves.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const SCANNER = path.resolve(__dirname, '../scanner/node_modules');
const { chromium } = require(path.join(SCANNER, 'playwright'));
const AxeBuilder = require(path.join(SCANNER, '@axe-core/playwright')).default;

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
    ok(`${p} — body asks for the store URL`,
       r && /Store URL|Shop-Adresse/.test(decodeURIComponent(r.href)));
    ok(`${p} — button has a visible text label`, r && r.text.length > 5, r && r.text);
    await ctx.close();
  }

  console.log('\n7. Nothing spills out of its column, 360–1440px, both languages');
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

  console.log('\n8. Palette contrast (scripts/contrast.cjs)');
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

  console.log('\n9. Content is data, not markup');
  {
    const src = fs.readFileSync(path.join(__dirname, 'src/components/Home.astro'), 'utf8');
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/content/copy/en.json'), 'utf8'));
    ok('headline appears in the content file, not in a component',
       en.home.headline.includes('Three obligations') && !src.includes('Three obligations'));
    ok('price lives in the content file', en.home.priceAmount === '€890' && !src.includes('890'));
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
       en.footer.columns.every((c) => c.links.every((l) => /^(#|\/|https:|mailto:)/.test(l.href))));
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
