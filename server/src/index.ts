// Load env vars before any other module reads process.env (e.g. JWT_SECRET in auth.ts)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import authRouter from './auth';
import systemRouter from './routes/system';
import configRouter from './routes/config';
import snapshotRouter from './routes/snapshot';
import snapcastRouter from './routes/snapcast';
import watchdogRouter from './routes/watchdog';
import snapclientInstancesRouter from './routes/snapclientInstances';
import toolsRouter from './routes/tools';
import pipeSourcesRouter from './routes/pipeSources';
import { pipeSourceService } from './services/pipeSources';

const app = express();
const PORT = process.env.PORT || 3000;

// The frontend is served from this same origin in production; CORS is only
// needed when the Vite dev server (5173) talks to the API without the proxy.
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/system', systemRouter);
app.use('/api/config', configRouter);
app.use('/api/snapshots', snapshotRouter);
app.use('/api/snapcast', snapcastRouter);
app.use('/api/watchdog', watchdogRouter);
app.use('/api/snapclient-instances', snapclientInstancesRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/pipe-sources', pipeSourcesRouter);
app.use('/api/radio-pipes', pipeSourcesRouter); // backwards compat alias

// Basic status route
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    service: 'Snapcast Manager',
    mode: (process.env.SNAPCAST_MODE as 'client' | 'server' | 'both') || 'both',
  });
});

// Unknown API routes must return JSON 404, not the SPA shell
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl}` });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../../client/dist')));

// SPA Fallback - Path-less middleware for Express 5 compatibility
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

// Task 7: migrate any pipe source still on the pre-0.4 /tmp FIFO path onto
// the new /run/snapcast-manager one before accepting traffic. The database
// module above is already fully initialized by the time this file's
// imports finish running (its `init()` call is a top-level side effect of
// importing '../database', transitively pulled in by every router above),
// so this satisfies "after the database is initialized". migrateFifoPaths()
// itself already never throws (each pipe's migration is independently
// caught -- see its docstring in services/pipeSources.ts), but this
// try/catch is kept as defense in depth so a startup-crashing bug there
// can never take server startup down with it.
async function start(): Promise<void> {
  try {
    await pipeSourceService.migrateFifoPaths();
  } catch (err) {
    console.error('[startup] Pipe-source FIFO migration failed unexpectedly:', err);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
