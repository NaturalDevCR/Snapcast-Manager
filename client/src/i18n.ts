import { createI18n } from 'vue-i18n';
import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';
import enLayout from './locales/en/layout.json';
import esLayout from './locales/es/layout.json';
import enLogin from './locales/en/login.json';
import esLogin from './locales/es/login.json';
import enSetup from './locales/en/setup.json';
import esSetup from './locales/es/setup.json';

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
    en: { common: enCommon, layout: enLayout, login: enLogin, setup: enSetup },
    es: { common: esCommon, layout: esLayout, login: esLogin, setup: esSetup },
  },
});

export default i18n;
