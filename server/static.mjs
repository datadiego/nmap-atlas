import { isDirectory, readBytes } from '../core/fs.mjs';
import { extname, join, resolve, sep } from '../core/path.mjs';

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

const INDEX = '<!doctype html><html><body>No encontrado. Ejecuta `bun run build` antes de iniciar el servidor.</body></html>';

/** Middleware final: sirve dist/ y devuelve index.html para rutas de SPA. */
export async function serveStatic(c, distDir) {
  let requested;
  try {
    requested = decodeURIComponent(new URL(c.req.raw.url).pathname);
  } catch {
    return new Response('Ruta no válida', { status: 400 });
  }

  const root = resolve(distDir);
  let target = resolve(root, `.${requested}`);
  if (target !== root && !target.startsWith(root + sep)) {
    return new Response('Acceso denegado', { status: 403 });
  }

  if (await isDirectory(target)) target = join(target, 'index.html');
  else if (!(await Bun.file(target).exists())) target = join(root, 'index.html');

  try {
    const body = await readBytes(target);
    return new Response(body, {
      headers: { 'Content-Type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response(INDEX, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
