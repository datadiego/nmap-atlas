#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createServer } from '../server/index.mjs';

const standalone = Boolean(globalThis.Bun?.isStandaloneExecutable);
const embeddedDist = standalone ? path.join(import.meta.dir ?? process.cwd(), 'dist') : null;

const HELP = `
Nmap Atlas CLI

Uso:
  nmap-atlas [opciones]

Opciones:
  -p, --port <puerto>        Puerto HTTP (por defecto 4173)
  -h, --host <host>          Host de escucha (por defecto 127.0.0.1)
      --host 0.0.0.0         Exponer en la red (solo en redes de confianza)
      --scans-dir <ruta>     Dónde guardar los XML (por defecto ./scans)
      --timeout <ms>         Tiempo máximo por escaneo (por defecto 1800000 = 30 min)
      --host-timeout <ms>    Tiempo máximo por host (por defecto sin límite)
      --no-save              No guardar los XML en disco
      --nmap-sudo            Ejecutar nmap con «sudo -n» (requiere NOPASSWD)
      --nmap-command <cmd>   Prefijo completo, por defecto «nmap»
      --ipcalc-command <cmd> Ruta a ipcalc, por defecto «ipcalc»
      --help                 Mostrar esta ayuda

Ejemplos:
  nmap-atlas
  nmap-atlas --port 8080 --scans-dir ./mis-escaneos
  nmap-atlas --nmap-sudo
  npx nmap-atlas --host 0.0.0.0
`;

const config = {
  host: '127.0.0.1',
  port: 4173,
  scansDir: path.resolve(process.cwd(), 'scans'),
  distDir: embeddedDist && existsSync(embeddedDist)
    ? embeddedDist
    : path.resolve(process.cwd(), 'dist'),
  timeoutMs: 1_800_000,
  hostTimeoutMs: null,
  save: true,
  cwd: process.cwd(),
  nmapCommand: (process.env.NMAP_ATLAS_NMAP_COMMAND ?? 'nmap').trim().split(/\s+/).filter(Boolean),
  ipcalcCommand: process.env.NMAP_ATLAS_IPCALC_COMMAND?.trim() || 'ipcalc',
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
    case '--scans-dir':
      config.scansDir = path.resolve(process.cwd(), next());
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
    case '--ipcalc-command':
      config.ipcalcCommand = next().trim() || 'ipcalc';
      break;
    default:
      if (arg.startsWith('--port=')) config.port = Number(arg.slice(7));
      else if (arg.startsWith('--host=')) config.host = arg.slice(7);
      else if (arg.startsWith('--scans-dir=')) config.scansDir = path.resolve(process.cwd(), arg.slice(12));
      else if (arg.startsWith('--timeout=')) config.timeoutMs = Number(arg.slice(10));
      else if (arg.startsWith('--host-timeout=')) config.hostTimeoutMs = Number(arg.slice(15));
      else if (arg.startsWith('--nmap-command=')) {
        config.nmapCommand = arg.slice(15).trim().split(/\s+/).filter(Boolean);
      }
      else if (arg.startsWith('--ipcalc-command=')) {
        config.ipcalcCommand = arg.slice(17).trim() || 'ipcalc';
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

const server = createServer(config);
server.on('error', (error) => {
  console.error('[nmap-atlas] No se pudo iniciar el servidor:', error.message);
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  console.log(`Nmap Atlas → http://${config.host}:${config.port}`);
  console.log(`Vista web: ${embeddedDist ? 'incrustada en el binario' : config.distDir}`);
  console.log(`nmap: ${config.nmapCommand.join(' ')}`);
  console.log(`ipcalc: ${config.ipcalcCommand}`);
  console.log(`Tiempo por host: ${config.hostTimeoutMs ? `${config.hostTimeoutMs} ms` : 'sin límite'}`);
  console.log(`XML guardados en ${config.scansDir}${config.save ? '' : ' (desactivado)'}`);
  console.log('Pulsa Ctrl+C para detener.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
