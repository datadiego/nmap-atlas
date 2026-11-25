import { byteLength, makeTempDir, readText, removeDir } from '../core/fs.mjs';
import { captureOutput, readStream } from '../core/process.mjs';
import { join } from '../core/path.mjs';
import { getByName, saveParsed } from '../db/repositories/scans.mjs';
import { updateProgress } from '../db/repositories/jobs.mjs';
import { captureHttpScreenshots } from './gowitness.mjs';
import { parseNmapXml } from './parser/nmapXml.mjs';
import { ValidationError } from './errors.mjs';

const PROFILES = {
  quick: ['-F', '--open'],
  hosts: ['-sn', '-n', '--max-retries=1'],
  // Descubrimiento incisivo: combina ARP (red local), ICMP, TCP y UDP para
  // detectar dispositivos que bloquean un único tipo de sonda (móviles, IoT...).
  deep: [
    '-sn', '-PR', '-PE', '-PP', '-PM',
    '-PS80,443,5223', '-PA80,443', '-PU5353,1900',
    '-n', '--max-retries=2',
  ],
  service: ['-sV', '-sC', '--open'],
  full: ['-sV', '-sC', '-O', '-p-'],
  custom: [],
};

const ALLOWED_OPTIONS = new Set([
  '-sS',
  '-sT',
  '-sU',
  '-sN',
  '-sF',
  '-sX',
  '-sA',
  '-sW',
  '-sM',
  '-sY',
  '-sZ',
  '-sO',
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
  '-PP',
  '-PM',
  '-PR',
  '-PS80,443,5223',
  '-PA80,443',
  '-PU5353,1900',
  '-PS80,443',
  '-PU53,1900',
  '-sIzombie',
  '-bftp.relay',
  '--scanflags=SYNACK',
  '--max-retries=1',
  '--max-retries=2',
  '-n',
  '-R',
  '-6',
  '--traceroute',
]);

// Opciones con argumento editable: se valida el prefijo y el formato del valor.
const SCRIPT_OPTION_PATTERN = /^--script=[A-Za-z0-9][A-Za-z0-9._-]*(?:,[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const ALLOWED_OPTION_PATTERNS = [
  /^-sI[A-Za-z0-9._:-]{1,255}$/,
  /^-b(?:[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?@)?[A-Za-z0-9._-]+(?::\d{1,5})?$/,
  /^--scanflags=[A-Z]{1,64}$/,
  /^-P[SUA][A-Za-z0-9,.-]{1,80}$/,
  SCRIPT_OPTION_PATTERN,
];

const ALLOWED_TIMINGS = new Set(['-T0', '-T1', '-T2', '-T3', '-T4', '-T5']);
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const MIN_HOST_TIMEOUT_MS = 1_000;
const MAX_HOST_TIMEOUT_MS = 30 * 60 * 1000;
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
// Comas, dos puntos y @ se permiten para listas de puertos, zombies y relays FTP.
const FLAG_PATTERN = /^--?[A-Za-z][A-Za-z0-9._,@:-]*(?:=([A-Za-z0-9._:%+/=,-]{1,80}))?$/;
const VALUE_PATTERN = /^[A-Za-z0-9._:%+/=@-]{1,80}$/;
const FLAGS_WITH_VALUE = new Set([
  '--scan-delay', '--max-scan-delay', '--host-timeout',
  '--min-rtt-timeout', '--max-rtt-timeout', '--initial-rtt-timeout',
  '--min-rate', '--max-rate', '--min-parallelism', '--max-parallelism',
  '--max-retries', '--ttl', '-e', '-S', '-g', '--source-port',
  '--data-string', '--data-length', '--spoof-mac', '--dns-servers',
  '-sI', '-b', '--scanflags', '-PS', '-PA', '-PU',
]);

function estimateTargets(raw) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(raw ?? '').trim());
  if (!match) return null;
  const prefix = Number(match[2]);
  if (prefix > 32) return null;
  return 2 ** (32 - prefix);
}

/** IP aproximada que nmap está recorriendo según el avance del CIDR. */
function ipAtProgress(raw, processed) {
  if (!processed) return '';
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(raw ?? '').trim());
  if (!match) return '';
  const prefix = Number(match[2]);
  if (prefix > 32) return '';
  const octets = match[1].split('.').map(Number);
  if (octets.some((octet) => octet > 255)) return '';
  const address = octets.reduce((value, octet) => (value << 8) | octet, 0) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  const count = 2 ** (32 - prefix);
  if (processed >= count) return '';
  // `processed` cuenta las IPs ya terminadas: la siguiente es la que nmap está
  // recorriendo ahora. Es una estimación porque nmap no emite su IP cuando
  // el host no responde.
  const current = (network + processed) >>> 0;
  return [
    (current >>> 24) & 255,
    (current >>> 16) & 255,
    (current >>> 8) & 255,
    current & 255,
  ].join('.');
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
  const invalid = options.find(
    (option) => !ALLOWED_OPTIONS.has(option) && !ALLOWED_OPTION_PATTERNS.some((pattern) => pattern.test(option)),
  );
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

function buildArgsFromCommand(raw, config, options = []) {
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
  const selectedScripts = new Set(
    validateOptions(options).filter((option) => option.startsWith('--script=')),
  );
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

      // El selector de NSE genera '--script=...' también en el comando mostrado;
      // se acepta solo si es exactamente el flag enviado en 'options'.
      if (name === '--script') {
        if (!SCRIPT_OPTION_PATTERN.test(token) || !selectedScripts.has(token)) {
          throw new ValidationError(`Flag no permitido: ${name}. No se pueden cambiar la salida, los scripts ni los archivos de entrada.`);
        }
        flags.push(token);
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
    return buildArgsFromCommand(payload.command, config, payload.options);
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
  return Array.isArray(config.nmapCommand) && config.nmapCommand.length
    ? config.nmapCommand
    : ['nmap'];
}

/** Con setcap, nmap sigue creyendo que no es root hasta recibir --privileged. */
function nmapInvocation(config) {
  const command = nmapCommand(config);
  if (config.nmapPrivileged && !command.includes('--privileged')) {
    return [...command, '--privileged'];
  }
  return command;
}

export async function getNmapVersion(config) {
  const command = nmapInvocation(config);
  try {
    const { output } = await captureOutput([...command, '--version'], { cwd: config.cwd });
    const match = /^Nmap version ([^\s]+)/m.exec(output);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function scanName(target) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = String(target ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'scan';
  return `${stamp}-${slug}`;
}

/** Detiene un escaneo en curso y deja constancia en su stderr. */
export function cancelScan(rawId, activeScans) {
  if (typeof rawId !== 'string' || !SAFE_SCAN_ID.test(rawId)) return false;
  const entry = activeScans.get(rawId);
  if (!entry || entry.child.exitCode !== null || entry.child.signalCode !== null) return false;
  entry.note('Escaneo cancelado por el usuario.');
  entry.child.kill();
  return true;
}

export async function runNmap(payload, config, db, activeScans = new Map()) {
  const { args, target } = buildArgs(payload, config);
  const command = nmapInvocation(config);
  // La salida "normal" (-oN) se captura en un temporal: nunca sustituye al XML
  // en SQLite, que sigue siendo la única fuente de verdad.
  const normalDir = await makeTempDir('nmap-atlas-normal-');
  const normalPath = join(normalDir, 'nmap.nmap');
  let normalText = '';
  try {
  // Nmap solo emite <taskprogress> en el XML si se pide explícitamente.
  // Es la única forma fiable de saber cuántas IPs lleva procesadas, incluso
  // cuando no hay resultados (hosts caídos o sin respuesta).
  const nmapArgs = [...args, '-oN', normalPath];
  if (!nmapArgs.some((arg) => arg === '--stats-every' || arg.startsWith('--stats-every='))) {
    const outputIndex = nmapArgs.indexOf('-oX');
    nmapArgs.splice(outputIndex === -1 ? nmapArgs.length : outputIndex, 0, '--stats-every=1s');
  }
  const timeoutMs = validateTimeout(payload.timeoutMs) ?? config.timeoutMs;
  const scanId = typeof payload.id === 'string' && SAFE_SCAN_ID.test(payload.id) ? payload.id : null;
  const started = Date.now();

  const result = await new Promise((resolve, reject) => {
    const child = Bun.spawn([...command, ...nmapArgs], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: config.cwd,
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
    const totalTargets = estimateTargets(target);
    const stats = {
      bytes: 0, hostHints: 0, hosts: 0, total: totalTargets ?? 0,
      processed: 0, percent: 0, currentApprox: false,
      lastAddress: '', currentAddress: '', queued: 0,
      log: [],
    };
    let lastHostEvent = Date.now();
    const addLog = (message) => {
      const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
      stats.log.push(`${time}  ${message}`);
      if (stats.log.length > 200) stats.log.shift();
      if (/^(Descubierto|Analizando|Completado) /.test(message)) lastHostEvent = Date.now();
      if (scanId) updateProgress(db, scanId, stats);
    };
    const progressText = () => {
      const current = stats.currentAddress
        ? ` · en curso ${stats.currentApprox ? '~' : ''}${stats.currentAddress}`
        : '';
      if (totalTargets) {
        return ` · ${stats.processed.toLocaleString('es-ES')}/${totalTargets.toLocaleString('es-ES')} IPs${current}`;
      }
      const percent = Math.round(stats.percent);
      return percent > 0 ? ` · ${percent}%${current}` : current;
    };
    addLog(`Escaneando ${target}`);

    const stdoutStream = readStream(child.stdout, (chunk) => {
      stdout += chunk;
      stats.bytes += byteLength(chunk);

      // Solo contamos etiquetas completas; las que quedan partidas se unen
      // con el siguiente chunk para no perder ni duplicar hosts.
      const text = pending + chunk;
      const lastTag = text.lastIndexOf('>');
      const complete = lastTag === -1 ? '' : text.slice(0, lastTag + 1);
      pending = lastTag === -1 ? text : text.slice(lastTag + 1);

      stats.hostHints += (complete.match(/<hosthint[\s>]/g) ?? []).length;
      stats.hosts += (complete.match(/<host[\s>]/g) ?? []).length;

      const tags = complete.match(
        /<hosthint\b[^>]*>|<\/hosthint>|<host\b[^>]*>|<\/host>|<address\b[^>]*>|<port\b[^>]*>|<taskprogress\b[^>]*\/>/g,
      ) ?? [];
      for (const tag of tags) {
        if (tag.startsWith('<taskprogress')) {
          const percentMatch = /percent="([\d.]+)"/.exec(tag);
          const percent = percentMatch ? Number(percentMatch[1]) : Number.NaN;
          if (Number.isFinite(percent)) {
            stats.percent = Math.max(stats.percent, percent);
            if (totalTargets) {
              const done = Math.min(totalTargets, Math.round((totalTargets * percent) / 100));
              stats.processed = Math.max(stats.processed, done);
            }
          }
        } else if (tag.startsWith('<hosthint')) {
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
          if (blockAddress) addLog(`Completado ${blockAddress}${detail}${progressText()}`);
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
      const liveAddress = discovered[0] ?? (section === 'host' ? blockAddress : '');
      if (liveAddress) {
        stats.currentAddress = liveAddress;
        stats.currentApprox = false;
      } else {
        const estimated = ipAtProgress(target, stats.processed);
        stats.currentAddress = estimated;
        stats.currentApprox = Boolean(estimated);
      }
      stats.queued = discovered.length;
    });
    const stderrStream = readStream(child.stderr, (chunk) => { stderr += chunk; });

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
          addLog(`Descubriendo${progressText() || ` · ${seconds} s transcurridos`}`);
        }, 15_000)
      : null;

    const timer = setTimeout(() => {
      note(`Escaneo detenido tras ${timeoutMs} ms (--timeout).`);
      child.kill();
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

    void (async () => {
      let error = null;
      try {
        await child.exited;
      } catch (cause) {
        error = cause;
      }
      await Promise.all([stdoutStream, stderrStream]);
      if (error) {
        finish(new Error('No se pudo ejecutar nmap. ¿Está instalado y en el PATH? ' + error.message));
      } else {
        finish(null, { stdout, stderr, code: child.exitCode, signal: child.signalCode });
      }
    })();
  });

  if (!result.stdout.includes('<nmaprun')) {
    const detail = result.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 500);
    const hint = /requires root privileges|privileges/i.test(detail)
      ? ' Consulta la sección «Permisos» del README (setcap, --nmap-sudo o sudo).'
      : '';
    throw new Error(`nmap no devolvió XML. ${detail}${hint}`);
  }

  try {
    normalText = await readText(normalPath);
  } catch {
    // Un escaneo cancelado antes del primer host puede no escribir Salida normal.
  }

  const displayName = `nmap ${target}`;
  let parsed;
  try {
    parsed = parseNmapXml(result.stdout);
  } catch (error) {
    // Un XML dañado no debe impedir ver el stderr ni el progreso del escaneo.
    parsed = {
      scanner: 'nmap',
      args: '',
      start: '',
      startstr: '',
      version: '',
      xmloutputversion: '',
      scanInfos: [],
      hosts: [],
      runStats: null,
      filename: '',
      rawSize: byteLength(result.stdout),
      warnings: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (result.code !== 0 && normalText) {
    parsed.warnings = [...(parsed.warnings ?? []), 'Salida normal incompleta.'];
  }

  // El flag interno -oN no se muestra: el usuario ve solo el XML y sus flags.
  const displayCommand = [...command, ...args].join(' ');
  let savedAs = null;
  if (config.save) {
    savedAs = saveParsed(db, {
      name: scanName(target),
      xml: result.stdout,
      rawText: normalText,
      parsed,
      source: 'nmap',
      command: displayCommand,
      durationMs: Date.now() - started,
      exitCode: result.code,
      stderr: result.stderr.trim().slice(-1000),
      jobId: scanId,
    });
    parsed = { ...parsed, filename: savedAs };
  } else {
    parsed = { ...parsed, filename: displayName };
  }

  let gowitness = null;
  if (payload.gowitness === true) {
    if (!savedAs) {
      gowitness = 'No se pueden capturar pantallas sin guardar el escaneo (--no-save).';
    } else {
      try {
        const row = getByName(db, savedAs);
        gowitness = await captureHttpScreenshots(result.stdout, config, db, row.id);
      } catch (error) {
        // Un fallo de gowitness nunca debe impedir devolver el escaneo.
        gowitness = `No se pudieron capturar pantallas: ${error.message}`;
      }
    }
  }
  return {
    xml: result.stdout,
    rawText: normalText,
    scan: parsed,
    command: displayCommand,
    durationMs: Date.now() - started,
    exitCode: result.code,
    stderr: result.stderr.trim().slice(-1000),
    savedAs,
    gowitness,
    timeoutMs,
  };
  } finally {
    removeDir(normalDir);
  }
}
