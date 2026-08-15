'use strict';
/** Tests for the intake step. No browser needed. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { extract, readPipeline } = require('../src/intake');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? '  → ' + d : ''))); };

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'intake-'));
const listFile = path.join(work, 'domains.csv');
const pipeFile = path.join(work, 'pipeline.csv');
const scans = path.join(work, 'out');

fs.writeFileSync(listFile, 'domain,group,country,note\nrains.com,fashion,DK,\n');
fs.writeFileSync(pipeFile, 'domain,group,stage,owner,updated,note\nganni.com,fashion,contacted,O,2026-08-14,no reply\n');
fs.mkdirSync(path.join(scans, 'muuto.com'), { recursive: true });
fs.writeFileSync(path.join(scans, 'muuto.com', 'scan.json'), '{"domain":"muuto.com","status":"ok"}');

const run = (input, extra = []) => execFileSync('node',
  [path.join(__dirname, '../src/intake.js'), '--group', 'home', '--list', listFile,
    '--pipeline', pipeFile, '--scans', scans, ...extra],
  { input, encoding: 'utf8' });

console.log('\n1. Pulling domains out of messy pasted text');
{
  const got = extract(`
    Rains ApS | https://www.rains.com/ | Denmark
    Muuto A/S    muuto.com
    follow us instagram.com/x facebook.com/y
    logo https://cdn.shopify.com/a/logo.png
    mailto:hi@newbrand.co.uk
    Powered by Shopify · google.com/analytics
  `);
  ok('finds real brands', got.includes('rains.com') && got.includes('muuto.com') && got.includes('newbrand.co.uk'), got.join(','));
  ok('drops social and platform noise', !got.some((d) => /instagram|facebook|shopify|google/.test(d)), got.join(','));
  ok('drops asset files', !got.some((d) => /\.png$/.test(d)), got.join(','));
  ok('keeps multi-part TLDs intact', got.includes('newbrand.co.uk'), got.join(','));
  ok('deduplicates', new Set(got).size === got.length);
}

console.log('\n2. Nothing is ever added twice');
{
  const out = run('rains.com\nmuuto.com\nganni.com\nhay.dk\n', ['--dry-run']);
  ok('already on the list is held back', /1\s+already on the list/.test(out), out.trim());
  ok('already scanned is held back', /1\s+already scanned/.test(out), out.trim());
  ok('already contacted is held back', /already in the pipeline/.test(out), out.trim());
  ok('the contact stage is shown so you know why', /ganni\.com \(contacted, 2026-08-14\)/.test(out), out.trim());
  ok('only the genuinely new one is offered', /1\s+new/.test(out) && /hay\.dk/.test(out), out.trim());
}

console.log('\n3. Appending, and staying idempotent');
{
  run('hay.dk\n', ['--country', 'DK', '--source', 'Ambiente 2026']);
  const list = fs.readFileSync(listFile, 'utf8');
  ok('the row is written with its group, country and source', /hay\.dk,home,DK,Ambiente 2026/.test(list), list.trim().split('\n').pop());
  const again = run('hay.dk\n');
  ok('running the same paste twice adds nothing', /Nothing new to add/.test(again), again.trim());
}

console.log('\n4. Reading the tracker');
{
  const p = readPipeline(pipeFile);
  ok('pipeline parsed', p.get('ganni.com') && p.get('ganni.com').stage === 'contacted', JSON.stringify([...p]));
  ok('a missing tracker is not an error', readPipeline(path.join(work, 'nope.csv')).size === 0);
}

console.log('\n─────────────────────────────');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
