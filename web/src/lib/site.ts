import { getEntry, type CollectionEntry } from 'astro:content';

export type Locale = 'en' | 'de';
export type Copy = CollectionEntry<'copy'>['data'];

export const LOCALES: Locale[] = ['en', 'de'];

/** Load the copy for one locale. Throws at build time if the file is missing. */
export async function loadCopy(locale: Locale): Promise<Copy> {
  const entry = await getEntry('copy', locale);
  if (!entry) throw new Error(`No copy file for locale "${locale}" in src/content/copy/`);
  return entry.data;
}

/** Prefix a path with the locale. English is served from the root. */
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return locale === 'en' ? clean : `/${locale}${clean === '/' ? '/' : clean}`;
}

/**
 * The same page in every language, for <link rel="alternate" hreflang>.
 * `key` is the shared identity of a page ("home", "impressum", ...), so the
 * German slug can differ from the English one without breaking the pairing.
 */
export const PAGE_SLUGS: Record<string, Record<Locale, string>> = {
  home: { en: '/', de: '/' },
  sample: { en: '/sample-report', de: '/beispielbericht' },
  impressum: { en: '/impressum', de: '/impressum' },
  privacy: { en: '/privacy', de: '/datenschutz' },
  accessibility: { en: '/accessibility', de: '/barrierefreiheit' },
};

export function alternates(key: string): { locale: Locale; href: string }[] {
  const map = PAGE_SLUGS[key];
  if (!map) return [];
  return LOCALES.map((locale) => ({ locale, href: localePath(locale, map[locale]) }));
}
