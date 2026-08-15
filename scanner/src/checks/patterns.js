'use strict';
// Central regex home. Every check reads from here so the report and the scanner
// can never drift apart on what "found" means.

const A11Y_STATEMENT = /barrierefrei|barrierefreiheit|accessibility[\s-]*statement|erkl(ä|ae)rung\s+zur\s+barrierefreiheit|accessibility/i;
const IMPRESSUM      = /impressum|imprint|legal[\s-]*notice|mentions?[\s-]*l(é|e)gales|anbieterkennzeichnung/i;

// Where a foreign shop hides its company details when it has no Impressum.
// Ornella cannot search LUCID without a legal entity name, so a null here
// costs a prospect. Ordered by how likely the page is to name the entity.
const IDENTITY_FALLBACK = /terms[\s-]*(and|&|of)?[\s-]*(conditions|service|use|sale)?|allgemeine[\s-]*gesch(ä|ae)ftsbedingungen|\bagb\b|legal|about[\s-]*us|(ü|ue)ber[\s-]*uns|contact|kontakt|privacy|datenschutz|policies/i;
// A bare "GPSR" matched the words in a footer link ("GPSR Compliance") and
// reported a shop as having a responsible person when all it had was a page
// title. Require an actual designation.
const RESPONSIBLE    = /responsible\s+person|verantwortliche[rs]?\s+person|EU[\s-]*(representative|rep\b)|EU[\s-]*Verantwortliche[rs]?|bevollm(ä|ae)chtigte[rn]?|authoris?zed\s+representative|GPSR[\s-]*(?:responsible|representative|contact|verantwortliche)/i;
const PRIVACY        = /datenschutz|privacy[\s-]*(policy|notice)/i;
const PRODUCTISH     = /\/(produkt|product|shop|store|collections?|katalog|catalog|p|artikel)\//i;

// German legal forms, longest-first so "GmbH & Co. KG" wins over "GmbH".
const LEGAL_FORMS = [
  'GmbH & Co\\. ?KG', 'GmbH & Co\\. ?KGaA', 'AG & Co\\. ?KG', 'UG \\(haftungsbeschr(ä|ae)nkt\\)',
  'gGmbH', 'GmbH', 'mbH', 'AG', 'KGaA', 'OHG', 'KG', 'e\\.K\\.', 'e\\.V\\.', 'SE',
  'B\\.V\\.', 'N\\.V\\.', 'S\\.L\\.U?\\.', 'S\\.A\\.S?\\.', 'S\\.r\\.l\\.', 'S\\.p\\.A\\.',
  'SARL', 'SAS', 'SASU', 'Ltd\\.?', 'Limited', 'LLC', 'Inc\\.?', 'PLC', 'ApS', 'A/S',
  'AB', 'Oy', 'AS', 'Sp\\. ?z ?o\\.o\\.', 's\\.r\\.o\\.', 'd\\.o\\.o\\.', 'Kft\\.', 'Lda\\.',
];
/**
 * Platform and payment boilerplate that ends in a legal form and is therefore
 * a perfect decoy. "This store is hosted on Shopify Inc." was extracted as the
 * legal entity for two real shops.
 */
const PLATFORM_NAMES = /\b(shopify|wix|squarespace|bigcommerce|woocommerce|magento|adobe|klarna|paypal|stripe|klaviyo|mailchimp|trustpilot|google|meta platforms|facebook|amazon|cloudflare|centra|salesforce)\b/i;

/**
 * French, Italian and Spanish legal notices put the name and the legal form on
 * separate labelled lines:
 *     Dénomination sociale : BALIBARIS
 *     Forme juridique : S.A.S.
 * The adjacency pattern below can never match that, and on such a page the
 * first thing that *did* match was the hosting provider further down the page.
 */
const LABEL_ENTITY = /(?:d[ée]nomination\s+sociale|raison\s+sociale|firmenname|firmierung|company\s+name|denominazione(?:\s+sociale)?|ragione\s+sociale|raz[óo]n\s+social|bedrijfsnaam)\s*[:：\-–]\s*([^\n]{2,70})/i;
const LABEL_FORM = /(?:forme\s+juridique|rechtsform|legal\s+form|forma\s+jur[íi]dica|forma\s+giuridica)\s*[:：\-–]\s*([^\n]{2,30})/i;
const LABEL_ADDRESS = /(?:adresse\s+du\s+si[èe]ge\s+social|si[èe]ge\s+social|sede\s+legale|domicilio\s+social|anschrift|adresse)\s*[:：\-–]\s*([^\n]{5,120})/i;

const ENTITY = new RegExp(
  '([A-ZÄÖÜ][\\wÄÖÜäöüß&.\\-\'’]*(?:[ \\t]+[\\wÄÖÜäöüß&.\\-\'’]+){0,6}?[ \\t]+(?:' + LEGAL_FORMS.join('|') + '))(?![\\w])'
);

// German postal address: "10115 Berlin" preceded by a street line.
const ADDRESS = /((?:[A-ZÄÖÜ][^\n,;]{2,60}?\s+\d+[a-zA-Z]?)\s*[,\n]\s*(?:D-|DE-)?\d{5}\s+[A-ZÄÖÜ][^\n,;]{1,40})/;
const VAT     = /\b(DE\s?\d{9}|[A-Z]{2}\s?[A-Z0-9]{8,12})\b(?=[^\n]{0,40}(?:USt|VAT|MwSt|Umsatzsteuer)|)/;
// The label is matched case-insensitively but the number is NOT: with /i the
// capture group happily matched "entification" out of the phrase "VAT
// identification number", and that shipped as a company's VAT ID.
// Candidates are validated by isVatId() below.
const VAT_LABELLED = /(?:USt[\s.-]*IdNr\.?|Umsatzsteuer[\s-]*Identifikationsnummer|VAT(?:[\s.-]+(?:id\w*|no\.?|nr\.?|reg\w*))?(?:[\s.-]+(?:number|nummer|no\.?))?|MwSt[\s.-]*Nr\.?|(?:num[ée]ro\s+de\s+)?TVA(?:\s+intracommunautaire)?|P\.?\s?IVA|partita\s+IVA|CVR(?:[\s.-]*(?:nr\.?|number))?|Org(?:anisation)?[\s.-]*(?:nr\.?|number))[^A-Za-z0-9]{0,20}((?:[A-Z]{2}[ \t.-]?)?[0-9][0-9A-Z \t.-]{5,13}[0-9A-Z])/i;

/** EU/EEA plus the UK and Switzerland — the countries our prospects sell from. */
const VAT_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','EL','ES','FI','FR','GR','HR','HU',
  'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK','GB','XI','CH','NO','IS','LI',
]);

/** A candidate is a VAT ID only if it looks like one, not merely nearby. */
function isVatId(raw) {
  const v = String(raw || '').replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[A-Z]{0,2}[0-9A-Z]{6,14}$/.test(v)) return false;
  const digits = (v.match(/\d/g) || []).length;
  if (digits < 6) return false;                       // "ENTIFICATION" has none
  const cc = v.slice(0, 2);
  if (/^[A-Z]{2}$/.test(cc)) return VAT_COUNTRIES.has(cc);
  return /^\d/.test(v);                               // bare national number, e.g. a Danish CVR
}
const REGISTER = /(?:HRB|HRA|Handelsregister[^\n]{0,30}?)\s*[:\-]?\s*(HRB|HRA)?\s*(\d{3,7})/i;
const LUCID_ID = /\bDE\s?\d{13}\b/;

module.exports = {
  isVatId, PLATFORM_NAMES, LABEL_ENTITY, LABEL_FORM, LABEL_ADDRESS,
  A11Y_STATEMENT, IMPRESSUM, IDENTITY_FALLBACK, RESPONSIBLE, PRIVACY, PRODUCTISH,
  ENTITY, ADDRESS, VAT_LABELLED, REGISTER, LUCID_ID,
};
