import { byteLength } from '../../core/fs.mjs';
import { ValidationError } from '../../server/errors.mjs';
import { stripAtlasNotes } from '../../server/parser/nmapXml.mjs';

export const SAFE_NAME = /^[A-Za-z0-9._-]{1,255}$/;
const MAX_NOTES = 500;

/** SQLite manda: el sufijo .xml era del antiguo archivo, no del escaneo. */
export const normalizeScanName = (name) =>
  typeof name === 'string' ? name.replace(/\.xml$/i, '') : name;

function requireName(name) {
  const normalized = normalizeScanName(name);
  if (typeof normalized !== 'string' || !SAFE_NAME.test(normalized)) {
    throw new ValidationError('Nombre de escaneo no válido.');
  }
  return normalized;
}

function json(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function uniqueName(db, desired) {
  const base = requireName(desired);
  let name = base;
  let suffix = 1;
  while (db.get('SELECT 1 FROM scans WHERE name = ?', name)) {
    name = `${base}-${suffix += 1}`;
  }
  return name;
}

function insertScripts(db, table, column, ownerId, scripts) {
  const stmt = db.prepare(
    `INSERT INTO scripts (${column}, ordinal, script_id, output) VALUES (?, ?, ?, ?)`,
  );
  scripts.forEach((script, ordinal) => {
    stmt.run(ownerId, ordinal, script.id ?? '', script.output ?? '');
  });
}

function insertHost(db, scanId, ordinal, host) {
  const result = db.run(
    `INSERT INTO hosts
       (scan_id, ordinal, host_key, start_raw, end_raw, state, reason, uptime, distance,
        srtt, rttvar, to_rtt, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    scanId,
    ordinal,
    host.key || `host-${ordinal}`,
    host.start ?? '',
    host.end ?? '',
    host.state ?? '',
    host.reason ?? '',
    host.uptime ?? '',
    host.distance ?? '',
    host.times?.srtt ?? '',
    host.times?.rttvar ?? '',
    host.times?.to ?? '',
    host.notes ?? '',
  );
  const hostId = result.lastInsertRowid;

  const address = db.prepare(
    'INSERT INTO host_addresses (host_id, ordinal, addr, type, vendor) VALUES (?, ?, ?, ?, ?)',
  );
  (host.addresses ?? []).forEach((entry, index) => {
    address.run(hostId, index, entry.addr ?? '', entry.type ?? '', entry.vendor ?? '');
  });

  const hostname = db.prepare(
    'INSERT INTO host_names (host_id, ordinal, name, type) VALUES (?, ?, ?, ?)',
  );
  (host.hostnames ?? []).forEach((entry, index) => {
    hostname.run(hostId, index, entry.name ?? '', entry.type ?? '');
  });

  const traceStmt = db.prepare(
    'INSERT INTO traceroutes (host_id, ordinal, port, proto) VALUES (?, ?, ?, ?)',
  );
  const hopStmt = db.prepare(
    'INSERT INTO trace_hops (trace_id, ordinal, ttl, ipaddr, rtt, host) VALUES (?, ?, ?, ?, ?, ?)',
  );
  (host.traces ?? []).forEach((trace, traceIndex) => {
    const traceResult = traceStmt.run(
      hostId,
      traceIndex,
      trace.port ?? '',
      trace.proto ?? '',
    );
    (trace.hops ?? []).forEach((hop, hopIndex) => {
      hopStmt.run(
        traceResult.lastInsertRowid,
        hopIndex,
        Number(hop.ttl ?? 0) || 0,
        hop.ipaddr ?? '',
        hop.rtt ?? '',
        hop.host ?? '',
      );
    });
  });

  const portStmt = db.prepare(
    `INSERT INTO ports
       (host_id, ordinal, protocol, port_id, state, reason, reason_ttl,
        service_name, service_product, service_version, service_extra_info,
        service_method, service_conf, service_ostype, service_devicetype)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const cpeStmt = db.prepare(
    'INSERT INTO service_cpes (port_id, ordinal, value) VALUES (?, ?, ?)',
  );
  (host.ports ?? []).forEach((port, portIndex) => {
    const portResult = portStmt.run(
      hostId,
      portIndex,
      port.protocol ?? '',
      Number.parseInt(port.portId, 10) || 0,
      port.state ?? 'unknown',
      port.reason ?? '',
      port.reasonTtl ?? '',
      port.service?.name ?? '',
      port.service?.product ?? '',
      port.service?.version ?? '',
      port.service?.extraInfo ?? '',
      port.service?.method ?? '',
      port.service?.conf ?? 0,
      port.service?.ostype ?? '',
      port.service?.devicetype ?? '',
    );
    const portId = portResult.lastInsertRowid;
    (port.service?.cpe ?? []).forEach((value, index) => cpeStmt.run(portId, index, value));
    insertScripts(db, 'scripts', 'port_id', portId, port.scripts ?? []);
    insertScripts(db, 'scripts', 'service_port_id', portId, port.service?.scripts ?? []);
  });

  const osMatch = db.prepare(
    'INSERT INTO os_matches (host_id, ordinal, name, accuracy, line) VALUES (?, ?, ?, ?, ?)',
  );
  (host.os ?? []).forEach((entry, index) => {
    osMatch.run(hostId, index, entry.name ?? '', entry.accuracy ?? 0, entry.line ?? '');
  });

  const osClass = db.prepare(
    `INSERT INTO os_classes
       (host_id, ordinal, type, vendor, os_family, os_gen, accuracy)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const osCpe = db.prepare(
    'INSERT INTO os_class_cpes (os_class_id, ordinal, value) VALUES (?, ?, ?)',
  );
  (host.osClasses ?? []).forEach((entry, index) => {
    const result = osClass.run(
      hostId,
      index,
      entry.type ?? '',
      entry.vendor ?? '',
      entry.osFamily ?? '',
      entry.osGen ?? '',
      entry.accuracy ?? 0,
    );
    (entry.cpe ?? []).forEach((value, cpeIndex) => osCpe.run(result.lastInsertRowid, cpeIndex, value));
  });

  const groupStmt = db.prepare(
    'INSERT INTO extra_port_groups (host_id, ordinal, state, port_count) VALUES (?, ?, ?, ?)',
  );
  const reasonStmt = db.prepare(
    `INSERT INTO extra_port_reasons (group_id, ordinal, reason, count, proto, ports)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  (host.extraPorts ?? []).forEach((group, index) => {
    const result = groupStmt.run(hostId, index, group.state ?? 'unknown', group.count ?? 0);
    (group.reasons ?? []).forEach((reason, reasonIndex) => {
      reasonStmt.run(
        result.lastInsertRowid,
        reasonIndex,
        reason.reason ?? '',
        reason.count ?? 0,
        reason.proto ?? '',
        reason.ports ?? '',
      );
    });
  });

  insertScripts(db, 'scripts', 'host_id', hostId, host.scripts ?? []);
}

export function saveParsed(db, options) {
  const {
    name,
    xml,
    rawText = '',
    parsed,
    source = 'upload',
    command = '',
    durationMs = 0,
    exitCode = null,
    stderr = '',
    jobId = null,
    replace = false,
  } = options;

  if (typeof xml !== 'string' || !xml.trim()) throw new ValidationError('El XML está vacío.');
  const cleanXml = stripAtlasNotes(xml);
  const now = Date.now();

  return db.transaction(() => {
    let finalName = name ? requireName(name) : uniqueName(db, 'scan');
    const existing = db.get('SELECT id FROM scans WHERE name = ?', finalName);
    if (existing) {
      if (!replace) finalName = uniqueName(db, finalName);
      else {
        db.run('DELETE FROM scans WHERE id = ?', existing.id);
      }
    }

    const result = db.run(
      `INSERT INTO scans
         (name, source, scanner, args, command, nmap_version, xml_output_version,
          start_raw, startstr, started_at, duration_ms, exit_code, stderr,
          warnings_json, raw_xml, raw_text, raw_size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      finalName,
      source,
      parsed.scanner ?? 'nmap',
      parsed.args ?? '',
      command,
      parsed.version ?? '',
      parsed.xmloutputversion ?? '',
      parsed.start ?? '',
      parsed.startstr ?? '',
      parsed.start ? numDate(parsed.start) : null,
      durationMs,
      exitCode,
      stderr ?? '',
      JSON.stringify(parsed.warnings ?? []),
      cleanXml,
      typeof rawText === 'string' ? rawText : '',
      byteLength(cleanXml),
      now,
      now,
    );
    const scanId = result.lastInsertRowid;

    const info = db.prepare(
      `INSERT INTO scan_infos (scan_id, ordinal, type, protocol, num_services, services)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    (parsed.scanInfos ?? []).forEach((entry, index) => {
      info.run(scanId, index, entry.type ?? '', entry.protocol ?? '', entry.numServices ?? 0, entry.services ?? '');
    });

    const stats = parsed.runStats;
    if (stats) {
      db.run(
        `INSERT INTO run_stats
           (scan_id, hosts_up, hosts_down, hosts_total, elapsed, summary, finished_str)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        scanId,
        stats.hostsUp ?? 0,
        stats.hostsDown ?? 0,
        stats.hostsTotal ?? 0,
        stats.elapsed ?? '',
        stats.summary ?? '',
        stats.finishedStr ?? '',
      );
    }

    (parsed.hosts ?? []).forEach((host, index) => insertHost(db, scanId, index, host));

    if (jobId) {
      db.run('UPDATE scan_jobs SET scan_id = ? WHERE id = ?', scanId, jobId);
    }
    return finalName;
  })();
}

function numDate(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed * 1000 : null;
}

export function list(db) {
  return db.all(
    `SELECT name, raw_size, created_at, updated_at FROM scans ORDER BY created_at DESC, id DESC`,
  ).map((row) => ({
    name: row.name,
    size: Number(row.raw_size ?? 0),
    mtime: new Date(Number(row.updated_at ?? row.created_at ?? 0)).toISOString(),
  }));
}

export function count(db) {
  return Number(db.get('SELECT COUNT(*) AS total FROM scans')?.total ?? 0);
}

export function getByName(db, name) {
  return db.get('SELECT * FROM scans WHERE name = ?', requireName(name));
}

export function getRawText(db, name) {
  const row = db.get('SELECT name, raw_text FROM scans WHERE name = ?', requireName(name));
  if (!row) throw new ValidationError('El escaneo indicado no existe.');
  return { name: row.name, text: row.raw_text ?? '' };
}

export function rename(db, from, to) {
  const source = requireName(from);
  const destination = requireName(to);
  if (source === destination) return source;
  if (!getByName(db, source)) throw new ValidationError('El escaneo indicado no existe.');
  if (getByName(db, destination)) throw new ValidationError('Ya existe un escaneo con ese nombre.');
  db.run('UPDATE scans SET name = ?, updated_at = ? WHERE name = ?', destination, Date.now(), source);
  return destination;
}

export function remove(db, name) {
  const normalized = requireName(name);
  const result = db.run('DELETE FROM scans WHERE name = ?', normalized);
  if (!result.changes) throw new ValidationError('El escaneo indicado no existe.');
  return normalized;
}

export function removeAll(db) {
  return Number(db.run('DELETE FROM scans').changes ?? 0);
}

export function setHostNote(db, name, index, notes) {
  const scan = getByName(db, name);
  if (!scan) throw new ValidationError('El escaneo indicado no existe.');
  if (!Number.isInteger(index) || index < 0) throw new ValidationError('Índice de host no válido.');
  if (typeof notes !== 'string' || notes.length > MAX_NOTES) {
    throw new ValidationError(`La nota es demasiado larga (máximo ${MAX_NOTES} caracteres).`);
  }
  const result = db.run(
    'UPDATE hosts SET notes = ? WHERE scan_id = ? AND ordinal = ?',
    notes.trim(),
    scan.id,
    index,
  );
  if (!result.changes) throw new ValidationError('Índice de host no válido.');
  return true;
}

export function setHostNoteByKey(db, name, hostKey, notes) {
  const scan = getByName(db, name);
  if (!scan) throw new ValidationError('El escaneo indicado no existe.');
  if (typeof hostKey !== 'string' || !hostKey || hostKey.length > 100) {
    throw new ValidationError('Clave de host no válida.');
  }
  if (typeof notes !== 'string' || notes.length > MAX_NOTES) {
    throw new ValidationError(`La nota es demasiado larga (máximo ${MAX_NOTES} caracteres).`);
  }
  db.run(
    'UPDATE hosts SET notes = ? WHERE scan_id = ? AND host_key = ?',
    notes.trim(),
    scan.id,
    hostKey,
  );
  return true;
}

/** Migración única de notas de localStorage: solo rellena hosts sin nota. */
export function migrateHostNotes(db, entries) {
  if (!Array.isArray(entries)) throw new ValidationError('Lista de notas no válida.');
  if (entries.length > 10_000) throw new ValidationError('Demasiadas notas para migrar.');

  return db.transaction(() => {
    let migrated = 0;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const { name, hostKey, notes } = entry;
      const scanName = normalizeScanName(name);
      if (typeof scanName !== 'string' || !SAFE_NAME.test(scanName)) continue;
      if (typeof hostKey !== 'string' || !hostKey || hostKey.length > 100) continue;
      if (typeof notes !== 'string' || !notes.trim() || notes.length > MAX_NOTES) continue;

      const scan = getByName(db, scanName);
      if (!scan) continue;
      const host = db.get(
        'SELECT notes FROM hosts WHERE scan_id = ? AND host_key = ?',
        scan.id,
        hostKey,
      );
      // Si el XML ya traía <atlas-note>, esa nota manda: no la pisamos con
      // un valor antiguo que pudiera quedar en localStorage.
      if (!host || (host.notes ?? '').trim()) continue;

      setHostNoteByKey(db, scanName, hostKey, notes);
      migrated += 1;
    }
    return migrated;
  })();
}

export function buildScan(db, scan) {
  const infos = db.all(
    'SELECT * FROM scan_infos WHERE scan_id = ? ORDER BY ordinal',
    scan.id,
  ).map((row) => ({
    type: row.type,
    protocol: row.protocol,
    numServices: Number(row.num_services ?? 0),
    services: row.services,
  }));

  const stats = db.get('SELECT * FROM run_stats WHERE scan_id = ?', scan.id);
  const runStats = stats
    ? {
        hostsUp: Number(stats.hosts_up ?? 0),
        hostsDown: Number(stats.hosts_down ?? 0),
        hostsTotal: Number(stats.hosts_total ?? 0),
        elapsed: stats.elapsed ?? '',
        summary: stats.summary ?? '',
        finishedStr: stats.finished_str ?? '',
      }
    : null;

  const scriptsFor = (column, ownerId) => db.all(
    `SELECT script_id, output FROM scripts WHERE ${column} = ? ORDER BY ordinal`,
    ownerId,
  ).map((row) => ({ id: row.script_id, output: row.output }));

  const tracesFor = (hostId) => db.all(
    'SELECT * FROM traceroutes WHERE host_id = ? ORDER BY ordinal',
    hostId,
  ).map((trace) => ({
    port: trace.port,
    proto: trace.proto,
    hops: db.all(
      'SELECT ttl, ipaddr, rtt, host FROM trace_hops WHERE trace_id = ? ORDER BY ordinal',
      trace.id,
    ).map((hop) => ({ ...hop, ttl: Number(hop.ttl ?? 0) })),
  }));

  const hosts = db.all(
    'SELECT * FROM hosts WHERE scan_id = ? ORDER BY ordinal',
    scan.id,
  ).map((host) => {
    const ports = db.all(
      'SELECT * FROM ports WHERE host_id = ? ORDER BY ordinal',
      host.id,
    ).map((port) => {
      const cpes = db.all(
        'SELECT value FROM service_cpes WHERE port_id = ? ORDER BY ordinal',
        port.id,
      ).map((row) => row.value);
      const serviceScripts = scriptsFor('service_port_id', port.id);
      const hasService = Boolean(
        port.service_name || port.service_product || port.service_version ||
        port.service_extra_info || port.service_method || port.service_ostype ||
        port.service_devicetype || cpes.length || serviceScripts.length,
      );
      return {
        protocol: port.protocol,
        portId: String(port.port_id),
        state: port.state,
        reason: port.reason,
        reasonTtl: port.reason_ttl,
        service: hasService
          ? {
              name: port.service_name,
              product: port.service_product,
              version: port.service_version,
              extraInfo: port.service_extra_info,
              method: port.service_method,
              conf: Number(port.service_conf ?? 0),
              ostype: port.service_ostype,
              devicetype: port.service_devicetype,
              cpe: cpes,
              scripts: serviceScripts,
            }
          : undefined,
        scripts: scriptsFor('port_id', port.id),
      };
    });

    const groups = db.all(
      'SELECT * FROM extra_port_groups WHERE host_id = ? ORDER BY ordinal',
      host.id,
    ).map((group) => ({
      state: group.state,
      count: Number(group.port_count ?? 0),
      reasons: db.all(
        'SELECT * FROM extra_port_reasons WHERE group_id = ? ORDER BY ordinal',
        group.id,
      ).map((reason) => ({
        reason: reason.reason,
        count: Number(reason.count ?? 0),
        proto: reason.proto,
        ports: reason.ports,
      })),
    }));

    const osClasses = db.all(
      'SELECT * FROM os_classes WHERE host_id = ? ORDER BY ordinal',
      host.id,
    ).map((entry) => ({
      type: entry.type,
      vendor: entry.vendor,
      osFamily: entry.os_family,
      osGen: entry.os_gen,
      accuracy: Number(entry.accuracy ?? 0),
      cpe: db.all(
        'SELECT value FROM os_class_cpes WHERE os_class_id = ? ORDER BY ordinal',
        entry.id,
      ).map((row) => row.value),
    }));

    return {
      key: host.host_key || `host-${host.ordinal}`,
      start: host.start_raw,
      end: host.end_raw,
      state: host.state,
      reason: host.reason,
      addresses: db.all(
        'SELECT addr, type, vendor FROM host_addresses WHERE host_id = ? ORDER BY ordinal',
        host.id,
      ),
      hostnames: db.all(
        'SELECT name, type FROM host_names WHERE host_id = ? ORDER BY ordinal',
        host.id,
      ),
      ports,
      extraPorts: groups,
      os: db.all(
        'SELECT name, accuracy, line FROM os_matches WHERE host_id = ? ORDER BY ordinal',
        host.id,
      ).map((entry) => ({ ...entry, accuracy: Number(entry.accuracy ?? 0) })),
      osClasses,
      uptime: host.uptime,
      distance: host.distance,
      times: host.srtt || host.rttvar || host.to_rtt
        ? { srtt: host.srtt, rttvar: host.rttvar, to: host.to_rtt }
        : null,
      traces: tracesFor(host.id),
      scripts: scriptsFor('host_id', host.id),
      notes: host.notes ?? '',
    };
  });

  return {
    scanner: scan.scanner || 'nmap',
    args: scan.args,
    start: scan.start_raw,
    startstr: scan.startstr,
    version: scan.nmap_version,
    xmloutputversion: scan.xml_output_version,
    scanInfos: infos,
    hosts,
    runStats,
    filename: scan.name,
    rawSize: Number(scan.raw_size ?? 0),
    warnings: json(scan.warnings_json, []),
  };
}

export function getScanJson(db, name) {
  const scan = getByName(db, name);
  if (!scan) throw new ValidationError('El escaneo indicado no existe.');
  return buildScan(db, scan);
}
