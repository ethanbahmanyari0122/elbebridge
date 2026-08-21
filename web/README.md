# elbebridge.com

Astro, static output, English and German. All copy lives in JSON — no text is
written inside a component.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # → dist/
npm run audit      # 75 accessibility checks against the built site
```

## Where the content lives

```
src/content/copy/en.json     every English word on the site
src/content/copy/de.json     every German word on the site
src/content.config.ts        the schema both files must satisfy
```

Change a price, a headline, a legal paragraph — edit the JSON. Nothing in
`src/components/` or `src/pages/` needs to be touched, and the audit proves it:
it fails if the headline or the price ever appears inside a component.

The schema is enforced at build time. Delete a required field and the build
stops with the field name, rather than publishing a blank section.

### Adding a legal page

Add an object to the `legal` array in **both** locale files:

```json
{
  "key": "privacy",
  "slug": "datenschutz",
  "title": "Datenschutzerklärung",
  "metaDescription": "…",
  "intro": "…",
  "sections": [
    { "heading": "1. Verantwortlicher", "blocks": [
      { "type": "p", "text": "…" },
      { "type": "ul", "items": ["…"] },
      { "type": "dl", "items": [{ "term": "…", "desc": "…" }] },
      { "type": "address", "lines": ["…"] }
    ]}
  ]
}
```

`key` pairs the page across languages so `hreflang` stays correct even when the
slugs differ — `/privacy` and `/de/datenschutz` are the same page to a search
engine. `src/pages/[slug].astro` generates the routes; you never add a page file.

### Inline formatting inside any text field

| You write | You get |
|---|---|
| `[label](https://example.com)` | a link — `https:`, `mailto:`, `/` and `#` only |
| `**bold**` / `_italic_` | `<strong>` / `<em>` |
| `==missing==` | accent-coloured span — the highlight word in the headline |
| `{de\|Verpackungsgesetz}` | `<span lang="de">…</span>` |
| `` `User-agent: …` `` | `<code>…</code>` |

That last one matters: a German word inside an English sentence needs its own
`lang` attribute or a screen reader pronounces it as English. It is WCAG 3.1.2,
it is the kind of thing we charge clients to find, and it would be embarrassing
to get wrong here. Content is escaped before formatting is applied, so nothing
an author types can inject markup.

### Adding a third language

1. Copy `en.json` to `fr.json`, translate, set `"locale": "fr"`.
2. Add `'fr'` to `locales` in `astro.config.mjs` and to `LOCALES` in `src/lib/site.ts`.
3. Add the French slugs to `PAGE_SLUGS` in `src/lib/site.ts`.
4. Copy `src/pages/de/` to `src/pages/fr/` and change `'de'` to `'fr'` in the two files.

## Design system

Tokens live at the top of `src/styles/global.css` — surfaces, ink, brand,
status, type and rhythm. Change a token, the whole site follows.

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#141c28` | body text, 17.1:1 on white |
| `--ink-muted` | `#4c5768` | secondary text, 7.3:1 |
| `--accent` | `#1350c4` | links, highlight word, numbered steps, 7.1:1 |
| `--navy` | `#10233f` | buttons, footer |
| `--sand` / `--paper` | `#f4f0e8` / `#fbfaf7` | price card, alternating bands |
| `--focus` | `#a34a15` | focus ring — 5.9:1 on white, 5.2:1 on sand |

`npm run contrast` prints the ratio for every pair, and the audit fails the
build if any of them drops below 4.5:1. Change a colour, run it.

**Type.** Source Serif 4 Variable for headings, Inter Variable for body. Both
self-hosted via `@fontsource-variable/*` and bundled into `dist/` — no request
ever leaves for a font CDN. That is deliberate: the privacy policy promises no
third-party requests, and German courts have held that hotlinking Google Fonts
transmits visitor IPs without consent. Do not swap these for a `<link>` to
fonts.googleapis.com.

**Icons** are inline SVG in `src/components/Icon.astro`, no icon library. They
are decorative — every one is `aria-hidden`, and each sits beside real text.
Which icon appears is chosen in the content file (`"icon": "accessibility"`),
and the schema rejects any name the component does not implement.

**The hero visual** is CSS and inline SVG, not an image: a shop being inspected
— product tiles, a price row, a checkout button — with three floating cards over
it. The shop is desaturated on purpose; it is the subject, not the sell. It
restates the three obligations that appear as real text below, so it is
`aria-hidden` rather than read out twice. Being markup rather than a PNG means it
translates, scales and costs nothing to download.

**Header and footer are data too.** The tagline lives in `site.tagline`; the
whole footer — blurb, founders line, link columns, contact block and the bottom
bar — lives in `footer`. Add a column when the page behind it exists; the audit
checks every footer link points somewhere real, because a footer full of dead
links is worse than a short one.

**Underlines.** Links in running text keep a permanent underline: colour alone
is not a sufficient distinction (WCAG 1.4.1). Links inside a labelled `nav`
landmark — the header and the footer columns — do not need one, because their
role is structural rather than inferred from styling. They still underline on
hover and focus.

Two specificity traps are commented in the stylesheet, because both produced
bugs that only the audit caught:

- `.site-nav a` (0,1,1) outranks `.btn-primary` (0,1,0), so an unscoped colour
  rule there painted the header CTA navy-on-navy at 1.08:1. The rule is written
  `.site-nav a:not(.btn)`.
- `.footer-col ul` (0,1,1) outranks `.social` (0,1,0), which stacked the social
  icons one per row. The rule is written `.footer-col .social`.

## Why Astro and not React or Vue

In a single-page app, a route change updates the DOM without a page load, and
screen readers announce nothing — the user has no idea they navigated. You have
to build route announcement and focus management by hand, and keep them working.

This site ships **zero JavaScript** — no files, and not a single `<script>` tag.
Navigation is real navigation, so there is nothing to announce and nothing to
get wrong. The audit asserts this on every run. The homepage is HTML and CSS
only; the rest of the build is the self-hosted font files.

That is not purism. We sell accessibility audits; the failure mode of an SPA is
exactly the failure we would be charging a client to fix.

## If the dev server says `Cannot read properties of undefined`

Astro caches the content collection in `.astro/data-store.json`. If a content
JSON file changes **while `astro dev` is running**, the running server can keep
serving the cached copy and rewrite the stale cache back to disk — so deleting
`.astro` while the server runs does not help. The symptom is a component
crashing on a field you can see plainly in the JSON.

```bash
# stop the dev server first — it holds the stale state in memory
npm run clean      # rm -rf .astro dist
npm run dev
```

`npm run dev:clean` does both in one go. `npm run build` is unaffected; it always
syncs from disk.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
Expected repository layout:

```
your-repo/
  .github/workflows/deploy.yml
  web/            ← this folder
  scanner/        ← the domain scanner
```

If you put `web/` somewhere else, update `working-directory` and
`cache-dependency-path` in the workflow.

One-time setup in the repo: **Settings → Pages → Source → GitHub Actions**.

### DNS at GoDaddy

`public/CNAME` already contains `elbebridge.com`. Add these records **by hand**
in GoDaddy's DNS records table:

| Type | Name | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | `<your-github-username>.github.io` |

Then in **Settings → Pages → Custom domain**, enter `elbebridge.com` and tick
**Enforce HTTPS** once the certificate is issued. Propagation can take up to 24
hours; the certificate is issued after DNS resolves.

> **Do not use GoDaddy's Connect Domain or Airo wizards.** They rewrite the zone
> behind you, and your Google Workspace MX, SPF, DKIM and DMARC records live in
> that same zone. You have lost DNS to that wizard once already. Add the five
> records above by hand and change nothing else.

## What is already filled in

No placeholders remain; the audit fails the build if any reappear, in the JSON
or in the rendered HTML.

- **Impressum** — elbebridge GbR, Stormarner Straße 41, 22049 Hamburg, phone
  +49 151 20277581, both representatives named. No register section: two people
  trading together in Germany form a GbR by operation of law, and a GbR has no
  Handelsregister entry. No VAT section either — § 5 DDG asks for a USt-IdNr
  only *where one exists*. Add the section back when you are assigned one.
- **Privacy / Datenschutz** — controller details, GitHub Pages named as the
  host, GitHub's own privacy statement linked for log retention, and section 6
  stating plainly that GitHub, Inc. and Google Workspace are reachable from the
  US under the EU-U.S. Data Privacy Framework and Standard Contractual Clauses.
  It does not claim everything stays in Europe, because it does not.
- **Accessibility / Barrierefreiheit** — reviewed 15 August 2026.

Two things to revisit as the business changes: add the USt-IdNr when you have
one, and re-date the privacy and accessibility statements whenever their content
changes.

### The enquiry route

There is no form. GitHub Pages is static, so a form needs a third-party backend,
an account and a data processing agreement — and a form with no working endpoint
is worse than none. Instead `home.contact` renders a `mailto:` button with the
subject and body prefilled, so the visitor's mail client opens with the same
fields a form would have asked for.

That is also why the privacy policy can say there is no third party between the
visitor and us, and why the site ships **zero JavaScript**.

**To switch to a real form later**, pick an EU-hosted backend — Formspree, Basin
and Netlify Forms all store submissions in the US and would have to be declared
as a third-country transfer. EU-hosted options that publish a DPA: Formbricks
Cloud (Germany), Formcarry (Frankfurt), PostTo, SimplyForms. Then replace
`home.contact` with a form block, name the provider in
`legal → privacy → section 3`, and update section 6.

## Re-run the audit after every content change

```bash
npm run build && npm run audit
```

104 checks: axe against WCAG 2.2 AA and EN 301 549 on all eight pages, reflow at
320px and 200% text, language and `hreflang` pairing, keyboard reachability and
focus visibility, that no JavaScript ships at all, that the mailto route carries
a prefilled subject in the right language, column overflow at seven widths in
both languages, every colour pair in the palette, that no placeholder or
unrendered markdown reaches the HTML, that the Impressum carries the address,
phone and both representatives, and that content has not crept back into
components.

It borrows Playwright and axe from `../scanner/node_modules`, so run
`npm install` in `scanner/` first.

German compound nouns are long enough to break a phone layout, and that is a
failure axe cannot see. The reflow check has now caught it twice — once on the
plain build and again after the redesign, when grid tracks sized themselves to
the width of *Registerrecherchen*.

Two CSS notes worth keeping, because both are easy to get wrong again:

- `overflow-wrap: break-word` breaks a word visually but still reports the whole
  word as the min-content width, so a grid track stays too wide. `anywhere` also
  shrinks min-content, which is what actually fixes reflow.
- Grid and flex children default to `min-width: auto`. Any long word inside one
  can force the track wider than the viewport. `min-width: 0` on the children is
  the fix, and it is applied to every grid child in the layout.
