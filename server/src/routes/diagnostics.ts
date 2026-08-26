// Task 62 (Stage 5, item 5.5, part 1/2): GET /api/diagnostics.
//
// Authenticated (same authenticateToken convention as /health/detail) --
// unlike the public /health probe, findings here can reveal internal
// path/process detail (FIFO paths, systemd unit filenames, occupying
// process names) that an unauthenticated caller shouldn't see.
//
// diagnosticsService.runDiagnostics() already degrades each of its 5
// checks independently (see services/diagnostics.ts's header) and never
// throws in practice; the try/catch here is defense in depth only, mirroring
// every other route's own error-to-500 handling in this codebase rather
// than assuming that internal discipline can never regress.
import { Router, Request, Response } from 'express';
import { authenticateToken } from '../auth';
import { diagnosticsService } from '../services/diagnostics';

const router = Router();

router.get('/diagnostics', authenticateToken, async (_req: Request, res: Response) => {
  try {
    const findings = await diagnosticsService.runDiagnostics();
    res.json({ findings });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Diagnostics failed' });
  }
});

export default router;
