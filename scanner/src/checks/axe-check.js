'use strict';
const AxeBuilder = require('@axe-core/playwright').default;
const cfg = require('../config');

async function runAxe(page, label) {
  const results = await new AxeBuilder({ page }).withTags(cfg.axeTags).analyze();
  return { label, url: page.url(), results };
}

/** Flatten one or more axe passes into the numbers the report needs. */
function summarise(passes) {
  const byRule = new Map();
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let total = 0;

  for (const p of passes) {
    for (const v of p.results.violations) {
      const n = v.nodes.length;
      total += n;
      if (counts[v.impact] !== undefined) counts[v.impact] += n;
      const prev = byRule.get(v.id) || {
        id: v.id, impact: v.impact, help: v.help, description: v.description,
        helpUrl: v.helpUrl, wcag: (v.tags || []).filter((t) => /^wcag\d|^EN-/.test(t)),
        count: 0, pages: new Set(), sample: null,
      };
      prev.count += n;
      prev.pages.add(p.label);
      if (!prev.sample && v.nodes[0]) {
        prev.sample = {
          target: v.nodes[0].target.join(' '),
          html: (v.nodes[0].html || '').slice(0, 400),
          failureSummary: (v.nodes[0].failureSummary || '').slice(0, 400),
          page: p.label,
        };
      }
      byRule.set(v.id, prev);
    }
  }

  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const top = [...byRule.values()]
    .map((r) => ({ ...r, pages: [...r.pages] }))
    .sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || b.count - a.count)
    .slice(0, 10);

  return {
    axeTotal: total,
    axeCritical: counts.critical,
    axeSerious: counts.serious,
    axeModerate: counts.moderate,
    axeMinor: counts.minor,
    top10Rules: top,
    pagesScanned: passes.map((p) => ({ label: p.label, url: p.url })),
    axeVersion: passes[0] ? passes[0].results.testEngine.version : null,
    ruleSet: cfg.axeTags,
  };
}

module.exports = { runAxe, summarise };
