'use strict';
const P = require('./patterns');

/**
 * Check 5 — the one that feeds Ornellas' LUCID lookup. She cannot search the
 * Verpackungsregister without the legal entity name, so we pull the entity,
 * the address, and anything that disambiguates it (VAT ID, HRB number).
 * A LUCID number already on the site is the strongest possible signal that
 * the producer is registered — surface it so nobody wastes a lookup.
 */
/**
 * Normalised comparison of a company name against the brand in the domain.
 * charlietemple.nl listed "Luxottica Group S.p.A." in its terms — a supplier,
 * not the shop. When a candidate matches the domain it is almost always the
 * right one, so it wins; when none matches we keep the first plausible one,
 * because plenty of real entities look nothing like their domain
 * (bergamotte.com is Very Bloom SAS).
 */
function matchesBrand(name, brand) {
  if (!brand) return false;
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = brand.toLowerCase().replace(/[^a-z0-9]/g, '');
  return b.length >= 4 && n.includes(b);
}

function extractIdentity(text, brand) {
  const clean = String(text || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');

  // A labelled legal notice is far more reliable than pattern-matching prose,
  // so it wins outright when present.
  const labelled = extractLabelled(clean);

  // Walk candidates rather than trusting the first: the first match is often
  // platform boilerplate or a sentence that happens to end in a legal form.
  let entityM = null;
  let legalEntity = null;
  const rx = new RegExp(P.ENTITY.source, 'g');
  let m;
  while ((m = rx.exec(clean)) !== null) {
    const candidate = trimEntity(m[1]);
    if (!isPlausibleEntity(candidate, clean, m)) continue;
    if (!legalEntity) { entityM = m; legalEntity = candidate; }
    if (matchesBrand(candidate, brand)) { entityM = m; legalEntity = candidate; break; }
  }

  const vatM = clean.match(P.VAT_LABELLED);
  const regM = clean.match(P.REGISTER);
  const lucidM = clean.match(P.LUCID_ID);

  if (labelled.legalEntity) legalEntity = labelled.legalEntity;

  const address = labelled.address
    || addressNear(clean, entityM)
    || matchAddress(clean);
  return {
    legalEntity,
    address,
    vatId: vatM && P.isVatId(vatM[1]) ? vatM[1].replace(/[\s.-]/g, '').toUpperCase() : null,
    registerNumber: regM ? `${(regM[1] || 'HR').toUpperCase()} ${regM[2]}` : null,
    lucidNumberOnSite: lucidM ? lucidM[0].replace(/\s+/g, '') : null,
    // A name with no address behind it is a guess. Ornella needs to know which
    // rows are safe to search and which need a human first.
    identityConfidence: !legalEntity ? 'none' : (address ? 'high' : 'medium'),
  };
}

/** German-format address anywhere in the text (street + 5-digit PLZ + city). */
function matchAddress(clean) {
  const m = clean.match(P.ADDRESS);
  return m ? tidy(m[1]).replace(/\s*\n\s*/g, ', ') : null;
}

/** A line that reads like prose rather than part of an address block. */
function isProse(line) {
  if (line.length > 60) return true;
  if (/[("\u201c]|https?:|www\.|@/.test(line)) return true;
  if (/\b(is|are|was|were|the|our|this|website|company|operator|owner|registered|please|you|we)\b/i.test(line)) return true;
  if (/[:;]$/.test(line)) return true;
  return false;
}

/**
 * Postcode line, across the formats our prospects actually use:
 *   22049 Hamburg        DE      1015 CJ Amsterdam    NL
 *   111 34 Stockholm     SE      DK-1058 København    DK
 *   00-950 Warszawa      PL      London E1 6JJ        UK
 * The Swedish "111 34" form is why an earlier version skipped the Swedish
 * company on a page that also listed a German EU representative.
 */
const POSTCODE_ANY = new RegExp([
  '(?:^|\\s)(?:[A-Z]{1,2}-)?\\d{4,6}\\s+\\p{Lu}',   // 22049 Hamburg / DK-1058 K.
  '(?:^|\\s)\\d{3}\\s\\d{2}\\s+\\p{Lu}',          // 111 34 Stockholm
  '(?:^|\\s)\\d{2}-\\d{3}\\s+\\p{Lu}',              // 00-950 Warszawa
  '\\p{Lu}{1,2}\\d[\\dA-Z]?\\s+\\d\\p{Lu}{2}',      // E1 6JJ
].join('|'), 'u');

/**
 * The address block near an entity. Anchored on the postcode line and read
 * upwards, because reading downwards from the company name swallowed the
 * sentence in front of it. One real site produced
 *   '". The owner and operator of this website (...) is, Son of a Tailor ApS, ...'
 * as its address.
 */
function addressNear(clean, entityM) {
  if (!entityM) return null;
  const from = entityM.index + entityM[0].length;
  const window = clean.slice(from, from + 400);
  const lines = window.split('\n').map((l) => tidy(l)).filter(Boolean).slice(0, 8);

  const pcIdx = lines.findIndex((l) => POSTCODE_ANY.test(l) && !isProse(l));
  if (pcIdx < 0) return null;

  const block = [];
  for (let i = Math.max(0, pcIdx - 3); i < pcIdx; i++) {
    const line = lines[i];
    if (isProse(line)) { block.length = 0; continue; }        // discard anything before prose
    if (block.length === 0 && P.ENTITY.test(line)) continue;  // the company name repeated
    block.push(line);
  }
  block.push(lines[pcIdx]);

  if (block.length < 2) return null;
  const joined = block.join(', ');
  return /\d/.test(joined) ? joined : null;
}

/** Words that can precede a company name in prose but are not part of it. */
const ENTITY_LEAD = /^(?:our|the|this|that|a|an|by|from|contact|about|company|operator|owner|website|shop|store|brand|name|is|are|was|were|ist|sind|und|and|von|der|die|das)\s+/i;

/** Prose connectors that can only sit in front of the name, never inside it. */
const ENTITY_SPLIT = /\s(?:ist|sind|is|are|was|were|betrieben von|werden von|versandt von|erfolgt durch|operated by|owned by|durch)\s/i;

/** Capital/registration clauses that trail a name in FR/DE/IT notices. */
const ENTITY_TAIL = /\s+(?:au\s+capital|con\s+capitale|mit\s+(?:einem\s+)?stammkapital|with\s+a\s+(?:share\s+)?capital|inscrite|eingetragen|registered\s+in)\b.*$/i;

/** Short forms like AB, AS, AG, SE are ordinary words in capitalised text. */
const SHORT_FORMS = /\s(AB|AS|AG|SE|KG|NV|BV|SA|SL|OY)$/;

/** Prose words that never appear inside a company name. */
const GERMAN_PROSE = /\b(kauf|verkauf|nutzung|bereitstellung|bestimmter|bestimmte|dieser|diese|unserer|unsere|folgende|gem(ä|ae)ß|sowie|jeweils|betrieb|angebot|bestellung|lieferung)\b/i;

function isPlausibleEntity(name, text, match) {
  if (!name || name.length < 4) return false;
  if (P.PLATFORM_NAMES.test(name)) return false;          // "hosted on Shopify Inc."
  const words = name.split(/\s+/);
  if (words.length > 6) return false;                     // a sentence, not a name
  // A two-letter form must end the line or be followed by punctuation, or
  // "SANDQVIST AS SEEN IN" reads as a Norwegian company.
  if (SHORT_FORMS.test(name)) {
    // Only a continuation on the SAME line is suspicious. A newline after the
    // form is exactly what a real address block looks like.
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 3);
    if (/^[ \t]+[A-Za-zÄÖÜäöü]/.test(after)) return false;
  }
  // German prose that happens to end in a legal form: "Kauf bestimmter
  // Produkte der Limited ist ausgeschlossen."
  if (GERMAN_PROSE.test(name)) return false;
  return true;
}

/**
 * Read "Dénomination sociale : X" / "Forme juridique : Y" style notices and
 * recombine them into "X Y".
 */
function extractLabelled(clean) {
  const nameM = clean.match(P.LABEL_ENTITY);
  if (!nameM) return { legalEntity: null, address: null };
  let name = tidy(nameM[1]).replace(/[,;]$/, '');
  if (!name || name.length < 2 || P.PLATFORM_NAMES.test(name)) return { legalEntity: null, address: null };

  const formM = clean.match(P.LABEL_FORM);
  if (formM) {
    const form = tidy(formM[1]).replace(/[,;]$/, '');   // keep the dots in "S.A.S."

    // Don't duplicate a form the name already carries ("BALIBARIS SAS").
    const bare = (x) => x.replace(/[^a-z]/gi, '').toLowerCase();
    if (form && !bare(name).endsWith(bare(form))) name = `${name} ${form}`;
  }

  const addrM = clean.match(P.LABEL_ADDRESS);
  const address = addrM ? tidy(addrM[1]).replace(/[.;]$/, '') : null;
  return { legalEntity: name, address: address && /\d/.test(address) ? address : null };
}

function trimEntity(name) {
  let out = tidy(name);
  // "Betreiber der Website ist die Muster Handels GmbH" -> everything after "ist"
  const parts = out.split(ENTITY_SPLIT);
  if (parts.length > 1) out = tidy(parts[parts.length - 1]);
  out = out.replace(ENTITY_TAIL, '');
  for (let i = 0; i < 5; i++) {
    const next = out.replace(ENTITY_LEAD, '');
    if (next === out) break;
    out = next;
  }
  return tidy(out);
}

function tidy(s) {
  return String(s).replace(/[ \t]+/g, ' ').replace(/^[\s,;:•\-–]+|[\s,;:•\-–]+$/g, '').trim();
}

module.exports = { extractIdentity };
