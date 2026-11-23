export type Theme = 'gruvbox' | 'dracula';

export const themes: Theme[] = ['gruvbox', 'dracula'];

const STORAGE_KEY = 'nmap-atlas:theme';

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dracula' || saved === 'gruvbox') return saved;
  } catch {
    // localStorage puede no estar disponible.
  }
  return 'gruvbox';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage puede no estar disponible.
  }
}
