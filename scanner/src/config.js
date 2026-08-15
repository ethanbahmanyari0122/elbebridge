'use strict';
module.exports = {
  // Identifiable UA with a contact URL — non-negotiable for "researcher, not scraper".
  contactUrl: process.env.SCAN_CONTACT_URL || 'https://elbebridge.com/scanner',
  uaToken: 'ElbeBridgeComplianceBot',
  get userAgent() {
    return `Mozilla/5.0 (compatible; ${this.uaToken}/1.0; +${this.contactUrl})`;
  },

  // Politeness
  minGapMsPerHost: 1000,     // 1 request/second per host, hard floor
  domainConcurrency: 3,      // different hosts in parallel; each still 1 req/s

  // Timeouts (ms)
  navTimeout: 30000,
  axeTimeout: 60000,
  domainBudget: 120000,      // hard ceiling per domain; exceeded => status "timeout"

  viewport: { width: 1366, height: 900 },
  locale: 'de-DE',
  timezone: 'Europe/Berlin',

  // Which rule set to test against. EN 301 549 is the standard the BFSG is
  // assessed against; it references WCAG 2.1 AA, but ISO/IEC 40500:2025 codified
  // WCAG 2.2, so we scan 2.2 AA to avoid a second remediation cycle for clients.
  axeTags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'EN-301-549'],

  maxEvidenceShots: 3,       // element screenshots of worst violations, for report p.2

  /**
   * Where to start for a given domain. Overridable ONLY via SCAN_TEST_ORIGINS
   * (a JSON map of domain -> origin) so the fixture suite can point at
   * localhost. Unset in every real run.
   */
  originFor(domain) {
    const raw = process.env.SCAN_TEST_ORIGINS;
    if (raw) {
      try {
        const map = JSON.parse(raw);
        if (map[domain]) return map[domain];
      } catch { /* ignore malformed override */ }
    }
    return `https://${domain}`;
  },
};
