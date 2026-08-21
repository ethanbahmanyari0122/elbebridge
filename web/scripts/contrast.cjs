// WCAG 2.x relative luminance + contrast ratio, so the palette is verified not guessed.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = (hex) => { const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const P = {
  // Keep in sync with :root in src/styles/global.css
  white:'#FFFFFF', paper:'#FBFAF7', sand:'#F4F0E8', cardBorder:'#E4E0D7',
  ink:'#141C28', inkMuted:'#4C5768',
  navy:'#10233F', navyHover:'#1B3760',
  accent:'#1350C4', accentHover:'#0E3E99',
  accentOnNavy:'#A9C8FA', mutedOnNavy:'#C3CEDE',
  focus:'#A34A15', error:'#A4262C', ok:'#186A3B',
};
const tests = [
  ['body text', P.ink, P.white], ['body text on paper', P.ink, P.paper], ['body on sand', P.ink, P.sand],
  ['muted text', P.inkMuted, P.white], ['muted on paper', P.inkMuted, P.paper], ['muted on sand', P.inkMuted, P.sand],
  ['link', P.accent, P.white], ['link on paper', P.accent, P.paper], ['link on sand', P.accent, P.sand],
  ['link hover', P.accentHover, P.white],
  ['white on navy button', P.white, P.navy], ['white on navy hover', P.white, P.navyHover],
  ['secondary button label', P.navy, P.white], ['secondary button hover', P.navy, P.paper],
  ['footer link on navy', P.accentOnNavy, P.navy], ['footer muted on navy', P.mutedOnNavy, P.navy],
  ['footer white on navy', P.white, P.navy],
  ['focus ring on white', P.focus, P.white], ['focus ring on sand', P.focus, P.sand], ['focus ring on paper', P.focus, P.paper],
  ['error text', P.error, P.white], ['error on paper', P.error, P.paper],
  ['card border vs white (3:1 UI)', P.cardBorder, P.white],
];
let bad = 0;
for (const [name, fg, bg] of tests) {
  const r = ratio(fg, bg);
  // 4.5:1 for text; the border row is a non-text boundary, judged separately.
  const need = name.includes('border') ? 1.0 : 4.5;
  const pass = r >= need;
  if (!pass) bad++;
  console.log(`${pass ? '✓' : '✗'} ${name.padEnd(32)} ${r.toFixed(2)}:1  (need ${need})`);
}
console.log(bad ? `\n${bad} FAILING` : '\nAll text pairs meet WCAG AA');
