import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class ValidationError extends Error {}

const PROFILES = {
  quick: ['-F', '--open'],
  hosts: ['-sn', '-n', '--max-retries=1'],
  service: ['-sV', '-sC', '--open'],
  full: ['-sV', '-sC', '-O', '-p-'],
  custom: [],
};

const ALLOWED_OPTIONS = new Set([
  '-sS',
  '-sT',
  '-sU',
  '-sn',
  '-sL',
  '-sV',
  '--version-light',
  '-sC',
  '-O',
  '--osscan-limit',
  '-A',
  '--open',
  '-F',
  '-p-',
  '-Pn',
  '-PE',
  '--max-retries=1',
  '-n',
  '-R',
  '-6',
  '--traceroute',
]);

const ALLOWED_TIMINGS = new Set(['-T0', '-T1', '-T2', '-T3', '-T4', '-T5']);
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MIN_HOST_TIMEOUT_MS = 1_000;
const MAX_HOST_TIMEOUT_MS = 30 * 60 * 1000;
const SAFE_NAME = /^[A-Za-z0-9._-]+\.xml$/;
const SAFE_SCAN_ID = /^[A-Za-z0-9_-]{1,80}$/;

const MAX_COMMAND_LENGTH = 1000;
// Opciones que no se permiten al editar el comando: salida a fichero, scripts
// NSE, lectura de archivos y objetivos que no sea el último token.
const BLOCKED_FLAG_PREFIXES = [
  '-o', // -oX, -oN, -oA... (no coincide con --open)
  '--script',
  '--exclude',
  '-iL',
  '--datadir',
  '--servicedb',
  '--versiondb',
  '--resume',
  '--stylesheet',
];
const FLAG_PATTERN = /^--?[A-Za-z][A-Za-z0-9._-]*(?:=([A-Za-z0-9._:%+/=-]{1,80}))?$/;
const VALUE_PATTERN = /^[A-Za-z0-9._:%+/=-]{1,80}$/;
const FLAGS_WITH_VALUE = new Set([
  '--scan-delay', '--max-scan-delay', '--host-timeout',
  '--min-rtt-timeout', '--max-rtt-timeout', '--initial-rtt-timeout',
  '--min-rate', '--max-rate', '--min-parallelism', '--max-parallelism',
  '--max-retries', '--ttl', '-e', '-S', '-g', '--source-port',
  '--data-string', '--data-length', '--spoof-mac', '--dns-servers',
]);

function estimateTargets(raw) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const prefix = Number(match[2]);
  if (prefix > 32) return null;
  return 2 ** (32 - prefix);
}

function validateTarget(raw) {
  const target = String(raw ?? '').trim();
  if (!target || target.length > 500) {
    throw new ValidationError('Indica un objetivo válido (IP, hostname, CIDR o rango).');
  }
  if (target.startsWith('-')) {
    throw new ValidationError('El objetivo no puede empezar por guion: se interpretaría como opción.');
  }
  if (/[\n\r;|&$`><(){}!]/.test(target) || !/^[A-Za-z0-9._:/,\[\]\-\s]+$/.test(target)) {
    throw new ValidationError('El objetivo contiene caracteres no permitidos.');
  }
  return target;
}

function validatePorts(raw) {
  if (!raw || !String(raw).trim()) return '';
  const ports = String(raw).trim();
  if (ports.length > 200 || !/^[0-9,\s-]+$/.test(ports)) {
    throw new ValidationError('Puertos no válidos. Usa formatos como 80,443 o 1-1024.');
  }
  for (const token of ports.split(/[\s,]+/).filter(Boolean)) {
    const bounds = token.split('-');
    if (bounds.length > 2 || bounds.some((value) => !/^\d{1,5}$/.test(value))) {
      throw new ValidationError(`Rango de puertos no válido: ${token}`);
    }
    if (bounds.some((value) => Number(value) < 1 || Number(value) > 65535)) {
      throw new ValidationError(`Puerto fuera de rango: ${token}`);
    }
  }
  return ports;
}

function validateOptions(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new ValidationError('Las opciones deben ser una lista.');
  const options = raw.filter((value) => typeof value === 'string' && value.trim());
  const invalid = options.find((option) => !ALLOWED_OPTIONS.has(option));
  if (invalid) throw new ValidationError(`Opción no permitida: ${invalid}`);
  return [...new Set(options)];
}

function validateProfile(raw) {
  const profile = String(raw ?? 'service');
  if (!PROFILES[profile]) throw new ValidationError(`Perfil desconocido: ${profile}`);
  return profile;
}

function validateTiming(raw) {
  const timing = String(raw ?? '-T4');
  if (!ALLOWED_TIMINGS.has(timing)) throw new ValidationError(`Tiempo no válido: ${timing}`);
  return timing;
}

function validateTimeout(raw) {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new ValidationError(
      `Tiempo límite no válido: usa entre ${MIN_TIMEOUT_MS} y ${MAX_TIMEOUT_MS} ms.`,
    );
  }
  return value;
}

function validateHostTimeout(raw) {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_HOST_TIMEOUT_MS || value > MAX_HOST_TIMEOUT_MS) {
    throw new ValidationError(
      `Tiempo por host no válido: usa entre ${MIN_HOST_TIMEOUT_MS} y ${MAX_HOST_TIMEOUT_MS} ms.`,
    );
  }
  return value;
}

function parseHostTimeout(raw) {
  const value = String(raw ?? '').trim();
  const match = /^(\d+)(ms|s|m)?$/i.exec(value);
  if (!match) return Number.NaN;
  const multiplier = match[2]?.toLowerCase() === 's' ? 1000 : match[2]?.toLowerCase() === 'm' ? 60_000 : 1;
  return Number(match[1]) * multiplier;
}

function tokenizeCommand(raw) {
  const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((token) =>
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
      ? token.slice(1, -1)
      : token,
  );
}

function buildArgsFromCommand(raw, config) {
  const command = String(raw).trim();
  if (!command) throw new ValidationError('El comando está vacío.');
  if (command.length > MAX_COMMAND_LENGTH) {
    throw new ValidationError(`El comando es demasiado largo (máximo ${MAX_COMMAND_LENGTH} caracteres).`);
  }
  if (/[\n\r;|&$`><(){}!\\]/.test(command)) {
    throw new ValidationError('El comando contiene caracteres no permitidos.');
  }

  const tokens = tokenizeCommand(command);
  const prefix = nmapCommand(config);
  if (tokens.slice(0, prefix.length).join(' ') !== prefix.join(' ')) {
    throw new ValidationError(`El comando debe empezar por «${prefix.join(' ')}».`);
  }

  const flags = [];
  let ports = '';
  let target = null;
  let waitingFor = null;
  const rest = tokens.slice(prefix.length);

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    // El XML siempre se lee de la salida estándar; nunca de un archivo.
    if (token === '-oX') {
      if (rest[index + 1] !== '-') {
        throw new ValidationError('La salida XML debe ser «-oX -»; no se permiten archivos.');
      }
      index += 1;
      continue;
    }

    if (waitingFor) {
      if (!VALUE_PATTERN.test(token)) {
        throw new ValidationError(`Valor no válido para ${waitingFor}: ${token}`);
      }
      if (waitingFor === '--host-timeout') validateHostTimeout(parseHostTimeout(token));
      flags.push(token);
      waitingFor = null;
      continue;
    }

    if (token.startsWith('-')) {
      const name = token.split('=')[0];

      if (name === '-p' || name === '--port') {
        const value = token.includes('=') ? token.slice(name.length + 1) : rest[index + 1];
        if (value == null || value.startsWith('-')) {
          throw new ValidationError('Falta la lista de puertos después de -p.');
        }
        if (!token.includes('=')) index += 1;
        ports = validatePorts(value);
        continue;
      }

      if (BLOCKED_FLAG_PREFIXES.some((blocked) => name.startsWith(blocked))) {
        throw new ValidationError(`Flag no permitido: ${name}. No se pueden cambiar la salida, los scripts ni los archivos de entrada.`);
      }
      const match = FLAG_PATTERN.exec(token);
      if (!match) throw new ValidationError(`Flag no válido: ${token}`);
      if (name === '--host-timeout' && match[1]) validateHostTimeout(parseHostTimeout(match[1]));

      flags.push(token);
      if (!match[1] && FLAGS_WITH_VALUE.has(name)) waitingFor = name;
      continue;
    }

    if (target !== null) {
      throw new ValidationError('Solo se permite un objetivo en el comando.');
    }
    target = token;
  }

  if (waitingFor) throw new ValidationError(`Falta el valor para ${waitingFor}.`);
  if (!target) throw new ValidationError('Falta el objetivo en el comando.');

  const validatedTarget = validateTarget(target);
  return {
    args: [...flags, ...(ports ? ['-p', ports] : []), '-oX', '-', validatedTarget],
    target: validatedTarget,
    profile: 'custom',
  };
}

export function buildArgs(payload, config) {
  if (payload.command != null && String(payload.command).trim()) {
    return buildArgsFromCommand(payload.command, config);
  }

  const target = validateTarget(payload.target);
  const profile = validateProfile(payload.profile);
  const ports = validatePorts(payload.ports);
  const options = validateOptions(payload.options);
  const timing = validateTiming(payload.timing);
  const hostTimeoutMs = validateHostTimeout(payload.hostTimeoutMs) ?? config.hostTimeoutMs ?? null;
  const hostTimeoutFlag = hostTimeoutMs ? `${hostTimeoutMs}ms` : null;

  // Si el cliente envía «options», esa lista es la fuente de verdad: el perfil
  // solo marca los checks iniciales y no debe reintroducir flags desmarcados.
  const flags = [
    ...(Array.isArray(payload.options) ? [] : PROFILES[profile]),
    ...options,
    timing,
  ].filter((flag) => !ports || flag !== '-p-');
  const uniqueFlags = flags.filter((flag, index) => flags.indexOf(flag) === index);
  const args = [
    ...(hostTimeoutFlag ? ['--host-timeout', hostTimeoutFlag] : []),
    ...uniqueFlags,
    ...(ports ? ['-p', ports] : []),
    '-oX',
    '-',
    target,
  ];
  return { args, target, profile };
}

function nmapCommand(config) {
  const command = Array.isArray(config.nmapCommand) && config.nmapCommand.length
    ? config.nmapCommand
    : ['nmap'];
  return command;
}

export async function getNmapVersion(config) {
  const command = nmapCommand(config);
  return new Promise((resolve) => {
    const child = spawn(command[0], [...command.slice(1), '--version'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const match = /^Nmap version ([^\s]+)/m.exec(output);
      resolve(match ? match[1] : null);
    });
  });
}

async function saveXml(scansDir, xml, target) {
  await mkdir(scansDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = target
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'scan';
  const name = `${stamp}-${slug}.xml`;
  await writeFile(path.join(scansDir, name), xml, 'utf8');
  return name;
}

/** Detiene un escaneo en curso y deja constancia en su stderr. */
export function cancelScan(rawId, activeScans) {
  if (typeof rawId !== 'string' || !SAFE_SCAN_ID.test(rawId)) return false;
  const entry = activeScans.get(rawId);
  if (!entry || entry.child.exitCode !== null || entry.child.signalCode !== null) return false;
  entry.note('Escaneo cancelado por el usuario.');
  entry.child.kill('SIGTERM');
  return true;
}

export async function runNmap(payload, config, activeScans = new Map()) {
  const { args, target } = buildArgs(payload, config);
  const command = nmapCommand(config);
  const timeoutMs = validateTimeout(payload.timeoutMs) ?? config.timeoutMs;
  const scanId = typeof payload.id === 'string' && SAFE_SCAN_ID.test(payload.id) ? payload.id : null;
  const started = Date.now();

  const result = await new Promise((resolve, reject) => {
    const child = spawn(command[0], [...command.slice(1), ...args], {
      shell: false,
      cwd: config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let settled = false;
    // Cola de hosts descubiertos: el primero que aún no ha terminado es el que
    // nmap está analizando ahora (el XML de cada host se emite al completarlo).
    let section = '';
    let blockAddress = '';
    let blockOpenPorts = 0;
    let analysisStarted = false;
    const discovered = [];
    const stats = {
      bytes: 0, hostHints: 0, hosts: 0,
      lastAddress: '', currentAddress: '', queued: 0,
      log: [],
    };
    let lastHostEvent = Date.now();
    const addLog = (message) => {
      const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
      stats.log.push(`${time}  ${message}`);
      if (stats.log.length > 200) stats.log.shift();
      if (/^(Descubierto|Analizando|Completado) /.test(message)) lastHostEvent = Date.now();
    };
    addLog(`Escaneando ${target}`);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      stats.bytes += Buffer.byteLength(chunk);

      // Solo contamos etiquetas completas; las que quedan partidas se unen
      // con el siguiente chunk para no perder ni duplicar hosts.
      const text = pending + chunk;
      const lastTag = text.lastIndexOf('>');
      const complete = lastTag === -1 ? '' : text.slice(0, lastTag + 1);
      pending = lastTag === -1 ? text : text.slice(lastTag + 1);

      stats.hostHints += (complete.match(/<hosthint[\s>]/g) ?? []).length;
      stats.hosts += (complete.match(/<host[\s>]/g) ?? []).length;

      const tags = complete.match(
        /<hosthint\b[^>]*>|<\/hosthint>|<host\b[^>]*>|<\/host>|<address\b[^>]*>|<port\b[^>]*>/g,
      ) ?? [];
      for (const tag of tags) {
        if (tag.startsWith('<hosthint')) {
          section = 'hint';
          blockAddress = '';
        } else if (tag === '</hosthint>') {
          if (blockAddress && !discovered.includes(blockAddress)) {
            discovered.push(blockAddress);
            addLog(`Descubierto ${blockAddress}`);
          }
          section = '';
          blockAddress = '';
        } else if (/^<host\b/.test(tag)) {
          section = 'host';
          blockAddress = '';
          blockOpenPorts = 0;
          if (!analysisStarted) {
            analysisStarted = true;
            if (discovered[0]) addLog(`Analizando ${discovered[0]}`);
          }
        } else if (tag === '</host>') {
          const detail = blockOpenPorts ? ` · ${blockOpenPorts} puertos abiertos` : '';
          if (blockAddress) addLog(`Completado ${blockAddress}${detail}`);
          const index = discovered.indexOf(blockAddress);
          if (index !== -1) discovered.splice(index, 1);
          if (discovered[0]) addLog(`Analizando ${discovered[0]}`);
          section = '';
          blockAddress = '';
        } else if (tag.startsWith('<address')) {
          const match = /addr="([^"]+)"/.exec(tag);
          if (match) {
            blockAddress = match[1];
            stats.lastAddress = blockAddress;
          }
        } else if (section === 'host' && /state="open"/.test(tag)) {
          blockOpenPorts += 1;
        }
      }
      stats.currentAddress = discovered[0] ?? (section === 'host' ? blockAddress : '');
      stats.queued = discovered.length;
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    const note = (message) => {
      stderr += `\n${message}`;
      addLog(message);
    };
    if (scanId) activeScans.set(scanId, { child, note, stats });

    // En un `-sn` grande, nmap puede pasar minutos sin descubrir hosts nuevos.
    // Estas líneas son de Atlas (no de nmap) para que el proceso no parezca parado.
    const heartbeat = args.includes('-sn')
      ? setInterval(() => {
          if (Date.now() - lastHostEvent < 15_000) return;
          const seconds = Math.floor((Date.now() - started) / 1000);
          const count = estimateTargets(target);
          addLog(`Descubriendo ${count ? `${count.toLocaleString('es-ES')} IPs · ` : ''}${seconds} s transcurridos`);
        }, 15_000)
      : null;

    const timer = setTimeout(() => {
      note(`Escaneo detenido tras ${timeoutMs} ms (--timeout).`);
      child.kill('SIGTERM');
    }, timeoutMs);

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (scanId) activeScans.delete(scanId);
      if (error) reject(error);
      else resolve(value);
    };

    child.on('error', (error) =>
      finish(new Error('No se pudo ejecutar nmap. ¿Está instalado y en el PATH? ' + error.message)),
    );
    child.on('close', (code, signal) =>
      finish(null, { stdout, stderr, code, signal }),
    );
  });

  if (!result.stdout.includes('<nmaprun')) {
    const detail = result.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 500);
    const hint = /requires root privileges|privileges/i.test(detail)
      ? ' Consulta la sección «Permisos» del README (setcap, --nmap-sudo o sudo).'
      : '';
    throw new Error(`nmap no devolvió XML. ${detail}${hint}`);
  }

  const savedAs = config.save ? await saveXml(config.scansDir, result.stdout, target) : null;
  return {
    xml: result.stdout,
    command: [...command, ...args].join(' '),
    durationMs: Date.now() - started,
    exitCode: result.code,
    stderr: result.stderr.trim().slice(-1000),
    savedAs,
    timeoutMs,
  };
}

export async function listScans(scansDir) {
  try {
    const entries = await readdir(scansDir, { withFileTypes: true });
    const scans = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && SAFE_NAME.test(entry.name))
        .map(async (entry) => {
          const info = await stat(path.join(scansDir, entry.name));
          return { name: entry.name, size: info.size, mtime: info.mtime.toISOString() };
        }),
    );
    return scans.sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readScan(scansDir, name) {
  if (!SAFE_NAME.test(name)) throw new ValidationError('Nombre de escaneo no válido.');
  return readFile(path.join(scansDir, name), 'utf8');
}

export function validateScanName(name) {
  return SAFE_NAME.test(name);
}
