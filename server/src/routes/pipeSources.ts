import { Router } from 'express';
import { pipeSourceService, getFifoPath, getSystemdServiceName } from '../services/pipeSources';

const router = Router();

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
router.post('/', async (req, res) => {
  try {
    const { name, type = 'radio', url, reconnect, reconnectStreamed, reconnectAtEof, reconnectDelayMax, idleThreshold, enabled } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (type === 'radio' && !url) return res.status(400).json({ error: 'url is required for radio sources' });
    const pipe = await pipeSourceService.create({
      name: String(name).trim(),
      type: type === 'mpd' ? 'mpd' : 'radio',
      url: url ? String(url).trim() : '',
      reconnect: reconnect !== false,
      reconnectStreamed: reconnectStreamed !== false,
      reconnectAtEof: reconnectAtEof !== false,
      reconnectDelayMax: Number(reconnectDelayMax) || 30,
      idleThreshold: Number(idleThreshold) || 15000,
      enabled: enabled !== false,
    });
    res.json(pipe);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pipe-sources/:id
router.put('/:id', async (req, res) => {
  try {
    const pipe = await pipeSourceService.update(req.params.id, req.body);
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
router.post('/:id/control', async (req, res) => {
  try {
    const { action } = req.body;
    const allowed = ['start', 'stop', 'restart', 'enable', 'disable'];
    if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
    await pipeSourceService.control(req.params.id, action);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
router.post('/adopt', async (req, res) => {
  try {
    const { name, type = 'radio', url, reconnect, reconnectStreamed, reconnectAtEof, reconnectDelayMax, idleThreshold, enabled, existingServiceName } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const pipe = await pipeSourceService.adopt({
      name: String(name).trim(),
      type: type === 'mpd' ? 'mpd' : 'radio',
      url: url ? String(url).trim() : '',
      reconnect: reconnect !== false,
      reconnectStreamed: reconnectStreamed !== false,
      reconnectAtEof: reconnectAtEof !== false,
      reconnectDelayMax: Number(reconnectDelayMax) || 30,
      idleThreshold: Number(idleThreshold) || 15000,
      enabled: enabled !== false,
      existingServiceName: existingServiceName || undefined,
    });
    res.json(pipe);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
