import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { pushSettings } from '../settings';
import {
  formatDateTime,
  formatNumber,
  loadLocale,
  saveLocale,
  setGlobalLocale,
  translate,
  type Locale,
  type TFunction,
  type TranslationKey,
} from './index';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDateTime: (value: Date, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(loadLocale);

  // Los módulos no-React leen el idioma de aquí; se actualiza antes de renderizar.
  setGlobalLocale(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    saveLocale(next);
    pushSettings({ locale: next });
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key: TranslationKey, params) => translate(locale, key, params),
    formatNumber: (numberValue, options) => formatNumber(locale, numberValue, options),
    formatDateTime: (date, options) => formatDateTime(locale, date, options),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n debe usarse dentro de I18nProvider');
  return context;
}
