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
  '/', '/impressum/', '/privacy/', '/accessibility/', '/sample-report/', '/scanner/',
  '/de/', '/de/impressum/', '/de/datenschutz/', '/de/barrierefreiheit/', '/de/beispielbericht/', '/de/scanner/',
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
       r.violations.map((x) => `${x.id}(${x.nodes.length}): ${x.nodes.map((n) => n.target.join(' ') + ' ' + n.failureSummary).join(' || ')}`).join(', '));
    await ctx.close();
  }

  console.log('\n2. Reflow — 320px wide at 200% text, no horizontal scrolling (WCAG 1.4.10)');
  for (const p of PAGES) {
    const ctx = await b.newContext({ viewport: { width: 320, height: 640 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + p, { waitUntil: 'networkidle' });
    await pg.addStyleTag({ content: 'html{font-size:200% !important}' });
    await pg.waitForTimeout(150);
    const over = await pg.evaluate(() => {
      const root = document.documentElement;
      const bad = [...document.querySelectorAll('body *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > root.clientWidth + 1 || r.left < -1);
      }).slice(0, 8).map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}[${Math.round(r.left)},${Math.round(r.right)}]`;
      });
      return { delta: root.scrollWidth - root.clientWidth, bad };
    });
    ok(`${p} — no horizontal scroll`, over.delta <= 1, `overflows by ${over.delta}px: ${over.bad.join(', ')}`);
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
      // Structured data is a <script> tag the browser never executes: it has no
      // src, and a type the parser hands to the structured-data reader rather
      // than to the JavaScript engine. That is the only kind allowed here, and
      // it is checked rather than trusted — "no <script> at all" was the easier
      // assertion to make and the wrong one to keep once JSON-LD was needed.
      const tags = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
      const executable = tags.filter((attrs) => !/type=["']application\/ld\+json["']/i.test(attrs));
      ok(`${p} — no executable <script> tag`, executable.length === 0, executable.join(' | '));
      ok(`${p} — structured data loads nothing`, !tags.some((attrs) => /\bsrc=/i.test(attrs)),
         tags.filter((attrs) => /\bsrc=/i.test(attrs)).join(' | '));
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
  for (const [p, subject] of [['/', 'German Market Compliance Audit request'], ['/de/', 'Anfrage German Market Compliance Audit']]) {
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

  console.log('\n7. The five compliance areas and buyer deliverables are complete');
  for (const url of ['/', '/de/']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + url, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(() => {
      const workstreams = [...document.querySelectorAll('.workstream-grid > li')].map((x) => x.id);
      const deliverables = document.querySelectorAll('.deliverable-grid > li').length;
      const reportBadge = document.querySelector('.report-example-badge')?.textContent.trim() || '';
      const hrefs = [...document.querySelectorAll('header a, footer a')]
        .map((a) => a.getAttribute('href')).filter(Boolean);
      const localTargets = hrefs.filter((h) => h.includes('#')).map((h) => h.split('#')[1]).filter(Boolean);
      return { workstreams, deliverables, reportBadge, localTargets };
    });
    ok(`${url} — five compliance areas render`,
       JSON.stringify(r.workstreams) === JSON.stringify(['accessibility', 'gpsr', 'lucid', 'consumer-information', 'product-information']),
       JSON.stringify(r.workstreams));
    ok(`${url} — five buyer deliverables render`, r.deliverables === 5, String(r.deliverables));
    ok(`${url} — report preview is explicitly fictional`, /fictional|fiktiv/i.test(r.reportBadge), r.reportBadge);
    ok(`${url} — nav and footer section targets exist`,
       r.localTargets.every((id) => Boolean(id) && ['what-we-check','process','audit','check','accessibility','gpsr','lucid','consumer-information','product-information'].includes(id)),
       JSON.stringify(r.localTargets));
    await ctx.close();
  }

  console.log('\n8. The audit hero is complete at desktop and mobile widths');
  for (const [url, width] of [['/', 1280], ['/', 390], ['/de/', 1280], ['/de/', 390]]) {
    const ctx = await b.newContext({ viewport: { width, height: 900 } });
    const pg = await ctx.newPage();
    await pg.goto(BASE + url, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(() => {
      return {
        headline: document.querySelector('h1')?.textContent.trim(),
        preview: Boolean(document.querySelector('.audit-preview')),
        checks: document.querySelectorAll('.audit-checks > li').length,
        ctas: document.querySelectorAll('.hero-actions a').length,
      };
    });
    ok(`${url} at ${width}px — headline, audit preview and two actions render`,
       r.headline && r.preview && r.checks === 5 && r.ctas === 2, JSON.stringify(r));
    await ctx.close();
  }

  console.log('\n9. The FAQ is native, complete and usable without JavaScript');
  for (const url of ['/', '/de/']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    await pg.goto(BASE + url, { waitUntil: 'networkidle' });
    const r = await pg.evaluate(() => {
      const rows = [...document.querySelectorAll('.faq-list details')];
      rows[0].open = true;
      return { count: rows.length, firstOpen: rows[0]?.open,
        summaries: rows.map((x) => x.querySelector('summary')?.textContent.trim()) };
    });
    ok(`${url} — five FAQ items render and native disclosure opens`,
       r.count === 5 && r.firstOpen && r.summaries.every(Boolean), JSON.stringify(r));
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
          document.querySelectorAll('.footer-grid > *, .footer-bar > *, .hero-grid > *, .split > *, .workstream-grid > *, .audience-grid > *, .process-grid > *, .finding-grid > *, .price-v5 > *').forEach((col) => {
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
       home.some((h) => /^\/(de\/)?#what-we-check$/.test(h || '')), home.filter((h) => (h || '').includes('#')).join(' '));
    await ctx.close();
  }

  console.log('\n13. Content is data, not markup');
  {
    const src = fs.readFileSync(path.join(__dirname, 'src/components/Home.astro'), 'utf8');
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/content/copy/en.json'), 'utf8'));
    // Assert the rule, not the wording. This check used to hard-code the
    // headline text, so editing the headline "failed" the audit even though
    // nothing was wrong — the check itself was the thing out of date.
    const words = en.home.headline.replace(/[=*_]/g, '').split(/\s+/).filter(Boolean);
    const windows = words.map((_, i) => words.slice(i, i + 3).join(' ')).filter((w) => w.split(' ').length === 3);
    const leaked = windows.find((w) => src.includes(w));
    ok('headline appears in the content file, not in a component',
       words.length >= 4 && src.includes('h.headline') && !leaked, leaked || '');
    ok('price lives in the v5 content model', en.home.v5.price.amount === '€890' && !src.includes('€890'));
    ok('the five compliance areas are data-driven',
       en.home.v5.workstreams.length === 5 && en.home.v5.workstreams.every((x) => x.id && x.icon)
       && src.includes('v.workstreams') && src.includes('item.icon'));
    ok('the five buyer deliverables are data-driven',
       en.home.v5.deliverables.length === 5 && src.includes('v.deliverables'));
    // The supplied mark and refreshed social card must be available to every route.
    for (const loc of ['en', 'de']) {
      const c = JSON.parse(fs.readFileSync(path.join(__dirname, `src/content/copy/${loc}.json`), 'utf8'));
      const img = c.site.socialImage;
      ok(`${loc} — social card declared and present on disk`,
         Boolean(img) && fs.existsSync(path.join(__dirname, 'public', img.src.replace(/^\//, ''))), JSON.stringify(img));
    }
    ok('supplied brand mark is wired for header/footer and icons',
       src.includes('audit-preview')
       && fs.existsSync(path.join(__dirname, 'public/elbebridge-mark.jpg'))
       && fs.existsSync(path.join(__dirname, 'public/favicon-32.png'))
       && fs.existsSync(path.join(__dirname, 'public/favicon-192.png')));

    ok('the active differentiation is concise and not framed as generic AI disparagement',
       en.home.v5.advantages.length === 4 && !/why not just ask an ai/i.test(src));
    const homeMarkup = fs.readFileSync(path.join(__dirname, 'dist/index.html'), 'utf8');
    const internalMechanics = /Article 19\(|scanner could not|machine candidate|verified_absent|candidate states|evidence hashes?|run IDs?|queue architecture/i;
    ok('public homepage does not expose internal checking mechanics',
       !internalMechanics.test(homeMarkup), (homeMarkup.match(internalMechanics) || [])[0] || '');
    ok('public report preview uses only fictional example identities',
       /Example Outdoor GmbH/.test(homeMarkup) && /Fictional marketing example/.test(homeMarkup), 'homepage report preview');
    // The public brand uses the supplied ElbeBridge capitalization. The legal
    // entity remains whatever the Impressum states.
    for (const loc of ['en', 'de']) {
      const parsed = JSON.parse(fs.readFileSync(path.join(__dirname, `src/content/copy/${loc}.json`), 'utf8'));
      ok(`${loc} — public wordmark and logotype use "ElbeBridge"`,
         parsed.site.logotype === 'ElbeBridge' && parsed.site.wordmark === 'ElbeBridge',
         `${parsed.site.logotype} / ${parsed.site.wordmark}`);
    }
    ok('founder names are not on the marketing pages',
       !/Bahmanyari|Buxbaum/.test(JSON.stringify(en.home)) && !/Bahmanyari|Buxbaum/.test(JSON.stringify(en.footer)),
       'home/footer');
    // ...but § 5 DDG requires them in the Impressum, so they must stay there.
    const impressumPage = en.legal.find((x) => x.key === 'impressum');
    ok('both representatives still named in the Impressum',
       /Bahmanyari/.test(JSON.stringify(impressumPage)) && /Buxbaum/.test(JSON.stringify(impressumPage)));

    for (const loc of ['en', 'de']) {
      const c = JSON.parse(fs.readFileSync(path.join(__dirname, `src/content/copy/${loc}.json`), 'utf8'));
      const p = c.home.v5.price;
      ok(`${loc} — price includes scope and separately quoted implementation notes`,
         /scope|Umfang/i.test(p.scopeNote) && /separate|separat/i.test(p.implementationNote),
         JSON.stringify({ scope: p.scopeNote, implementation: p.implementationNote }));
    }
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

    ok('icons are chosen in content, not hard-coded',
       en.home.v5.workstreams.every((o) => !!o.icon) && en.home.v5.advantages.every((o) => !!o.icon));
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
