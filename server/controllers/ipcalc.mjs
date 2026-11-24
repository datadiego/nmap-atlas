import { calculateRange } from '../ipcalc.mjs';
import { readJson } from '../http.mjs';

export async function calculate(c) {
  const body = await readJson(c);
  return c.json(await calculateRange(body.target, c.var.config));
}
