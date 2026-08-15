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
    return { rules: parse(await res.text(), userAgentToken), fetched: true, status: res.status };
  } catch (e) {
    return { rules: [], fetched: false, error: String(e.message || e) };
  } finally { clearTimeout(timer); }
}

function parse(body, uaToken) {
  const groups = [];
  let current = null;
  for (const raw of body.split(/\r?\n/)) {
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
  const exact = groups.filter((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const star = groups.filter((g) => g.agents.includes('*'));
  return (exact.length ? exact : star).flatMap((g) => g.rules);
}

function isAllowed(rules, pathname) {
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue;               // empty Disallow means allow all
    if (!matches(r.path, pathname)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

function matches(pattern, pathname) {
  const anchored = pattern.endsWith('$');
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const rx = new RegExp('^' + p.split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return rx.test(pathname);
}

module.exports = { fetchRobots, isAllowed };
