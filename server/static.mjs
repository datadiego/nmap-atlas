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

/** Middleware final: sirve dist/ y devuelve index.html para rutas de SPA. */
export async function serveStatic(c, distDir) {
  let requested;
  try {
    requested = decodeURIComponent(new URL(c.req.raw.url).pathname);
  } catch {
    return new Response('Ruta no válida', { status: 400 });
  }

  const root = path.resolve(distDir);
  let target = path.resolve(root, `.${requested}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return new Response('Acceso denegado', { status: 403 });
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) target = path.join(target, 'index.html');
  } catch {
    target = path.join(root, 'index.html');
  }

  try {
    const body = await readFile(target);
    return new Response(body, {
      headers: { 'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response('No encontrado. Ejecuta `npm run build` antes de iniciar el servidor.', { status: 404 });
  }
}
