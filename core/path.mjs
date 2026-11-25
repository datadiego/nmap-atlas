/** Utilidades de rutas sobre Bun, sin módulos de Node. */
export const sep = '/';
export const delimiter = ':';

export function currentDir() {
  return process.cwd();
}

export function normalize(input) {
  const value = String(input ?? '');
  const absolute = value.startsWith('/');
  const parts = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push('..');
      continue;
    }
    parts.push(part);
  }
  const joined = parts.join('/');
  if (absolute) return `/${joined}`;
  return joined || '.';
}

export function isAbsolute(input) {
  return String(input ?? '').startsWith('/');
}

/** Equivale a path.resolve con el directorio de trabajo de Bun. */
export function resolve(...parts) {
  const list = parts.filter((part) => part !== '' && part != null).map((part) => String(part));
  let absoluteIndex = -1;
  for (let index = 0; index < list.length; index += 1) {
    if (list[index].startsWith('/')) absoluteIndex = index;
  }
  const relevant = absoluteIndex === -1 ? [currentDir(), ...list] : list.slice(absoluteIndex);
  return normalize(relevant.join('/'));
}

/** Equivale a path.join: une segmentos y limpia '.' y '..'. */
export function join(...parts) {
  return normalize(parts.filter((part) => part !== '' && part != null).join('/'));
}

export function dirname(input) {
  const value = normalize(input);
  const index = value.lastIndexOf('/');
  if (index === -1) return '.';
  if (index === 0) return '/';
  return value.slice(0, index) || '/';
}

export function basename(input, extension = '') {
  const value = normalize(input);
  const name = value.slice(value.lastIndexOf('/') + 1);
  return extension && name.endsWith(extension) ? name.slice(0, -extension.length) : name;
}

export function extname(input) {
  const name = basename(input);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index);
}
