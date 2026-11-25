import {
  isExecutable,
  makeTempDir,
  readBytes,
  readText,
  removeDir,
  writeText,
} from '../core/fs.mjs';
import { captureOutput, readStream } from '../core/process.mjs';
import { basename, currentDir, dirname, extname, join } from '../core/path.mjs';
import { insertScreenshot } from '../db/repositories/screenshots.mjs';

function splitCommand(value, fallback) {
  const parts = typeof value === 'string' ? value.trim().split(/\s+/) : value;
  return Array.isArray(parts) && parts.length ? parts : [fallback];
}

async function gowitnessCommand(config) {
  const command = splitCommand(config.gowitnessCommand ?? Bun.env.NMAP_ATLAS_GOWITNESS_COMMAND, 'gowitness');
  const name = command[0];
  if (name.includes('/') || name.includes('\\')) return command;
  let inPathFound = false;
  for (const dir of (Bun.env.PATH ?? '').split(':')) {
    if (await isExecutable(join(dir, name))) { inPathFound = true; break; }
  }
  if (inPathFound) return command;

  // Con `sudo ./nmap-atlas`, HOME pasa a ser /root y PATH pierde ~/go/bin.
  // SUDO_USER conserva la cuenta original, así que buscamos también en su HOME.
  const sudoUser = Bun.env.SUDO_USER;
  const homes = [Bun.env.HOME ?? ''];
  if (sudoUser && /^[A-Za-z0-9._-]+$/.test(sudoUser)) {
    homes.push(join('/home', sudoUser), join('/Users', sudoUser));
  }
  const candidates = [...new Set(homes.filter(Boolean))]
    .flatMap((home) => [
      join(home, 'go', 'bin', name),
      join(home, '.local', 'bin', name),
    ])
    .concat(join('/usr/local/bin', name));
  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return [candidate, ...command.slice(1)];
  }
  return command;
}

/** Solo se usa como dato informativo del estado; las imágenes viven en SQLite. */
export function screenshotDir(config) {
  return dirname(config.dbPath ?? currentDir());
}

/** Comprueba si gowitness está disponible y devuelve su versión. */
export async function getGowitnessVersion(config) {
  try {
    const command = await gowitnessCommand(config);
    const { output } = await captureOutput([...command, 'version'], { cwd: config.cwd });
    const match = /(?:^|\s)v(\d+(?:\.\d+)*)/i.exec(output);
    return match ? match[1] : output.trim() ? 'instalado' : null;
  } catch {
    return null;
  }
}

export function urlKey(value) {
  try {
    const url = new URL(value);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return `${url.hostname.replace(/^\[|\]$/g, '')}:${port}`;
  } catch {
    return null;
  }
}

function mimeFor(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return null;
}

/**
 * Ejecuta gowitness sobre el XML en un directorio temporal, importa las
 * capturas correctas como BLOB a SQLite y borra todos los temporales.
 */
export async function captureHttpScreenshots(xml, config, db, scanId) {
  const command = await gowitnessCommand(config);
  const timeoutMs = config.gowitnessTimeoutMs ?? 600_000;
  const dir = await makeTempDir('nmap-atlas-gw-');

  const xmlPath = join(dir, 'scan.xml');
  const jsonl = join(dir, 'results.jsonl');
  await writeText(xmlPath, xml);

  let child;
  try {
    child = Bun.spawn(
      [
        ...command,
        'scan', 'nmap',
        '-f', xmlPath,
        '--screenshot-path', dir,
        '--open-only',
        // Con el retardo por defecto (3 s), gowitness v3 + Chromium 156 deja el
        // screenshot esperando hasta el timeout en este contenedor.
        '--delay', '0',
        // `--service-contains http` está invertido en v3; usamos la lista
        // explícita de servicios HTTP documentada por gowitness.
        ...['http', 'https', 'http-alt', 'https-alt', 'http-mgmt', 'http-proxy', 'www', 'www-http']
          .flatMap((service) => ['--service', service]),
        '--write-jsonl',
        '--write-jsonl-file', jsonl,
      ],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', cwd: config.cwd },
    );
  } catch (error) {
    removeDir(dir);
    return `No se pudo iniciar gowitness: ${error.message}`;
  }

  let output = '';
  const streams = Promise.all([
    readStream(child.stdout, (chunk) => { output += chunk; }),
    readStream(child.stderr, (chunk) => { output += chunk; }),
  ]);

  const timer = setTimeout(() => {
    child.kill();
    output += `\nCapturas detenidas tras ${timeoutMs} ms.`;
  }, timeoutMs);

  let signalCode = null;
  let spawnError = null;
  try {
    await child.exited;
  } catch (error) {
    spawnError = error;
  } finally {
    clearTimeout(timer);
    signalCode = child.signalCode;
    await streams;
  }

  let captured = 0;
  if (!spawnError && child.exitCode === 0) {
    try {
      const lines = (await readText(jsonl)).split('\n').filter(Boolean);
      const shots = new Map();
      for (const line of lines) {
        let result;
        try { result = JSON.parse(line); } catch { continue; }
        // Las páginas de error no activan el filtro «Solo con capturas».
        const ok = result.response_code >= 200 && result.response_code < 400;
        if (!result.file_name || result.failed || !ok) continue;
        const key = urlKey(result.url ?? result.final_url);
        if (!key) continue;
        const url = result.url ?? result.final_url ?? '';
        const shot = {
          file: basename(result.file_name),
          url,
          title: result.title ?? '',
          code: result.response_code,
        };
        // gowitness prueba http y https: si ambas funcionan, nos quedamos con http.
        const score = (entry) => (entry.url.startsWith('http://') ? 1 : 0);
        if (!shots.has(key) || score(shot) > score(shots.get(key))) shots.set(key, shot);
      }
      for (const [key, shot] of shots) {
        const mime = mimeFor(shot.file);
        if (!mime) continue;
        const data = await readBytes(join(dir, shot.file));
        insertScreenshot(db, {
          scanId,
          cacheKey: key,
          data,
          mime,
          originalFile: shot.file,
          url: shot.url,
          title: shot.title,
          code: shot.code,
        });
        captured += 1;
      }
    } catch {
      // Sin JSONL no podemos asociar las imágenes con hosts; no importamos nada.
    }
  }

  removeDir(dir);
  if (spawnError) return `No se pudo ejecutar gowitness: ${spawnError.message}`;
  const detail = output.trim().split('\n').slice(-2).join(' ').slice(0, 200);
  if (/permission denied|eacces/i.test(detail)) {
    return `gowitness no puede capturar pantallas. Detalle: ${detail}`;
  }
  if (child.exitCode !== 0) {
    const code = signalCode ? `señal ${signalCode}` : `código ${child.exitCode}`;
    return `gowitness terminó con ${code} y no se pudieron capturar pantallas. ${detail}`.trim();
  }
  return `Capturas de servicios HTTP guardadas en la base de datos (${captured} nuevas).`;
}
