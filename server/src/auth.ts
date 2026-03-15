import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from './database';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'changeme_secret_key';

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
    insert.run(username, hashedPassword);

    res.status(201).json({ message: 'Admin user created successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', (req: Request, res: Response) => {
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

export default router;
