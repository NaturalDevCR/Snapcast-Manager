import express, { Request, Response } from 'express';
import { systemService } from '../services/system';
import { configService } from '../services/config';
import { authenticateToken } from '../auth';

const router = express.Router();

router.use(authenticateToken);

router.get('/status/:service', async (req: Request, res: Response) => {
    const { service } = req.params;
    if (service !== 'snapserver' && service !== 'shairport-sync' && service !== 'snapmanager') {
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
    if (service !== 'snapserver' && service !== 'shairport-sync' && service !== 'snapmanager') {
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
    if (service !== 'snapserver' && service !== 'shairport-sync') {
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
    if (pkg !== 'snapserver' && pkg !== 'ffmpeg' && pkg !== 'snap-ctrl' && pkg !== 'shairport-sync') {
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
    if (pkg !== 'snapserver' && pkg !== 'ffmpeg' && pkg !== 'shairport-sync') {
        return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const output = await systemService.installPackage(pkg);
        res.json({ message: `${pkg} installed`, output });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/update/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'ffmpeg' && pkg !== 'shairport-sync' && pkg !== 'snap-ctrl') {
         return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const output = await systemService.updatePackage(pkg as any);
        res.json({ message: `${pkg} updated`, output });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/update-node', async (req: Request, res: Response) => {
    try {
        const output = await systemService.updateNodeJs();
        res.json({ message: 'Node.js update initiated', output });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/uninstall/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    if (pkg !== 'snapserver' && pkg !== 'ffmpeg') {
         return res.status(400).json({ error: 'Invalid package name' });
    }
    try {
        const output = await systemService.uninstallPackage(pkg);
        res.json({ message: `${pkg} uninstalled`, output });
    } catch (error: any) {
         res.status(500).json({ error: error.message });
    }
});

router.post('/install-snap-ctrl', async (req: Request, res: Response) => {
    try {
        console.log('Starting snap-ctrl installation...');
        const output = await systemService.installSnapCtrl();
        
        console.log('Configuring snapserver to use snap-ctrl...');
        await configService.setSnapserverDocRoot('/usr/share/snapserver/snap-ctrl');
        
        console.log('Restarting snapserver...');
        await systemService.restartService('snapserver');
        
        res.json({ message: 'snap-ctrl installed and configured successfully', output });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/version/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    try {
        const version = await systemService.getPackageVersion(pkg as any);
        res.json({ pkg, version });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/check-updates/:pkg', async (req: Request, res: Response) => {
    const { pkg } = req.params;
    try {
        const version = await systemService.getLatestAvailableVersion(pkg as any);
        res.json({ pkg, version });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
