'use strict';
// Central regex home. Every check reads from here so the report and the scanner
// can never drift apart on what "found" means.

const A11Y_STATEMENT = /barrierefrei|barrierefreiheit|accessibility[\s-]*statement|erkl(ä|ae)rung\s+zur\s+barrierefreiheit|accessibility/i;
const IMPRESSUM      = /impressum|imprint|legal[\s-]*notice|mentions?[\s-]*l(é|e)gales|anbieterkennzeichnung/i;
const RESPONSIBLE    = /responsible\s+person|verantwortliche[rs]?\s+person|EU[\s-]*(representative|rep\b)|EU[\s-]*Verantwortliche[rs]?|bevollm(ä|ae)chtigte[rn]?|authoris?zed\s+representative|GPSR/i;
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
const ENTITY = new RegExp(
  '([A-ZÄÖÜ][\\wÄÖÜäöüß&.\\-\'’]*(?:[ \\t]+[\\wÄÖÜäöüß&.\\-\'’]+){0,6}?[ \\t]+(?:' + LEGAL_FORMS.join('|') + '))(?![\\w])'
);

// German postal address: "10115 Berlin" preceded by a street line.
const ADDRESS = /((?:[A-ZÄÖÜ][^\n,;]{2,60}?\s+\d+[a-zA-Z]?)\s*[,\n]\s*(?:D-|DE-)?\d{5}\s+[A-ZÄÖÜ][^\n,;]{1,40})/;
const VAT     = /\b(DE\s?\d{9}|[A-Z]{2}\s?[A-Z0-9]{8,12})\b(?=[^\n]{0,40}(?:USt|VAT|MwSt|Umsatzsteuer)|)/;
const VAT_LABELLED = /(?:USt[\s.-]*IdNr|Umsatzsteuer[\s-]*Identifikationsnummer|VAT[\s-]*(?:ID|number)|MwSt[\s.-]*Nr)[^\wA-Z]{0,20}([A-Z]{2}\s?[A-Z0-9]{8,12})/i;
const REGISTER = /(?:HRB|HRA|Handelsregister[^\n]{0,30}?)\s*[:\-]?\s*(HRB|HRA)?\s*(\d{3,7})/i;
const LUCID_ID = /\bDE\s?\d{13}\b/;

module.exports = {
  A11Y_STATEMENT, IMPRESSUM, RESPONSIBLE, PRIVACY, PRODUCTISH,
  ENTITY, ADDRESS, VAT_LABELLED, REGISTER, LUCID_ID,
};
