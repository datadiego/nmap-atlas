import * as scans from '../../db/repositories/scans.mjs';
import { readJson } from '../http.mjs';
import { importXml } from '../services/scans.mjs';

export function list(c) {
  return c.json({ scans: scans.list(c.var.db) });
}

export async function upload(c) {
  const body = await readJson(c);
  const { name, scan, warnings } = importXml(c.var.db, body.xml, body.filename, 'upload');
  return c.json({ name, scan, warnings });
}

export function deleteAll(c) {
  return c.json({ deleted: scans.removeAll(c.var.db) });
}

export async function rename(c) {
  const body = await readJson(c);
  return c.json({ name: scans.rename(c.var.db, c.req.param('name'), body.name) });
}

export function remove(c) {
  return c.json({ name: scans.remove(c.var.db, c.req.param('name')) });
}

export async function note(c) {
  const body = await readJson(c);
  const notes = body.notes ?? '';
  return c.json({
    ok: scans.setHostNote(
      c.var.db,
      c.req.param('name'),
      Number(c.req.param('index')),
      notes,
    ),
  });
}

export async function migrateNotes(c) {
  const body = await readJson(c);
  return c.json({ migrated: scans.migrateHostNotes(c.var.db, body.notes) });
}

export function getJson(c) {
  return c.json(scans.getScanJson(c.var.db, c.req.param('name')));
}

export function getRaw(c) {
  const { text } = scans.getRawText(c.var.db, c.req.param('name'));
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(text);
}
