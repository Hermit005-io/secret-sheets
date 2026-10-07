// Builds the whole page into one HTML file with nothing to fetch:
//
//     node build.mjs        ->  dist/secret-sheets.html  and  ../docs/index.html
//
// The script and the styles are written into the page itself, and the page's
// security policy names them by their SHA-256, so the browser will run those
// and nothing else, and will refuse every network request.

import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {build} from 'esbuild';

const here = new URL('.', import.meta.url);
const read = path => readFileSync(new URL(path, here), 'utf8');
const hash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

const bundled = await build({
  entryPoints: [new URL('src/app.ts', here).pathname],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  // No reason for the page to mention the machine it was built on.
  absWorkingDir: new URL('.', here).pathname,
});
// A closing script tag inside the script would end it early.
const script = bundled.outputFiles[0].text.trim().replaceAll('</script', '<\\/script');

const style = (
  await build({
    entryPoints: [new URL('src/style.css', here).pathname],
    minify: true,
    write: false,
  })
).outputFiles[0].text.trim();

const policy = [
  "default-src 'none'",
  `script-src ${hash(script)}`,
  `style-src ${hash(style)}`,
  'img-src blob: data:',
  'media-src blob: mediastream:',
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

// Function replacements, so that "$" in the script is not read as a pattern.
const page = read('src/index.html')
  .replace('__POLICY__', () => policy)
  .replace('__STYLE__', () => style)
  .replace('__SCRIPT__', () => script);

for (const out of ['dist/secret-sheets.html', '../docs/index.html']) {
  mkdirSync(new URL(out.replace(/[^/]+$/, ''), here), {recursive: true});
  writeFileSync(new URL(out, here), page);
}

const digest = createHash('sha256').update(page).digest('hex');
console.log(`built ${(page.length / 1024).toFixed(0)} KB, SHA-256 ${digest}`);
if (read('src/strings.ts').includes("PAGE_ADDRESS = ''")) {
  console.log('note: PAGE_ADDRESS in src/strings.ts is empty, so printed sheets do not say where to find the page');
}
