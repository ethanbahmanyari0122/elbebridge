// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://elbebridge.com',

  // English at /, German at /de/. Adding a third language means adding a
  // locale here and one JSON file — no component ever changes.
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de'],
    routing: { prefixDefaultLocale: false },
  },

  integrations: [sitemap({ i18n: { defaultLocale: 'en', locales: { en: 'en', de: 'de' } } })],

  // Static output. No server, no client router, nothing to break for a
  // screen reader on navigation.
  output: 'static',

  build: { inlineStylesheets: 'auto' },

  compressHTML: true,
});
