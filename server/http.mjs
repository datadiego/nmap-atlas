import { byteLength } from '../core/fs.mjs';
import { ValidationError } from './errors.mjs';

const MAX_BODY = 8 * 1024 * 1024;

export async function readJson(c) {
  const text = await c.req.text();
  if (byteLength(text) > MAX_BODY) {
    throw new ValidationError('La petición es demasiado grande.');
  }
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('objeto esperado');
    }
    return value;
  } catch {
    throw new ValidationError('Cuerpo JSON no válido.');
  }
}
