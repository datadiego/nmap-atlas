import { spawn } from 'node:child_process';
import { ValidationError } from './nmap.mjs';

const MAX_TARGET_LENGTH = 120;
// Solo direcciones IPv4/IPv6 con prefijo opcional. Se rechaza cualquier cosa
// que empiece por guion para que ipcalc no interprete la entrada como opción.
const TARGET_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?$|^[0-9a-fA-F:]+(?:\/\d{1,3})?$/;
const FIELDS = [
  'ADDRESS',
  'FULLADDRESS',
  'NETWORK',
  'FULLNETWORK',
  'NETMASK',
  'PREFIX',
  'CIDR',
  'BROADCAST',
  'ADDRSPACE',
  'MINADDR',
  'MAXADDR',
  'ADDRESSES',
];

function ipcalcCommand(config) {
  return config.ipcalcCommand ?? 'ipcalc';
}

export function validateTarget(raw) {
  if (typeof raw !== 'string') throw new ValidationError('La dirección debe ser texto.');
  const target = raw.trim();
  if (!target) throw new ValidationError('Escribe una dirección IP o un rango en CIDR.');
  if (target.length > MAX_TARGET_LENGTH) {
    throw new ValidationError(`La dirección es demasiado larga (máximo ${MAX_TARGET_LENGTH} caracteres).`);
  }
  if (!TARGET_PATTERN.test(target)) {
    throw new ValidationError('Formato no válido. Usa una IP (10.0.0.1), un CIDR (10.0.0.0/24) o una IPv6.');
  }
  return target;
}

export async function getIpcCalcVersion(config) {
  return new Promise((resolve) => {
    const child = spawn(ipcalcCommand(config), ['--version'], {
      shell: false,
      cwd: config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const match = /ipcalc\s+([^\s]+)/i.exec(output);
      resolve(match ? match[1] : null);
    });
  });
}

export async function calculateRange(raw, config) {
  const target = validateTarget(raw);

  const stdout = await new Promise((resolve, reject) => {
    const child = spawn(ipcalcCommand(config), ['--format=json', target], {
      shell: false,
      cwd: config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', () =>
      reject(new ValidationError('No se pudo ejecutar ipcalc. ¿Está instalado y en el PATH?')),
    );
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = err.trim().split('\n')[0].slice(0, 300) || `ipcalc salió con código ${code}`;
        reject(new ValidationError(detail));
        return;
      }
      resolve(out);
    });
  });

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new ValidationError('ipcalc no devolvió un JSON válido. ¿Es la versión 1.2.0 o superior?');
  }
  if (!data.CIDR || !data.PREFIX) {
    throw new ValidationError('ipcalc no devolvió los datos de red esperados.');
  }

  const result = { input: target, family: data.FULLADDRESS || target.includes(':') ? 'IPv6' : 'IPv4' };
  for (const field of FIELDS) {
    if (data[field] != null) result[field.toLowerCase()] = String(data[field]);
  }
  return result;
}
