import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from './nmap.mjs';

const SAFE_NAME = /^[A-Za-z0-9._-]+\.xml$/;
const MAX_NOTES = 500;

const escapeXml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const noteElement = (notes) => `<atlas-note>${escapeXml(notes.trim())}</atlas-note>`;

/** Inserta o reemplaza <atlas-note> en el host enésimo del XML. */
export function applyNoteToXml(xml, index, notes) {
  if (!Number.isInteger(index) || index < 0) {
    throw new ValidationError('Índice de host no válido.');
  }
  if (typeof notes !== 'string' || notes.length > MAX_NOTES) {
    throw new ValidationError(`La nota es demasiado larga (máximo ${MAX_NOTES} caracteres).`);
  }

  let seen = 0;
  let replaced = false;
  let output = xml.replace(
    /(<host\b[^>]*>)([\s\S]*?)(<\/host>)/g,
    (match, open, inner, close) => {
      if (seen++ !== index) return match;
      replaced = true;
      const cleaned = inner.replace(/<atlas-note\b[^>]*>[\s\S]*?<\/atlas-note>/g, '');
      return `${open}${cleaned}${notes.trim() ? noteElement(notes) : ''}${close}`;
    },
  );
  if (replaced) return output;

  seen = 0;
  output = xml.replace(/<host\b[^>]*?\/>/g, (match) => {
    if (seen++ !== index) return match;
    replaced = true;
    if (!notes.trim()) return match;
    const open = match.replace(/\s*\/>$/, '');
    return `${open}>${noteElement(notes)}</host>`;
  });
  if (!replaced) throw new ValidationError('No se encontró el host indicado en el XML.');
  return output;
}

export async function updateHostNote(scansDir, name, index, notes) {
  if (!SAFE_NAME.test(name)) throw new ValidationError('Nombre de escaneo no válido.');
  const file = path.join(scansDir, name);
  let xml;
  try {
    xml = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw new ValidationError('El escaneo indicado no existe.');
    throw error;
  }

  const updated = applyNoteToXml(xml, index, notes);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, updated, 'utf8');
  await rename(temp, file);
  return true;
}
