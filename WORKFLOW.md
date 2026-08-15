# How the two of you actually run this

> **Sharing this with Ornella?** Send `docs/elbebridge-how-we-work.pdf` instead.
> Same material, written without tooling terms, with every spreadsheet column
> she touches explained and a glossary at the back. This file is the version
> with the commands in it.

One page. Who does what, in what order, and the two rules that stop it falling
over.

---

## The split — corrected for reality

Ornella has no terminal. The scanner and the report generator live in a repo on
Ethan's laptop. So **everything that runs a command is Ethan's**, and Ornella
works entirely in spreadsheets and email.

**Ethan runs the machines.** Build the list, scan it, generate reports, fix
sites. All of it local.

**Ornella does what no machine can.** Search the German register, talk to
providers, run the outreach in German, take the calls.

The handover between you is two CSV files, both of which open in Google Sheets.

---

## The loop

| # | What happens | Who | How long |
|---|---|---|---|
| 1 | Build the list — one source, one sector | **E** | 1 hour, once a week |
| 2 | Scan it | **E** | overnight, unattended |
| 3 | Send Ornella `_lucid-worklist.csv` | **E** | 1 min |
| 4 | Search LUCID, fill four columns, send it back | **O** | ~3 min a row |
| 5 | Generate reports with her results in them | **E** | 1 second each |
| 6 | Outreach and follow-up, in German | **O** | the real work |
| 7 | They pay | | |
| 8 | Fix the site / broker the packaging | E / O | |

Only steps 4 and 6 are hers, and neither needs anything installed.

---

## Step 1 — building the list (Ethan, 1 hour a week)

Pick **one source** and **one sector group**. Copy whatever the page gives you
into a text file, then:

```bash
cd scanner
node src/intake.js --group home --country DK --source "Ambiente 2026" --file paste.txt
```

It pulls the domains out, throws away social links, CDNs and logo files, and
refuses to add anything already on the list, already scanned, or already in the
tracker. Run the same paste twice and nothing happens. `--dry-run` to look first.

**Sources, best signal first**

| Source | Why it is good |
|---|---|
| Trade-fair exhibitor directories — Ambiente Frankfurt (3,644 exhibitors), ISPO Munich (2,300+), Premium Berlin, Spielwarenmesse | A foreign brand paying to exhibit in Germany has declared it wants the German market. Gives you the company name too |
| Meta Ad Library, filtered to Germany | If they pay to advertise into Germany they sell into Germany, and they have budget. Refreshes constantly |
| Marketplace brand directories — Zalando, Otto, AboutYou | High volume, everything ships to Germany, mixed with big brands who have in-house teams |
| idealo.de, Geizhals merchant lists | The long tail, once the obvious names are used |

Roughly 50 names an hour, so ~200 fresh prospects a month — more than two people
can chase.

## Step 2 — scanning (Ethan)

```bash
node src/index.js --group home
```

Unattended. Roughly 25 seconds a domain at three at a time. Start it and leave.
Re-running skips anything already done, so an interrupted run resumes free.

---

## Reading the worklist (Ethan)

`scanner/out/_run-summary.csv`, sorted best prospect first.

The score multiplies *how much they have got wrong* by *whether German law
reaches them at all*. A wrecked shop with no German presence scores near zero —
it is not a customer at any price.

Drop rows where:

- `redirectedOffDomain = TRUE` — that domain is now a different company
- `germanMarket = low` — no sign they face Germany
- `axeReliable = FALSE` — an overlay blocked the scan, so the count is a floor

## The register handover — the one real handover

This is the only real handover, and it is now a file rather than a conversation.

**Ethan sends** `scanner/out/_lucid-worklist.csv`. The scan writes it
automatically. It contains only rows worth searching — a legal entity was found,
the domain is genuinely theirs — sorted best prospect first, with four empty
columns at the end.

**Ornella fills those four columns** in Google Sheets:

| Column | What to put |
|---|---|
| `lucidStatus` | `registered`, `not_found`, or `unclear` |
| `lucidNumber` | the LUCID number, if there is one |
| `checkedOn` | the date she searched — it is printed in the report |
| `note` | anything odd: two similar entities, a name that did not match |

If `identityConfidence` says `medium`, the name came off a legal page with no
address to confirm it. Worth a look before searching.

**Ethan saves it** as `report/lucid-results.csv`. The generator picks it up
automatically:

- `registered` → green, and the packaging fix disappears from page 3
- `not_found` → red, and the report says *"We searched the public LUCID register
  on 16 August under [entity] and found no registration"*
- `unclear` → stays open rather than guessing
- blank → the line reads *register check pending*

**Never send a report with that line still pending if she has already
searched.** It reads as though you did not finish the job.

## Step 6 — outreach (Ornella)

Her call on wording. Two things that come from the data:

- The strongest openers are shops with an **Impressum but no accessibility
  statement**. They already know German law applies to them and have missed the
  newest rule. It is a short conversation.
- **Automated market surveillance has been running since January 2026.** That is
  a better opening than a deadline that has already passed.

Every send gets a row in `pipeline.csv`.

> Before the first hundred emails: get twenty minutes of legal advice on
> unsolicited B2B email under UWG § 7. The exposure runs to the sender, and
> being on the wrong side of it while selling compliance would be expensive.

---

## The tracker — `scanner/pipeline.csv`

Ornella owns it. One row per company touched.

```
domain,group,stage,owner,updated,note
```

`stage`: `scanned` → `report_sent` → `contacted` → `replied` → `call_booked` →
`won` / `lost` / `excluded`

`excluded` needs a reason: too small (under 10 staff **and** under €2m, so the
BFSG exemption applies), already compliant, wrong market, or the domain turned
out to be someone else.

It is a plain CSV — open it in Sheets or Excel. `intake.js` reads it and will
not re-add anything in it, whatever the stage.

---

## The two rules

**1. Nothing gets contacted twice.** That is what the tracker is for. Every
brand you touch gets a row the same day, even a dead one.

**2. Never send a report you have not read.** It takes a second to generate and
a minute to read. The scanner is good but it is not a lawyer, and one wrong
company name in a €890 document costs more than the fee.

---

## The weekly rhythm

| | |
|---|---|
| **Monday** | E: intake and kick off the scan overnight |
| **Tuesday** | E: send the register worklist. O: search LUCID, send it back |
| **Wednesday** | E: generate reports. O: start outreach on the top rows |
| **Thu–Fri** | O: follow-ups and calls. E: remediation for anyone who bought |
| **Friday** | Both: read the numbers — scanned, reported, contacted, replied, won. One written decision for next week |

---

## What still has no owner

- **EPR provider pricing.** Tuesday's calls. Nothing moves on packaging margin
  until it is in writing.
- **The manual accessibility pass.** Ten sites, mouse unplugged, then NVDA.
  Automated testing finds a minority of barriers, and watching a checkout become
  unusable with a keyboard is the demo that sells. Only Ethan can do it, and only
  by doing it.
- **Company size.** The one qualifier no scan can see. Thirty seconds on
  LinkedIn, on shops that already scored well — not across the whole list.
