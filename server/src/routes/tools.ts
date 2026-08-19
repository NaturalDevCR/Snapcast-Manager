// Task 9: migrated onto the shell-free platform layer
// (platform/exec.ts's run(), platform/files.ts's installPrivilegedFile())
// and, most importantly, fixes design-spec finding #3 -- the single most
// severe vulnerability in this codebase.
//
// PRE-TASK-9: `POST /api/tools/scripts` accepted ANY absolute path as a
// "managed script" (only `path.startsWith('/')` + a quote/newline
// blacklist), and `POST /api/tools/script` then wrote attacker-controlled
// content to that path as root (`sudo cp` + `sudo chmod +x`, built from
// shell-interpolated template strings). Combined, any authenticated user
// could register e.g. `/etc/sudoers.d/pwn` or
// `/etc/systemd/system/anything.service` and then write arbitrary content
// to it as root -- a two-request root-RCE/persistence primitive needing no
// other bug. See services/tools.ts's `validateManagedScriptPath()` for the
// fix and its documented residual risk.
import express, { Request, Response } from 'express';
import fs from 'fs';
import { authenticateToken } from '../auth';
import db from '../database';
import { randomUUID } from 'crypto';
import { run } from '../platform/exec';
import { installPrivilegedFile } from '../platform/files';
import { MANAGED_SCRIPTS_DIR, validateManagedScriptPath, readCrontab } from '../services/tools';

const router = express.Router();

router.use(authenticateToken);

// ─── Crontab ──────────────────────────────────────────────────────────────────
// crontab operates on the INVOKING user's own crontab, not a privileged
// system path -- the pre-existing code never applied SUDO() to either of
// these calls, so neither does this migration.

router.get('/crontab', async (_req: Request, res: Response) => {
  try {
    const content = await readCrontab();
    res.json({ content });
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
    // Shell-free: the temp file PATH is passed as a single argv element to
    // `crontab`, never interpolated into a shell command string.
    await run('crontab', [tmpFile]);
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
    // installPrivilegedFile writes to an unpredictable, process-owned temp
    // path (fs.mkdtemp) and installs via a sudo-prefixed argv `cp` -- no
    // predictable /tmp path, no shell string. See platform/files.ts.
    await installPrivilegedFile(MPD_CONF, content);
    res.json({ message: 'MPD config saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Script Paths ─────────────────────────────────────────────────────────────

router.get('/scripts', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM script_paths ORDER BY created_at ASC').all() as any[];
    // `managed` is surfaced so a future frontend task can show a read-only
    // indicator for legacy (pre-Task-9) rows registered outside
    // MANAGED_SCRIPTS_DIR -- see POST /script below for the enforcement.
    res.json(rows.map(r => ({ ...r, managed: !!r.managed })));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/scripts', (req: Request, res: Response) => {
  try {
    const { label, path: rawPath } = req.body;
    if (!label || !rawPath) {
      return res.status(400).json({ error: 'label and path are required' });
    }
    if (typeof rawPath !== 'string') {
      return res.status(400).json({ error: 'path must be a string' });
    }
    // THE FIX for design-spec finding #3: registration is now restricted to
    // MANAGED_SCRIPTS_DIR, resolved-path + symlink-aware. See
    // services/tools.ts's validateManagedScriptPath() docstring for the
    // full approach and its documented residual risk.
    const validation = validateManagedScriptPath(rawPath);
    if (!validation.ok) {
      return res.status(400).json({
        error: `Invalid script path (${validation.reason}). Scripts must be registered inside ${MANAGED_SCRIPTS_DIR}.`,
      });
    }
    const id = randomUUID();
    db.prepare('INSERT INTO script_paths (id, label, path, managed) VALUES (?, ?, ?, 1)')
      .run(id, label, validation.resolvedPath);
    res.json({ id, label, path: validation.resolvedPath, managed: true });
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
    // Removing a registration -- managed or not -- never touches the
    // underlying file, so this is always safe for both managed and legacy
    // (unmanaged) rows.
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
    // Only allow paths registered in the DB for security. Legacy
    // (managed = 0) rows remain readable here -- read-only means read-only,
    // not invisible; see POST /script below for the write-side rejection.
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
    // Only allow paths registered in the DB for security.
    const row = db.prepare('SELECT id, managed FROM script_paths WHERE path = ?').get(filePath) as any;
    if (!row) {
      return res.status(403).json({ error: 'Path not registered' });
    }
    if (!row.managed) {
      return res.status(403).json({
        error: `This script path is outside ${MANAGED_SCRIPTS_DIR} (it was registered before this security fix) and is now read-only. ` +
          `Remove and re-register it at a path inside ${MANAGED_SCRIPTS_DIR} to make it editable again.`,
      });
    }
    // Defense in depth: re-validate the boundary independently of the
    // `managed` flag stored in the DB -- don't trust that "it's in the DB
    // with managed=1" alone means "safe to write to", in case a future bug
    // lets a bad row into the table another way.
    const validation = validateManagedScriptPath(filePath);
    if (!validation.ok) {
      return res.status(403).json({ error: `Refusing to write: ${validation.reason}` });
    }
    // mode 0o755 (rwxr-xr-x): the original code did `sudo cp` (which
    // preserves the temp file's mode -- typically 0o644 from
    // fs.writeFileSync's default) followed by `sudo chmod +x`, which adds
    // the execute bit wherever the corresponding read bit is already set --
    // for a 0o644 source that's exactly 0o755. Requesting 0o755 directly
    // reproduces that same end result (owner rwx, group/other rx) in one
    // step via installPrivilegedFile's `mode` option.
    await installPrivilegedFile(validation.resolvedPath, content, { mode: 0o755 });
    res.json({ message: 'Script saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
