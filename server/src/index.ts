// Load env vars before any other module reads process.env (e.g. JWT_SECRET in auth.ts)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
import eventsRouter from './routes/events';
import { pipeSourceService } from './services/pipeSources';
import { snapcastLive } from './services/snapcastLive';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = process.env.PORT || 3000;

// Task 15: HTTP security headers. The CSP is built on helmet's own strict
// defaults (default-src 'self', object-src 'none', no 'unsafe-inline'
// anywhere by default) -- confirmed against the REAL built
// `client/dist/index.html` (via `cd client && npm run build`) that no
// `'unsafe-inline'`/nonce carve-out is needed: Vite emits the app's script
// and CSS as external files (`<script type="module" src="/assets/...">`,
// `<link rel="stylesheet" href="/assets/...">`), not inline <script>/<style>
// tags, so the default script-src/style-src 'self' already covers them.
//
// The one deliberate carve-out: `client/index.html` still loads Google
// Fonts (Inter + Material Symbols) directly from fonts.googleapis.com /
// fonts.gstatic.com (see that file's <link> tags). Stage 2 of the
// hardening plan self-hosts those fonts instead; until that lands,
// style-src/font-src must explicitly allow just those two hosts -- no
// other external host is allowed beyond them. Tighten this back to
// helmet's plain defaults once fonts are self-hosted.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
      },
    },
  })
);

// The frontend is served from this same origin in production; CORS is only
// needed when the Vite dev server (5173) talks to the API without the proxy.
if (process.env.NODE_ENV !== 'production') {
  app.use(cors());
}
// Task 15: bound the JSON body size (was unbounded express.json()) so a
// client can't force the process to buffer an arbitrarily large request body.
app.use(express.json({ limit: '1mb' }));

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
app.use('/api/events', eventsRouter);

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

// Task 15: central error-handling middleware -- MUST be registered last,
// after every router and the SPA fallback above, so Express treats it as
// the catch-all for anything that reaches it without a route's own
// try/catch handling it first (see middleware/errorHandler.ts for the
// full scope-boundary explanation: this is a safety net, not a
// replacement for each route's existing local error handling).
app.use(errorHandler);

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

  // Task 26, Part 3: detect (never mutate) pipe sources whose names collide
  // after slugging -- possible on an install that predates create()/
  // adopt()'s own slug-collision validation. scanForSlugCollisions() itself
  // already never throws (see its docstring in services/pipeSources.ts),
  // but this try/catch is kept as defense in depth, mirroring the
  // migrateFifoPaths() call above.
  try {
    await pipeSourceService.scanForSlugCollisions();
  } catch (err) {
    console.error('[startup] Pipe-source slug-collision scan failed unexpectedly:', err);
  }

  // Task 25: connect eagerly at startup rather than lazily on first request,
  // so the cache is already warm by the time the first GET /api/snapcast/status
  // or /api/events client shows up (per the task brief's stated preference).
  // Never throws -- snapcastLive.ts's own reconnect-with-backoff loop is the
  // only handling a snapserver that's slow to start, or not installed/running
  // at all, needs (see that file's header for the log-rate-limiting that
  // keeps a permanently-absent snapserver from flooding the console).
  snapcastLive.start();

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Task 15: request timeout via Node's own http.Server#setTimeout, applied
  // to the server instance app.listen() returns. This is a socket-idle
  // timeout (resets on activity), not a hard cap on total request
  // duration, which is what we want here: routes/system.ts's long-running
  // install/update/uninstall work already runs as a background job
  // (jobService.start(), returning 202 immediately -- see startJob() in
  // routes/system.ts) that the client polls via quick, individual
  // GET /system/jobs/:id requests rather than holding one connection open
  // for the job's full duration, so those never approach this timeout.
  // 2 minutes is generous for any single request/response on this app
  // (including e.g. streaming a backup archive download in
  // GET /system/backups/download/:name) while still bounding a
  // slow-loris-style hung connection.
  server.setTimeout(2 * 60 * 1000);
}

start();
