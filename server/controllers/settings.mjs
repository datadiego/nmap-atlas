import { getSettings, updateSettings } from '../../db/repositories/settings.mjs';
import { readJson } from '../http.mjs';

export function get(c) {
  return c.json(getSettings(c.var.db));
}

export async function update(c) {
  return c.json(updateSettings(c.var.db, await readJson(c)));
}
