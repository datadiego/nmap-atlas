/**
 * Puente de ajustes con SQLite. localStorage se usa solo como caché de arranque:
 * la primera vez se migran los valores antiguos y después manda la BD.
 */

const SYNC_KEY = 'nmap-atlas:settings-synced';
const KEYS = {
  locale: 'nmap-atlas:locale',
  theme: 'nmap-atlas:theme',
  viewMode: 'nmap-atlas:view-mode',
  remember: 'nmap-atlas:remember',
  rememberedForm: 'nmap-atlas:remembered-form',
  hideWarning: 'nmap-atlas:hide-warning',
};

export interface AppSettings {
  locale: 'es' | 'en';
  theme: string;
  viewMode: string;
  remember: Record<string, boolean>;
  rememberedForm: Record<string, unknown>;
  hideWarning: boolean;
}

let cachedSettings: AppSettings | null = null;

export function currentAppSettings(): AppSettings | null {
  return cachedSettings;
}

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function collectLocal(): Partial<AppSettings> {
  return {
    locale: localStorage.getItem(KEYS.locale) === 'en' ? 'en' : 'es',
    theme: localStorage.getItem(KEYS.theme) ?? 'gruvbox',
    viewMode: localStorage.getItem(KEYS.viewMode) ?? 'hierarchy',
    remember: readJson(KEYS.remember) as Record<string, boolean>,
    rememberedForm: readJson(KEYS.rememberedForm),
    hideWarning: localStorage.getItem(KEYS.hideWarning) === '1',
  };
}

function applyLocal(settings: AppSettings) {
  localStorage.setItem(KEYS.locale, settings.locale);
  localStorage.setItem(KEYS.theme, settings.theme);
  localStorage.setItem(KEYS.viewMode, settings.viewMode);
  localStorage.setItem(KEYS.remember, JSON.stringify(settings.remember ?? {}));
  if (Object.keys(settings.rememberedForm ?? {}).length) {
    localStorage.setItem(KEYS.rememberedForm, JSON.stringify(settings.rememberedForm));
  } else {
    localStorage.removeItem(KEYS.rememberedForm);
  }
  if (settings.hideWarning) localStorage.setItem(KEYS.hideWarning, '1');
  else localStorage.removeItem(KEYS.hideWarning);
}

export function pushSettings(patch: Partial<AppSettings>): Promise<void> {
  try {
    return fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(() => undefined).catch(() => undefined);
  } catch {
    // Sin servidor, los ajustes siguen funcionando en la sesión actual.
    return Promise.resolve();
  }
}

export async function loadAppSettings(): Promise<AppSettings | null> {
  try {
    const response = await fetch('/api/settings');
    if (!response.ok) return null;
    const settings = await response.json() as AppSettings;

    if (!localStorage.getItem(SYNC_KEY)) {
      const local = collectLocal();
      await pushSettings(local);
      localStorage.setItem(SYNC_KEY, '1');
      cachedSettings = { ...settings, ...local };
      return cachedSettings;
    }

    applyLocal(settings);
    cachedSettings = settings;
    return settings;
  } catch {
    return null;
  }
}
