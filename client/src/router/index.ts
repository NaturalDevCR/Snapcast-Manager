import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import Login from '../views/Login.vue'
import ServerConfig from '../views/ServerConfig.vue'
import Setup from '../views/Setup.vue'
import Logs from '../views/Logs.vue'
import { fetchApi } from '../utils/api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/setup',
      name: 'setup',
      component: Setup
    },
    {
      path: '/login',
      name: 'login',
      component: Login
    },
    {
      path: '/',
      name: 'dashboard',
      component: Dashboard,
      meta: { requiresAuth: true }
    },
    {
      path: '/server',
      name: 'server-config',
      component: ServerConfig,
      meta: { requiresAuth: true }
    },
    {
      path: '/logs',
      name: 'logs',
      component: Logs,
      meta: { requiresAuth: true }
    }
  ]
})

router.beforeEach(async (to, _from, next) => {
  const token = localStorage.getItem('token');
  
  // Skip setup check for the setup route itself to avoid infinite loops
  if (to.path !== '/setup') {
    try {
      const { isInitialized } = await fetchApi('/auth/setup-status');
      if (!isInitialized) {
        return next('/setup');
      }
    } catch (err) {
      console.error('Failed to check setup status:', err);
    }
  }

  if (to.meta.requiresAuth && !token) {
    next('/login');
  } else if (to.path === '/setup' && token) {
    // If already logged in, no need for setup
    next('/');
  } else {
    next();
  }
});

export default router
