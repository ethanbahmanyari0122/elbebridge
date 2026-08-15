# docs

`elbebridge-how-we-work.pdf` — the handbook for the two of us. Written for
Ornella, so no development or tooling terms are used without explaining them,
and every spreadsheet column she touches is spelled out.

Six pages: what we sell, who does what, the week, her two jobs step by step,
what we never say, the two rules, and a glossary.

To regenerate after editing `workflow.html`:

```bash
node docs/build.js
```

Borrows Playwright from `../scanner/node_modules`, so run `npm install` in
`scanner/` first.

`WORKFLOW.md` at the repo root is the same material for Ethan — shorter, with
the commands in it. This PDF is the shareable version.
