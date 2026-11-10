import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../.site-build/', import.meta.url));
await stat(join(output, 'docs/index.html'));
const basePath = '/interlock/';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:8765');
    if (url.pathname === '/' || url.pathname === '/interlock') {
      response.writeHead(302, { Location: basePath });
      response.end();
      return;
    }
    if (!url.pathname.startsWith(basePath)) throw new Error('Outside site');
    let path = join(
      output,
      decodeURIComponent(url.pathname.slice(basePath.length)),
    );
    if (relative(output, path).startsWith(`..${sep}`))
      throw new Error('Outside site');
    if ((await stat(path)).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(302, { Location: `${url.pathname}/${url.search}` });
        response.end();
        return;
      }
      path = join(path, 'index.html');
    }
    const data = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(data);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(join(output, '404.html')));
  }
});

server.listen(8765, '127.0.0.1', () => {
  console.log('Marketing: http://127.0.0.1:8765/interlock/');
  console.log('Docs: http://127.0.0.1:8765/interlock/docs/');
});
