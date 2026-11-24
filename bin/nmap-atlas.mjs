#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createApp } from '../server/app.mjs';
import { initializeDatabase } from '../db/migrate.mjs';

const standalone = Boolean(globalThis.Bun?.isStandaloneExecutable);
const embeddedDir = standalone ? (import.meta.dir ?? process.cwd()) : null;
const embeddedDist = embeddedDir ? path.join(embeddedDir, 'dist') : null;
const embeddedDb = embeddedDir ? path.join(embeddedDir, 'db') : null;

const HELP = `
Nmap Atlas CLI

Uso:
  nmap-atlas [opciones]

Opciones:
  -p, --port <puerto>        Puerto HTTP (por defecto 4173)
  -h, --host <host>          Host de escucha (por defecto 127.0.0.1)
      --host 0.0.0.0         Exponer en la red (solo en redes de confianza)
      --db-path <ruta>       Base de datos SQLite (por defecto ./data/nmap-atlas.sqlite)
                             También con NMAP_ATLAS_DB_PATH
      --timeout <ms>         Tiempo máximo por escaneo (por defecto 1800000 = 30 min)
      --host-timeout <ms>    Tiempo máximo por host (por defecto sin límite)
      --no-save              No guardar los escaneos en la base de datos
      --nmap-sudo            Ejecutar nmap con «sudo -n» (requiere NOPASSWD)
      --nmap-command <cmd>   Prefijo completo, por defecto «nmap»
      --nmap-privileged      Añade --privileged a nmap (con setcap, sin root)
      --nse-scripts-dir <ruta>  Directorio de scripts NSE (detección automática)
      --ipcalc-command <cmd> Ruta a ipcalc, por defecto «ipcalc»
      --gowitness-command <cmd>  Ruta a gowitness, por defecto «gowitness»
      --help                 Mostrar esta ayuda

Ejemplos:
  nmap-atlas
  nmap-atlas --port 8080 --db-path ./data/otra.sqlite
  nmap-atlas --nmap-sudo
  npx nmap-atlas --host 0.0.0.0
`;

const config = {
  host: '127.0.0.1',
  port: 4173,
  dbPath: process.env.NMAP_ATLAS_DB_PATH?.trim()
    ? path.resolve(process.cwd(), process.env.NMAP_ATLAS_DB_PATH.trim())
    : path.resolve(process.cwd(), 'data/nmap-atlas.sqlite'),
  dbDir: embeddedDb && existsSync(embeddedDb) ? embeddedDb : path.resolve(process.cwd(), 'db'),
  distDir: embeddedDist && existsSync(embeddedDist)
    ? embeddedDist
    : path.resolve(process.cwd(), 'dist'),
  timeoutMs: 1_800_000,
  hostTimeoutMs: null,
  save: true,
  cwd: process.cwd(),
  nmapCommand: (process.env.NMAP_ATLAS_NMAP_COMMAND ?? 'nmap').trim().split(/\s+/).filter(Boolean),
  nmapPrivileged: ['1', 'true', 'yes'].includes(
    (process.env.NMAP_ATLAS_NMAP_PRIVILEGED ?? '').trim().toLowerCase(),
  ),
  nseScriptsDir: process.env.NMAP_ATLAS_NSE_SCRIPTS_DIR?.trim() || null,
  ipcalcCommand: process.env.NMAP_ATLAS_IPCALC_COMMAND?.trim() || 'ipcalc',
  gowitnessCommand: process.env.NMAP_ATLAS_GOWITNESS_COMMAND?.trim() || 'gowitness',
};

const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  const next = () => args[++index];
  switch (arg) {
    case '--help':
    case '-?':
      console.log(HELP);
      process.exit(0);
      break;
    case '--port':
    case '-p':
      config.port = Number(next());
      break;
    case '--host':
    case '-h':
      config.host = next();
      break;
    case '--db-path':
      config.dbPath = path.resolve(process.cwd(), next());
      break;
    case '--timeout':
      config.timeoutMs = Number(next());
      break;
    case '--host-timeout':
      config.hostTimeoutMs = Number(next());
      break;
    case '--no-save':
      config.save = false;
      break;
    case '--nmap-sudo':
      config.nmapCommand = ['sudo', '-n', 'nmap'];
      break;
    case '--nmap-command':
      config.nmapCommand = next().trim().split(/\s+/).filter(Boolean);
      break;
    case '--nmap-privileged':
      config.nmapPrivileged = true;
      break;
    case '--nse-scripts-dir':
      config.nseScriptsDir = next().trim() || null;
      break;
    case '--ipcalc-command':
      config.ipcalcCommand = next().trim() || 'ipcalc';
      break;
    case '--gowitness-command':
      config.gowitnessCommand = next().trim() || 'gowitness';
      break;
    default:
      if (arg.startsWith('--port=')) config.port = Number(arg.slice(7));
      else if (arg.startsWith('--host=')) config.host = arg.slice(7);
      else if (arg.startsWith('--db-path=')) config.dbPath = path.resolve(process.cwd(), arg.slice(10));
      else if (arg.startsWith('--timeout=')) config.timeoutMs = Number(arg.slice(10));
      else if (arg.startsWith('--host-timeout=')) config.hostTimeoutMs = Number(arg.slice(15));
      else if (arg.startsWith('--nmap-command=')) {
        config.nmapCommand = arg.slice(15).trim().split(/\s+/).filter(Boolean);
      }
      else if (arg.startsWith('--nse-scripts-dir=')) {
        config.nseScriptsDir = arg.slice(18).trim() || null;
      }
      else if (arg.startsWith('--ipcalc-command=')) {
        config.ipcalcCommand = arg.slice(17).trim() || 'ipcalc';
      }
      else if (arg.startsWith('--gowitness-command=')) {
        config.gowitnessCommand = arg.slice(20).trim() || 'gowitness';
      }
      else {
        console.error(`Opción desconocida: ${arg}\n${HELP}`);
        process.exit(1);
      }
  }
}

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  console.error('Puerto no válido.');
  process.exit(1);
}
if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000) {
  console.error('Timeout no válido.');
  process.exit(1);
}
if (config.hostTimeoutMs !== null &&
    (!Number.isInteger(config.hostTimeoutMs) || config.hostTimeoutMs < 1000 || config.hostTimeoutMs > 1_800_000)) {
  console.error('Timeout por host no válido (1000–1800000 ms).');
  process.exit(1);
}
if (!config.nmapCommand.length) {
  console.error('El comando de nmap no puede estar vacío.');
  process.exit(1);
}

let db;
try {
  db = await initializeDatabase(config);
} catch (error) {
  console.error('[nmap-atlas] No se pudo inicializar la base de datos:', error);
  process.exit(1);
}

const activeScans = new Map();
const app = createApp({ db, config, activeScans });
let server;

if (globalThis.Bun?.serve) {
  server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
  });
} else {
  const { serve } = await import('@hono/node-server');
  server = serve({
    port: config.port,
    hostname: config.host,
    fetch: app.fetch,
  });
}

console.log(`Nmap Atlas → http://${config.host}:${config.port}`);
console.log(`Base de datos: ${config.dbPath}`);
console.log(`Vista web: ${embeddedDist ? 'incrustada en el binario' : config.distDir}`);
console.log(`nmap: ${config.nmapCommand.join(' ')}`);
console.log(`ipcalc: ${config.ipcalcCommand}`);
console.log(`gowitness: ${config.gowitnessCommand} → capturas en SQLite`);
console.log(`Tiempo por host: ${config.hostTimeoutMs ? `${config.hostTimeoutMs} ms` : 'sin límite'}`);
console.log('Pulsa Ctrl+C para detener.');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try { server?.stop?.(); } catch { /* ya detenido */ }
    try { server?.close?.(() => process.exit(0)); } catch { /* ya detenido */ }
    try { db.close(); } catch { /* ya cerrada */ }
    setTimeout(() => process.exit(0), 200).unref?.();
  });
}
