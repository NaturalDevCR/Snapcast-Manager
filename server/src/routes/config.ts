import express, { Request, Response } from 'express';
import { configService } from '../services/config';
import { authenticateToken } from '../auth';

const router = express.Router();

router.use(authenticateToken);

router.get('/server', async (req: Request, res: Response) => {
    try {
        const config = await configService.readServerConfig();
        res.json({ content: config });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/server', async (req: Request, res: Response) => {
    const { content } = req.body;
    if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Content must be a string' });
    }
    try {
        await configService.writeServerConfig(content);
        res.json({ message: 'Server config updated' });
    } catch (error: any) {
         res.status(500).json({ error: error.message });
    }
});

router.get('/server/parsed', async (req: Request, res: Response) => {
    try {
        const config = await configService.readServerConfigParsed();
        res.json({ config });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/server/parsed', async (req: Request, res: Response) => {
    const { config } = req.body;
    if (typeof config !== 'object') {
        return res.status(400).json({ error: 'Config must be an object' });
    }
    try {
        await configService.writeServerConfigParsed(config);
        res.json({ message: 'Server config updated' });
    } catch (error: any) {
         res.status(500).json({ error: error.message });
    }
});

export default router;
