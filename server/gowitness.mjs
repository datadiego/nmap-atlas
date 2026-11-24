import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { insertScreenshot } from '../db/repositories/screenshots.mjs';

function splitCommand(value, fallback) {
  const parts = typeof value === 'string' ? value.trim().split(/\s+/) : value;
  return Array.isArray(parts) && parts.length ? parts : [fallback];
}

function isExecutable(file) {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** fish añade ~/go/bin mediante fish_user_paths; buscamos también los destinos habituales. */
function gowitnessCommand(config) {
  const command = splitCommand(config.gowitnessCommand ?? process.env.NMAP_ATLAS_GOWITNESS_COMMAND, 'gowitness');
  const name = command[0];
  if (name.includes('/') || name.includes('\\')) return command;
  const inPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => isExecutable(path.join(dir, name)));
  if (inPath) return command;

  // Con `sudo ./nmap-atlas`, HOME pasa a ser /root y PATH pierde ~/go/bin.
  // SUDO_USER conserva la cuenta original, así que buscamos también en su HOME.
  const homes = [homedir()];
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && /^[A-Za-z0-9._-]+$/.test(sudoUser)) {
    homes.push(path.join('/home', sudoUser), path.join('/Users', sudoUser));
  }
  const fallback = [...new Set(homes)]
    .flatMap((home) => [
      path.join(home, 'go', 'bin', name),
      path.join(home, '.local', 'bin', name),
    ])
    .concat(path.join('/usr/local/bin', name))
    .find(isExecutable);
  return fallback ? [fallback, ...command.slice(1)] : command;
}

/** Solo se usa como dato informativo del estado; las imágenes viven en SQLite. */
export function screenshotDir(config) {
  return config.gowitnessDir ?? path.resolve(path.dirname(config.dbPath ?? config.scansDir ?? process.cwd()), 'screenshots');
}

/** Comprueba si gowitness está disponible y devuelve su versión. */
export function getGowitnessVersion(config) {
  const command = gowitnessCommand(config);
  return new Promise((resolve) => {
    const child = spawn(command[0], [...command.slice(1), 'version'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const match = /(?:^|\s)v(\d+(?:\.\d+)*)/i.exec(output);
      resolve(match ? match[1] : output.trim() ? 'instalado' : null);
    });
  });
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
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return null;
}

/**
 * Ejecuta gowitness sobre el XML en un directorio temporal, importa las
 * capturas correctas como BLOB a SQLite y borra todos los temporales.
 */
export async function captureHttpScreenshots(xml, config, db, scanId) {
  const command = gowitnessCommand(config);
  const timeoutMs = config.gowitnessTimeoutMs ?? 600_000;
  let dir;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'nmap-atlas-gw-'));
  } catch (error) {
    return `No se pudo crear el directorio temporal para capturas: ${error.message}`;
  }

  const xmlPath = path.join(dir, 'scan.xml');
  const jsonl = path.join(dir, 'results.jsonl');
  await writeFile(xmlPath, xml, 'utf8');

  let child;
  try {
    child = spawn(
      command[0],
      [
        ...command.slice(1),
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
      { shell: false, cwd: config.cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return `No se pudo iniciar gowitness: ${error.message}`;
  }

  let output = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      output += `\nCapturas detenidas tras ${timeoutMs} ms.`;
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  }).catch((error) => ({ error }));

  let captured = 0;
  if (!exit.error && exit.code === 0) {
    try {
      const lines = (await readFile(jsonl, 'utf8')).split('\n').filter(Boolean);
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
          file: path.basename(result.file_name),
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
        const data = await readFile(path.join(dir, shot.file));
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

  await rm(dir, { recursive: true, force: true }).catch(() => {});
  if (exit.error) return `No se pudo ejecutar gowitness: ${exit.error.message}`;
  const detail = output.trim().split('\n').slice(-2).join(' ').slice(0, 200);
  if (/permission denied|eacces/i.test(detail)) {
    return `gowitness no puede capturar pantallas. Detalle: ${detail}`;
  }
  if (exit.code !== 0) {
    return `gowitness terminó con código ${exit.code} y no se pudieron capturar pantallas. ${detail}`.trim();
  }
  return `Capturas de servicios HTTP guardadas en la base de datos (${captured} nuevas).`;
}
