import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Every word on this site lives in src/content/copy/<locale>.json and is
 * validated against the schema below at build time. Components render this
 * data and contain no copy of their own — change the JSON, the site changes.
 * Miss a required field and the build fails rather than shipping a blank.
 */

// Inline formatting allowed inside any `text` field, handled by src/lib/inline.ts:
//   [label](https://example.com)   link — https:, mailto:, tel:, / or # only
//   **bold**  _italic_
//   ==word==                       accent-coloured span
//   {de|Wort}                      inline language change (WCAG 3.1.2)
const richText = z.string().min(1);

/** Icons available in src/components/Icon.astro. Anything else fails the build. */
const iconName = z.enum([
  'accessibility', 'person', 'box', 'search', 'document', 'wrench',
  'chart', 'shield', 'check', 'arrow-right', 'globe', 'mail', 'linkedin',
  'shirt', 'shoe', 'bottle', 'lock', 'pin',
]);

const block = z.discriminatedUnion('type', [
  z.object({ type: z.literal('p'), text: richText }),
  z.object({ type: z.literal('ul'), items: z.array(richText).min(1) }),
  z.object({ type: z.literal('ol'), items: z.array(richText).min(1) }),
  z.object({ type: z.literal('dl'), items: z.array(z.object({ term: richText, desc: richText })).min(1) }),
  z.object({ type: z.literal('address'), lines: z.array(richText).min(1) }),
]);

const section = z.object({
  heading: richText,
  blocks: z.array(block).min(1),
});

const legalPage = z.object({
  /** Shared identity across locales, so /privacy and /datenschutz can be paired. */
  key: z.enum(['impressum', 'privacy', 'accessibility']),
  slug: z.string(),
  lang: z.enum(['en', 'de']).optional(),   // page language if it differs from the locale
  title: richText,
  metaDescription: z.string().min(20).max(300),
  intro: richText.optional(),
  sections: z.array(section).min(1),
});

const copy = defineCollection({
  // One JSON file per locale. The filename is the entry id, so en.json is
  // reachable as getEntry('copy', 'en'). Adding a language = adding a file.
  loader: glob({ pattern: '*.json', base: './src/content/copy' }),
  schema: z.object({
    locale: z.enum(['en', 'de']),
    localeName: z.string(),
    htmlLang: z.string(),

    ui: z.object({
      skipToContent: z.string(),
      primaryNavLabel: z.string(),
      legalNavLabel: z.string(),
      languageNavLabel: z.string(),
      switchTo: z.string(),
      home: z.string(),
    }),

    site: z.object({
      wordmark: z.string(),
      logotype: z.string(),
      eyebrow: z.string(),
      title: richText,
      metaDescription: z.string().min(20).max(300),
      email: z.string().email(),
      /** Sits beside the wordmark in the header. */
      tagline: z.string(),
      social: z.array(z.object({
        label: z.string(),          // real accessible name — icons are decorative
        href: z.string(),
        icon: iconName,
      })).default([]),
    }),

    home: z.object({
      headline: richText,
      lede: richText,
      heroCta: z.string(),
      trust: z.array(z.string()).min(1),
      journeyEnd: richText,
      /**
       * Optional illustrated hero. Shown on wide screens only; the linked
       * checkpoint list below is what renders on a phone, and what renders
       * everywhere if no image is set. Labels are baked into the artwork, so a
       * locale without its own version simply gets the live list.
       */
      heroImage: z.object({
        src: z.string(),
        width: z.number(),
        height: z.number(),
      }).optional(),
      obligationsHeading: richText,
      obligations: z.array(z.object({
        icon: iconName,
        heading: richText,
        short: z.string(),          // compact label for the hero visual
        code: z.string(),           // BFSG / GPSR / LUCID
        law: richText,
        text: richText,
      })).min(1),
      whatWeDoHeading: richText,
      steps: z.array(z.object({ icon: iconName, lead: richText, text: richText })).min(1),
      priceHeading: richText,
      priceAmount: z.string(),
      priceLines: z.array(richText).min(1),
      /**
       * No form. GitHub Pages is static, so a form needs a third-party backend,
       * and a broken form is worse than none. A mailto keeps the promise made
       * in the privacy policy: no third party between the visitor and us.
       * To switch to a real form later, see README → "The enquiry route".
       */
      contact: z.object({
        heading: richText,
        intro: richText,
        buttonLabel: z.string(),
        mailSubject: z.string(),
        mailBody: z.string(),
        note: richText,
      }),
      /** Answers the objection Ornella flagged: "why not just use AI?" */
      comparison: z.object({
        heading: richText,
        intro: richText,
        colUs: z.string(),
        colAi: z.string(),
        // Spoken alternatives for the tick and the dash. A symbol on its own
        // fails WCAG 1.4.1, and we are not shipping that on a page that sells
        // accessibility.
        yes: z.string(),
        no: z.string(),
        rows: z.array(z.object({
          factor: richText,
          us: z.boolean(),
          ai: z.boolean(),
        })).min(1),
      }),
      peopleHeading: richText,
      peopleNote: richText,
      disclaimer: richText,
      formDisclaimer: richText,
    }),

    nav: z.object({
      cta: z.object({ href: z.string(), label: z.string() }),
      primary: z.array(z.object({ href: z.string(), label: z.string() })),
      legal: z.array(z.object({ href: z.string(), label: z.string(), lang: z.string().optional() })),
    }),

    /**
     * The footer is entirely data. Add a column here when the pages behind it
     * exist — the design has room for more than we can honestly link to today,
     * and a footer full of dead links is worse than a short one.
     */
    footer: z.object({
      blurb: richText,
      location: z.string(),
      columns: z.array(z.object({
        heading: z.string(),
        links: z.array(z.object({ href: z.string(), label: z.string(), lang: z.string().optional() })).min(1),
      })).min(1),
      contact: z.object({
        heading: z.string(),
        text: richText,
        responseNote: z.string(),
      }),
      /** The thin row under the footer divider. */
      bar: z.object({
        icon: iconName,
        disclaimer: z.string(),
        privacyNote: z.string(),
      }),
      copyright: richText,
    }),

    legal: z.array(legalPage).min(1),
  }),
});

export const collections = { copy };
