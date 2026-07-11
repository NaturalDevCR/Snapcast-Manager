import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import db from './database';

const router = express.Router();

// Use JWT_SECRET from the environment if provided; otherwise generate one once
// and persist it in the settings table so tokens survive restarts. Never fall
// back to a hardcoded secret (it would let anyone forge admin tokens).
function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'").get() as { value: string } | undefined;
  if (row?.value) return row.value;
  const secret = randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)").run(secret);
  return secret;
}
const JWT_SECRET = resolveJwtSecret();

// Simple in-memory rate limiter for login attempts (per IP)
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return next();
  }
  entry.count++;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    const retryMin = Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 60000);
    return res.status(429).json({ error: `Too many login attempts. Try again in ${retryMin} min.` });
  }
  next();
}

router.get('/setup-status', (req: Request, res: Response) => {
  try {
    const stmt = db.prepare('SELECT count(*) as count FROM users');
    const result = stmt.get() as { count: number };
    res.json({ isInitialized: result.count > 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/setup', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const checkStmt = db.prepare('SELECT count(*) as count FROM users');
    if ((checkStmt.get() as { count: number }).count > 0) {
      return res.status(400).json({ error: 'System already initialized' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insert = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const result = insert.run(username, hashedPassword);

    const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'admin' }, JWT_SECRET, { expiresIn: '1d' });

    res.status(201).json({ 
      message: 'Admin user created successfully',
      token,
      user: { id: result.lastInsertRowid, username, role: 'admin' }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', loginRateLimiter, (req: Request, res: Response) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
     return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    const user = stmt.get(username) as any;

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    loginAttempts.delete(req.ip || 'unknown');
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    (req as any).user = user;
    next();
  });
};

router.post('/change-password', authenticateToken, (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const user = (req as any).user;
  
  if (!currentPassword || !newPassword) {
     return res.status(400).json({ error: 'Current and new passwords are required' });
  }

  try {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const dbUser = stmt.get(user.id) as any;

    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = bcrypt.compareSync(currentPassword, dbUser.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    const update = db.prepare('UPDATE users SET password = ? WHERE id = ?');
    update.run(hashedPassword, user.id);

    res.json({ message: 'Password updated successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
