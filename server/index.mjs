import http from 'node:http';
import { ValidationError, cancelScan, deleteAllScans, deleteScan, getNmapVersion, listScans, readScan, renameScan, runNmap } from './nmap.mjs';
import { calculateRange, getIpcCalcVersion } from './ipcalc.mjs';
import { serveStatic } from './static.mjs';

const MAX_BODY = 1024 * 1024;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/xml; charset=utf-8' });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError('La petición es demasiado grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('Cuerpo JSON no válido.');
  }
}

export function createServer(config) {
  const activeScans = new Map();

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    try {
      if (pathname === '/api/status' && req.method === 'GET') {
        const [version, ipcalcVersion, scans] = await Promise.all([
          getNmapVersion(config),
          getIpcCalcVersion(config),
          listScans(config.scansDir),
        ]);
        const command = config.nmapCommand ?? ['nmap'];
        return sendJson(res, 200, {
          ok: true,
          nmapAvailable: Boolean(version),
          nmapVersion: version,
          nmapCommand: command.join(' '),
          privileged: command.length > 1,
          scansDir: config.scansDir,
          saving: config.save,
          savedScans: scans.length,
          ipcalcAvailable: Boolean(ipcalcVersion),
          ipcalcVersion,
        });
      }

      if (pathname === '/api/scans' && req.method === 'GET') {
        return sendJson(res, 200, { scans: await listScans(config.scansDir) });
      }

      if (pathname === '/api/scans/rename' && req.method === 'POST') {
        const { from, to } = await readJson(req);
        return sendJson(res, 200, { name: await renameScan(config.scansDir, from, to) });
      }

      if (pathname === '/api/scans/delete' && req.method === 'POST') {
        const { name } = await readJson(req);
        return sendJson(res, 200, { name: await deleteScan(config.scansDir, name) });
      }

      if (pathname === '/api/scans/delete-all' && req.method === 'POST') {
        return sendJson(res, 200, { deleted: await deleteAllScans(config.scansDir) });
      }

      if (pathname.startsWith('/api/scans/') && req.method === 'GET') {
        const name = decodeURIComponent(pathname.slice('/api/scans/'.length));
        return sendText(res, 200, await readScan(config.scansDir, name));
      }

      if (pathname === '/api/scan' && req.method === 'POST') {
        const payload = await readJson(req);
        const result = await runNmap(payload, config, activeScans);
        return sendJson(res, 200, result);
      }

      if (pathname === '/api/scan/cancel' && req.method === 'POST') {
        const payload = await readJson(req);
        return sendJson(res, 200, { ok: cancelScan(payload.id, activeScans) });
      }

      if (pathname === '/api/scan/progress' && req.method === 'GET') {
        const id = url.searchParams.get('id') ?? '';
        const entry = /^[A-Za-z0-9_-]{1,80}$/.test(id) ? activeScans.get(id) : null;
        return sendJson(res, 200, entry ? { ok: true, ...entry.stats } : { ok: false });
      }

      if (pathname === '/api/ipcalc' && req.method === 'POST') {
        const payload = await readJson(req);
        const result = await calculateRange(payload.target, config);
        return sendJson(res, 200, result);
      }

      if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Endpoint no encontrado.' });
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return await serveStatic(req, res, pathname, config.distDir);
      }

      return sendJson(res, 405, { error: 'Método no permitido.' });
    } catch (error) {
      const status = error instanceof ValidationError ? 400 : 500;
      if (status === 500) console.error('[nmap-atlas]', error);
      return sendJson(res, status, {
        error: error instanceof Error ? error.message : 'Error inesperado.',
      });
    }
  });
}
