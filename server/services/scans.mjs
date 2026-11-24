import { saveParsed } from '../../db/repositories/scans.mjs';
import { ValidationError } from '../errors.mjs';
import { parseNmapXml } from '../parser/nmapXml.mjs';

/** Parse en servidor + persistencia en SQLite. El XML nunca se escribe a disco. */
export function importXml(db, xml, filename, source = 'upload') {
  if (typeof xml !== 'string' || !xml.trim()) throw new ValidationError('El XML está vacío.');
  if (filename !== undefined && (typeof filename !== 'string' || filename.length > 255)) {
    throw new ValidationError('Nombre de archivo no válido.');
  }
  const parsed = parseNmapXml(xml, filename ?? '');
  const name = saveParsed(db, {
    name: filename || null,
    xml,
    parsed,
    source,
    command: parsed.args ?? '',
  });
  return {
    name,
    scan: { ...parsed, filename: name },
    warnings: parsed.warnings ?? [],
  };
}
