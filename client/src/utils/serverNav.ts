// Task 30: navigation reorganization for Layout.vue's server-mode nav.
// UI overhaul (2026-11): the four groups are now three (Security folded into
// Settings) and every item is rendered directly in the sidebar instead of
// behind a "Menu" dropdown.
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
  // UI overhaul (2026-11): i18n keys under `layout.nav.*`. `name` /
  // `description` stay as English fallbacks for non-Vue consumers/tests,
  // but the layout renders these keys so the nav follows the EN/ES switch
  // (it used to mix hardcoded Spanish group labels with English items).
  nameKey: string;
  descriptionKey: string;
}

export interface ServerNavGroup {
  key: string;
  label: string;
  labelKey: string;
  items: ServerNavItem[];
}

export const serverNavGroups: ServerNavGroup[] = [
  {
    key: 'audio',
    label: 'Audio',
    labelKey: 'layout.nav.groupAudio',
    items: [
      { name: 'Sources', href: '/pipe-sources', icon: 'sensors', description: 'Radio & MPD pipe sources', nameKey: 'layout.nav.sources', descriptionKey: 'layout.nav.sourcesDescription' },
    ],
  },
  {
    key: 'sistema',
    label: 'System',
    labelKey: 'layout.nav.groupSystem',
    items: [
      // Task 63: self-diagnostics UI (Stage 5, item 5.5, part 2/2), consuming
      // GET /api/diagnostics (Task 62).
      { name: 'Diagnostics', href: '/diagnostics', icon: 'health_and_safety', description: 'Self-diagnostics & repairs', nameKey: 'layout.nav.diagnostics', descriptionKey: 'layout.nav.diagnosticsDescription' },
      { name: 'Logs', href: '/logs', icon: 'terminal', description: 'Service logs', nameKey: 'layout.nav.logs', descriptionKey: 'layout.nav.logsDescription' },
      { name: 'Watchdogs', href: '/watchdogs', icon: 'monitor_heart', description: 'Service monitors', nameKey: 'layout.nav.watchdogs', descriptionKey: 'layout.nav.watchdogsDescription' },
    ],
  },
  {
    key: 'configuracion',
    label: 'Settings',
    labelKey: 'layout.nav.groupSettings',
    items: [
      { name: 'Server Config', href: '/server', icon: 'tune', description: 'Snapserver settings', nameKey: 'layout.nav.serverConfig', descriptionKey: 'layout.nav.serverConfigDescription' },
      { name: 'Tools', href: '/tools', icon: 'build', description: 'Crontab, scripts & backups', nameKey: 'layout.nav.tools', descriptionKey: 'layout.nav.toolsDescription' },
      { name: 'Security', href: '/security', icon: 'shield_lock', description: 'Admin access', nameKey: 'layout.nav.security', descriptionKey: 'layout.nav.securityDescription' },
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

// True when the current route is inside ANY of the grouped-menu
// items -- drives the dropdown trigger button's (desktop) / collapsible
// header's (mobile) active highlighting, matching the old flat
// isSystemActive's intent.
export function isAnyServerNavGroupActive(currentPath: string): boolean {
  return serverNavGroups.some(group => isServerNavGroupActive(group, currentPath));
}
