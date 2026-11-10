import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const output = fileURLToPath(new URL('../.site-build/', import.meta.url));
const origin = 'https://dgca.github.io';
const basePath = '/interlock/';

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

const pages = new Map();
for (const path of await htmlFiles(output)) {
  const dom = new JSDOM(await readFile(path, 'utf8'));
  const document = dom.window.document;
  pages.set(path, {
    ids: new Set([...document.querySelectorAll('[id]')].map((el) => el.id)),
    references: [
      // Canonical and alternate metadata can name the requested missing URL on
      // Docusaurus's 404 page. Check navigable links and loaded assets instead.
      ...[
        ...document.querySelectorAll(
          'a[href], link[rel="stylesheet"], link[rel="preload"], link[rel="icon"]',
        ),
      ].map((el) => el.getAttribute('href')),
      ...[...document.querySelectorAll('script[src], img[src]')].map((el) =>
        el.getAttribute('src'),
      ),
    ],
  });
  dom.window.close();
}

const errors = [];
let references = 0;
for (const [path, page] of pages) {
  const sourcePath = relative(output, path);
  const sourceUrl = new URL(basePath + sourcePath, origin);
  for (const reference of page.references) {
    if (!reference) continue;
    const url = new URL(reference, sourceUrl);
    if (url.origin !== origin) continue;
    references++;
    if (!url.pathname.startsWith(basePath)) {
      errors.push(`${sourcePath}: link escapes project path: ${reference}`);
      continue;
    }
    let target = join(
      output,
      decodeURIComponent(url.pathname.slice(basePath.length)),
    );
    try {
      if ((await stat(target)).isDirectory())
        target = join(target, 'index.html');
      await stat(target);
    } catch {
      errors.push(`${sourcePath}: missing target: ${reference}`);
      continue;
    }
    if (url.hash && pages.has(target)) {
      const id = decodeURIComponent(url.hash.slice(1));
      if (!pages.get(target).ids.has(id)) {
        errors.push(`${sourcePath}: missing anchor: ${reference}`);
      }
    }
  }
}

const logo = await readFile(
  new URL('../site/interlock-logo.svg', import.meta.url),
);
const docsLogo = await readFile(
  new URL('../website/static/img/interlock-logo.svg', import.meta.url),
);
if (!logo.equals(docsLogo)) {
  errors.push('Documentation logo differs from site/interlock-logo.svg');
}
if (errors.length) {
  throw new Error(`Website checks failed:\n${errors.join('\n')}`);
}
console.log(
  `Checked ${pages.size} HTML pages and ${references} local links and assets.`,
);
