import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

export interface StaticServer {
  /** e.g. http://127.0.0.1:41234 */
  url: string;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
};

/**
 * Serves `root` over HTTP on a free port.
 *
 * Students build their pages on Windows, where file names are case-insensitive. A path that
 * only differs in case is still served, and the response carries an `X-Case-Mismatch` header
 * with the real file name, so the grader can mention it instead of treating it as broken.
 */
export async function serveDir(root: string): Promise<StaticServer> {
  const server = http.createServer((req, res) => {
    const found = resolvePath(root, req.url ?? '/');
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const body = fs.readFileSync(found.file);
    const headers: Record<string, string> = { 'Content-Type': contentType(found.file, body), 'Cache-Control': 'no-store' };
    if (found.caseMismatch) headers['X-Case-Mismatch'] = encodeURI(path.relative(root, found.file).split(path.sep).join('/'));
    res.writeHead(200, headers);
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function resolvePath(root: string, url: string): { file: string; caseMismatch: boolean } | undefined {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return undefined;
  }
  const segments: string[] = [];
  for (const raw of pathname.split('/')) {
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      // keep the raw segment
    }
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop(); // never climbs above root
    else segments.push(segment);
  }

  let current = root;
  let caseMismatch = false;
  for (const segment of segments) {
    const next = findEntry(current, segment);
    if (!next) return undefined;
    current = path.join(current, next.name);
    caseMismatch ||= next.caseMismatch;
  }
  if (fs.statSync(current).isDirectory()) {
    const index = findEntry(current, 'index.html');
    if (!index) return undefined;
    current = path.join(current, index.name);
    caseMismatch ||= index.caseMismatch;
  }
  return { file: current, caseMismatch };
}

function findEntry(dir: string, name: string): { name: string; caseMismatch: boolean } | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return undefined;
  }
  const wanted = name.normalize('NFC');
  const exact = names.find((n) => n.normalize('NFC') === wanted);
  if (exact) return { name: exact, caseMismatch: false };
  const loose = names.find((n) => n.normalize('NFC').toLowerCase() === wanted.toLowerCase());
  return loose ? { name: loose, caseMismatch: true } : undefined;
}

function contentType(file: string, body: Buffer): string {
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  if (type !== 'text/html' && type !== 'text/css') return type;
  // A BOM, <meta charset> or @charset decides the encoding; otherwise assume UTF-8.
  const head = body.subarray(0, 2048).toString('latin1').toLowerCase();
  const declared = body[0] === 0xef || body[0] === 0xfe || body[0] === 0xff || /<meta[^>]+charset|@charset/.test(head);
  return declared ? type : `${type}; charset=utf-8`;
}
