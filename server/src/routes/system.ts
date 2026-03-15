import express, { Request, Response } from 'express';
import { systemService, PackageName } from '../services/system';
import { authenticateToken } from '../auth';

const router = express.Router();

router.use(authenticateToken);

router.get('/status/:service', async (req: Request, res: Response) => {
    const { service } = req.params;
    if (service !== 'snapserver' && service !== 'snapclient') {
        return res.status(400).json({ error: 'Invalid service name' });
    }
    try {
        const status = await systemService.getServiceStatus(service);
        res.json({ service, status });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/service/:action/:service', async (req: Request, res: Response) => {
    const { action, service } = req.params;
    if (service !== 'snapserver' && service !== 'snapclient') {
        return res.status(400).json({ error: 'Invalid service name' });
    }
    
    try {
        let message = '';
        switch (action) {
            case 'start':
                await systemService.startService(service);
                message = `${service} started`;
                break;
            case 'stop':
                await systemService.stopService(service);
                message = `${service} stopped`;
                break;
            case 'restart':
                await systemService.restartService(service);
                message = `${service} restarted`;
                break;
            case 'enable':
                await systemService.enableService(service);
                message = `${service} enabled`;
                break;
            case 'disable':
                await systemService.disableService(service);
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
    if (pkg !== 'snapserver' && pkg !== 'snapclient' && pkg !== 'ffmpeg') {
        return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const installed = await systemService.isInstalled(pkg);
        res.json({ pkg, installed });
    } catch (error: any) {
         res.status(500).json({ error: error.message });
    }
});

router.post('/install/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'snapclient' && pkg !== 'ffmpeg') {
        return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const output = await systemService.installPackage(pkg);
        res.json({ message: `${pkg} installed`, output });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/uninstall/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'snapclient' && pkg !== 'ffmpeg') {
         return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const output = await systemService.uninstallPackage(pkg);
        res.json({ message: `${pkg} uninstalled`, output });
    } catch (error: any) {
         res.status(500).json({ error: error.message });
    }
});

export default router;
