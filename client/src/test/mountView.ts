// Shared mount helper for view smoke tests.
//
// Every view depends on Pinia (stores) and most depend on Vue Router
// (directly, or via <Layout> which calls useRoute()/useRouter()). This
// installs a real Pinia instance and a minimal in-memory router so a view
// can mount without a running backend or browser history APIs.
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { watch, type Component } from 'vue';
import enCommon from '../locales/en/common.json';
import esCommon from '../locales/es/common.json';
import enLayout from '../locales/en/layout.json';
import esLayout from '../locales/es/layout.json';
import enLogin from '../locales/en/login.json';
import esLogin from '../locales/es/login.json';
import enSetup from '../locales/en/setup.json';
import esSetup from '../locales/es/setup.json';
import enOnboarding from '../locales/en/onboarding.json';
import esOnboarding from '../locales/es/onboarding.json';
import enDashboard from '../locales/en/dashboard.json';
import esDashboard from '../locales/es/dashboard.json';
import enLogs from '../locales/en/logs.json';
import esLogs from '../locales/es/logs.json';
import enSecurity from '../locales/en/security.json';
import esSecurity from '../locales/es/security.json';
import enDiagnostics from '../locales/en/diagnostics.json';
import esDiagnostics from '../locales/es/diagnostics.json';
import enWatchdogs from '../locales/en/watchdogs.json';
import esWatchdogs from '../locales/es/watchdogs.json';
import { useUIStore } from '../stores/ui';

// A fresh i18n instance per mount (not the app's shared singleton) so tests
// never leak locale state between each other; always defaults to 'en' so
// every EXISTING English-text assertion in this codebase's smoke tests
// keeps passing unchanged (spec §"Testing").
function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: {
      en: { common: enCommon, layout: enLayout, login: enLogin, setup: enSetup, onboarding: enOnboarding, dashboard: enDashboard, logs: enLogs, security: enSecurity, diagnostics: enDiagnostics, watchdogs: enWatchdogs },
      es: { common: esCommon, layout: esLayout, login: esLogin, setup: esSetup, onboarding: esOnboarding, dashboard: esDashboard, logs: esLogs, security: esSecurity, diagnostics: esDiagnostics, watchdogs: esWatchdogs },
    },
  });
}

export async function mountSmokeTest(component: Component, initialPath = '/'): Promise<VueWrapper> {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', name: 'catch-all', component: { template: '<div />' } }],
  });
  const testI18n = createTestI18n();

  await router.push(initialPath);
  await router.isReady();

  // `useUIStore().setLocale()` mutates the REAL, app-wide `i18n.global.locale`
  // singleton exported by `client/src/i18n.ts` (see `stores/ui.ts`), not this
  // mount's own `testI18n` instance created above. Left unhandled, a test
  // that calls `setLocale('es')` would flip `useUIStore().locale` but the
  // mounted component's `t()` — bound to `testI18n`, which nothing else
  // updates — would keep rendering English forever. Bridge the gap here by
  // watching the store's `locale` ref (which setLocale always updates,
  // regardless of which i18n instance it also mutates) and mirroring it onto
  // this mount's own i18n instance, so locale-switch tests genuinely
  // re-render.
  const uiStore = useUIStore(pinia);
  watch(
    () => uiStore.locale,
    (locale) => {
      testI18n.global.locale.value = locale;
    },
    { immediate: true },
  );

  const wrapper = mount(component, {
    global: {
      plugins: [pinia, router, testI18n],
    },
  });

  // Most views fetch data in onMounted. Flush the microtask queue so those
  // chains (and any errors they'd raise) settle before the test ends and
  // the stubbed `fetch` from setup.ts is torn down — otherwise a still
  // in-flight chain resumes after teardown against the real `fetch`.
  await flushPromises();

  return wrapper;
}
