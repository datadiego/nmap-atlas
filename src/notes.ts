const HOST_NOTES_KEY = 'nmap-atlas:host-notes';
const MIGRATED_KEY = 'nmap-atlas:host-notes-migrated';

interface LegacyNote {
  name: string;
  hostKey: string;
  notes: string;
}

/**
 * Heredado de la etapa en la que las notas vivían en localStorage. Se llama
 * una sola vez al arrancar: las notas pasan a hosts.notes en SQLite y se
 * eliminan del navegador. Si el servidor no responde, se reintenta en el
 * siguiente arranque.
 */
export async function migrateLegacyNotes(): Promise<number> {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return 0;
    const raw = localStorage.getItem(HOST_NOTES_KEY);
    if (!raw) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return 0;
    }

    const saved = JSON.parse(raw) as Record<string, unknown>;
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      localStorage.setItem(MIGRATED_KEY, '1');
      return 0;
    }

    const notes: LegacyNote[] = Object.entries(saved).flatMap(([key, value]) => {
      const separator = key.indexOf('\u0000');
      if (separator <= 0 || typeof value !== 'string' || !value.trim()) return [];
      const name = key.slice(0, separator);
      const hostKey = key.slice(separator + 1);
      return name && hostKey ? [{ name, hostKey, notes: value }] : [];
    });

    if (!notes.length) {
      localStorage.removeItem(HOST_NOTES_KEY);
      localStorage.setItem(MIGRATED_KEY, '1');
      return 0;
    }

    const response = await fetch('/api/notes/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    if (!response.ok) return 0;

    const data = (await response.json().catch(() => ({}))) as { migrated?: number };
    localStorage.removeItem(HOST_NOTES_KEY);
    localStorage.setItem(MIGRATED_KEY, '1');
    return Number(data.migrated ?? 0);
  } catch {
    // Sin localStorage o sin servidor: no marcamos la migración como hecha.
    return 0;
  }
}
