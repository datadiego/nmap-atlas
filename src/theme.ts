import { useSyncExternalStore } from 'react';

export type Theme = 'gruvbox' | 'dracula' | 'dark' | 'light';

export const themes: Theme[] = ['gruvbox', 'dracula', 'dark', 'light'];

const STORAGE_KEY = 'nmap-atlas:theme';
const listeners = new Set<() => void>();

function isTheme(value: string | null | undefined): value is Theme {
  return value === 'gruvbox' || value === 'dracula' || value === 'dark' || value === 'light';
}

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isTheme(saved)) return saved;
  } catch {
    // localStorage puede no estar disponible.
  }
  return 'gruvbox';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function emitThemeChange(): void {
  listeners.forEach((listener) => listener());
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage puede no estar disponible.
  }
  emitThemeChange();
}

function getThemeSnapshot(): Theme {
  const current = document.documentElement.dataset.theme;
  return isTheme(current) ? current : 'gruvbox';
}

function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !isTheme(event.newValue)) return;
    applyTheme(event.newValue);
    emitThemeChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => 'gruvbox');
}
