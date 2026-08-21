import express, { Request, Response } from 'express';
import { snapclientInstanceService } from '../services/snapclientInstances';
import { authenticateToken } from '../auth';
import { validate, ValidatedRequest } from '../middleware/validate';
import {
  controlSnapclientInstanceParamsSchema,
  createSnapclientInstanceBodySchema,
  setAlsaVolumeBodySchema,
} from '../schemas/snapclientInstances';
import type { CreateSnapclientInstanceInput, SetAlsaVolumeInput, SnapclientControlAction } from '@shared/snapclientInstances';

const router = express.Router();
router.use(authenticateToken);

router.get('/devices', async (_req: Request, res: Response) => {
  try {
    const [devices, instances] = await Promise.all([
      snapclientInstanceService.listAudioDevices(),
      snapclientInstanceService.listInstances(),
    ]);
    const usedHwIds = instances.map(i => i.soundcard);
    const devicesWithUsage = devices.map(d => ({ ...d, inUse: usedHwIds.includes(d.hwId) }));
    res.json({ devices: devicesWithUsage });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const instances = await snapclientInstanceService.listInstances();
    res.json({ instances });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', validate({ body: createSnapclientInstanceBodySchema }), async (req: Request, res: Response) => {
  try {
    // Task 23: the parsed/coerced output of createSnapclientInstanceBodySchema
    // -- host/port already defaulted -- not the raw req.body.
    const data = (req as ValidatedRequest<CreateSnapclientInstanceInput>).validated.body;
    const instance = await snapclientInstanceService.createInstance(data);
    res.json({ instance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id (update) -- NOT migrated to validate(): the pre-migration route
// had no input validation at all (the raw body went straight to
// snapclientInstanceService.updateInstance()), so there is no pre-existing
// check to preserve here -- see schemas/snapclientInstances.ts's header
// comment. Left as-is, matching task-23-brief.md's scope of migrating
// existing ad-hoc checks rather than adding new validation elsewhere.
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const instance = await snapclientInstanceService.updateInstance(req.params.id, req.body);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    res.json({ instance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await snapclientInstanceService.deleteInstance(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Instance not found' });
    res.json({ message: 'Instance deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── ALSA mixer endpoints — must be before /:id/:action to avoid route collision ──

// GET /snapclient-instances/alsa/:cardId  — list playback controls + current %
router.get('/alsa/:cardId', async (req: Request, res: Response) => {
  try {
    const controls = await snapclientInstanceService.listAlsaControls(req.params.cardId);
    res.json({ controls });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /snapclient-instances/alsa/:cardId  — set volume and persist
// body: { control: string, percent: number }
router.post('/alsa/:cardId', validate({ body: setAlsaVolumeBodySchema }), async (req: Request, res: Response) => {
  try {
    const { control, percent } = (req as ValidatedRequest<SetAlsaVolumeInput>).validated.body;
    await snapclientInstanceService.setAlsaVolume(req.params.cardId, control, percent);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  '/:id/:action',
  validate({ params: controlSnapclientInstanceParamsSchema }),
  async (req: Request, res: Response) => {
    try {
      const { id, action } = (req as ValidatedRequest<unknown, { id: string; action: SnapclientControlAction }>).validated.params;
      const ok = await snapclientInstanceService.controlInstance(id, action);
      if (!ok) return res.status(404).json({ error: 'Instance not found' });
      const status = await snapclientInstanceService.getInstanceStatus(id);
      res.json({ message: `Instance ${action}ed`, status });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const logs = await snapclientInstanceService.getInstanceLogs(req.params.id);
    if (logs === null) return res.status(404).json({ error: 'Instance not found' });
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
