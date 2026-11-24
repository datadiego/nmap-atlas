import { ValidationError } from '../../server/errors.mjs';

const LOCALES = new Set(['es', 'en']);
const VIEWS = new Set(['grid', 'hierarchy', 'list', 'screenshots']);

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function getSettings(db) {
  const row = db.get('SELECT * FROM app_settings WHERE id = 1');
  return {
    locale: row?.locale ?? 'es',
    theme: row?.theme ?? 'gruvbox',
    viewMode: row?.view_mode ?? 'hierarchy',
    remember: parseJson(row?.remember_json, {}),
    rememberedForm: parseJson(row?.remembered_form_json, {}),
    hideWarning: Boolean(row?.hide_warning ?? 0),
  };
}

export function updateSettings(db, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ValidationError('Ajustes no válidos.');
  }
  const current = getSettings(db);
  const next = { ...current };

  if (patch.locale !== undefined) {
    if (!LOCALES.has(patch.locale)) throw new ValidationError('Idioma no válido.');
    next.locale = patch.locale;
  }
  if (patch.theme !== undefined) {
    if (typeof patch.theme !== 'string' || !patch.theme || patch.theme.length > 40) {
      throw new ValidationError('Tema no válido.');
    }
    next.theme = patch.theme;
  }
  if (patch.viewMode !== undefined) {
    if (!VIEWS.has(patch.viewMode)) throw new ValidationError('Modo de vista no válido.');
    next.viewMode = patch.viewMode;
  }
  if (patch.remember !== undefined) {
    if (!patch.remember || typeof patch.remember !== 'object' || Array.isArray(patch.remember)) {
      throw new ValidationError('Preferencias «recordar» no válidas.');
    }
    next.remember = patch.remember;
  }
  if (patch.rememberedForm !== undefined) {
    if (!patch.rememberedForm || typeof patch.rememberedForm !== 'object' || Array.isArray(patch.rememberedForm)) {
      throw new ValidationError('Formulario recordado no válido.');
    }
    next.rememberedForm = patch.rememberedForm;
  }
  if (patch.hideWarning !== undefined) next.hideWarning = Boolean(patch.hideWarning);

  db.run(
    `UPDATE app_settings
        SET locale = ?, theme = ?, view_mode = ?, remember_json = ?,
            remembered_form_json = ?, hide_warning = ?, updated_at = ?
      WHERE id = 1`,
    next.locale,
    next.theme,
    next.viewMode,
    JSON.stringify(next.remember),
    JSON.stringify(next.rememberedForm),
    next.hideWarning ? 1 : 0,
    Date.now(),
  );
  return next;
}
