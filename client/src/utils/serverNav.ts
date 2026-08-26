// Task 30: navigation reorganization for Layout.vue's server-mode nav.
//
// Replaces the previously-flat six-item "System" dropdown with four
// task-based groups, per
// docs/superpowers/specs/2026-08-18-professional-hardening-design.md §4.7:
// Audio (Pipe Sources -- Audio Matrix itself stays a standalone top-level
// primary link, see Layout.vue), Sistema (Logs, Watchdogs), Configuración
// (Server Config, Tools), Seguridad (Security).
//
// A plain module (no Vue/vue-router imports) so the grouping data and the
// active-route matching logic are unit-testable without mounting
// Layout.vue or a router instance.

export interface ServerNavItem {
  name: string;
  href: string;
  icon: string;
  description: string;
}

export interface ServerNavGroup {
  key: string;
  label: string;
  items: ServerNavItem[];
}

export const serverNavGroups: ServerNavGroup[] = [
  {
    key: 'audio',
    label: 'Audio',
    items: [
      { name: 'Pipe Sources', href: '/pipe-sources', icon: 'sensors', description: 'Radio & MPD pipe sources' },
    ],
  },
  {
    key: 'sistema',
    label: 'Sistema',
    items: [
      { name: 'Logs', href: '/logs', icon: 'terminal', description: 'Service logs' },
      { name: 'Watchdogs', href: '/watchdogs', icon: 'monitor_heart', description: 'Service monitors' },
      // Task 63: self-diagnostics UI (Stage 5, item 5.5, part 2/2), consuming
      // GET /api/diagnostics (Task 62).
      { name: 'Diagnostics', href: '/diagnostics', icon: 'health_and_safety', description: 'Self-diagnostics & repairs' },
    ],
  },
  {
    key: 'configuracion',
    label: 'Configuración',
    items: [
      { name: 'Server Config', href: '/server', icon: 'settings', description: 'Snapserver settings' },
      { name: 'Tools', href: '/tools', icon: 'build_circle', description: 'Crontab, scripts & MPD' },
    ],
  },
  {
    key: 'seguridad',
    label: 'Seguridad',
    items: [
      { name: 'Security', href: '/security', icon: 'security', description: 'Admin access' },
    ],
  },
];

// Flattened view -- every grouped item regardless of which group it's in.
// Used for "is the current route anywhere in this menu" checks that don't
// care about group boundaries.
export const serverNavItems: ServerNavItem[] = serverNavGroups.flatMap(group => group.items);

// Mirrors Layout.vue's pre-existing isNavActive: '/' matches only the
// exact root path (so the dashboard link doesn't light up for every
// route), everything else matches by prefix so e.g. a future /tools/foo
// sub-route still highlights the Tools item.
export function isNavHrefActive(currentPath: string, href: string): boolean {
  if (href === '/') return currentPath === '/';
  return currentPath.startsWith(href);
}

export function isServerNavItemActive(item: { href: string }, currentPath: string): boolean {
  return isNavHrefActive(currentPath, item.href);
}

export function isServerNavGroupActive(group: ServerNavGroup, currentPath: string): boolean {
  return group.items.some(item => isServerNavItemActive(item, currentPath));
}

// True when the current route is inside ANY of the four grouped-menu
// items -- drives the dropdown trigger button's (desktop) / collapsible
// header's (mobile) active highlighting, matching the old flat
// isSystemActive's intent.
export function isAnyServerNavGroupActive(currentPath: string): boolean {
  return serverNavGroups.some(group => isServerNavGroupActive(group, currentPath));
}
