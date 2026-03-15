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

export default router;
