import { ValidationError } from '../../server/errors.mjs';

export function createJob(db, job) {
  db.run(
    `INSERT INTO scan_jobs
       (id, target, command, payload_json, status, total, started_at)
     VALUES (?, ?, ?, ?, 'running', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       target = excluded.target, command = excluded.command,
       payload_json = excluded.payload_json, status = 'running',
       started_at = excluded.started_at, finished_at = NULL`,
    job.id,
    job.target ?? '',
    job.command ?? '',
    JSON.stringify(job.payload ?? {}),
    job.total ?? 0,
    job.startedAt ?? Date.now(),
  );
  return job.id;
}

export function getJob(db, id) {
  return db.get('SELECT * FROM scan_jobs WHERE id = ?', id);
}

export function updateProgress(db, id, stats) {
  const job = getJob(db, id);
  if (!job) return null;

  const messages = Array.isArray(stats.log) ? stats.log : [];
  const already = Number(job.event_count ?? 0);
  const insert = db.prepare(
    'INSERT INTO scan_job_events (job_id, at, message) VALUES (?, ?, ?)',
  );
  messages.slice(already).forEach((message) => {
    insert.run(id, Date.now(), String(message));
  });

  db.run(
    `UPDATE scan_jobs
        SET percent = ?, processed = ?, total = ?, bytes = ?, host_hints = ?, hosts = ?,
            current_address = ?, current_approx = ?, event_count = ?
      WHERE id = ?`,
    Number(stats.percent ?? 0),
    Number(stats.processed ?? 0),
    Number(stats.total ?? 0),
    Number(stats.bytes ?? 0),
    Number(stats.hostHints ?? 0),
    Number(stats.hosts ?? 0),
    String(stats.currentAddress ?? ''),
    stats.currentApprox ? 1 : 0,
    messages.length,
    id,
  );
  return jobProgress(db, id);
}

export function jobProgress(db, id) {
  const job = getJob(db, id);
  if (!job) return null;
  return {
    ok: true,
    bytes: Number(job.bytes ?? 0),
    hostHints: Number(job.host_hints ?? 0),
    hosts: Number(job.hosts ?? 0),
    total: Number(job.total ?? 0),
    processed: Number(job.processed ?? 0),
    percent: Number(job.percent ?? 0),
    currentAddress: job.current_address ?? '',
    currentApprox: Boolean(job.current_approx),
    log: db.all(
      'SELECT message FROM scan_job_events WHERE job_id = ? ORDER BY id',
      id,
    ).map((row) => row.message),
  };
}

export function finishJob(db, id, result) {
  const job = getJob(db, id);
  if (!job) return;
  const status = result.status
    ?? (result.cancelled ? 'cancelled' : result.error ? 'failed' : 'finished');
  db.run(
    `UPDATE scan_jobs
        SET status = ?, percent = ?, processed = ?, total = ?, bytes = ?,
            host_hints = ?, hosts = ?, current_address = ?, current_approx = ?,
            exit_code = ?, duration_ms = ?, stderr = ?,
            gowitness_status = ?, gowitness_message = ?,
            finished_at = ?
      WHERE id = ?`,
    status,
    Number(result.percent ?? job.percent ?? 100),
    Number(result.processed ?? job.processed ?? 0),
    Number(result.total ?? job.total ?? 0),
    Number(result.bytes ?? job.bytes ?? 0),
    Number(result.hostHints ?? job.host_hints ?? 0),
    Number(result.hosts ?? job.hosts ?? 0),
    String(result.currentAddress ?? job.current_address ?? ''),
    Boolean(result.currentApprox ?? job.current_approx) ? 1 : 0,
    result.exitCode ?? null,
    Number(result.durationMs ?? 0),
    String(result.stderr ?? ''),
    result.gowitness == null ? null : result.gowitness ? 'done' : 'failed',
    String(result.gowitness ?? ''),
    Date.now(),
    id,
  );
}

export function cancelJob(db, id) {
  if (!getJob(db, id)) throw new ValidationError('Escaneo no encontrado.');
  db.run("UPDATE scan_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?", Date.now(), id);
}
