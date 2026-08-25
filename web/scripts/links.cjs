const fs = require('fs');
const path = require('path');

const dist = path.resolve(__dirname, '../dist');
const htmlFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.html')) htmlFiles.push(full);
  }
}

function targetFile(urlPath) {
  const clean = decodeURIComponent(urlPath || '/').replace(/^\/+/, '');
  const direct = path.join(dist, clean);
  if (path.extname(clean)) return direct;
  return path.join(direct, 'index.html');
}

walk(dist);
const failures = [];
let checked = 0;

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]);

  for (const ref of refs) {
    if (/^(?:https?:|mailto:|tel:|data:)/.test(ref)) continue;
    const [rawPath, fragment] = ref.split('#');
    const currentRoute = '/' + path.relative(dist, file).replace(/index\.html$/, '').replaceAll(path.sep, '/');
    const pathname = rawPath
      ? new URL(rawPath, `https://local.test${currentRoute}`).pathname
      : new URL(currentRoute, 'https://local.test').pathname;
    const target = targetFile(pathname);
    checked++;

    if (!fs.existsSync(target)) {
      failures.push(`${path.relative(dist, file)} → ${ref} (missing ${path.relative(dist, target)})`);
      continue;
    }

    if (fragment && target.endsWith('.html')) {
      const targetHtml = fs.readFileSync(target, 'utf8');
      const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\bid="${escaped}"`).test(targetHtml)) {
        failures.push(`${path.relative(dist, file)} → ${ref} (missing fragment)`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Checked ${checked} internal links and asset references across ${htmlFiles.length} pages: all valid.`);
