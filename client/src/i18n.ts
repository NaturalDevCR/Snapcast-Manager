import { createI18n } from 'vue-i18n';
import enCommon from './locales/en/common.json';
import esCommon from './locales/es/common.json';
import enLayout from './locales/en/layout.json';
import esLayout from './locales/es/layout.json';
import enLogin from './locales/en/login.json';
import esLogin from './locales/es/login.json';
import enSetup from './locales/en/setup.json';
import esSetup from './locales/es/setup.json';
import enOnboarding from './locales/en/onboarding.json';
import esOnboarding from './locales/es/onboarding.json';
import enDashboard from './locales/en/dashboard.json';
import esDashboard from './locales/es/dashboard.json';
import enLogs from './locales/en/logs.json';
import esLogs from './locales/es/logs.json';
import enSecurity from './locales/en/security.json';
import esSecurity from './locales/es/security.json';
import enDiagnostics from './locales/en/diagnostics.json';
import esDiagnostics from './locales/es/diagnostics.json';
import enWatchdogs from './locales/en/watchdogs.json';
import esWatchdogs from './locales/es/watchdogs.json';

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
    en: { common: enCommon, layout: enLayout, login: enLogin, setup: enSetup, onboarding: enOnboarding, dashboard: enDashboard, logs: enLogs, security: enSecurity, diagnostics: enDiagnostics, watchdogs: enWatchdogs },
    es: { common: esCommon, layout: esLayout, login: esLogin, setup: esSetup, onboarding: esOnboarding, dashboard: esDashboard, logs: esLogs, security: esSecurity, diagnostics: esDiagnostics, watchdogs: esWatchdogs },
  },
});

export default i18n;
