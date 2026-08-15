'use strict';
const P = require('./patterns');

/**
 * Check 5 — the one that feeds Ornellas' LUCID lookup. She cannot search the
 * Verpackungsregister without the legal entity name, so we pull the entity,
 * the address, and anything that disambiguates it (VAT ID, HRB number).
 * A LUCID number already on the site is the strongest possible signal that
 * the producer is registered — surface it so nobody wastes a lookup.
 */
function extractIdentity(text) {
  const clean = String(text || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');

  const entityM = clean.match(P.ENTITY);
  const legalEntity = entityM ? tidy(entityM[1]) : null;

  const vatM = clean.match(P.VAT_LABELLED);
  const regM = clean.match(P.REGISTER);
  const lucidM = clean.match(P.LUCID_ID);

  return {
    legalEntity,
    address: addressNear(clean, entityM) || matchAddress(clean),
    vatId: vatM ? vatM[1].replace(/\s+/g, '') : null,
    registerNumber: regM ? `${(regM[1] || 'HR').toUpperCase()} ${regM[2]}` : null,
    lucidNumberOnSite: lucidM ? lucidM[0].replace(/\s+/g, '') : null,
  };
}

/** German-format address anywhere in the text (street + 5-digit PLZ + city). */
function matchAddress(clean) {
  const m = clean.match(P.ADDRESS);
  return m ? tidy(m[1]).replace(/\s*\n\s*/g, ', ') : null;
}

/**
 * Address block immediately after the legal entity — works for non-German
 * producers whose postcode format the German regex will never match.
 */
function addressNear(clean, entityM) {
  if (!entityM) return null;
  const after = clean.slice(entityM.index + entityM[0].length, entityM.index + entityM[0].length + 400);
  const lines = after.split('\n').map((l) => tidy(l)).filter(Boolean);
  const block = [];
  for (const line of lines.slice(0, 6)) {
    if (/^(tel|telefon|phone|fax|e-?mail|mail|web|www|ust|vat|mwst|handelsregister|hrb|hra|gesch(ä|ae)ftsf|vertreten|registergericht|inhaber)\b/i.test(line)) break;
    if (line.length > 90) break;
    block.push(line);
    if (/\d{4,6}\s+\p{Lu}/u.test(line) || /\p{Lu}{1,2}\d[\dA-Z ]{2,6}\s/u.test(line)) break; // postcode line ends it
  }
  if (block.length < 2) return null;
  const joined = block.join(', ');
  return /\d/.test(joined) ? joined : null;
}

function tidy(s) {
  return String(s).replace(/[ \t]+/g, ' ').replace(/^[\s,;:•\-–]+|[\s,;:•\-–]+$/g, '').trim();
}

module.exports = { extractIdentity };
