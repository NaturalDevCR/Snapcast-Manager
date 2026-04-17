import express, { Request, Response } from 'express';
import { exec } from 'child_process';
import util from 'util';
import fs from 'fs';
import { authenticateToken } from '../auth';
import db from '../database';
import { randomUUID } from 'crypto';

const router = express.Router();
const execAsync = util.promisify(exec);

router.use(authenticateToken);

const SUDO = () => (process as any).getuid?.() === 0 ? '' : 'sudo ';

// ─── Crontab ──────────────────────────────────────────────────────────────────

router.get('/crontab', async (_req: Request, res: Response) => {
  try {
    const { stdout } = await execAsync('crontab -l 2>/dev/null || true');
    res.json({ content: stdout });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/crontab', async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    const tmpFile = `/tmp/snapmanager-crontab-${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, content.endsWith('\n') ? content : content + '\n');
    await execAsync(`crontab ${tmpFile}`);
    fs.unlinkSync(tmpFile);
    res.json({ message: 'Crontab saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── MPD Config ───────────────────────────────────────────────────────────────

const MPD_CONF = '/etc/mpd.conf';

router.get('/mpd-config', async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(MPD_CONF)) {
      return res.json({ content: '' });
    }
    const content = fs.readFileSync(MPD_CONF, 'utf8');
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/mpd-config', async (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    const tmpFile = `/tmp/snapmanager-mpd-${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, content);
    await execAsync(`${SUDO()}cp ${tmpFile} ${MPD_CONF} && rm -f ${tmpFile}`);
    res.json({ message: 'MPD config saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Script Paths ─────────────────────────────────────────────────────────────

router.get('/scripts', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM script_paths ORDER BY created_at ASC').all();
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scripts', (req: Request, res: Response) => {
  try {
    const { label, path } = req.body;
    if (!label || !path) {
      return res.status(400).json({ error: 'label and path are required' });
    }
    const id = randomUUID();
    db.prepare('INSERT INTO script_paths (id, label, path) VALUES (?, ?, ?)').run(id, label, path);
    res.json({ id, label, path });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ error: 'A script with that path already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.delete('/scripts/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM script_paths WHERE id = ?').run(id);
    res.json({ message: 'Script path removed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Script File Read/Write ───────────────────────────────────────────────────

router.get('/script', async (req: Request, res: Response) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'path query param is required' });
    }
    // Only allow paths registered in the DB for security
    const row = db.prepare('SELECT id FROM script_paths WHERE path = ?').get(filePath) as any;
    if (!row) {
      return res.status(403).json({ error: 'Path not registered' });
    }
    if (!fs.existsSync(filePath)) {
      return res.json({ content: '' });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/script', async (req: Request, res: Response) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || typeof content !== 'string') {
      return res.status(400).json({ error: 'path and content are required' });
    }
    // Only allow paths registered in the DB for security
    const row = db.prepare('SELECT id FROM script_paths WHERE path = ?').get(filePath) as any;
    if (!row) {
      return res.status(403).json({ error: 'Path not registered' });
    }
    const tmpFile = `/tmp/snapmanager-script-${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, content);
    await execAsync(`${SUDO()}cp ${tmpFile} ${filePath} && chmod +x ${filePath} && rm -f ${tmpFile}`);
    res.json({ message: 'Script saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
