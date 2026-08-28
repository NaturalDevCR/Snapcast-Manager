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
import enServerConfig from './locales/en/serverConfig.json';
import esServerConfig from './locales/es/serverConfig.json';
import enPipeSources from './locales/en/pipeSources.json';
import esPipeSources from './locales/es/pipeSources.json';
import enClientDashboard from './locales/en/clientDashboard.json';
import esClientDashboard from './locales/es/clientDashboard.json';
import enTools from './locales/en/tools.json';
import esTools from './locales/es/tools.json';
import enRouting from './locales/en/routing.json';
import esRouting from './locales/es/routing.json';

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
    en: { common: enCommon, layout: enLayout, login: enLogin, setup: enSetup, onboarding: enOnboarding, dashboard: enDashboard, logs: enLogs, security: enSecurity, diagnostics: enDiagnostics, watchdogs: enWatchdogs, serverConfig: enServerConfig, pipeSources: enPipeSources, clientDashboard: enClientDashboard, tools: enTools, routing: enRouting },
    es: { common: esCommon, layout: esLayout, login: esLogin, setup: esSetup, onboarding: esOnboarding, dashboard: esDashboard, logs: esLogs, security: esSecurity, diagnostics: esDiagnostics, watchdogs: esWatchdogs, serverConfig: esServerConfig, pipeSources: esPipeSources, clientDashboard: esClientDashboard, tools: esTools, routing: esRouting },
  },
});

export default i18n;
