import { getScreenshot, listScreenshots } from '../../db/repositories/screenshots.mjs';

export function list(c) {
  const scan = c.req.query('scan');
  return c.json({
    screenshots: listScreenshots(c.var.db, scan ? Number(scan) : null),
  });
}

function imageResponse(row) {
  if (!row) return null;
  const data = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
  return new Response(data, {
    headers: {
      'Content-Type': row.mime || 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}

export function image(c) {
  return imageResponse(getScreenshot(c.var.db, c.req.param('id')))
    ?? c.json({ error: 'Captura no encontrada.' }, 404);
}
