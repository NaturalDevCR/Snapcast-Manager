// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- deliberate, see explanation below
// @ts-nocheck
//
// Why: see services/pipeSources.test.ts's identical header for the full
// investigation into the `node --test --import ts-node/register`
// type-stripping bug this pragma works around -- this file's mocking
// helpers (stubModuleFn) bind parameterized functions to module-exports
// properties, which hits the same bug. Correctness is independently
// confirmed via `npm run build` (which does NOT compile this test file,
// but does compile the production services/diagnostics.ts /
// routes/diagnostics.ts files it imports, with no pragma of their own).
//
// DB isolation: services/pipeSources.ts (imported transitively) reads the
// real ../database singleton, which reads process.env.DB_PATH at
// module-load time. Set BEFORE any of these imports, same convention as
// every other *.test.ts file in this codebase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';

const tmpDbPath = path.join(os.tmpdir(), `diagnostics-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDbPath;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-fixed-secret-for-diagnostics-test-ts';

import { diagnosticsService } from './diagnostics';
import { pipeSourceService } from './pipeSources';
import * as systemdModule from '../platform/systemd';
import * as execModule from '../platform/exec';
import * as configModule from './config';
import { snapcastLive } from './snapcastLive';
import fsPromises from 'fs/promises';

// ---- same plain-property-reassignment stubbing pattern as
// pipeSources.test.ts / health.test.ts (no new mocking approach) ----
function stubModuleFn(mod: any, key: string, impl: (...args: any[]) => any): () => void {
  const original = mod[key];
  mod[key] = impl;
  return () => {
    mod[key] = original;
  };
}

function stubMany(stubs: Array<() => void>): () => void {
  return () => stubs.forEach(r => r());
}

/** Baseline: everything healthy / empty, so a test only needs to override
 * the one thing it cares about. */
function stubHealthyBaseline(): () => void {
  return stubMany([
    stubModuleFn(pipeSourceService, 'discover', async () => []),
    stubModuleFn(pipeSourceService, 'list', () => []),
    stubModuleFn(pipeSourceService, 'getAllStatuses', async () => ({})),
    stubModuleFn(fsPromises, 'readdir', async () => {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }),
    stubModuleFn(fsPromises, 'stat', async () => {
      throw new Error('ENOENT');
    }),
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({})),
    stubModuleFn(execModule, 'run', async () => ({ stdout: 'State Recv-Q Send-Q Local Address:Port Peer Address:Port\n', stderr: '' })),
  ]);
}

function stubIsConnected(value: boolean): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(snapcastLive), 'isConnected');
  Object.defineProperty(snapcastLive, 'isConnected', { get: () => value, configurable: true });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(Object.getPrototypeOf(snapcastLive), 'isConnected', originalDescriptor);
    }
    delete (snapcastLive as any).isConnected;
  };
}

function fakePipe(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'pipe-1',
    name: 'Radio One',
    type: 'radio',
    url: 'https://example.com/stream',
    reconnect: true,
    reconnectStreamed: true,
    reconnectAtEof: true,
    reconnectDelayMax: 30,
    idleThreshold: 15000,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// =====================================================================
// 1. unmanaged-config -- wraps pipeSources.discover()
// =====================================================================

test('unmanaged-config: discover() with an existingService produces an adopt finding', async () => {
  const restore = stubHealthyBaseline();
  const restoreDiscover = stubModuleFn(pipeSourceService, 'discover', async () => [
    {
      name: 'Radio One',
      fifoPath: '/run/snapcast-manager/snapfifo_radio_one',
      sourceUri: 'pipe:///run/snapcast-manager/snapfifo_radio_one?name=Radio%20One',
      idleThreshold: 15000,
      detectedType: 'radio',
      existingService: {
        name: 'snapcast-radio-radio-one',
        filePath: '/etc/systemd/system/snapcast-radio-radio-one.service',
        url: 'https://example.com/stream',
        reconnect: true,
        reconnectStreamed: true,
        reconnectAtEof: true,
        reconnectDelayMax: 30,
        isActive: false,
      },
    },
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const unmanaged = findings.filter(f => f.category === 'unmanaged-config');
    assert.equal(unmanaged.length, 1);
    assert.equal(unmanaged[0].id, 'unmanaged-config-radio-one');
    assert.equal(unmanaged[0].repairAction.kind, 'endpoint');
    assert.equal(unmanaged[0].repairAction.endpoint, '/api/pipe-sources/adopt');
    assert.equal(unmanaged[0].repairAction.method, 'POST');
    assert.equal(unmanaged[0].repairAction.body.existingServiceName, 'snapcast-radio-radio-one');
  } finally {
    restoreDiscover();
    restore();
  }
});

test('unmanaged-config: discover() entry with no existingService points at create, not adopt', async () => {
  const restore = stubHealthyBaseline();
  const restoreDiscover = stubModuleFn(pipeSourceService, 'discover', async () => [
    {
      name: 'Unknown Pipe',
      fifoPath: '/run/snapcast-manager/snapfifo_unknown_pipe',
      sourceUri: 'pipe:///run/snapcast-manager/snapfifo_unknown_pipe?name=Unknown%20Pipe',
      idleThreshold: 15000,
      detectedType: 'mpd',
      existingService: null,
    },
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const unmanaged = findings.filter(f => f.category === 'unmanaged-config');
    assert.equal(unmanaged.length, 1);
    assert.equal(unmanaged[0].repairAction.kind, 'endpoint');
    assert.equal(unmanaged[0].repairAction.endpoint, '/api/pipe-sources');
    assert.notEqual(unmanaged[0].repairAction.endpoint, '/api/pipe-sources/adopt');
  } finally {
    restoreDiscover();
    restore();
  }
});

test('unmanaged-config: radio-type entry with no existingService is manual, not a non-submittable endpoint body', async () => {
  // Fix (post-Task-62-review): createPipeSourceBodySchema REQUIRES a real
  // http(s) `url` for type 'radio' (schemas/pipeSources.ts). d.sourceUri is
  // the raw pipe:// FIFO URI, not a stream URL -- there's nothing honest to
  // auto-fill, so this case must be `manual`, unlike the mpd case above.
  const restore = stubHealthyBaseline();
  const restoreDiscover = stubModuleFn(pipeSourceService, 'discover', async () => [
    {
      name: 'Mystery Radio',
      fifoPath: '/run/snapcast-manager/snapfifo_mystery_radio',
      sourceUri: 'pipe:///run/snapcast-manager/snapfifo_mystery_radio?name=Mystery%20Radio',
      idleThreshold: 15000,
      detectedType: 'radio',
      existingService: null,
    },
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const unmanaged = findings.filter(f => f.category === 'unmanaged-config');
    assert.equal(unmanaged.length, 1);
    assert.equal(unmanaged[0].repairAction.kind, 'manual');
    assert.equal(unmanaged[0].repairAction.body, undefined);
    assert.ok(unmanaged[0].repairAction.instructions.includes('Mystery Radio'));
  } finally {
    restoreDiscover();
    restore();
  }
});

test('unmanaged-config: discover() returning [] produces no findings', async () => {
  const restore = stubHealthyBaseline();
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'unmanaged-config').length, 0);
  } finally {
    restore();
  }
});

// =====================================================================
// 2. orphaned-unit
// =====================================================================

test('orphaned-unit: a snapcast-radio-*.service file with no matching tracked pipe is flagged', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(fsPromises, 'readdir', async () => ['snapcast-radio-ghost.service', 'unrelated.service']),
    stubModuleFn(pipeSourceService, 'list', () => []),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const orphaned = findings.filter(f => f.category === 'orphaned-unit');
    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0].id, 'orphaned-unit-snapcast-radio-ghost');
    assert.equal(orphaned[0].repairAction.kind, 'manual');
    assert.ok(orphaned[0].repairAction.instructions.length > 0);
  } finally {
    restores();
    restore();
  }
});

test('orphaned-unit: a unit matching a tracked pipe source is NOT flagged', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    // getSystemdServiceName('Radio One') -> 'snapcast-radio-radio-one'
    stubModuleFn(fsPromises, 'readdir', async () => ['snapcast-radio-radio-one.service']),
    stubModuleFn(pipeSourceService, 'list', () => [fakePipe({ name: 'Radio One' })]),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'orphaned-unit').length, 0);
  } finally {
    restores();
    restore();
  }
});

// =====================================================================
// 3. fifo-no-producer
// =====================================================================

test('fifo-no-producer: FIFO on disk, unit inactive -> finding with a start repair action', async () => {
  const restore = stubHealthyBaseline();
  const pipe = fakePipe({ id: 'pipe-abc', name: 'Radio One' });
  const restores = stubMany([
    stubModuleFn(pipeSourceService, 'list', () => [pipe]),
    stubModuleFn(pipeSourceService, 'getAllStatuses', async () => ({ [pipe.id]: 'inactive' })),
    stubModuleFn(fsPromises, 'stat', async () => ({ isFIFO: () => true })),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const fifo = findings.filter(f => f.category === 'fifo-no-producer');
    assert.equal(fifo.length, 1);
    assert.equal(fifo[0].repairAction.kind, 'endpoint');
    assert.equal(fifo[0].repairAction.endpoint, `/api/pipe-sources/${pipe.id}/control`);
    assert.equal(fifo[0].repairAction.method, 'POST');
    assert.equal(fifo[0].repairAction.body.action, 'start');
  } finally {
    restores();
    restore();
  }
});

test('fifo-no-producer: FIFO on disk, unit active -> no finding', async () => {
  const restore = stubHealthyBaseline();
  const pipe = fakePipe({ id: 'pipe-abc', name: 'Radio One' });
  const restores = stubMany([
    stubModuleFn(pipeSourceService, 'list', () => [pipe]),
    stubModuleFn(pipeSourceService, 'getAllStatuses', async () => ({ [pipe.id]: 'active' })),
    stubModuleFn(fsPromises, 'stat', async () => ({ isFIFO: () => true })),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'fifo-no-producer').length, 0);
  } finally {
    restores();
    restore();
  }
});

test('fifo-no-producer: FIFO missing from disk entirely -> no finding (not this check\'s concern)', async () => {
  const restore = stubHealthyBaseline();
  const pipe = fakePipe({ id: 'pipe-abc', name: 'Radio One' });
  const restores = stubMany([
    stubModuleFn(pipeSourceService, 'list', () => [pipe]),
    stubModuleFn(pipeSourceService, 'getAllStatuses', async () => ({ [pipe.id]: 'inactive' })),
    // baseline stat already throws ENOENT -- explicit here for clarity
    stubModuleFn(fsPromises, 'stat', async () => { throw new Error('ENOENT'); }),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'fifo-no-producer').length, 0);
  } finally {
    restores();
    restore();
  }
});

// =====================================================================
// 4. snapserver-down -- synthesized from the same two checks health.ts uses
// =====================================================================

test('snapserver-down: systemd active + RPC connected -> no finding', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubIsConnected(true),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'snapserver-down').length, 0);
  } finally {
    restores();
    restore();
  }
});

test('snapserver-down: systemd inactive (RPC connected) -> one finding, error severity', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => false),
    stubIsConnected(true),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const down = findings.filter(f => f.category === 'snapserver-down');
    assert.equal(down.length, 1);
    assert.equal(down[0].severity, 'error');
    assert.equal(down[0].repairAction.kind, 'endpoint');
    assert.equal(down[0].repairAction.endpoint, '/api/system/service/restart/snapserver');
  } finally {
    restores();
    restore();
  }
});

test('snapserver-down: RPC disconnected (systemd active) -> one finding', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubIsConnected(false),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'snapserver-down').length, 1);
  } finally {
    restores();
    restore();
  }
});

// =====================================================================
// 5. port-occupied -- ss/lsof pattern from watchdog.ts, real configured ports
// =====================================================================

const SS_NOTHING_LISTENING = 'State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port\n';
function ssListenLine(process_: string) {
  return (
    'State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port\n' +
    `LISTEN 0       128     0.0.0.0:1780        0.0.0.0:*             users:(("${process_}",pid=1234,fd=10))\n`
  );
}

test('port-occupied: nothing listening while snapserver is active -> finding(s)', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({})), // falls back to defaults
    stubModuleFn(execModule, 'run', async () => ({ stdout: SS_NOTHING_LISTENING, stderr: '' })),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const occupied = findings.filter(f => f.category === 'port-occupied');
    assert.equal(occupied.length, 3); // http, tcp-control, tcp-streaming
    assert.ok(occupied.every(f => f.severity === 'warning'));
    assert.ok(occupied.every(f => f.repairAction.kind === 'endpoint'));
  } finally {
    restores();
    restore();
  }
});

test('port-occupied: only snapserver itself listening -> no finding', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({})),
    stubModuleFn(execModule, 'run', async () => ({ stdout: ssListenLine('snapserver'), stderr: '' })),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'port-occupied').length, 0);
  } finally {
    restores();
    restore();
  }
});

test('port-occupied: a genuinely different process listening -> a manual-investigation finding', async () => {
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({})),
    stubModuleFn(execModule, 'run', async () => ({ stdout: ssListenLine('nginx'), stderr: '' })),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    const occupied = findings.filter(f => f.category === 'port-occupied');
    assert.equal(occupied.length, 3);
    assert.ok(occupied.every(f => f.repairAction.kind === 'manual'));
    assert.ok(occupied.every(f => f.message.includes('nginx')));
  } finally {
    restores();
    restore();
  }
});

test('port-occupied: reads live-configured ports, not hardcoded defaults', async () => {
  const restore = stubHealthyBaseline();
  const seenPorts: string[] = [];
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({
      http: { port: 9999 },
      'tcp-control': { port: 9998 },
      'tcp-streaming': { port: 9997 },
    })),
    stubModuleFn(execModule, 'run', async (_bin: string, args: string[]) => {
      seenPorts.push(args.join(' '));
      return { stdout: SS_NOTHING_LISTENING, stderr: '' };
    }),
  ]);
  try {
    await diagnosticsService.runDiagnostics();
    assert.ok(seenPorts.some(a => a.includes(':9999')));
    assert.ok(seenPorts.some(a => a.includes(':9998')));
    assert.ok(seenPorts.some(a => a.includes(':9997')));
    assert.ok(!seenPorts.some(a => a.includes(':1780')));
  } finally {
    restores();
    restore();
  }
});

test('port-occupied: ss unavailable (Linux, no fallback) -> no finding, not treated as confirmed empty', async () => {
  // Fix (post-Task-62-review): getPortListeners() returning [] on a genuine
  // "ss isn't installed" failure used to be indistinguishable from a real
  // "queried successfully, nobody's listening" result -- which produced a
  // false-positive "stale config" finding whenever snapserver was active.
  // getPortListeners() now returns null for "couldn't check" instead, and
  // checkPortOccupied() must skip (not finding-ify) that case.
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  const restore = stubHealthyBaseline();
  const restores = stubMany([
    stubModuleFn(systemdModule, 'isActive', async () => true),
    stubModuleFn(configModule.configService, 'readServerConfigParsed', async () => ({})),
    stubModuleFn(execModule, 'run', async () => { throw new Error('ss: command not found'); }),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'port-occupied').length, 0);
  } finally {
    restores();
    restore();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

// =====================================================================
// runDiagnostics() overall degradation
// =====================================================================

test('runDiagnostics(): one check throwing does not prevent the others from reporting', async () => {
  const restore = stubHealthyBaseline();
  const pipe = fakePipe({ id: 'pipe-abc', name: 'Radio One' });
  const restores = stubMany([
    stubModuleFn(pipeSourceService, 'discover', async () => { throw new Error('simulated discover failure'); }),
    stubModuleFn(pipeSourceService, 'list', () => [pipe]),
    stubModuleFn(pipeSourceService, 'getAllStatuses', async () => ({ [pipe.id]: 'inactive' })),
    stubModuleFn(fsPromises, 'stat', async () => ({ isFIFO: () => true })),
  ]);
  try {
    const findings = await diagnosticsService.runDiagnostics();
    assert.equal(findings.filter(f => f.category === 'unmanaged-config').length, 0);
    assert.equal(findings.filter(f => f.category === 'fifo-no-producer').length, 1);
  } finally {
    restores();
    restore();
  }
});
