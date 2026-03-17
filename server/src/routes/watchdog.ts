import { Router } from 'express';
import { WatchdogService } from '../services/watchdog';

const router = Router();
const watchdogService = new WatchdogService();

// GET /api/watchdog - List all watchdogs
router.get('/', async (req, res) => {
  try {
    const watchdogs = await watchdogService.getWatchdogs();
    res.json(watchdogs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load watchdogs' });
  }
});

// PUT /api/watchdog/bulk - Bulk update watchdogs (Expert Mode)
router.put('/bulk', async (req, res) => {
  try {
    if (!Array.isArray(req.body)) {
      res.status(400).json({ error: 'Body must be an array of watchdogs' });
      return;
    }
    await watchdogService.save(req.body);
    res.json({ success: true, count: req.body.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk save watchdogs' });
  }
});

// POST /api/watchdog - Add a watchdog
router.post('/', async (req, res) => {
  try {
    const { name, port, description, enabled } = req.body;
    if (!name || !port) {
      res.status(400).json({ error: 'Name and Port are required' });
      return;
    }
    const watchdog = await watchdogService.addWatchdog({ name, port, description, enabled });
    res.status(201).json(watchdog);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create watchdog' });
  }
});

// PUT /api/watchdog/:id - Update a watchdog
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const watchdog = await watchdogService.updateWatchdog(id, req.body);
    if (!watchdog) {
      res.status(404).json({ error: 'Watchdog not found' });
      return;
    }
    res.json(watchdog);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update watchdog' });
  }
});

// DELETE /api/watchdog/:id - Delete a watchdog
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const success = await watchdogService.deleteWatchdog(id);
    if (!success) {
      res.status(404).json({ error: 'Watchdog not found' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete watchdog' });
  }
});

// GET /api/watchdog/:id/stats - Get real-time stats
router.get('/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const stats = await watchdogService.getStats(id);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// POST /api/watchdog/:id/disconnect - Disconnect individual socket
router.post('/:id/disconnect', async (req, res) => {
  try {
    const { id } = req.params;
    const { peerIp, peerPort } = req.body;
    if (!peerIp || !peerPort) {
      res.status(400).json({ error: 'Peer IP and Port are required' });
      return;
    }
    const success = await watchdogService.killConnection(id, peerIp, peerPort);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: 'Failed to disconnect socket' });
  }
});

export default router;
