import express, { Request, Response } from 'express';
import { authenticateToken } from '../auth';
import { executeSnapcastRpc } from '../utils/snapcastRpc';
import { snapcastLive } from '../services/snapcastLive';

const router = express.Router();

router.use(authenticateToken);

// Task 25: serves from snapcastLive.ts's in-memory cache (kept current by
// its persistent WebSocket connection + notification merges) instead of
// making a fresh HTTP JSON-RPC round trip to snapserver on every poll --
// this is the exact "polling storm" design-spec finding #20 called out.
// Response shape is UNCHANGED (`{ status: <Server.GetStatus result> }`) --
// client/src/stores/snapcast.ts's fetchStatus() keeps working as-is.
//
// Falls back to the original direct RPC call when the cache hasn't warmed
// up yet (server just started, WS not connected yet, or snapserver was
// never reachable) -- this route's public contract (same shape, same
// failure mode) must keep working even before the persistent connection
// has caught up, per the task brief.
router.get('/status', async (req: Request, res: Response) => {
    const cached = snapcastLive.getCachedStatus();
    if (cached) {
        return res.json({ status: cached });
    }
    try {
        const status = await executeSnapcastRpc('Server.GetStatus');
        res.json({ status });
    } catch (error: any) {
        console.error('Snapcast RPC Error:', error);
        res.status(500).json({ error: error.message || 'Failed to communicate with Snapserver RPC' });
    }
});

router.post('/group/:id/stream', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { stream_id } = req.body;
    console.log(`[Snapcast RPC] Setting stream for group ${id} to ${stream_id}...`);
    try {
        const result = await executeSnapcastRpc('Group.SetStream', { id, stream_id });
        console.log(`[Snapcast RPC] Group.SetStream response:`, JSON.stringify(result));
        res.json(result);
    } catch (error: any) {
        console.error(`[Snapcast RPC] Group.SetStream FAILED:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

router.post('/group/:id/muted', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { muted } = req.body;
    try {
        const result = await executeSnapcastRpc('Group.SetMute', { id, mute: muted });
        res.json({ success: true, result });
    } catch (error: any) {
        console.error('Snapcast Group.SetMute Error:', error);
        res.status(500).json({ error: error.message || 'Failed to mute group' });
    }
});

router.post('/client/:id/volume', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { volume } = req.body; // { percent: number, muted: boolean }
    try {
        const result = await executeSnapcastRpc('Client.SetVolume', { id, volume });
        res.json({ success: true, result });
    } catch (error: any) {
        console.error('Snapcast Client.SetVolume Error:', error);
        res.status(500).json({ error: error.message || 'Failed to set client volume' });
    }
});

router.post('/client/:id/name', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name } = req.body;
    try {
        const result = await executeSnapcastRpc('Client.SetName', { id, name });
        res.json({ success: true, result });
    } catch (error: any) {
        console.error('Snapcast Client.SetName Error:', error);
        res.status(500).json({ error: error.message || 'Failed to set client name' });
    }
});

router.post('/group/:id/name', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name } = req.body;
    try {
        const result = await executeSnapcastRpc('Group.SetName', { id, name });
        res.json({ success: true, result });
    } catch (error: any) {
        console.error('Snapcast Group.SetName Error:', error);
        res.status(500).json({ error: error.message || 'Failed to set group name' });
    }
});

export default router;
