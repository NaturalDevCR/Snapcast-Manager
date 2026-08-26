import { describe, expect, it } from 'vitest';
import {
  serverNavGroups,
  serverNavItems,
  isNavHrefActive,
  isServerNavItemActive,
  isServerNavGroupActive,
  isAnyServerNavGroupActive,
} from '../serverNav';

describe('serverNavGroups', () => {
  it('defines exactly the four task-based groups from the design spec', () => {
    expect(serverNavGroups.map(g => g.key)).toEqual(['audio', 'sistema', 'configuracion', 'seguridad']);
    expect(serverNavGroups.map(g => g.label)).toEqual(['Audio', 'Sistema', 'Configuración', 'Seguridad']);
  });

  it('preserves every pre-existing route path exactly, with no additions or removals', () => {
    const hrefs = serverNavItems.map(item => item.href).sort();
    expect(hrefs).toEqual([
      '/diagnostics',
      '/logs',
      '/pipe-sources',
      '/security',
      '/server',
      '/tools',
      '/watchdogs',
    ].sort());
  });

  it('groups items by task area', () => {
    const byKey = Object.fromEntries(serverNavGroups.map(g => [g.key, g.items.map(i => i.href)]));
    expect(byKey.audio).toEqual(['/pipe-sources']);
    expect(byKey.sistema).toEqual(['/logs', '/watchdogs', '/diagnostics']);
    expect(byKey.configuracion).toEqual(['/server', '/tools']);
    expect(byKey.seguridad).toEqual(['/security']);
  });

  // Task 63: the new self-diagnostics nav entry, added to the `sistema`
  // group alongside Logs/Watchdogs.
  it('includes a Diagnostics item in the sistema group with a non-empty icon and active-route matching', () => {
    const diagnosticsItem = serverNavItems.find(i => i.href === '/diagnostics');
    expect(diagnosticsItem).toBeTruthy();
    expect(diagnosticsItem!.name).toBe('Diagnostics');
    expect(diagnosticsItem!.icon).toBeTruthy();
    expect(isServerNavItemActive(diagnosticsItem!, '/diagnostics')).toBe(true);
    expect(isServerNavItemActive(diagnosticsItem!, '/logs')).toBe(false);

    const sistemaGroup = serverNavGroups.find(g => g.key === 'sistema')!;
    expect(isServerNavGroupActive(sistemaGroup, '/diagnostics')).toBe(true);
  });

  it('has no duplicate items across groups', () => {
    const hrefs = serverNavItems.map(item => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe('isNavHrefActive', () => {
  it('matches "/" only when the path is exactly root', () => {
    expect(isNavHrefActive('/', '/')).toBe(true);
    expect(isNavHrefActive('/tools', '/')).toBe(false);
  });

  it('matches other hrefs by prefix', () => {
    expect(isNavHrefActive('/tools', '/tools')).toBe(true);
    expect(isNavHrefActive('/tools/sub-page', '/tools')).toBe(true);
    expect(isNavHrefActive('/toolshed', '/tools')).toBe(true); // pre-existing prefix behavior, unchanged
    expect(isNavHrefActive('/server', '/tools')).toBe(false);
  });
});

describe('isServerNavItemActive / isServerNavGroupActive', () => {
  it('flags the specific item matching the current route', () => {
    const toolsItem = serverNavItems.find(i => i.href === '/tools')!;
    const logsItem = serverNavItems.find(i => i.href === '/logs')!;
    expect(isServerNavItemActive(toolsItem, '/tools')).toBe(true);
    expect(isServerNavItemActive(logsItem, '/tools')).toBe(false);
  });

  it('flags a group active when the current route matches any item inside it', () => {
    const configGroup = serverNavGroups.find(g => g.key === 'configuracion')!;
    expect(isServerNavGroupActive(configGroup, '/tools')).toBe(true);
    expect(isServerNavGroupActive(configGroup, '/server')).toBe(true);
    expect(isServerNavGroupActive(configGroup, '/security')).toBe(false);
  });
});

describe('isAnyServerNavGroupActive', () => {
  it('is true when on a route belonging to any of the four groups', () => {
    expect(isAnyServerNavGroupActive('/tools')).toBe(true);
    expect(isAnyServerNavGroupActive('/security')).toBe(true);
    expect(isAnyServerNavGroupActive('/watchdogs')).toBe(true);
    expect(isAnyServerNavGroupActive('/pipe-sources')).toBe(true);
  });

  it('is false on routes outside the grouped menu (dashboard, audio matrix)', () => {
    expect(isAnyServerNavGroupActive('/')).toBe(false);
    expect(isAnyServerNavGroupActive('/routing')).toBe(false);
  });
});
