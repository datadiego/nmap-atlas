import { Glob } from 'bun';
import { join } from './path.mjs';

/** Acceso a archivos usando Bun.file/Bun.write, sin node:fs. */

const encoder = new TextEncoder();

export function byteLength(value) {
  return encoder.encode(String(value ?? '')).length;
}

export async function readText(file) {
  return Bun.file(file).text();
}

export async function readBytes(file) {
  return new Uint8Array(await Bun.file(file).arrayBuffer());
}

export async function writeText(file, value) {
  await Bun.write(file, value);
}

export async function exists(file) {
  return Bun.file(file).exists();
}

export async function stat(file) {
  return Bun.file(file).stat();
}

export async function isDirectory(file) {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
}

export function ensureDir(dir) {
  const result = Bun.spawnSync(['mkdir', '-p', dir]);
  return result.exitCode === 0;
}

export async function makeTempDir(prefix) {
  const base = Bun.env.TMPDIR || Bun.env.TEMP || Bun.env.TMP || '/tmp';
  const dir = join(base, `${prefix}${crypto.randomUUID().replace(/-/g, '')}`);
  ensureDir(dir);
  return dir;
}

export function removeDir(dir) {
  return Bun.spawnSync(['rm', '-rf', '--', dir]).exitCode === 0;
}

export function globFiles(dir, pattern) {
  return [...new Glob(pattern).scanSync({ cwd: dir })];
}

export async function isExecutable(file) {
  try {
    return ((await stat(file)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
