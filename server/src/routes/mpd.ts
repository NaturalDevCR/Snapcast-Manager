import { Router, Request, Response } from 'express';
import { MpdService } from '../services/mpd';

const router = Router();
const mpdService = new MpdService();

/**
 * @route   GET /api/mpd/status
 * @desc    Obtiene el estado actual de MPD y la canción en reproducción.
 * @access  Public (o Autenticado según el middleware global si existe)
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const status = await mpdService.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch MPD status', message: err.message });
  }
});

/**
 * @route   POST /api/mpd/control
 * @desc    Controla la reproducción de MPD (play, pause, stop, etc.)
 * @access  Public
 */
router.post('/control', async (req: Request, res: Response) => {
  const { action } = req.body;
  if (!action) {
    return res.status(400).json({ error: 'Missing action parameter' });
  }

  try {
    const response = await mpdService.control(action as any);
    res.json({ status: 'ok', response });
  } catch (err: any) {
    // Si falla la conexión (MPD offline), devolvemos 400 con un mensaje descriptivo
    if (err.message && err.message.includes('Failed to connect to MPD')) {
        return res.status(400).json({ 
            error: 'MPD is offline', 
            message: 'No se puede controlar MPD porque parece estar apagado o no instalado (Puerto 6600 inaccesible).' 
        });
    }
    res.status(500).json({ error: 'Failed to control MPD', message: err.message });
  }
});

/**
 * @route   POST /api/mpd/volume
 * @desc    Ajusta el volumen de MPD
 * @access  Public
 */
router.post('/volume', async (req: Request, res: Response) => {
  const { volume } = req.body;
  if (volume === undefined) {
    return res.status(400).json({ error: 'Missing volume parameter' });
  }

  try {
    const response = await (mpdService as any).sendCommand(`setvol ${volume}`);
    res.json({ status: 'ok', response });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to set volume', message: err.message });
  }
});

export default router;
