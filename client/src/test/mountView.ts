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
import type { Component } from 'vue';
import enCommon from '../locales/en/common.json';
import esCommon from '../locales/es/common.json';
import enLayout from '../locales/en/layout.json';
import esLayout from '../locales/es/layout.json';

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
      en: { common: enCommon, layout: enLayout },
      es: { common: esCommon, layout: esLayout },
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
