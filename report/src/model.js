'use strict';
/**
 * Turns one scan.json into the view model the report renders.
 *
 * Every judgement the report makes is made here, in one place, so the wording
 * in the template can never drift from the data underneath it.
 */

/** Words we never publish. Stating a conclusion about liability is not our job. */
const BANNED = /\b(compliant|compliance guaranteed|guarantee[ds]?|fine[- ]proof|abmahnungssicher|rechtssicher|certified|we certify)\b/i;

/**
 * Ornella's register result, if she has done the lookup. Without it the report
 * says the check is pending; with it, it states what the register showed.
 */
function lucidStateFor(scan, lucid) {
  if (scan.lucidNumberOnSite) {
    return { state: 'published', number: scan.lucidNumberOnSite };
  }
  const r = lucid && lucid[scan.domain];
  if (!r || !r.lucidStatus) return { state: 'pending' };
  const st = String(r.lucidStatus).trim().toLowerCase();
  if (st === 'registered') return { state: 'registered', number: r.lucidNumber || null, checkedOn: r.checkedOn || null };
  if (st === 'not_found') return { state: 'not_found', checkedOn: r.checkedOn || null, note: r.note || null };
  return { state: 'unclear', checkedOn: r.checkedOn || null, note: r.note || null };
}

function ragFor(scan, copy, lucid) {
  const a11yFindings = (scan.axeTotal ?? 0) > 0;
  const hasStatement = scan.hasA11yStatement === true && scan.a11yStatementLooksSubstantive !== false;

  // Accessibility: red if we found failures, amber if only the statement is
  // missing, green if neither. An inconclusive scan can never be green.
  let bfsg = 'green';
  if (scan.axeReliable === false) bfsg = 'amber';
  if (a11yFindings || !hasStatement) bfsg = 'amber';
  if ((scan.axeCritical ?? 0) > 0 && !hasStatement) bfsg = 'red';
  else if ((scan.axeCritical ?? 0) > 0) bfsg = 'red';

  const gpsr = scan.hasResponsiblePerson === true ? 'green' : 'red';

  // We cannot see the register from outside, so this stays open until Ornella
  // has searched it. Once she has, the report states what she found.
  const l = lucidStateFor(scan, lucid);
  const lucidRag = l.state === 'published' || l.state === 'registered' ? 'green'
    : l.state === 'not_found' ? 'red'
      : 'unknown';

  return { bfsg, gpsr, lucid: lucidRag };
}

function sentenceFor(key, scan, copy, lucid) {
  const n = scan.axeTotal ?? 0;
  const c = scan.axeCritical ?? 0;
  if (key === 'bfsg') {
    const parts = [];
    if (n > 0) parts.push(`${n} automatically detectable failures against EN 301 549, ${c} of them critical`);
    else if (scan.axeReliable === false) parts.push('the scan could not complete because an overlay covered the page, so no count can be given');
    else parts.push('no automatically detectable failures on the pages tested');
    parts.push(scan.hasA11yStatement ? 'an accessibility statement is published' : 'no accessibility statement was found');
    return parts.join('; ') + '.';
  }
  if (key === 'gpsr') {
    return scan.hasResponsiblePerson
      ? 'A responsible person in the EU is named on the pages we checked.'
      : 'No responsible person in the EU was named on the homepage, a product page, or the legal pages we checked.';
  }
  const l = lucidStateFor(scan, lucid);
  const on = l.checkedOn ? ` on ${l.checkedOn}` : '';
  if (l.state === 'published') return `A LUCID registration number is published on the site (${l.number}).`;
  if (l.state === 'registered') return `A registration was found in the public LUCID register${on}${l.number ? ` (${l.number})` : ''}, though it is not published on the site.`;
  if (l.state === 'not_found') return `We searched the public LUCID register${on} under the legal entity above and found no registration.`;
  if (l.state === 'unclear') return `We searched the public LUCID register${on} and could not match the legal entity with confidence. This needs confirming before any conclusion is drawn.`;
  return 'No LUCID registration number is published on the site. We are searching the public register to establish the position.';
}

/** The failing rules, worst first, joined to the plain-English catalogue. */
function findings(scan, copy) {
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return (scan.top10Rules || [])
    .slice()
    .sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || b.count - a.count)
    .map((r) => {
      const known = copy.rules[r.id];
      return {
        id: r.id,
        impact: r.impact,
        count: r.count,
        title: known ? known.title : r.help,
        text: known ? known.text : r.description,
        effort: known ? known.effort : null,
        // Keep clause tags (EN-9.1.1.1) and drop the standard's own name tag
        // (EN-301-549), which rendered as the nonsense "EN 301 549 §301-549".
        clauses: (r.wcag || [])
          .filter((t) => /^EN-\d+(\.\d+)+$/.test(t))
          .map((t) => `EN 301 549 §${t.replace(/^EN-/, '')}`),
        sample: r.sample || null,
        pages: r.pages || [],
        shot: (scan.evidenceShots || []).find((s) => s.ruleId === r.id) || null,
      };
    });
}

function remediation(scan, copy, rag) {
  const out = [];
  const add = (key, extra = {}) => {
    const m = copy.remediation[key];
    if (m) out.push({ key, title: m.title, effort: m.effort, priority: m.priority, ...extra });
  };

  if ((scan.axeCritical ?? 0) > 0 || (scan.axeTotal ?? 0) > 0) {
    for (const f of findings(scan, copy).slice(0, 6)) {
      out.push({
        key: f.id,
        title: `${f.title} — ${f.count} ${f.count === 1 ? 'instance' : 'instances'}`,
        effort: f.effort || '—',
        priority: f.impact === 'critical' ? 1 : 2,
      });
    }
  }
  if (!scan.hasA11yStatement) add('a11y-statement');
  add('manual-audit');
  if (rag.gpsr === 'red') add('gpsr-details');
  if (rag.lucid === 'red') add('lucid-register');
  if (scan.hasImpressum === false) add('impressum');

  return out.sort((a, b) => a.priority - b.priority);
}

function build(scan, copy, opts = {}) {
  const lucid = opts.lucid || null;
  const rag = ragFor(scan, copy, lucid);
  const lucidState = lucidStateFor(scan, lucid);
  const model = {
    brand: opts.brand || scan.domain,
    domain: scan.domain,
    scannedAt: scan.scannedAt,
    reportDate: opts.date || new Date().toISOString().slice(0, 10),
    version: `${copy.meta.reportVersion}.${(scan.schemaVersion ?? 1)}`,
    legalEntity: scan.legalEntity || null,
    identityConfidence: scan.identityConfidence || 'none',
    address: scan.address || null,
    vatId: scan.vatId || null,
    pagesTested: (scan.pagesScanned || []).map((p) => p.url),
    ruleset: (scan.ruleSet || []).join(', '),
    axe: {
      total: scan.axeTotal ?? null,
      critical: scan.axeCritical ?? null,
      serious: scan.axeSerious ?? null,
      reliable: scan.axeReliable !== false,
    },
    rag,
    rows: ['bfsg', 'gpsr', 'lucid'].map((key) => ({
      key,
      name: copy.obligations[key].name,
      law: copy.obligations[key].law,
      requires: copy.obligations[key].requires,
      status: rag[key],
      statusLabel: copy.status[rag[key]],
      sentence: sentenceFor(key, scan, copy, lucid),
    })),
    lucidState,
    findings: findings(scan, copy),
    remediation: remediation(scan, copy, rag),
    hasHomeShot: Boolean(opts.homeShot),
    homeShot: opts.homeShot || null,
  };
  return model;
}

module.exports = { build, ragFor, findings, remediation, lucidStateFor, BANNED };
