import { createI18n } from 'vue-i18n';
import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';

export type SupportedLocale = 'en' | 'es';
export const SUPPORTED_LOCALES: SupportedLocale[] = ['en', 'es'];

export function detectDefaultLocale(): SupportedLocale {
  const lang = navigator.language?.toLowerCase() ?? '';
  if (lang.startsWith('es')) return 'es';
  return 'en';
}

const storedLocale = localStorage.getItem('locale') as SupportedLocale | null;
const initialLocale: SupportedLocale =
  storedLocale && SUPPORTED_LOCALES.includes(storedLocale) ? storedLocale : detectDefaultLocale();

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: {
    en: { common: enCommon },
    es: { common: esCommon },
  },
});

export default i18n;
