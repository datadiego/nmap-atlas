import { en } from './locales/en';
import { es, type Translation, type TranslationKey } from './locales/es';

export type { Translation, TranslationKey };
export type TFunction = (key: TranslationKey, params?: Record<string, string | number>) => string;

/** Registro de idiomas. Para añadir uno: traducir es.ts y añadirlo aquí. */
export const locales = { es, en } satisfies Record<string, Translation>;

export type Locale = keyof typeof locales;
export const DEFAULT_LOCALE: Locale = 'es';

const LOCALE_KEY = 'nmap-atlas:locale';

export function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    return raw && raw in locales ? (raw as Locale) : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function saveLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Sin almacenamiento, el idioma se mantiene solo durante esta sesión.
  }
}

export function interpolate(
  text: string,
  params: Record<string, string | number> = {},
): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? ''));
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  return interpolate(locales[locale][key], params);
}

/** Idioma actual para módulos que no son componentes React (parser, grafo...). */
let currentLocale: Locale = loadLocale();

export const getLocale = () => currentLocale;

export function setGlobalLocale(locale: Locale) {
  currentLocale = locale;
}

export const tGlobal: TFunction = (key, params) => translate(currentLocale, key, params);

export const formatNumber = (
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
) => new Intl.NumberFormat(locale, options).format(value);

export const formatDateTime = (
  locale: Locale,
  value: Date,
  options?: Intl.DateTimeFormatOptions,
) => new Intl.DateTimeFormat(locale, options).format(value);

export const languageName = (locale: Locale, target: Locale) => {
  const name = new Intl.DisplayNames([locale], { type: 'language' }).of(target) ?? target;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
};
