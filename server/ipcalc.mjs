import { readStream } from '../core/process.mjs';
import { ValidationError } from './errors.mjs';

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

async function run(args, config) {
  const proc = Bun.spawn([ipcalcCommand(config), ...args], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: config.cwd,
  });
  let out = '';
  let err = '';
  await Promise.all([
    readStream(proc.stdout, (chunk) => { out += chunk; }),
    readStream(proc.stderr, (chunk) => { err += chunk; }),
  ]);
  return { out, err, code: await proc.exited };
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
  try {
    const { out } = await run(['--version'], config);
    const match = /ipcalc\s+([^\s]+)/i.exec(out);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function calculateRange(raw, config) {
  const target = validateTarget(raw);

  let stdout;
  try {
    const result = await run(['--format=json', target], config);
    if (result.code !== 0) {
      const detail = result.err.trim().split('\n')[0].slice(0, 300) || `ipcalc salió con código ${result.code}`;
      throw new ValidationError(detail);
    }
    stdout = result.out;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('No se pudo ejecutar ipcalc. ¿Está instalado y en el PATH?');
  }

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
