'use strict';
/**
 * Minimal robots.txt parser. Picks the group matching our UA token, else '*'.
 * Longest matching pattern wins; Allow beats Disallow at equal length (RFC 9309).
 */
async function fetchRobots(origin, userAgentToken, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      signal: ctrl.signal, headers: { 'user-agent': userAgentToken }, redirect: 'follow',
    });
    if (!res.ok) return { rules: [], fetched: false, status: res.status };
    const body = await res.text();
    const parsed = parse(body, userAgentToken);
    return {
      rules: parsed.rules,
      matchedAgents: parsed.matchedAgents,
      groupCount: parsed.groupCount,
      raw: body.slice(0, 4000),      // kept so a wrong skip can be diagnosed
      fetched: true,
      status: res.status,
      finalUrl: res.url,
    };
  } catch (e) {
    return { rules: [], fetched: false, error: String(e.message || e) };
  } finally { clearTimeout(timer); }
}

function parse(body, uaToken) {
  const groups = [];
  let current = null;
  // Shopify serves robots.txt with bare CR between the Disallow lines and CRLF
  // only at group boundaries. Splitting on /\r?\n/ collapsed forty rules into
  // one and merged every user-agent group into a single group — so a
  // "Disallow: /" meant for Nutch was applied to us, and we skipped a live
  // prospect. RFC 9309 permits CR, LF or CRLF.
  for (const raw of body.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!current || current.closed) { current = { agents: [], rules: [], closed: false }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' || field === 'allow') {
      if (!current) continue;
      current.closed = true;
      current.rules.push({ allow: field === 'allow', path: value });
    }
  }
  const ua = uaToken.toLowerCase();
  // A named group only applies to us if the token in the file is a real word of
  // our user agent. Plain substring matching once made "Nutch" — a group whose
  // only rule is "Disallow: /" — look like it applied to us, and we skipped a
  // live prospect that was never blocked.
  const exact = groups.filter((g) => g.agents.some((a) => a !== '*' && matchesAgent(ua, a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  const chosen = exact.length ? exact : star;
  return {
    rules: chosen.flatMap((g) => g.rules),
    matchedAgents: chosen.flatMap((g) => g.agents),
    groupCount: groups.length,
  };
}

/**
 * RFC 9309 matches a robots user-agent token as a prefix of the crawler's
 * product token, case-insensitively — not as an arbitrary substring.
 */
function matchesAgent(ua, agentToken) {
  const a = agentToken.trim().toLowerCase();
  if (!a) return false;
  return ua === a || ua.startsWith(a);
}

function isAllowed(rules, pathname) {
  return decide(rules, pathname).allow;
}

/** Same as isAllowed, but returns which rule decided it. */
function decide(rules, pathname) {
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue;               // empty Disallow means allow all
    if (!matches(r.path, pathname)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow, rule: r };
  }
  return best ? { allow: best.allow, rule: best.rule } : { allow: true, rule: null };
}

function matches(pattern, pathname) {
  const anchored = pattern.endsWith('$');
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const rx = new RegExp('^' + p.split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return rx.test(pathname);
}

module.exports = { fetchRobots, isAllowed, decide, matchesAgent };
