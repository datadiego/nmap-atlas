import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

export async function serveStatic(req, res, pathname, distDir) {
  let requested;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    return send(res, 400, 'Ruta no válida');
  }

  const root = path.resolve(distDir);
  let target = path.resolve(root, `.${requested}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return send(res, 403, 'Acceso denegado');
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    // SPA: cualquier ruta desconocida sirve index.html
    target = path.join(root, 'index.html');
  }

  try {
    const body = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    send(res, 200, body, MIME[ext] ?? 'application/octet-stream');
  } catch {
    send(res, 404, 'No encontrado. Ejecuta `npm run build` antes de iniciar el servidor.');
  }
}
