import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const INDEX_NAME = 'atlas-screenshots.json';

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

/**
 * fish añade ~/go/bin mediante `fish_user_paths`; solo existe en procesos
 * iniciados desde fish. Si el servidor se lanza desde bash o un lanzador,
 * buscamos también los destinos habituales de `go install`.
 */
function gowitnessCommand(config) {
  const command = splitCommand(config.gowitnessCommand ?? process.env.NMAP_ATLAS_GOWITNESS_COMMAND, 'gowitness');
  const name = command[0];
  if (name.includes('/') || name.includes('\\')) return command;
  const inPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => isExecutable(path.join(dir, name)));
  if (inPath) return command;
  const fallback = [
    path.join(homedir(), 'go', 'bin', name),
    path.join(homedir(), '.local', 'bin', name),
    path.join('/usr/local/bin', name),
  ].find(isExecutable);
  return fallback ? [fallback, ...command.slice(1)] : command;
}

export function screenshotDir(config) {
  return config.gowitnessDir ?? path.resolve(path.dirname(config.scansDir), 'screenshots');
}

export async function readScreenshotIndex(config) {
  try {
    const raw = await readFile(path.join(screenshotDir(config), INDEX_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Comprueba si gowitness está disponible y devuelve su versión. */
export function getGowitnessVersion(config) {
  const command = gowitnessCommand(config);
  return new Promise((resolve) => {
    // gowitness v3 responde a `version`, no a `--version` (este último solo
    // imprime la ayuda). El banner incluye líneas como «v3, with <3 by...».
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

async function countScreenshots(dir) {
  try {
    const files = await readdir(dir, { withFileTypes: true });
    return files.filter(
      (entry) => entry.isFile() && /\.(jpe?g|png)$/i.test(entry.name),
    ).length;
  } catch {
    return 0;
  }
}

function urlKey(value) {
  try {
    const url = new URL(value);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    return `${hostname}:${port}`;
  } catch {
    return null;
  }
}

async function writeIndex(dir, index) {
  const file = path.join(dir, INDEX_NAME);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(index, null, 2), 'utf8');
  await rename(temp, file);
}

/**
 * Pasa el XML guardado a gowitness para capturar solo servicios HTTP abiertos.
 * El JSONL de salida permite asociar cada captura con su IP:puerto. Devuelve
 * un aviso en español; nunca lanza errores hacia el escaneo principal.
 */
export async function captureHttpScreenshots(xmlPath, config) {
  const command = gowitnessCommand(config);
  const dir = screenshotDir(config);
  const timeoutMs = config.gowitnessTimeoutMs ?? 600_000;
  const before = await countScreenshots(dir);
  try {
    await mkdir(dir, { recursive: true });
    accessSync(dir, fsConstants.W_OK);
  } catch (error) {
    return `gowitness no puede escribir en ${dir}: ${error.message}. Corrige el propietario con: sudo chown -R "$USER:$USER" "${dir}"`;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonl = path.join(dir, `.gowitness-${stamp}.jsonl`);
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
        // `--service-contains http` está invertido en v3 (comprueba si
        // "http" contiene el nombre de servicio), así que usamos la lista
        // explícita de servicios HTTP documentada por gowitness.
        ...['http', 'https', 'http-alt', 'https-alt', 'http-mgmt', 'http-proxy', 'www', 'www-http']
          .flatMap((service) => ['--service', service]),
        '--write-jsonl',
        '--write-jsonl-file', jsonl,
      ],
      { shell: false, cwd: config.cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
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
      const index = await readScreenshotIndex(config);
      const lines = (await readFile(jsonl, 'utf8')).split('\n').filter(Boolean);
      for (const line of lines) {
        let result;
        try { result = JSON.parse(line); } catch { continue; }
        if (!result.file_name || result.failed || result.response_code === 0) continue;
        const key = urlKey(result.url ?? result.final_url);
        if (!key) continue;
        const url = result.url ?? result.final_url ?? '';
        const shot = {
          file: path.basename(result.file_name),
          url,
          title: result.title ?? '',
          code: result.response_code,
        };
        // gowitness prueba http y https para el mismo puerto: nos quedamos
        // con la respuesta con éxito y, si ambas lo son, con http.
        const score = (entry) =>
          (entry.code >= 200 && entry.code < 400 ? 100 : 0) + (entry.url.startsWith('http://') ? 1 : 0);
        captured += 1;
        if (!index[key] || score(shot) > score(index[key])) index[key] = shot;
      }
      await writeIndex(dir, index);
    } catch {
      // Si no hay JSONL (versiones antiguas), seguimos contando los archivos.
      captured = Math.max(0, (await countScreenshots(dir)) - before);
    }
  }
  await unlink(jsonl).catch(() => {});

  if (exit.error) return `No se pudo ejecutar gowitness: ${exit.error.message}`;
  const detail = output.trim().split('\n').slice(-2).join(' ').slice(0, 200);
  if (/permission denied|eacces/i.test(detail)) {
    return `gowitness no puede escribir en ${dir}. Corrige el propietario con: sudo chown -R "$USER:$USER" "${dir}"`;
  }
  if (exit.code !== 0) {
    return `gowitness terminó con código ${exit.code} y no se pudieron capturar pantallas. ${detail}`.trim();
  }
  return `Capturas de servicios HTTP guardadas en ${dir} (${captured} nuevas).`;
}
