import type { LayoutMode } from './graph/layouts';
import { pushSettings } from './settings';

/** La lista, las capturas y la salida raw comparten selector con las dos distribuciones del grafo. */
export type ViewMode = LayoutMode | 'list' | 'screenshots' | 'raw';

const VIEW_MODE_KEY = 'nmap-atlas:view-mode';

export function loadViewMode(): ViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    return raw === 'grid' || raw === 'list' || raw === 'hierarchy' || raw === 'screenshots' || raw === 'raw'
      ? raw
      : 'hierarchy';
  } catch {
    return 'hierarchy';
  }
}

export function saveViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Sin almacenamiento, el modo se mantiene solo durante esta sesión.
  }
  pushSettings({ viewMode: mode });
}
