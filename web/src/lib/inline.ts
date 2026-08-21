/**
 * A deliberately tiny inline formatter for content strings.
 *
 * Content is escaped first, then a fixed set of patterns is re-introduced.
 * Nothing an author writes can inject markup, and there is no Markdown
 * dependency to keep current.
 *
 *   [label](https://example.com)  → link (https:, mailto:, tel:, / and # only)
 *   **bold**                      → <strong>
 *   _italic_                      → <em>
 *   {de|Wort}                     → <span lang="de">Wort</span>
 *   ==word==                      → <span class="accent">word</span>
 *
 * A blank line separates paragraphs. Use paragraphs() to split, then inline()
 * on each piece — see below.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

const SAFE_HREF = /^(https:\/\/|mailto:|tel:|\/|#)/;

export function inline(text: string): string {
  let out = escapeHtml(text);

  // [label](href) — href was escaped above, so compare against the escaped form
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
    const clean = href.replace(/&amp;/g, '&');
    if (!SAFE_HREF.test(clean)) return whole;
    return `<a href="${escapeHtml(clean)}">${label}</a>`;
  });

  // `code` — a user agent string, a robots.txt line. Applied before the
  // emphasis rules below, so an underscore inside a code span is not read as
  // the start of an italic.
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');

  // {de|Wort} — inline language change, required by WCAG 3.1.2
  out = out.replace(/\{([a-z]{2}(?:-[A-Z]{2})?)\|([^}]+)\}/g, '<span lang="$1">$2</span>');

  // ==highlight== — the accent word in the headline stays in the content file
  // rather than being hard-coded into a component.
  out = out.replace(/==([^=]+)==/g, '<span class="accent">$1</span>');

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])_([^_]+)_/g, '$1<em>$2</em>');

  return out;
}

/**
 * Split a content string into paragraphs on blank lines.
 *
 * Copy is authored as one string per idea, but some of those ideas need two
 * paragraphs — a statement and then its consequence. Rendering them as one
 * block ran the two together; rendering \n as <br> would have faked a
 * paragraph without being one, which a screen reader reads straight through.
 */
export function paragraphs(text: string): string[] {
  return String(text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}
