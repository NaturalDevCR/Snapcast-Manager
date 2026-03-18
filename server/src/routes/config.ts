import express, { Request, Response } from 'express';
import fs from 'fs/promises';
import { configService } from '../services/config';
import { authenticateToken } from '../auth';
import { CONFIG_METADATA, CONFIG_SECTIONS, SOURCE_TEMPLATES } from '../constants/defaultConfig';

const SNAPCLIENT_CONFIG_PATH = '/etc/default/snapclient';

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

router.post('/save', authenticateToken, async (req: Request, res: Response) => {
  try {
    await configService.writeServerConfig(req.body.config);
    res.json({ message: 'Configuration saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Modular Configuration Routes
router.get('/segments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const segments = await configService.getSegments();
    res.json(segments);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/segments', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { name, content } = req.body;
    if (!name || content === undefined) {
      return res.status(400).json({ error: 'Name and content are required' });
    }
    await configService.saveSegment(name, content);
    res.json({ message: 'Segment saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/segments/:name', authenticateToken, async (req: Request, res: Response) => {
  try {
    await configService.deleteSegment(req.params.name);
    res.json({ message: 'Segment deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/rebuild', authenticateToken, async (req: Request, res: Response) => {
  try {
    await configService.rebuildMasterConfig();
    res.json({ message: 'Configuration rebuilt successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/metadata', authenticateToken, (req, res) => {
    res.json(CONFIG_METADATA);
});

router.get('/sections', authenticateToken, (req, res) => {
    res.json(CONFIG_SECTIONS);
});

router.get('/source-templates', authenticateToken, (req, res) => {
    res.json(SOURCE_TEMPLATES);
});

router.post('/reset', authenticateToken, async (req, res) => {
    try {
        await configService.resetToDefault();
        res.json({ message: 'Configuration reset to default' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Snapclient config (/etc/default/snapclient)
router.get('/snapclient', async (req: Request, res: Response) => {
    try {
        const content = await fs.readFile(SNAPCLIENT_CONFIG_PATH, 'utf-8').catch(() => '# snapclient default options\nSNAPCLIENT_OPTS=""\n');
        res.json({ content });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/snapclient', async (req: Request, res: Response) => {
    const { content } = req.body;
    if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Content must be a string' });
    }
    try {
        await fs.writeFile(SNAPCLIENT_CONFIG_PATH, content, 'utf-8');
        res.json({ message: 'Snapclient config updated' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
