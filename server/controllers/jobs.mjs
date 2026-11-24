import { cancelJob, createJob, finishJob, getJob, jobProgress, updateProgress } from '../../db/repositories/jobs.mjs';
import { cancelScan, runNmap } from '../nmap.mjs';
import { ValidationError } from '../errors.mjs';
import { readJson } from '../http.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function jobId(value) {
  const id = typeof value === 'string' && SAFE_ID.test(value)
    ? value
    : `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return id;
}

export async function run(c) {
  const body = await readJson(c);
  const id = jobId(body.id);
  const { db, config, activeScans } = c.var;
  createJob(db, {
    id,
    target: body.target ?? '',
    command: body.command ?? '',
    payload: body,
    startedAt: Date.now(),
  });

  try {
    const result = await runNmap(body, config, db, activeScans);
    finishJob(db, id, result);
    return c.json(result);
  } catch (error) {
    failJobSafely(db, id, error);
    throw error;
  }
}

function failJobSafely(db, id, error) {
  // Evitamos que un fallo al registrar el fallo tape el error original.
  try {
    finishJob(db, id, {
      status: 'failed',
      stderr: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // ignore
  }
}

export function progress(c) {
  const id = c.req.param('id') ?? c.req.query('id') ?? '';
  if (!SAFE_ID.test(id)) return c.json({ ok: false });
  const live = c.var.activeScans.get(id);
  if (live) updateProgress(c.var.db, id, live.stats);
  return c.json(jobProgress(c.var.db, id) ?? { ok: false });
}

export async function cancel(c) {
  const body = await readJson(c);
  const id = body.id;
  if (typeof id !== 'string' || !SAFE_ID.test(id)) {
    throw new ValidationError('ID de escaneo no válido.');
  }
  const ok = cancelScan(id, c.var.activeScans);
  if (ok) {
    try { cancelJob(c.var.db, id); } catch { /* el escaneo ya ha terminado */ }
  }
  return c.json({ ok });
}

export function get(c) {
  const job = getJob(c.var.db, c.req.param('id'));
  return job ? c.json(job) : c.json({ error: 'Escaneo no encontrado.' }, 404);
}
