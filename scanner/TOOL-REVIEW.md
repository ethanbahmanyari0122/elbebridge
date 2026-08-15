# Tool review — checked against the August 2026 landscape

You asked me to make sure every tool in the plan is the right choice before
building. Verdict: the stack is right, the rule set was wrong, and two of the
choices further down the plan are worth changing.

## Keep — Playwright + @axe-core/playwright

Correct, and correct for the reason the plan gives. As of 2026 axe-core inside
an existing browser-automation framework is the default for teams already
running Playwright, and axe has a higher detection rate than Pa11y. Pa11y 9.1
ships axe-core under the hood anyway, so choosing it would mean the same engine
with a CLI wrapper you'd have to fight. Lighthouse is fine for a smoke test and
misleading for compliance — its accessibility score is a weighted average, not a
pass/fail against a standard.

Installed and verified: axe-core 4.13.0.

The plan's instruction not to evaluate alternatives was the right call. I did
anyway, because you asked, and it came out where you did.

## Change — the rule set

The plan doesn't say which rules to run, and the default is WCAG 2.0/2.1 A+AA.
That's a miss. BFSG conformity is assessed against **EN 301 549**, which
references WCAG 2.1 AA — but ISO/IEC 40500:2025 codified WCAG 2.2 in January
2026 and most German programmes are now planning against 2.2 to avoid a second
remediation cycle.

The scanner runs `['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','EN-301-549']`.

The payoff is bigger than the extra rules: axe tags each violation with its
EN clause, so `top10Rules[].wcag` comes back as `["wcag2a","wcag111","EN-301-549","EN-9.1.1.1"]`.
Page 2 of the report needs "what the law requires" next to "what we found" — that
mapping is now free, rather than a lookup table you'd hand-maintain.

## Change — don't use Playwright for the report PDF

The plan says HTML template plus Playwright's PDF export, on the grounds that
you already have Playwright. Reasonable, and I'd still start there Monday, but
know the trade: 2026 benchmarks put Playwright at ~13ms per render warm against
WeasyPrint's ~629ms, while WeasyPrint produces files roughly six times smaller
(21KB vs 125KB on a complex document) and gives far better control over
print-specific CSS — page breaks, running headers, margin boxes.

For a three-page fixed-layout document you email to prospects, file size and
print fidelity matter more than render latency you will never notice at one
report per prospect. But WeasyPrint is a second toolchain to learn on a Monday.

**Recommendation:** build it with Playwright PDF on Monday as planned. If page
breaks fight you for more than an hour, switch — don't spend the afternoon on
CSS `break-inside`. Either way the template is plain HTML, so the switch is
cheap. Do not introduce a template engine or a reporting library; that part of
the plan is right.

## Confirm — the timing is better than the plan assumes

Worth knowing before Ornellas' calls, because it changes the pitch from "this is
coming" to "this is happening":

- The BFSG has been in force since 28 June 2025, and the first warnings landed
  about six weeks later.
- The market surveillance authority (MLBF) has been in an **active control
  phase since January 2026**, having adopted its surveillance strategy on
  29 January 2026. It works both reactively on complaints and proactively
  through systematic, largely automated checks.
- Reported exposure: roughly €3,500–20,000 per Abmahnung, fines up to €100,000
  for serious or repeated violations.
- In March 2026 the Commission sent Germany a reasoned opinion for incomplete
  transposition of the Accessibility Directive — so expect the German regime to
  tighten, not loosen.

"Automated market surveillance is already running, and it looks for exactly what
this scan looks for" is a stronger opening line than a deadline that has passed.

## Confirm — broker EPR, don't become the authorised representative

The plan's instinct is right and the reason is structural, not just cautious: a
manufacturer's authorised representative in Germany must be **established in
Germany**, registered in LUCID/EAR, and hold a written mandate transferring the
producer's obligations. That's a liability position, not a service line. Broker
it in year one.

One correction to the call list: **take-e-way is primarily WEEE/ElektroG**
(electricals and batteries). If your prospects are fashion, furniture and
homeware — which the seed list is — the packaging obligation is the live one and
your call list should lead with packaging specialists. Suggested revision:

1. Interzero / Lizenzero (packaging licensing plus authorised-representative
   services — the one-stop comparison)
2. Deutsche Recycling (as planned)
3. take-e-way — only if you expect electricals in the mix, and worth one call
   regardless because they're in Hamburg

Note for the pricing question: packaging licensing for genuinely small volumes
is advertised from around €39/year. That's the low anchor a prospect will find
in ten seconds of Googling, so your margin cannot come from marking up the
licence. It comes from the registration work, the data assembly and the
representation. Ask for the partner rate on *services*, not on tonnage.

## Flag — check before Ornellas starts sending

Not a tool choice, but it sits upstream of the whole funnel. Unsolicited
commercial email to businesses is restricted under German competition law
(UWG §7), and the exposure runs to the sender. You are selling compliance
services; being on the wrong side of this would be an expensive irony. Worth
twenty minutes with a lawyer before the first hundred emails go out, and worth
knowing that the answer differs depending on where the recipient sits. I'm not
a lawyer and this isn't legal advice.

## Sources

- [Accessibility Testing Tools Compared (2026) — A11yFlow](https://www.a11yflow.dev/blog/accessibility-testing-tools-compared)
- [axe vs WAVE vs Pa11y (2026) — Crosscheck](https://crosscheck.cloud/blogs/axe-vs-wave-vs-pa11y-accessibility-testing/)
- [axe-core — Deque](https://www.deque.com/axe/axe-core/)
- [axe-core rule descriptions (EN-301-549 tags)](https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md)
- [HTML to PDF benchmark 2026 — PDF4.dev](https://pdf4.dev/blog/html-to-pdf-benchmark-2026)
- [Playwright vs WeasyPrint (2026) — PDF4.dev](https://pdf4.dev/blog/playwright-vs-weasyprint)
- [BFSG 2026: Marktüberwachung in aktiver Kontrollphase](https://www.ehome-news.de/bfsg-2026-marktueberwachung-in-aktiver-kontrollphase-eu-kommission-mahnt-deutschland-zur-umsetzung/)
- [BFSG Bußgeld & Abmahnung: Was Websites 2026 droht](https://www.7aufeinenstreich.com/blog/bfsg-bussgeld-abmahnung)
- [German Accessibility Laws (BGG, BITV 2.0, BFSG) — Level Access](https://www.levelaccess.com/blog/german-accessibility-requirements/)
- [EPR Compliance in Germany, authorised representative — Interzero](https://licensing.interzero.at/en/epr-compliance-in-germany/)
- [Packaging licence fees — Lizenzero](https://www.lizenzero.de/en/packaging-licence-fees/)
