# Build track — status

**Saturday 15 August 2026.** Day 2 of 8. Milestone M1 review is Friday 21.

**How the two of you run this day to day:** [`WORKFLOW.md`](WORKFLOW.md) for
Ethan, [`docs/elbebridge-how-we-work.pdf`](docs/elbebridge-how-we-work.pdf) to
send Ornella.

> The acceptance test for the whole weekend: can you produce one finished
> findings PDF from one JSON file in under fifteen minutes?
>
> **Yes — in about one second.**
>
> ```
> cd report && node src/generate.js --domain organicbasics.com --brand "Organic Basics"
> ```
>
> Verified across all 35 reportable domains: three pages every time.

---

## The four deliverables

| # | Deliverable | Due | Status |
|---|---|---|---|
| 1 | Scanner running unattended over a list of domains | Sun night | **Done — proven on 45 real websites** |
| 2 | One page live, with Impressum and privacy policy | Sun night | **Done, live, a day early** |
| 3 | Three-page findings report template | Tue | **Done, three days early** |
| 4 | Wholesale pricing from two EPR providers, in writing | Wed | **Not started** |

Two of four are ahead of schedule. Deliverable 3 is the one that actually gets
sold, and it has had no time spent on it.

---

## 1. The plumbing — done and verified

Every DNS record below was checked against public DNS, not taken from the admin
console. Full record: **`EMAIL-SETUP.md`**.

| Item | elbebridge.com | elbebridge.de |
|---|---|---|
| Google verification | Live | Live |
| MX | Live | Live |
| SPF (and its chain) | Live | Live |
| DKIM published | Live | Live, own key |
| DKIM signing | Authenticating | Authenticating |
| DMARC | `p=none` → `ornella@` | `p=none` → `ornella@` |

- `.de` added as a **user alias domain**, so both mailboxes receive at both
  domains with no extra licence cost.
- GoDaddy's default `.de` DMARC record — `p=quarantine`, reporting to GoDaddy —
  was replaced rather than duplicated.
- The two DMARC records disagreed on the report address (`ornellas@` vs
  `ornella@`); both now point at the mailbox that exists.
- `hallo@elbebridge.com` exists as a Google Group with both founders.

**Four items still need a human inside the account:** confirm the group accepts
external posts (it shows *Custom*, and members-only silently rejects prospects),
send a test message from outside the domain, set Ornella's send-as default, and
register both domains at postmaster.google.com.

## 2. The scanner — Saturday's job

Built. `scanner/`, 96 source lines of checks over five modules, 33 assertions
passing against four local fixture sites.

### Acceptance criteria from the plan — all met

| Criterion | Result on the 45-domain run |
|---|---|
| Runs unattended without crashing | 45 scanned, 0 errors, 0 timeouts |
| All five fields populated | Yes on all 40 reachable domains |
| Under 15 minutes for 20 domains | 45 domains in **7 minutes 19 seconds** |
| Re-run without duplicating output | Proven, and `--force` re-scans |

79 fixture tests. Every bug found on a real site has a fixture reproducing it.

### What is definitely done

- All five checks implemented: axe over homepage + one product page, accessibility
  statement, Impressum, EU responsible person, company identity.
- Rule set is WCAG 2.2 AA + `EN-301-549`, so every violation arrives tagged with
  its EN clause — the mapping page 2 of the report needs, for free.
- Cookie-wall dismissal before scanning. Without it a broken shop scores clean.
- robots.txt honoured, one request per second per host, identifiable user agent
  with a contact URL, public pages only.
- Nothing throws: every failure writes a `scan.json` with a status. A hung host
  is bounded twice, at 30s per navigation and 120s per domain.
- Resumable — a re-run skips anything already `ok`.
- Two additions beyond the spec: cropped screenshots of the actual failing
  elements (page 2 evidence), and detection of a LUCID number already printed on
  a site, so Ornella does not waste a lookup.
- Seed list of 45 plausible foreign DTC brands in `scanner/domains.csv`.

### What the real web taught it

Six rounds of running it and reading the output by hand. Each of these was a
real bug that a fixture now guards:

- **Cookie walls dismissed 0 of 3.** The matcher required the label to equal
  "accept all", so "Accept All Cookies" never matched. axe reports nothing
  behind an overlay, so a broken shop scored clean.
- **A live prospect was skipped by robots.txt that never blocked us.** Shopify
  separates its `Disallow` lines with a bare CR; splitting on `\r?\n` merged
  every user-agent group, so a rule meant for Nutch applied to us.
- **A domain recorded as `timeout` overwrote itself with `ok` after the summary
  had been written.** The budget stopped us waiting but did not stop the work.
- **"hosted on Shopify Inc." was extracted as two shops' legal entity**, and a
  French notice yielded the *hosting provider* because the name and legal form
  sit on separate labelled lines.
- **`vatId: "entification"`**, captured out of the phrase "VAT identification
  number".
- **A footer link reading "GPSR Compliance" was read as having an EU
  responsible person.**

### Known limits, stated plainly

- 5 of 45 are unreachable behind bot protection (403/429/503) or slow origins.
  Not faults; recorded as `unreachable`.
- `identityConfidence` is `high` (name + address), `medium` (name from a legal
  page), or `low` (a guess off a homepage). Only high and medium reach Ornella.
- The scanner audits the seed list as a side effect: it found 5 rows that
  redirect to a different company, including a domain parked for sale.

---

## 3. The website — Sunday's job, done Saturday

**Live at https://elbebridge.com** — verified.

| Item | Status |
|---|---|
| One page, headline, three obligations, what we do, price, contact, who we are | **Done** |
| Price published (€890) | **Done** |
| Impressum | **Done** — elbebridge GbR, address, phone, both representatives |
| Privacy policy | **Done** — GDPR Art. 13, names GitHub and Google Workspace, states the US transfer honestly |
| Accessibility statement | **Done** — not required by the plan, but we sell this |
| Disclaimer on the page, not buried | **Done** |
| German version | **Done** — 8 pages total, `hreflang` paired |
| HTTPS enforced | **Live** |
| Passes our own standard | **110 automated checks, 0 failures** |

Zero JavaScript ships. No cookies, no analytics, no third-party requests —
which is why the privacy policy can say so.

**Deviation from the plan:** the plan specified a two-field form. There is no
form. GitHub Pages is static, a form needs a third-party backend and a DPA, and
a form posting nowhere is worse than none. It is a `mailto:` with the subject and
body prefilled asking for the store URL. Swappable for a real EU-hosted form in
one content change.

### Open on the website

- [ ] Founder order differs between locales — EN lists Ethan first, DE lists
      Ornella first. Pick one.
- [ ] USt-IdNr. section removed from the Impressum. Add it back when assigned.
- [ ] Verify the domain in GitHub → Settings → Pages → Verified domains, to
      prevent takeover. Five minutes.
- [ ] Decide whether elbebridge.de forwards to .com. Not urgent, and it touches
      the zone that holds your mail.

---

## 4. The findings report — done Saturday, due Tuesday

`report/`. One `scan.json` in, one three-page A4 PDF out, in about a second.

| From the plan | Status |
|---|---|
| Page 1 — summary, red/amber/green table, one sentence per finding, homepage screenshot | Done |
| Page 2 — what the law requires, what we found, the specific proof | Done, with the failing element's own HTML and its EN 301 549 clause |
| Page 3 — prioritised fixes, effort per item, fixed price | Done |
| Version number and date on every report | Done, in the masthead and the page footer |
| Disclaimer on page 1 | Done |
| Never *compliant*, *guaranteed*, *fine-proof*, *Abmahnungssicher* | Enforced — the generator throws rather than render one |
| Built from scan.json plus Ornella's LUCID result | Done; LUCID shows as *register check pending* until she searches |
| Under 15 minutes from JSON to PDF | About one second |

Every word lives in `content/report.en.json` — the legal text, the plain-English
explanation and effort estimate for 22 axe rules, the remediation catalogue and
the pricing. German is a second JSON file, not a code change.

**Judgements the report will not make.** It never says a shop is compliant, and
it never says packaging is unregistered — we cannot see the register from
outside, so that stays open until Ornella checks. Zero automated violations
shows amber rather than green when no accessibility statement is published, and
a scan that could not complete behind an overlay can never show green. It
refuses outright to generate for an unreachable domain or one that redirects to
a different company.

10 acceptance tests, run against every scan on disk.

## 5. EPR provider calls — Tuesday and Wednesday. Not started.

- [ ] Call Interzero / Lizenzero
- [ ] Call Deutsche Recycling
- [ ] Call one more for comparison
- [ ] Get in writing: a price you can quote with a known margin
- [ ] Get in writing: the document list a client must produce
- [ ] Get a named contact who will take referrals

**One correction to the plan's call list:** take-e-way is primarily WEEE and
ElektroG — electricals and batteries. Your seed list is fashion, footwear and
homeware, where packaging is the live obligation. Lead with packaging
specialists. Still worth one call to take-e-way because they are in Hamburg.

**On margin:** packaging licensing for small volumes is advertised from about
€39 a year. A prospect finds that in ten seconds. Your margin cannot come from
marking up the licence — ask for partner rates on *services*: registration work,
data assembly, representation.

---

## 6. Before outreach starts

- [x] ~~Verify the seed list~~ — the list is now 219 candidates in nine sector
      groups, and the scanner qualifies them itself: it detects whether a shop
      faces the German market and scores every row, worst-offender-first, so
      Ornella works a ranked list rather than a raw one.
- [ ] Size is still unverified — the BFSG micro-enterprise exemption (under 10
      staff **and** under €2m) is the one thing the scanner cannot see. Check it
      before quoting, not before scanning.
- [ ] Decide shared reply visibility before Monday
- [ ] **Check the rules on unsolicited B2B email (UWG § 7)** before the first
      hundred go out. The exposure runs to the sender, and being on the wrong
      side of it while selling compliance would be an expensive irony. Not legal
      advice — worth twenty minutes with a lawyer.

---

## The eight ways the weekend still disappears

From the plan, and all still true:

1. A customer portal or dashboard — you have no customers
2. A database — JSON files in folders are correct at this scale
3. A queue or worker — it is a script over a CSV
4. A nicer website — **done, stop**
5. A logo — the wordmark and arc are enough
6. Refactoring the scanner because it is ugly — it is meant to be ugly
7. Adding checks four and five before the first three have sold anything
8. Learning packaging law in depth — you need enough to ask good questions Tuesday

Add a ninth: **polishing the website further.** It is live and it passes. The
report template is worth more than every remaining pixel.

---

## Honest summary

Ahead on infrastructure, behind on product. The website is finished a day early
and to a standard that will survive a prospect looking closely. The scanner is
built and well-tested against fixtures, but has not met the real web, and that
gap is the entire risk in today's plan.

The thing that gets sold — the three-page findings report — has had no time
spent on it and is due Tuesday.

**Today: point the scanner at five real sites and read the output by hand.**
Tomorrow: the manual keyboard-and-screenreader pass on ten sites, which is where
the findings that actually convert come from, and which no tool can produce.
