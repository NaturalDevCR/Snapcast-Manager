import express, { Request, Response } from 'express';
import { snapclientInstanceService } from '../services/snapclientInstances';
import { authenticateToken } from '../auth';

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

router.post('/', async (req: Request, res: Response) => {
  const { name, host, port, soundcard, hostId } = req.body;
  if (!name || !soundcard) {
    return res.status(400).json({ error: 'name and soundcard are required' });
  }
  try {
    const instance = await snapclientInstanceService.createInstance({
      name,
      host: host || '127.0.0.1',
      port: port || 1704,
      soundcard,
      hostId,
    });
    res.json({ instance });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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
    await snapclientInstanceService.deleteInstance(req.params.id);
    res.json({ message: 'Instance deleted' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/:action', async (req: Request, res: Response) => {
  const { action } = req.params;
  if (!['start', 'stop', 'restart', 'enable', 'disable'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  try {
    await snapclientInstanceService.controlInstance(req.params.id, action as any);
    const status = await snapclientInstanceService.getInstanceStatus(req.params.id);
    res.json({ message: `Instance ${action}ed`, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const logs = await snapclientInstanceService.getInstanceLogs(req.params.id);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
