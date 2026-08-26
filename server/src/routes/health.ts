// Task 57 (Stage 5, item 5.1): health-check endpoints.
//
// Two deliberately different endpoints, not one:
// - GET /health is a fast, PUBLIC liveness probe (no auth) -- external
//   monitoring/uptime tooling and a future systemd watchdog need to reach
//   this without a JWT. It answers one question only: "is this process
//   able to respond and reach its own database." Anything more would leak
//   detail an unauthenticated caller shouldn't get.
// - GET /health/detail is AUTHENTICATED (same authenticateToken every
//   other data-bearing route uses) and answers a richer question: is
//   snapserver actually reachable (both at the systemd level and the
//   live RPC-connection level), is the config parseable, is there disk
//   space, are the paths this app manages writable. Each check is
//   independently try/caught -- one failing (e.g. snapserver genuinely
//   down) must not prevent the others from reporting their own real
//   state. The endpoint itself always returns 200 with a complete report;
//   interpreting individual pass/fail fields is the caller's job (the
//   future UI panel), not this endpoint's.
import { Router, Request, Response } from 'express';
import fs from 'fs';
import { authenticateToken } from '../auth';
import db from '../database';
import { isActive } from '../platform/systemd';
import { snapcastLive } from '../services/snapcastLive';
import { configService } from '../services/config';
import { SNAPSHOTS_DIR } from '../services/snapshot';

const router = Router();

// snapcastLive.isConnected is a plain synchronous getter over a private
// boolean field -- it should never throw, but wrapping the READ itself in
// try/catch (rather than `Promise.resolve(snapcastLive.isConnected)`,
// where a synchronous throw from the property access happens before
// Promise.resolve is ever called and so isn't caught by any .catch())
// is what actually honors "every check is independently try/caught."
function safeIsConnected(): boolean {
  try {
    return snapcastLive.isConnected;
  } catch {
    return false;
  }
}

router.get('/health', async (_req: Request, res: Response) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (err: any) {
    res.status(503).json({ status: 'error', error: err.message || 'Database unreachable' });
  }
});

router.get('/health/detail', authenticateToken, async (_req: Request, res: Response) => {
  const [snapserverSystemdActive, snapserverRpcConnected, configResult, disk, snapshotsDirWritable] =
    await Promise.all([
      isActive('snapserver.service').catch(() => false),
      Promise.resolve().then(() => safeIsConnected()),
      configService
        .readServerConfigParsed()
        .then(() => ({ parseable: true as const }))
        .catch((err: any) => ({ parseable: false as const, error: err.message || 'Config parse failed' })),
      fs.promises
        .statfs(SNAPSHOTS_DIR)
        .then((s) => {
          const freeBytes = s.bavail * s.bsize;
          const totalBytes = s.blocks * s.bsize;
          return { freeBytes, freePercent: totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 100) : 0 };
        })
        .catch((err: any) => ({ error: err.message || 'Disk check failed' })),
      fs.promises
        .access(SNAPSHOTS_DIR, fs.constants.W_OK)
        .then(() => true)
        .catch(() => false),
    ]);

  res.json({
    snapserver: {
      systemdActive: snapserverSystemdActive,
      rpcConnected: snapserverRpcConnected,
    },
    config: configResult,
    disk,
    permissions: {
      snapshotsDirWritable,
    },
  });
});

export default router;
