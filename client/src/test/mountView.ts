// Shared mount helper for view smoke tests.
//
// Every view depends on Pinia (stores) and most depend on Vue Router
// (directly, or via <Layout> which calls useRoute()/useRouter()). This
// installs a real Pinia instance and a minimal in-memory router so a view
// can mount without a running backend or browser history APIs.
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { Component } from 'vue';

export async function mountSmokeTest(component: Component, initialPath = '/'): Promise<VueWrapper> {
  const pinia = createPinia();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', name: 'catch-all', component: { template: '<div />' } }],
  });

  await router.push(initialPath);
  await router.isReady();

  const wrapper = mount(component, {
    global: {
      plugins: [pinia, router],
    },
  });

  // Most views fetch data in onMounted. Flush the microtask queue so those
  // chains (and any errors they'd raise) settle before the test ends and
  // the stubbed `fetch` from setup.ts is torn down — otherwise a still
  // in-flight chain resumes after teardown against the real `fetch`.
  await flushPromises();

  return wrapper;
}
