import { create } from 'zustand';
import { en, TranslationKeys } from './locales/en';

export type SupportedLocale = 'en' | 'es' | 'fr' | 'de' | 'ja' | 'zh';

interface I18nStore {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
  locale: 'en',
  setLocale: (locale) => set({ locale }),
}));

const translations: Record<SupportedLocale, any> = {
  en,
  es: en, // Fallback to en for pending translations
  fr: en,
  de: en,
  ja: en,
  zh: en,
};

/**
 * Universal translation helper.
 * Usage: t('nav.library') or t('reader.pageOf', { current: 1, total: 20 })
 */
export function t(keyPath: string, vars?: Record<string, string | number>): string {
  const { locale } = useI18nStore.getState();
  const dict = translations[locale] || translations.en;

  const keys = keyPath.split('.');
  let current: any = dict;
  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      current = undefined;
      break;
    }
  }

  if (typeof current !== 'string') {
    return keyPath;
  }

  if (vars) {
    return current.replace(/\{(\w+)\}/g, (_, v) => (vars[v] !== undefined ? String(vars[v]) : `{${v}}`));
  }

  return current;
}
