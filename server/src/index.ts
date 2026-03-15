import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import authRouter from './auth';
import systemRouter from './routes/system';
import configRouter from './routes/config';
import snapshotRouter from './routes/snapshot';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/system', systemRouter);
app.use('/api/config', configRouter);
app.use('/api/snapshots', snapshotRouter);

// Basic status route
app.get('/api/status', (req, res) => {
  res.json({ status: 'online', service: 'Snapcast Manager' });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../../client/dist')));

// SPA Fallback - Path-less middleware for Express 5 compatibility
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../../client/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
