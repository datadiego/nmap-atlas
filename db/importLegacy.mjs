import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getByName, normalizeScanName, saveParsed } from './repositories/scans.mjs';
import { insertScreenshot } from './repositories/screenshots.mjs';
import { parseNmapXml } from '../server/parser/nmapXml.mjs';
import { screenshotDir, urlKey } from '../server/gowitness.mjs';

function safeName(name) {
  return /^[A-Za-z0-9._-]{1,255}$/.test(name);
}

function findScanForKey(db, key) {
  const parsedKey = urlKey(key);
  if (!parsedKey) return null;
  const at = parsedKey.lastIndexOf(':');
  const host = parsedKey.slice(0, at);
  const port = Number.parseInt(parsedKey.slice(at + 1), 10);
  const row = db.get(
    `SELECT h.scan_id
       FROM hosts h
       LEFT JOIN host_addresses a ON a.host_id = h.id
       LEFT JOIN host_names n ON n.host_id = h.id
       LEFT JOIN ports p ON p.host_id = h.id AND p.port_id = ?
      WHERE a.addr = ? OR n.name = ? OR h.host_key = ?
      ORDER BY h.id DESC
      LIMIT 1`,
    port,
    host,
    host,
    host,
  );
  return row?.scan_id ?? null;
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return null;
}

/** Importa los artefactos anteriores (XML, notas y capturas) una sola vez. */
export async function importLegacy(db, config) {
  const already = Number(db.get('SELECT legacy_imported FROM app_settings WHERE id = 1')?.legacy_imported ?? 0);
  if (already) return { scans: 0, screenshots: 0, skipped: true };

  let imported = 0;
  let dir = [];
  try {
    dir = await readdir(config.scansDir, { withFileTypes: true });
  } catch {
    // Sin directorio legacy no hay nada que importar.
  }

  for (const entry of dir) {
    if (!entry.isFile() || !safeName(entry.name) || !/\.xml$/i.test(entry.name)) continue;
    const name = normalizeScanName(entry.name);
    if (getByName(db, name)) continue;
    try {
      const xml = await readFile(path.join(config.scansDir, entry.name), 'utf8');
      const parsed = parseNmapXml(xml, name);
      saveParsed(db, {
        name,
        xml,
        parsed,
        source: 'legacy',
        command: parsed.args ?? '',
      });
      imported += 1;
    } catch (error) {
      console.error(`[nmap-atlas] No se pudo importar ${entry.name}: ${error.message}`);
    }
  }

  let shots = 0;
  try {
    const raw = await readFile(path.join(screenshotDir(config), 'atlas-screenshots.json'), 'utf8');
    const index = JSON.parse(raw);
    if (index && typeof index === 'object' && !Array.isArray(index)) {
      for (const [key, shot] of Object.entries(index)) {
        if (!shot || typeof shot.file !== 'string' || path.basename(shot.file) !== shot.file) continue;
        if (!(shot.code >= 200 && shot.code < 400)) continue;
        const scanId = findScanForKey(db, key);
        if (!scanId) continue;
        const mime = mimeFor(shot.file);
        if (!mime) continue;
        try {
          const data = await readFile(path.join(screenshotDir(config), shot.file));
          insertScreenshot(db, {
            scanId,
            cacheKey: key,
            data,
            mime,
            originalFile: shot.file,
            url: shot.url ?? '',
            title: shot.title ?? '',
            code: shot.code,
          });
          shots += 1;
        } catch {
          // Una imagen ausente no impide importar el resto.
        }
      }
    }
  } catch {
    // Sin índice legacy no hay capturas que migrar.
  }

  db.run('UPDATE app_settings SET legacy_imported = 1, updated_at = ? WHERE id = 1', Date.now());
  return { scans: imported, screenshots: shots };
}
