'use strict';
const { BANNED } = require('./model');

/** Proof is evidence, not a code listing: enough to identify the element. */
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ARC = `<svg class="arc" viewBox="0 0 46 12" fill="none" aria-hidden="true">
  <path d="M2 10.2C7.6 4.4 14.6 1.5 23 1.5s15.4 2.9 21 8.7" stroke="#1350c4" stroke-width="2.6" stroke-linecap="round"/></svg>`;

function masthead(m, c, page) {
  return `<div class="masthead">
    <div><div>${ARC}</div><div class="wordmark">elbebridge</div></div>
    <div class="meta">
      <b>${esc(c.meta.product)}</b><br>
      ${esc(c.labels.prepared)}: <b>${esc(m.brand)}</b><br>
      ${esc(c.labels.date)}: ${esc(m.reportDate)} · ${esc(c.labels.version)} ${esc(m.version)}<br>
      ${esc(page)}
    </div></div>`;
}

function page1(m, c) {
  const facts = [
    [c.labels.scanned, m.domain],
    [c.labels.legalEntity, m.legalEntity ? `${m.legalEntity}${m.identityConfidence === 'medium' ? ' (to be confirmed)' : ''}` : 'Not published on the site'],
    [c.labels.pagesTested, `${m.pagesTested.length} (${m.pagesTested.map((u) => new URL(u).pathname || '/').join(', ')})`],
    [c.labels.ruleset, m.ruleset || 'WCAG 2.2 AA, EN 301 549'],
  ];
  return `<section class="page">
  ${masthead(m, c, c.labels.page1)}
  <h1>Three German obligations,<br>checked against your website</h1>
  <p class="subject">${esc(m.brand)} · scanned ${esc(String(m.scannedAt).slice(0, 10))}</p>

  <div class="facts">
    ${facts.map(([k, v]) => `<div><span>${esc(k)}:</span> <b>${esc(v)}</b></div>`).join('')}
  </div>

  <table>
    <thead><tr>
      <th>${esc(c.labels.obligation)}</th><th>${esc(c.labels.status)}</th><th>${esc(c.labels.finding)}</th>
    </tr></thead>
    <tbody>
      ${m.rows.map((r) => `<tr>
        <td class="ob"><b>${esc(r.name)}</b><span class="law">${esc(r.law)}</span></td>
        <td class="st"><span class="pill ${r.status}">${esc(r.statusLabel)}</span></td>
        <td>${esc(r.sentence)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  ${m.hasHomeShot ? `<div class="shot"><img src="${esc(m.homeShot)}" alt="">
    <div class="caption">${esc(m.domain)} homepage as tested on ${esc(String(m.scannedAt).slice(0, 10))}</div></div>` : ''}

  <div class="disclaimer"><b>Please read:</b> ${esc(c.meta.disclaimer)}</div>
</section>`;
}

function page2(m, c, opts) {
  const ob = (key) => {
    const row = m.rows.find((r) => r.key === key);
    let proof = '';
    if (key === 'bfsg') {
      // Two findings in full, the rest named compactly. Page 3 lists every one
      // with an effort estimate, so nothing is lost by not repeating it here.
      const shown = m.findings.slice(0, opts.evidenceCount);
      const rest = m.findings.slice(opts.evidenceCount);
      proof = m.findings.length
        ? shown.map((f) => `<div class="finding-row">
            <div class="count">${f.count}<small>${esc(f.impact)}</small></div>
            <div>
              <h3>${esc(f.title)}</h3>
              <p>${esc(f.text)}</p>
              ${f.clauses.length ? `<p class="clauses">${esc(f.clauses.join(' · '))}</p>` : ''}
              ${f.sample ? `<div class="proof">${esc(clip(f.sample.html || f.sample.target, 100))}</div>` : ''}
            </div></div>`).join('')
          + (rest.length ? `<p class="also">Also found: ${
              rest.map((f) => `${esc(f.title.toLowerCase())} (${f.count})`).join(', ')
            }. Every rule group is listed with an effort estimate on page 3.</p>` : '')
        : `<p>${esc(c.labels.noEvidence)}</p>`;
    } else if (key === 'gpsr') {
      proof = `<div class="proof">${esc(row.status === 'green'
        ? 'Found on: ' + (m.rows.find((r) => r.key === 'gpsr').sentence)
        : 'Searched the homepage, a product page and the legal pages for "responsible person", "verantwortliche Person", "EU representative" and "authorised representative". No match.')}</div>`;
    } else {
      const l = m.lucidState || { state: 'pending' };
      const who = m.legalEntity ? `"${m.legalEntity}"` : 'the legal entity above';
      const proofText = l.state === 'published'
        ? `LUCID number published on the site: ${l.number}`
        : l.state === 'registered'
          ? `Public Verpackungsregister searched${l.checkedOn ? ` on ${l.checkedOn}` : ''} under ${who}: registration found${l.number ? `, ${l.number}` : ''}.`
          : l.state === 'not_found'
            ? `Public Verpackungsregister searched${l.checkedOn ? ` on ${l.checkedOn}` : ''} under ${who}: no registration returned.${l.note ? ` ${l.note}` : ''}`
            : l.state === 'unclear'
              ? `Public Verpackungsregister searched${l.checkedOn ? ` on ${l.checkedOn}` : ''} under ${who}: no confident match.${l.note ? ` ${l.note}` : ''}`
              : 'No LUCID registration number published on the site. The public Verpackungsregister search is confirmed separately.';
      proof = `<div class="proof">${esc(proofText)}</div>`;
    }
    return `<div class="ob-block">
      <h3>${esc(row.name)} <span class="pill ${row.status}">${esc(row.statusLabel)}</span></h3>
      <dl class="kv">
        <dt>${esc(c.labels.requires)}</dt><dd>${esc(row.requires)}</dd>
        <dt>${esc(c.labels.found)}</dt><dd>${esc(row.sentence)}</dd>
        <dt>${esc(c.labels.proof)}</dt><dd>${proof}</dd>
      </dl></div>`;
  };
  return `<section class="page">
  ${masthead(m, c, c.labels.page2)}
  <h2>${esc(c.labels.page2)}</h2>
  ${['bfsg', 'gpsr', 'lucid'].map(ob).join('')}
  <div class="note">${esc(c.meta.methodNote)}</div>
</section>`;
}

function page3(m, c) {
  const p = c.pricing;
  return `<section class="page">
  ${masthead(m, c, c.labels.page3)}
  <h2>${esc(c.labels.page3)}</h2>
  <table>
    <thead><tr>
      <th>${esc(c.labels.priority)}</th><th>${esc(c.labels.item)}</th><th>${esc(c.labels.effort)}</th>
    </tr></thead>
    <tbody>
      ${m.remediation.map((r) => `<tr>
        <td class="pri"><span class="prio prio-${r.priority}">${r.priority === 1 ? 'First' : 'Then'}</span></td>
        <td>${esc(r.title)}</td>
        <td class="eff">${esc(r.effort)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="price">
    <table><tbody>
      <tr><td>${esc(p.checkLine)}</td><td>${esc(p.checkPrice)}</td></tr>
      <tr><td>${esc(p.remediationLine)}</td><td>—</td></tr>
      <tr><td>${esc(p.monitoringLine)}</td><td>${esc(p.monitoringPrice)}</td></tr>
    </tbody></table>
    <p class="cta">${esc(p.cta)}</p>
  </div>

  <div class="disclaimer">${esc(c.meta.vendorLine)}<br>${esc(c.meta.disclaimer)}</div>
</section>`;
}

function render(m, c, opts = {}) {
  opts = { evidenceCount: 2, ...opts };
  const html = `<!DOCTYPE html><html lang="${esc(c.locale)}"><head><meta charset="utf-8">
<title>${esc(c.meta.product)} — ${esc(m.brand)}</title>
<link rel="stylesheet" href="report.css"></head><body>
${page1(m, c)}${page2(m, c, opts)}${page3(m, c)}
</body></html>`;

  // A report that says "compliant" or "guaranteed" is a report we cannot stand
  // behind. Fail loudly rather than publish it.
  const text = html.replace(/<[^>]+>/g, ' ');
  const hit = text.match(BANNED);
  if (hit) throw new Error(`Refusing to render: banned word "${hit[0]}" reached the report`);
  return html;
}

module.exports = { render, esc };
