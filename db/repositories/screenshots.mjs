function parseKey(key) {
  const at = String(key ?? '').lastIndexOf(':');
  if (at <= 0) return null;
  const host = key.slice(0, at);
  const port = Number.parseInt(key.slice(at + 1), 10);
  if (!host || !Number.isInteger(port)) return null;
  return { host, port };
}

function resolveOwner(db, scanId, key) {
  const parsed = parseKey(key);
  if (!parsed) return { hostId: null, portId: null };
  const row = db.get(
    `SELECT h.id AS host_id, p.id AS port_id
       FROM hosts h
       LEFT JOIN host_addresses a ON a.host_id = h.id
       LEFT JOIN host_names n ON n.host_id = h.id
       LEFT JOIN ports p ON p.host_id = h.id AND p.port_id = ?
      WHERE (? IS NULL OR h.scan_id = ?)
        AND (a.addr = ? OR n.name = ? OR h.host_key = ?)
      ORDER BY h.id DESC
      LIMIT 1`,
    parsed.port,
    scanId,
    scanId,
    parsed.host,
    parsed.host,
    parsed.host,
  );
  return { hostId: row?.host_id ?? null, portId: row?.port_id ?? null };
}

export function insertScreenshot(db, options) {
  const {
    scanId,
    cacheKey,
    data,
    mime,
    originalFile = '',
    url = '',
    title = '',
    code = 0,
    probedAt = null,
  } = options;
  if (!Number.isInteger(scanId) || scanId <= 0) throw new Error('scanId no válido.');
  if (!cacheKey || !data?.length || !mime) throw new Error('Captura no válida.');
  const owners = resolveOwner(db, scanId, cacheKey);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const successful = code >= 200 && code < 400 ? 1 : 0;

  db.run(
    `INSERT INTO screenshots
       (scan_id, host_id, port_id, cache_key, data, mime, byte_size, original_file,
        url, title, code, successful, probed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scan_id, cache_key) DO UPDATE SET
       host_id = excluded.host_id, port_id = excluded.port_id, data = excluded.data,
       mime = excluded.mime, byte_size = excluded.byte_size,
       original_file = excluded.original_file, url = excluded.url,
       title = excluded.title, code = excluded.code, successful = excluded.successful,
       probed_at = excluded.probed_at`,
    scanId,
    owners.hostId,
    owners.portId,
    cacheKey,
    bytes,
    mime,
    bytes.byteLength,
    originalFile,
    url,
    title,
    code,
    successful,
    probedAt,
    Date.now(),
  );
}

export function listScreenshots(db, scanId = null) {
  const rows = scanId
    ? db.all('SELECT * FROM screenshots WHERE scan_id = ? ORDER BY id', scanId)
    : db.all('SELECT * FROM screenshots WHERE successful = 1 ORDER BY id');
  return Object.fromEntries(rows
    .filter((row) => Number(row.successful) === 1)
    .map((row) => [row.cache_key, {
      file: String(row.id),
      url: row.url ?? '',
      title: row.title ?? '',
      code: Number(row.code ?? 0),
    }]));
}

export function getScreenshot(db, id) {
  const numeric = Number.parseInt(String(id), 10);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return db.get('SELECT data, mime FROM screenshots WHERE id = ?', numeric);
}
