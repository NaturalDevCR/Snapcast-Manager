import { Router } from 'express';
import { radioPipeService, getFifoPath, getSystemdServiceName } from '../services/radioPipes';

const router = Router();

// GET /api/radio-pipes — list all with statuses
router.get('/', async (req, res) => {
  try {
    const pipes = radioPipeService.list();
    const statuses = await radioPipeService.getAllStatuses();
    const result = pipes.map(p => ({
      ...p,
      status: statuses[p.id] || 'unknown',
      fifoPath: getFifoPath(p.name),
      serviceName: getSystemdServiceName(p.name),
    }));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radio-pipes — create
router.post('/', async (req, res) => {
  try {
    const { name, url, reconnect, reconnectStreamed, reconnectAtEof, reconnectDelayMax, idleThreshold, enabled } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
    const pipe = await radioPipeService.create({
      name: String(name).trim(),
      url: String(url).trim(),
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

// PUT /api/radio-pipes/:id — update
router.put('/:id', async (req, res) => {
  try {
    const pipe = await radioPipeService.update(req.params.id, req.body);
    res.json(pipe);
  } catch (err: any) {
    res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
  }
});

// DELETE /api/radio-pipes/:id
router.delete('/:id', async (req, res) => {
  try {
    await radioPipeService.delete(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radio-pipes/:id/control — start | stop | restart | enable | disable
router.post('/:id/control', async (req, res) => {
  try {
    const { action } = req.body;
    const allowed = ['start', 'stop', 'restart', 'enable', 'disable'];
    if (!allowed.includes(action)) return res.status(400).json({ error: 'Invalid action' });
    await radioPipeService.control(req.params.id, action);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radio-pipes/:id/logs
router.get('/:id/logs', async (req, res) => {
  try {
    const logs = await radioPipeService.getLogs(req.params.id);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radio-pipes/system/zombies
router.get('/system/zombies', async (req, res) => {
  try {
    const count = await radioPipeService.getZombieCount();
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/radio-pipes/discover — find unmanaged pipe:// sources in snapserver config
router.get('/discover', async (req, res) => {
  try {
    const discovered = await radioPipeService.discover();
    res.json(discovered);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/radio-pipes/adopt — register an existing pipe:// source into the DB
router.post('/adopt', async (req, res) => {
  try {
    const { name, url, reconnect, reconnectStreamed, reconnectAtEof, reconnectDelayMax, idleThreshold, enabled, existingServiceName } = req.body;
    if (!name || !url) return res.status(400).json({ error: 'name and url are required' });
    const pipe = await radioPipeService.adopt({
      name: String(name).trim(),
      url: String(url).trim(),
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
