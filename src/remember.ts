const REMEMBER_KEY = 'nmap-atlas:remember';
const REMEMBERED_FORM_KEY = 'nmap-atlas:remembered-form';

export const REMEMBER_FIELDS = [
  { id: 'target', label: 'Objetivo' },
  { id: 'ports', label: 'Puertos' },
  { id: 'profile', label: 'Último perfil usado' },
  { id: 'timeout', label: 'Tiempo límite' },
  { id: 'hostTimeout', label: 'Tiempo por host' },
  { id: 'timing', label: 'Velocidad' },
  { id: 'options', label: 'Opciones adicionales' },
] as const;

export type RememberField = (typeof REMEMBER_FIELDS)[number]['id'];
export type RememberSettings = Record<RememberField, boolean>;

export interface RememberedForm {
  target: string;
  ports: string;
  profile: string;
  timeout: string;
  hostTimeout: string;
  timing: string;
  options: string[];
}

export const DEFAULT_FORM_VALUES: RememberedForm = {
  target: '127.0.0.1',
  ports: '',
  profile: 'service',
  timeout: '',
  hostTimeout: '',
  timing: '-T4',
  options: ['-sV', '-sC', '--open'],
};

export const DEFAULT_REMEMBER = Object.fromEntries(
  REMEMBER_FIELDS.map(({ id }) => [id, false]),
) as RememberSettings;

export const loadRememberSettings = (): RememberSettings => {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return { ...DEFAULT_REMEMBER };
    const saved = JSON.parse(raw) as Partial<RememberSettings>;
    return Object.fromEntries(
      REMEMBER_FIELDS.map(({ id }) => [id, saved[id] === true]),
    ) as RememberSettings;
  } catch {
    return { ...DEFAULT_REMEMBER };
  }
};

export const loadRememberedForm = (): Partial<RememberedForm> => {
  try {
    const raw = localStorage.getItem(REMEMBERED_FORM_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as Partial<RememberedForm>;
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
};

export const saveRememberSettings = (settings: RememberSettings) => {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento disponible, los ajustes se recuerdan solo en esta sesión.
  }
};

export const saveRememberedForm = (
  settings: RememberSettings,
  values: Partial<RememberedForm>,
) => {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(settings));
    if (Object.keys(values).length > 0) {
      localStorage.setItem(REMEMBERED_FORM_KEY, JSON.stringify(values));
    } else {
      localStorage.removeItem(REMEMBERED_FORM_KEY);
    }
  } catch {
    // Sin almacenamiento disponible, los ajustes se recuerdan solo en esta sesión.
  }
};

/** Desactiva campos y elimina sus valores guardados para que se carguen los defaults. */
export const forgetRememberedFields = (
  settings: RememberSettings,
  fields: readonly RememberField[],
) => {
  try {
    const saved = loadRememberedForm();
    for (const field of fields) delete saved[field];
    saveRememberedForm(settings, saved);
  } catch {
    // Sin almacenamiento disponible, no hay nada que olvidar.
  }
};
