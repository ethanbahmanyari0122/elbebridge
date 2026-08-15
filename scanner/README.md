# elbebridge-scan

BFSG / GPSR / LUCID pre-check over a list of domains. Feeds the three-page
findings report. It is deliberately a script over a CSV — no database, no queue,
no dashboard.

## The domain list

`domains.csv` holds 219 candidates in nine sector groups: fashion, footwear,
accessories, home, beauty, sport, kids, tech, gifts. Column 1 is the domain;
group, country and note travel through to the worklist.

They are candidates, not verified prospects. Some are dead, moved or already
compliant — the scanner is the filter and flags those itself. Feed it volume.

Work one group at a time; the pitch barely changes inside a group:

```bash
node src/index.js --group fashion
```

Groups that drag in extra law beyond your three obligations: **beauty** (CPNP
cosmetic notification), **kids** (toy safety), **tech** (WEEE/ElektroG and
battery registration — a bigger job and a bigger fee, and the reason to keep
take-e-way on the call list even though they are wrong for packaging).

## Adding candidates

```bash
node src/intake.js --group home --country DK --source "Ambiente 2026" --file paste.txt
```

Paste anything — an exhibitor page, a column of URLs, a messy export. It pulls
the domains out, drops social links, CDNs and asset files, and **refuses to add
anything already on the list, already scanned, or already in `pipeline.csv`**,
telling you which and why. Idempotent: run the same paste twice and nothing
happens. `--dry-run` to look first.

`pipeline.csv` is the contact tracker. Ornella owns it; one row per company
touched, so nobody gets emailed twice.

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
earlier runs, **sorted best prospect first**.

## How a prospect is scored

Two halves, and they multiply rather than add.

**Need** — how much they have got wrong: critical failures (capped), no
accessibility statement, no EU responsible person, plus small credits for having
an Impressum (they already know German law applies, so it is an easier
conversation) and for having produced a legal entity Ornella can search today.

**Reach** — whether German law touches them at all, from `germanMarket`:

| Confidence | Evidence | Multiplier |
|---|---|---|
| high | the shop itself is served in German — a `/de` storefront, `lang="de"`, or German UI wording | ×1 |
| medium | it offers a German route or mentions Germany — `hreflang="de"`, a `/de` link | ×0.55 |
| low | no sign at all | ×0.1 |

An earlier version added the two together, which ranked a wrecked shop with no
German presence above a tidy German one. That is backwards: the first is not a
customer at any price.

A scan that could not complete behind an overlay is discounted by 30%, because
its violation count is a floor rather than a finding.

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
