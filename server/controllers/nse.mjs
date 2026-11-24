import { listNseScripts } from '../services/nseScripts.mjs';

/** Catálogo de scripts NSE instalados, para el formulario de escaneo. */
export async function list(c) {
  return c.json(await listNseScripts(c.var.config));
}
