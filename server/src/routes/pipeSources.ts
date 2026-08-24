import { Router } from 'express';
import { pipeSourceService, getFifoPath, getSystemdServiceName } from '../services/pipeSources';
import { authenticateToken } from '../auth';
import { validate, ValidatedRequest } from '../middleware/validate';
import {
  adoptPipeSourceBodySchema,
  controlPipeSourceBodySchema,
  createPipeSourceBodySchema,
  setPipeSourceConfigBodySchema,
  updatePipeSourceBodySchema,
} from '../schemas/pipeSources';
import type {
  AdoptPipeSourceInput,
  ControlPipeSourceInput,
  CreatePipeSourceInput,
  SetPipeSourceConfigInput,
  UpdatePipeSourceInput,
} from '@shared/pipeSources';

const router = Router();

router.use(authenticateToken);

// Task 26, Part 3: pipeSourceService.create()/adopt() reject a name whose
// slug would be empty, or that collides (after slugging) with an existing
// pipe source's name -- see assertNoSlugCollision()'s docstring in
// services/pipeSources.ts. Those are caller-input validation failures
// (like adopt()'s existingServiceName mismatch below), not server errors,
// so both POST routes below map them to 400 via this same substring check
// rather than falling through to the generic 500.
function isSlugValidationError(message: string): boolean {
  return /has no alphanumeric characters|conflicting name already exists/.test(message);
}

// GET /api/pipe-sources
router.get('/', async (req, res) => {
  try {
    const pipes = pipeSourceService.list();
    const statuses = await pipeSourceService.getAllStatuses();
    const result = pipes.map(p => ({
      ...p,
      status: statuses[p.id] || 'unknown',
      fifoPath: getFifoPath(p.name),
      serviceName: p.type === 'radio' ? getSystemdServiceName(p.name) : 'mpd',
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pipe-sources
router.post('/', validate({ body: createPipeSourceBodySchema }), async (req, res) => {
  try {
    // Task 23: `req.validated.body` (equivalently `req.body`, which
    // validate() also overwrites in place) is the parsed/coerced output of
    // createPipeSourceBodySchema -- name is trimmed, url is
    // trimmed+allowlist-checked, type/booleans/numbers already have their
    // defaults applied. No re-derivation of any of that here.
    const data = (req as ValidatedRequest<CreatePipeSourceInput>).validated.body;
    const pipe = await pipeSourceService.create(data);
    res.json(pipe);
  } catch (err: any) {
    const status = isSlugValidationError(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/pipe-sources/:id
router.put('/:id', validate({ body: updatePipeSourceBodySchema }), async (req, res) => {
  try {
    const data = (req as ValidatedRequest<UpdatePipeSourceInput>).validated.body;
    const pipe = await pipeSourceService.update(req.params.id, data);
    res.json(pipe);
  } catch (err: any) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// DELETE /api/pipe-sources/:id
router.delete('/:id', async (req, res) => {
  try {
    await pipeSourceService.delete(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pipe-sources/:id/control
router.post('/:id/control', validate({ body: controlPipeSourceBodySchema }), async (req, res) => {
  try {
    const { action } = (req as ValidatedRequest<ControlPipeSourceInput>).validated.body;
    await pipeSourceService.control(req.params.id, action);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pipe-sources/:id/regenerate
router.post('/:id/regenerate', async (req, res) => {
  try {
    await pipeSourceService.regenerateService(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// GET /api/pipe-sources/:id/logs
router.get('/:id/logs', async (req, res) => {
  try {
    const logs = await pipeSourceService.getLogs(req.params.id);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pipe-sources/:id/config
router.get('/:id/config', async (req, res) => {
  try {
    const result = await pipeSourceService.getConfigContent(req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// PUT /api/pipe-sources/:id/config
router.put('/:id/config', validate({ body: setPipeSourceConfigBodySchema }), async (req, res) => {
  try {
    const { content } = (req as ValidatedRequest<SetPipeSourceConfigInput>).validated.body;
    await pipeSourceService.setConfigContent(req.params.id, content);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// POST /api/pipe-sources/:id/config/rollback
router.post('/:id/config/rollback', async (req, res) => {
  try {
    await pipeSourceService.rollbackConfig(req.params.id);
    res.json({ ok: true, message: 'Rolled back to the previous configuration' });
  } catch (err: any) {
    const status = err.message.includes('No previous version') || err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/pipe-sources/system/zombies
router.get('/system/zombies', async (req, res) => {
  try {
    const count = await pipeSourceService.getZombieCount();
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pipe-sources/discover
router.get('/discover', async (req, res) => {
  try {
    const discovered = await pipeSourceService.discover();
    res.json(discovered);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pipe-sources/adopt
router.post('/adopt', validate({ body: adoptPipeSourceBodySchema }), async (req, res) => {
  try {
    const data = (req as ValidatedRequest<AdoptPipeSourceInput>).validated.body;
    const pipe = await pipeSourceService.adopt(data);
    res.json(pipe);
  } catch (err: any) {
    // "existingServiceName does not match any discovered..." and the
    // slug-validation errors below both mean the caller supplied something
    // invalid -- 400, not a server error. The authoritative checks live in
    // pipeSourceService.adopt() itself (see its docstring), not here; this
    // only maps its errors to the right HTTP status.
    const status = err.message.includes('existingServiceName') || isSlugValidationError(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
