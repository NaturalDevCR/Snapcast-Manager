import express, { Request, Response } from 'express';
import { authenticateToken } from '../auth';
import { executeSnapcastRpc } from '../utils/snapcastRpc';

const router = express.Router();

router.use(authenticateToken);

router.get('/status', async (req: Request, res: Response) => {
    try {
        // Query the snapserver for its full status via JSON-RPC
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
    try {
        const result = await executeSnapcastRpc('Group.SetStream', { id, streamId: stream_id });
        res.json({ success: true, result });
    } catch (error: any) {
        console.error('Snapcast Group.SetStream Error:', error);
        res.status(500).json({ error: error.message || 'Failed to set group stream' });
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

export default router;
