import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

/**
 * Devuelve los scripts NSE que nmap tiene instalados. SQLite sigue siendo la
 * única fuente de verdad de los datos; esta lista es solo el catálogo del
 * ejecutable nmap para rellenar el formulario de escaneo.
 */

const SCRIPT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.nse$/;
const CACHE_MS = 5 * 60 * 1000;
let cache = null;

function withDelimiter(value) {
  return String(value ?? '')
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Directorios candidatos, ordenados por especificidad. */
function scriptDirs(config) {
  const dirs = [
    ...withDelimiter(config?.nseScriptsDir),
    ...withDelimiter(process.env.NMAP_ATLAS_NSE_SCRIPTS_DIR),
  ];

  const command = Array.isArray(config?.nmapCommand) ? config.nmapCommand : ['nmap'];
  const absolute = command.find((token) => token.startsWith('/') || /^[A-Za-z]:[\\/]/.test(token));
  if (absolute) {
    const bin = dirname(absolute);
    dirs.push(join(bin, '..', 'share', 'nmap', 'scripts'), join(bin, 'scripts'));
  }

  dirs.push(
    '/usr/share/nmap/scripts',
    '/usr/local/share/nmap/scripts',
    '/opt/homebrew/share/nmap/scripts',
    '/opt/local/share/nmap/scripts',
    join(homedir(), '.nmap', 'scripts'),
    'C:\\Program Files\\Nmap\\scripts',
    'C:\\Program Files (x86)\\Nmap\\scripts',
  );

  return [...new Set(dirs.map((dir) => resolve(dir)))];
}

function cleanDescription(value) {
  return String(value ?? '')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function parseMetadata(source) {
  const categoriesMatch = /categories\s*=\s*\{([^}]*)\}/.exec(source);
  const categories = categoriesMatch
    ? [...categoriesMatch[1].matchAll(/(["'])([^"']+)\1/g)].map((match) => match[2])
    : [];

  const longMatch = /description\s*=\s*\[\[([\s\S]*?)\]\]/.exec(source);
  const shortMatch = /description\s*=\s*(["'])([\s\S]*?)\1/.exec(source);
  const description = cleanDescription(longMatch?.[1] ?? shortMatch?.[2] ?? '');

  return { categories, description };
}

async function readDirScripts(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && SCRIPT_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(files.map(async (file) => {
    const source = await readFile(join(dir, file), 'utf8').catch(() => '');
    return {
      name: file.slice(0, -4),
      ...parseMetadata(source.slice(0, 12_000)),
    };
  }));
}

export async function listNseScripts(config) {
  const dirs = scriptDirs(config);
  const key = dirs.join('|');
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;

  for (const dir of dirs) {
    try {
      const scripts = await readDirScripts(dir);
      if (!scripts.length) continue;
      const value = { dir, scripts };
      cache = { at: Date.now(), key, value };
      return value;
    } catch {
      // Probamos el siguiente directorio candidato.
    }
  }

  const value = { dir: '', scripts: [] };
  cache = { at: Date.now(), key, value };
  return value;
}
