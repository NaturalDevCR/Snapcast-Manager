import express, { Request, Response } from 'express';
import { snapshotService } from '../services/snapshot';
import { authenticateToken } from '../auth';

const router = express.Router();

// All snapshot routes are protected
router.use(authenticateToken);

router.get('/', async (req: Request, res: Response) => {
    try {
        const snapshots = await snapshotService.listSnapshots();
        res.json(snapshots);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/', async (req: Request, res: Response) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    try {
        const snapshot = await snapshotService.createSnapshot(name, description);
        res.status(201).json(snapshot);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/restore', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await snapshotService.restoreSnapshot(parseInt(id));
        res.json({ message: 'Snapshot restored successfully' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await snapshotService.deleteSnapshot(parseInt(id));
        res.json({ message: 'Snapshot deleted' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
