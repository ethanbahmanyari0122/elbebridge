# elbebridge-report

Turns one `scan.json` into the three-page findings report. This is the thing
that gets sold; the scanner exists to feed it.

```bash
node src/generate.js --domain organicbasics.com --brand "Organic Basics"
```

Writes `reports/elbebridge-findings-<domain>-<date>.pdf`. Takes about a second.

| Option | Default |
|---|---|
| `--domain <d>` | required |
| `--brand <name>` | the domain |
| `--scans <dir>` | `../scanner/out` |
| `--out <dir>` | `./reports` |
| `--lucid <file>` | Ornella's completed register worklist (default `./lucid-results.csv`) |
| `--keep-html` | also writes the intermediate HTML |

## The register handover

The scan writes `scanner/out/_lucid-worklist.csv` — the rows worth searching,
with four empty columns. Ornella fills `lucidStatus` (`registered`, `not_found`
or `unclear`), `lucidNumber`, `checkedOn` and `note` in Sheets and sends it back.
Save it as `report/lucid-results.csv` and the generator uses it:

- `registered` → green, and the packaging item disappears from page 3
- `not_found` → red, and the report states the date the register was searched
  and the entity it was searched under
- `unclear` → stays open rather than guessing
- blank → *register check pending*

Without that file the report never claims anything about packaging. We cannot
see the register from outside, and saying "not registered" would be a claim we
have not checked.

Borrows Playwright from `../scanner/node_modules`, so run `npm install` in
`scanner/` first. Nothing else to install.

## The sample

`sample-report.pdf` is a complete report for **Nordlicht Home**, a fictional
Danish shop from the scanner's own test fixtures. Safe to send a prospect who
asks what they are buying.

It is deliberately not a report about a real company. An earlier version of this
folder held one for a named brand with 324 critical findings — in a repository
that is public so GitHub Pages can serve the website. Reports about real
companies stay out of version control; `.gitignore` enforces it.

## The three pages

1. **Summary** — the three obligations as a red/amber/green table, one sentence
   of finding each, the facts we scanned against, a homepage screenshot, and the
   disclaimer.
2. **The evidence** — per obligation: what the law requires, what we found, and
   the specific proof. For accessibility that means the failing element's own
   HTML and the EN 301 549 clause it breaks.
3. **What it takes to fix** — prioritised, with effort per item, then the price.

## Everything is content

`content/report.en.json` holds every word: the legal descriptions, the
plain-English explanation and effort estimate for each of 22 axe rules, the
remediation catalogue, and the pricing. No copy lives in the code.

Adding German later means adding `report.de.json` and a `--locale` flag; the
renderer needs no changes.

## Rules the generator enforces

- **It refuses to render banned words.** `compliant`, `guaranteed`,
  `fine-proof`, `Abmahnungssicher`, `rechtssicher`, `certified` — the build
  throws rather than publish one. Stating a conclusion about someone's liability
  is not our job.
- **It refuses domains it should not report on.** An unreachable scan, or one
  that redirects to a different company, exits non-zero instead of producing a
  document about the wrong business.
- **Packaging is never asserted as missing.** We cannot see the register from
  outside, so LUCID shows as *register check pending* until Ornella searches it.
  Saying "not registered" would be a claim we have not checked.
- **Zero violations is amber, not green**, when there is no accessibility
  statement. And a scan that could not complete behind an overlay can never be
  green.
- **Status is never colour alone** — each pill carries a word and a shape, so it
  survives greyscale printing and colour blindness.

## Three pages, whatever the shop

Page 2 shows up to three findings in full and names the rest compactly. The
generator renders the PDF, counts its pages, and steps the evidence down until
it fits. Verified across all 35 reportable domains in the last scan.

An earlier version guessed at fit by measuring element heights in the browser.
That under-reported badly, because it measured at a 1280px viewport while the
print column is 182mm — text wraps far more on paper. Measuring the finished
PDF is the only honest check.

## Tests

```bash
SCANS=../scanner/out node test/run.js
```

Runs the real generator over every scan on disk and asserts: three pages every
time, no banned words, the traffic lights match what the data supports, and the
refusals fire.
