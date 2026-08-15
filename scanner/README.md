# elbebridge-scan

BFSG / GPSR / LUCID pre-check over a list of domains. Feeds the three-page
findings report. It is deliberately a script over a CSV — no database, no queue,
no dashboard.

## Run it

```bash
npm install                 # also downloads Chromium
npm test                    # 33 assertions against local fixture sites, ~55s
npm run scan                # scans domains.csv into out/
```

Useful flags:

```bash
node src/index.js -i domains.csv -o out -c 3   # input, output, concurrency
node src/index.js --limit 20                   # first 20 only
node src/index.js --force                      # re-scan everything
node src/index.js --headed                     # watch it work, for debugging
```

Set your real contact URL before the first live run — it goes in the User-Agent:

```bash
export SCAN_CONTACT_URL="https://elbebridge.com/scanner"
```

## Output

```
out/
  _run-summary.csv        ← Ornellas' worklist: one row per domain
  _run-summary.json
  <domain>/
    scan.json             ← the report generator's only input
    home.png              ← page 1 of the report
    impressum.png
    evidence-<rule>.png   ← page 2 of the report: the failing element itself
    axe-raw.json          ← full axe output, kept for defensibility
```

`_run-summary.csv` always reflects the whole list, including domains scanned in
earlier runs.

## The five checks

| # | Check | Method | scan.json fields |
|---|-------|--------|------------------|
| 1 | Automated accessibility | axe-core over homepage + one product page, WCAG 2.2 AA + EN 301 549 tags | `axeTotal`, `axeCritical`, `axeSerious`, `top10Rules[]` |
| 2 | Accessibility statement | Link text and href matched, then the page is fetched and word-counted | `hasA11yStatement`, `a11yStatementReachable`, `a11yStatementLooksSubstantive` |
| 3 | Impressum | Link text and href matched | `hasImpressum`, `impressumUrl` |
| 4 | EU responsible person | Homepage + product + Impressum body text | `hasResponsiblePerson`, `responsiblePersonEvidence` |
| 5 | Company identity | Legal entity, address, VAT ID, HRB from the Impressum | `legalEntity`, `address`, `vatId`, `registerNumber`, `lucidNumberOnSite` |

Check 5 is what Ornellas needs for the LUCID lookup — she cannot search the
Verpackungsregister without the legal entity name. `readyForLucidLookup` tells
her which rows she can act on.

Two additions beyond the original spec, both because the report needs them:

- **`evidence-<rule>.png`** — a cropped screenshot of the actual failing element.
  Page 2 of the report is supposed to show the proof; this is the proof.
- **`lucidNumberOnSite`** — if a LUCID number is already printed on the site,
  the producer is registered. Don't burn a lookup, and don't put it in the report
  as a finding.

## Rules of engagement — enforced in code, not by convention

- `robots.txt` is fetched and honoured per host. `Disallow: /` produces
  `status: "skipped-robots"` and no request beyond robots.txt itself.
- One request per second per host, hard floor. Concurrency only ever runs
  *different* hosts in parallel.
- Identifiable User-Agent carrying a contact URL.
- Public pages only. Nothing behind a login, no orders, no forms submitted. The
  only click the scanner ever makes is a cookie-consent accept button.
- No personal data. Company identity only — the extractor stops at the first
  line matching `Geschäftsführer`, `Inhaber`, e-mail, or phone.

## Why a cookie wall matters more than it looks

A consent modal makes every element behind it hidden, so axe reports a broken
site as clean. The scanner dismisses the banner before scanning, and records how
in `cookieWall.via`. If `cookieWall.dismissed` is `false` and `axeTotal` is
suspiciously low, treat that scan as inconclusive rather than clean.

## Failure handling

Nothing throws out of a scan. Every domain gets a `scan.json` with a status:

| status | meaning |
|---|---|
| `ok` | scanned, all fields populated |
| `unreachable` | DNS failure, refused connection, 4xx/5xx on the homepage |
| `skipped-robots` | robots.txt disallows us |
| `timeout` | blew the 120s per-domain budget |
| `error` | anything else, with the message in `error` |
| `not-scanned` | in the CSV, never reached |

A hung host is bounded twice — a 30s navigation timeout and a 120s domain
budget. Domain 34 dying cannot take 35–100 with it; the fixture suite asserts
exactly that.

## Throughput

Fixtures run in ~4s per domain. Real sites are slower — budget 30–45s each. At
concurrency 3 that is roughly 4–5 minutes for 20 domains, comfortably inside the
15-minute acceptance criterion. Raise `-c` for the 100-domain run, but each host
still gets a one-second gap.

## Limitations, stated plainly

Automated testing catches a minority of WCAG failures. A `0` in `axeTotal` means
"no automatically detectable violations", never "accessible" — and the report
must never say otherwise. The keyboard-and-screenreader pass is where the
findings that actually sell come from.

## Testing

`npm test` starts four local sites — a shop failing everything behind a cookie
wall, a compliant shop, a `Disallow: /` host, and a host that accepts the
connection then never responds — and asserts on the real scanner's output.
Add a fixture whenever a real site breaks something.
