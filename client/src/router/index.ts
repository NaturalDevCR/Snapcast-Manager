import { createRouter, createWebHistory } from 'vue-router'
import Dashboard from '../views/Dashboard.vue'
import ClientDashboard from '../views/ClientDashboard.vue'
import Login from '../views/Login.vue'
import ServerConfig from '../views/ServerConfig.vue'
import Security from '../views/Security.vue'
import Setup from '../views/Setup.vue'
import Logs from '../views/Logs.vue'
import Watchdogs from '../views/Watchdogs.vue'
import Routing from '../views/Routing.vue'
import Tools from '../views/Tools.vue'

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
      path: '/security',
      name: 'security',
      component: Security,
      meta: { requiresAuth: true }
    },
    {
      path: '/watchdogs',
      name: 'watchdogs',
      component: Watchdogs,
      meta: { requiresAuth: true }
    },
    {
      path: '/logs',
      name: 'logs',
      component: Logs,
      meta: { requiresAuth: true }
    },
    {
      path: '/routing',
      name: 'routing',
      component: Routing,
      meta: { requiresAuth: true }
    },
    {
      path: '/client',
      name: 'client-dashboard',
      component: ClientDashboard,
      meta: { requiresAuth: true }
    },
    {
      path: '/tools',
      name: 'tools',
      component: Tools,
      meta: { requiresAuth: true }
    },

  ]
})

router.beforeEach(async (to, _from, next) => {
  const token = localStorage.getItem('token');
  
  // Skip setup check for the setup route itself to avoid infinite loops
  if (to.path !== '/setup') {
    try {
      const { isInitialized } = await fetchApi('/auth/setup-status');
      if (!isInitialized) {
        if (token) {
           localStorage.removeItem('token');
        }
        return next('/setup');
      }
    } catch (err) {
      console.error('Failed to check setup status:', err);
    }
  }

  // RE-read token in case we just deleted it above
  const currentToken = localStorage.getItem('token');

  if (to.meta.requiresAuth && !currentToken) {
    next('/login');
  } else if (to.path === '/setup' && currentToken) {
    // If already logged in, no need for setup
    next('/');
  } else {
    next();
  }
});

export default router
