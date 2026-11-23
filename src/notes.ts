const HOST_NOTES_KEY = 'nmap-atlas:host-notes';

export type HostNotes = Record<string, string>;

/** La clave incluye el archivo para no mezclar notas de escaneos distintos. */
export const hostNotesKey = (filename: string, hostKey: string) =>
  `${filename}\u0000${hostKey}`;

export const loadHostNotes = (): HostNotes => {
  try {
    const raw = localStorage.getItem(HOST_NOTES_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as HostNotes;
    if (!saved || typeof saved !== 'object') return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, value]) => typeof value === 'string'),
    ) as HostNotes;
  } catch {
    return {};
  }
};

export const saveHostNotes = (notes: HostNotes) => {
  try {
    const filled = Object.entries(notes).filter(([, value]) => value.trim());
    if (filled.length === 0) {
      localStorage.removeItem(HOST_NOTES_KEY);
      return;
    }
    localStorage.setItem(HOST_NOTES_KEY, JSON.stringify(Object.fromEntries(filled)));
  } catch {
    // Sin almacenamiento disponible, las notas se conservan solo en esta sesión.
  }
};

export const forgetHostNotes = (filenames: string[]) => {
  if (filenames.length === 0) return;
  const saved = loadHostNotes();
  let changed = false;
  Object.keys(saved).forEach((key) => {
    if (filenames.some((filename) => key.startsWith(`${filename}\u0000`))) {
      delete saved[key];
      changed = true;
    }
  });
  if (changed) saveHostNotes(saved);
};
