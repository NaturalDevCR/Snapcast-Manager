import express, { Request, Response } from 'express';
import { systemService } from '../services/system';
import { configService } from '../services/config';
import { backupService, resolveBackupPath } from '../services/backup';
import { BackupScheduleService, BACKUP_ALREADY_IN_PROGRESS_MESSAGE } from '../services/backupSchedule';
import { jobService } from '../services/jobs';
import { authenticateToken } from '../auth';
import { spawn } from 'child_process';
import fs from 'fs';

const router = express.Router();

// Same convention as routes/watchdog.ts's watchdogService: this router's
// own instantiation IS the app's one BackupScheduleService instance
// (services/backupSchedule.ts has no module-level singleton of its own),
// exported so index.ts's graceful-shutdown handler can call stop() on
// this SAME instance.
export const backupScheduleService = new BackupScheduleService();

router.use(authenticateToken);

/** Start a long-running task as a background job and return its id immediately. */
function startJob(res: Response, label: string, task: () => Promise<string>) {
    try {
        const job = jobService.start(label, task);
        res.status(202).json({ jobId: job.id, label: job.label });
    } catch (error: any) {
        res.status(409).json({ error: error.message });
    }
}

router.get('/dashboard', async (req: Request, res: Response) => {
    try {
        const metrics = await systemService.getDashboardMetrics();
        res.json(metrics);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/mympd-info', async (_req: Request, res: Response) => {
    try {
        const info = await systemService.getMympdInfo();
        res.json(info);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/status/:service', async (req: Request, res: Response) => {
    const { service } = req.params;
    if (service !== 'snapserver' && service !== 'snapclient' && service !== 'shairport-sync' && service !== 'snapmanager' && service !== 'librespot' && service !== 'mpd' && service !== 'mympd') {
        return res.status(400).json({ error: 'Invalid service name' });
    }
    try {
        if (service === 'snapmanager') {
            return res.json({ service, status: 'active' });
        }
        const status = await systemService.getServiceStatus(service as any);
        res.json({ service, status });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/logs/:service', async (req: Request, res: Response) => {
    const { service } = req.params;
    if (service !== 'snapserver' && service !== 'snapclient' && service !== 'shairport-sync' && service !== 'snapmanager' && service !== 'librespot' && service !== 'mpd' && service !== 'mympd') {
        return res.status(400).json({ error: 'Invalid service name' });
    }
    try {
        const logs = await systemService.getServiceLogs(service as any);
        res.json({ service, logs });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/service/:action/:service', async (req: Request, res: Response) => {
    const { action, service } = req.params;
    if (service !== 'snapserver' && service !== 'snapclient' && service !== 'shairport-sync' && service !== 'librespot' && service !== 'mpd' && service !== 'mympd') {
        return res.status(400).json({ error: 'Invalid service name' });
    }
    
    try {
        let message = '';
        switch (action) {
            case 'start':
                await systemService.startService(service as any);
                message = `${service} started`;
                break;
            case 'stop':
                await systemService.stopService(service as any);
                message = `${service} stopped`;
                break;
            case 'restart':
                await systemService.restartService(service as any);
                message = `${service} restarted`;
                break;
            case 'enable':
                await systemService.enableService(service as any);
                message = `${service} enabled`;
                break;
            case 'disable':
                await systemService.disableService(service as any);
                message = `${service} disabled`;
                break;
            default:
                return res.status(400).json({ error: 'Invalid action' });
        }
        res.json({ message });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/installed/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'snapclient' && pkg !== 'ffmpeg' && pkg !== 'snap-ctrl' && pkg !== 'shairport-sync' && pkg !== 'mpd' && pkg !== 'mympd') {
        return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const installed = await systemService.isInstalled(pkg);
        res.json({ pkg, installed });
    } catch (error: any) {
         res.status(500).json({ error: error.message });
    }
});

router.post('/install/:pkg', (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'snapclient' && pkg !== 'ffmpeg' && pkg !== 'shairport-sync' && pkg !== 'mpd' && pkg !== 'mympd') {
        return res.status(400).json({ error: 'Invalid package name' });
    }
    startJob(res, `Install ${pkg}`, () => systemService.installPackage(pkg));
});

router.post('/update/:pkg', (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'snapclient' && pkg !== 'ffmpeg' && pkg !== 'shairport-sync' && pkg !== 'snap-ctrl' && pkg !== 'mpd' && pkg !== 'mympd') {
         return res.status(400).json({ error: 'Invalid package name' });
    }
    const { clean } = req.body;
    startJob(res, `Update ${pkg}`, () => systemService.updatePackage(pkg as any, clean));
});

router.post('/update-node', (req: Request, res: Response) => {
    const { version } = req.body;
    startJob(res, `Update Node.js to ${version || '22'}`, () => systemService.updateNodeJs(version));
});

router.post('/uninstall/:pkg', (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'snapclient' && pkg !== 'ffmpeg' && pkg !== 'shairport-sync' && pkg !== 'mpd' && pkg !== 'mympd') {
         return res.status(400).json({ error: 'Invalid package name' });
    }
    startJob(res, `Uninstall ${pkg}`, () => systemService.uninstallPackage(pkg));
});

router.post('/install-snap-ctrl', (req: Request, res: Response) => {
    startJob(res, 'Install snap-ctrl', () => systemService.installSnapCtrl());
});

router.get('/jobs/:id', (req: Request, res: Response) => {
    const job = jobService.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
});

router.get('/backups', async (_req: Request, res: Response) => {
    try {
        const backups = await backupService.listBackups();
        res.json({ backups });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/backups/restore', async (req: Request, res: Response) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Missing backup name' });
    }
    try {
        const output = await backupService.restoreBackup(name);
        res.json({ message: output });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/backups/:name', async (req: Request, res: Response) => {
    try {
        await backupService.deleteBackup(req.params.name);
        res.json({ message: `Backup ${req.params.name} deleted` });
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/backups/download/:name', (req: Request, res: Response) => {
    const name = req.params.name;
    let fullPath: string;
    try {
        fullPath = resolveBackupPath(name);
    } catch {
        return res.status(400).json({ error: 'Invalid backup name' });
    }
    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Backup not found' });
    }
    const stat = fs.statSync(fullPath);
    res.setHeader('Content-disposition', `attachment; filename="${name}"`);
    res.setHeader('Content-type', 'application/gzip');
    res.setHeader('Content-length', String(stat.size));
    // An unhandled 'error' on a readable stream (e.g. EACCES if the file's
    // ownership/permissions don't allow this process to read it, or the
    // file vanishing between the existsSync() check above and the actual
    // open) throws asynchronously with no listener -- Node's default
    // behavior for that is an uncaught exception, which crashes the whole
    // process, not just this one request. That's a real, observed failure
    // mode here: it doesn't just fail this download, it drops every other
    // in-flight connection too (e.g. the SSE stream), until the process
    // manager restarts it. Handling the error explicitly confines the
    // failure to this one response.
    const stream = fs.createReadStream(fullPath);
    stream.on('error', (err: NodeJS.ErrnoException) => {
        console.error(`[backups] failed to read ${fullPath} for download:`, err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to read backup file' });
        } else {
            res.destroy(err);
        }
    });
    stream.pipe(res);
});

router.get('/backup-schedule', async (_req: Request, res: Response) => {
    try {
        const config = await backupScheduleService.getConfig();
        res.json(config);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.put('/backup-schedule', async (req: Request, res: Response) => {
    const { enabled, frequency, dayOfWeek, time, retainCount } = req.body;
    if (typeof enabled !== 'boolean' || (frequency !== 'daily' && frequency !== 'weekly')) {
        return res.status(400).json({ error: 'Invalid enabled/frequency' });
    }
    try {
        const config = await backupScheduleService.updateConfig({ enabled, frequency, dayOfWeek, time, retainCount });
        res.json(config);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/backup-schedule/run-now', async (_req: Request, res: Response) => {
    try {
        const result = await backupScheduleService.runNow();
        res.json(result);
    } catch (error: any) {
        // Same convention as startJob() above / routes/tools.ts's
        // duplicate-path check: a conflicting concurrent action gets 409,
        // everything else falls through to 500.
        if (error.message === BACKUP_ALREADY_IN_PROGRESS_MESSAGE) {
            return res.status(409).json({ error: error.message });
        }
        res.status(500).json({ error: error.message });
    }
});

const VALID_PACKAGES = ['snapserver', 'snapclient', 'ffmpeg', 'shairport-sync', 'snap-ctrl', 'node', 'mpd', 'mympd'];

router.get('/version/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (!VALID_PACKAGES.includes(pkg)) {
        return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const version = await systemService.getPackageVersion(pkg as any);
        res.json({ pkg, version });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/check-updates/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (!VALID_PACKAGES.includes(pkg)) {
        return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const version = await systemService.getLatestAvailableVersion(pkg as any);
        res.json({ pkg, version });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Pure decision function ("which tar -C targets, given what exists on
// disk"), pulled out of the route handler so it's unit-testable without a
// real filesystem or a spawned tar process -- see system.export.test.ts.
export function buildExportTargets(opts: {
    dataDirExists: boolean;
    confFileExists: boolean;
    snapserverStateExists: boolean;
}): string[] {
    const targets: string[] = [];
    if (opts.dataDirExists) {
        targets.push('-C', '/opt/snapcast-manager', 'data');
    }
    if (opts.confFileExists) {
        targets.push('-C', '/etc', 'snapserver.conf');
    }
    if (opts.snapserverStateExists) {
        // snapserver's persistent state directory (server.json -- volumes,
        // client/group state). Same path services/backup.ts's
        // collectSources() backs up cross-cuttingly (Task 1) -- the manual
        // export was a second, independent code path that missed it.
        targets.push('-C', '/var', 'lib/snapserver');
    }
    return targets;
}

router.get('/export', authenticateToken, (req: Request, res: Response) => {
    const backupName = `snapcast-backup-${Date.now()}.tar.gz`;
    res.setHeader('Content-disposition', `attachment; filename="${backupName}"`);
    res.setHeader('Content-type', 'application/gzip');

    const targets = buildExportTargets({
        dataDirExists: fs.existsSync('/opt/snapcast-manager/data'),
        confFileExists: fs.existsSync('/etc/snapserver.conf'),
        snapserverStateExists: fs.existsSync('/var/lib/snapserver'),
    });

    if (targets.length === 0) {
        return res.status(404).json({ error: 'No backup data found.' });
    }

    const tarProcess = spawn('tar', ['-czf', '-', ...targets]);

    tarProcess.stdout.pipe(res);

    tarProcess.stderr.on('data', (data) => {
        console.error(`Tar stderr: ${data}`);
    });

    tarProcess.on('error', (err) => {
        console.error('Tar error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to create backup archive' });
    });
});

export default router;
