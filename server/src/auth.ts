import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import db from './database';
import { sseTicketStore } from './services/sseTickets';

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

// Task 15: minimum password length policy -- applied on BOTH POST /setup
// (initial admin creation) and POST /change-password (the newPassword
// field), before any hashing/storing happens. Deliberately length-only
// (no uppercase/digit/symbol complexity rules): length is the single most
// impactful, least user-hostile policy -- see task-15-brief.md requirement 1.
const MIN_PASSWORD_LENGTH = 12;

function isPasswordTooShort(password: unknown): boolean {
  return typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH;
}

// Task 15: persisted rate limiter for login/setup/change-password attempts
// (per IP), backed by the `login_attempts` SQLite table (see database.ts)
// instead of an in-memory Map -- a restart is no longer a free rate-limit
// reset for an attacker, which matters here since this app's own
// install/update features restart the server itself.
//
// The SAME limiter (one row per IP, shared across all three endpoints) is
// applied to all of POST /auth/login, POST /auth/setup, and POST
// /auth/change-password:
//   - /login has always needed this (credential stuffing / brute force).
//   - /setup had NONE before this task -- an attacker could hammer the
//     initial-setup race condition or spam admin-creation attempts before
//     a real admin ever sets up the system.
//   - /change-password had NONE before this task -- an authenticated
//     attacker (or anyone holding a stolen valid token) could otherwise
//     brute-force the current-password check with unlimited attempts.
// The window/max-attempts constants are reused unchanged across all three
// (no differentiation): all three guard the same class of risk (a
// password-guessing loop against this single-admin app), and there's no
// specific reason found to size one endpoint's budget differently from
// another's.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
// Lazy cleanup: on every rate-limit check, sweep rows whose window expired
// more than this many window-lengths ago (for ANY ip, not just the current
// request's), so `login_attempts` doesn't grow unbounded from one-off
// visitors. A simple sweep-on-check is sufficient at this app's scale; a
// dedicated cron/cleanup job would be over-engineering.
const STALE_ROW_WINDOW_MULTIPLE = 4;

interface LoginAttemptRow {
  count: number;
  window_start: number;
}

function loginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();

  db.prepare('DELETE FROM login_attempts WHERE window_start < ?').run(now - LOGIN_WINDOW_MS * STALE_ROW_WINDOW_MULTIPLE);

  const row = db.prepare('SELECT count, window_start FROM login_attempts WHERE ip = ?').get(ip) as LoginAttemptRow | undefined;

  if (!row || now - row.window_start > LOGIN_WINDOW_MS) {
    db.prepare(
      `INSERT INTO login_attempts (ip, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(ip) DO UPDATE SET count = 1, window_start = excluded.window_start`
    ).run(ip, now);
    return next();
  }

  const newCount = row.count + 1;
  db.prepare('UPDATE login_attempts SET count = ? WHERE ip = ?').run(newCount, ip);

  if (newCount > LOGIN_MAX_ATTEMPTS) {
    const retryMin = Math.ceil((row.window_start + LOGIN_WINDOW_MS - now) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${retryMin} min.` });
  }
  next();
}

// Clears an IP's rate-limit counter after a successful attempt on a
// rate-limited endpoint, matching the original in-memory limiter's
// behavior of resetting on a successful login.
function clearRateLimit(ip: string) {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
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

router.post('/setup', loginRateLimiter, (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const checkStmt = db.prepare('SELECT count(*) as count FROM users');
    if ((checkStmt.get() as { count: number }).count > 0) {
      return res.status(400).json({ error: 'System already initialized' });
    }

    if (isPasswordTooShort(password)) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const insert = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
    const result = insert.run(username, hashedPassword);

    // A brand-new user always starts at token_version 0 (the column's own
    // default), so the claim mirrors that explicitly.
    const token = jwt.sign(
      { id: result.lastInsertRowid, username, role: 'admin', tokenVersion: 0 },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    clearRateLimit(req.ip || 'unknown');
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

    clearRateLimit(req.ip || 'unknown');
    const tokenVersion = user.token_version ?? 0;
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role, tokenVersion }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Task 15: verifies both the JWT signature AND that its `tokenVersion`
// claim matches the CURRENT value stored for that user in the `users`
// table -- this is what makes POST /change-password and POST /auth/logout
// able to immediately invalidate every previously-issued token for a user
// by bumping `token_version`, without maintaining a separate token
// blacklist.
//
// Backward compatibility: a token issued before this feature existed has
// no `tokenVersion` claim at all. `decoded.tokenVersion ?? 0` treats a
// missing claim as version 0 -- matching the `users.token_version` column's
// own `DEFAULT 0` -- so tokens issued just before this deploy keep working
// instead of every existing session breaking at once. This is a genuine
// comparison, not a bypass: as soon as that user's token_version moves
// past 0 (e.g. any password change or logout), an old claim-less token
// stops matching and is rejected exactly like any other stale token.
//
// This costs one extra synchronous DB read per authenticated request --
// acceptable for this single-admin, low-traffic app on synchronous
// better-sqlite3; no caching layer is added for it.
export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
    if (err) return res.sendStatus(403);

    const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.id) as { token_version: number } | undefined;
    if (!row) return res.sendStatus(403);

    const currentVersion = row.token_version ?? 0;
    const tokenVersion = decoded.tokenVersion ?? 0;
    if (tokenVersion !== currentVersion) {
      return res.sendStatus(403);
    }

    (req as any).user = decoded;
    next();
  });
};

// Task 28: mints a short-lived, single-use ticket that GET /api/events
// accepts via a `?ticket=` query param -- the browser's native EventSource
// API cannot set a custom Authorization header, so this is the
// workaround (see server/src/services/sseTickets.ts for the full
// design/tradeoff, and routes/events.ts for the consuming side). Behind
// the NORMAL authenticateToken middleware, same as every other route --
// minting a ticket itself still requires a valid JWT.
router.post('/sse-ticket', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  const { ticket, expiresAt } = sseTicketStore.mint(user.id, req.ip || 'unknown');
  res.status(201).json({ ticket, expiresAt });
});

// Task 28: GET /api/events' auth fallback. A plain browser EventSource
// can't set the Authorization header a normal API request would (see
// task-28-brief.md), so this accepts EITHER:
//   - a normal `Authorization: Bearer <jwt>` header, delegating to
//     authenticateToken exactly as before -- so any future direct API
//     consumer of /api/events is completely unaffected; OR
//   - a single-use ticket minted by POST /sse-ticket above, passed as
//     `?ticket=`.
// On the ticket path, this attaches the SAME `req.user` shape
// authenticateToken does (id/username/role/tokenVersion, looked up fresh
// from the users table -- the ticket itself only carries a userId) so
// downstream code (routes/events.ts) never needs to know which auth path
// was used. Failure modes mirror authenticateToken's own: 401 for "no
// credential presented at all" (no header AND no ticket param), 403 for
// "a credential was presented but is invalid" (missing/expired/
// already-used/wrong-IP ticket, or a user that's since been deleted).
export const authenticateTokenOrSseTicket = (req: Request, res: Response, next: NextFunction) => {
  if (req.headers['authorization']) {
    return authenticateToken(req, res, next);
  }

  const ticket = req.query.ticket;
  if (typeof ticket !== 'string' || !ticket) return res.sendStatus(401);

  const userId = sseTicketStore.consume(ticket, req.ip || 'unknown');
  if (userId === null) return res.sendStatus(403);

  const row = db.prepare('SELECT id, username, role, token_version FROM users WHERE id = ?').get(userId) as
    | { id: number; username: string; role: string; token_version: number }
    | undefined;
  if (!row) return res.sendStatus(403);

  (req as any).user = { id: row.id, username: row.username, role: row.role, tokenVersion: row.token_version ?? 0 };
  next();
};

router.post('/change-password', authenticateToken, loginRateLimiter, (req: Request, res: Response) => {
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

    if (isPasswordTooShort(newPassword)) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    // Bump token_version in the SAME update as the password change so this
    // immediately invalidates every previously-issued token for this user
    // -- including the very token used to make this request.
    const update = db.prepare('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?');
    update.run(hashedPassword, user.id);

    const updated = db.prepare('SELECT token_version FROM users WHERE id = ?').get(user.id) as { token_version: number };

    // Because this request's own token was just invalidated above, the
    // response must include a FRESH token (with the new tokenVersion) so
    // the client that just changed its own password isn't immediately
    // logged out by its own action.
    const freshToken = jwt.sign(
      { id: dbUser.id, username: dbUser.username, role: dbUser.role, tokenVersion: updated.token_version },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    clearRateLimit(req.ip || 'unknown');
    res.json({ message: 'Password updated successfully', token: freshToken });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Task 47: onboarding wizard progress, persisted server-side (no
// localStorage fallback -- see the design spec's "Overview & trigger") on
// the `users` table's onboarding_step/onboarding_dismissed columns (Task 47
// migration 7). `step` tracks which of the wizard's 3 steps the user has
// reached (0 = not started, 1-3 = in progress/done); `dismissed` records an
// explicit skip. Both endpoints sit behind the same authenticateToken
// middleware as every other authenticated route here.
router.get('/onboarding', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  try {
    const row = db.prepare('SELECT onboarding_step, onboarding_dismissed FROM users WHERE id = ?').get(user.id) as
      { onboarding_step: number; onboarding_dismissed: number } | undefined;
    if (!row) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ step: row.onboarding_step, dismissed: row.onboarding_dismissed === 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/onboarding', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  const { step, dismissed } = req.body;

  if (step !== undefined && (!Number.isInteger(step) || step < 0 || step > 3)) {
    return res.status(400).json({ error: 'step must be an integer between 0 and 3' });
  }
  if (dismissed !== undefined && typeof dismissed !== 'boolean') {
    return res.status(400).json({ error: 'dismissed must be a boolean' });
  }

  try {
    if (step !== undefined) {
      db.prepare('UPDATE users SET onboarding_step = ? WHERE id = ?').run(step, user.id);
    }
    if (dismissed !== undefined) {
      db.prepare('UPDATE users SET onboarding_dismissed = ? WHERE id = ?').run(dismissed ? 1 : 0, user.id);
    }
    const row = db.prepare('SELECT onboarding_step, onboarding_dismissed FROM users WHERE id = ?').get(user.id) as
      { onboarding_step: number; onboarding_dismissed: number };
    res.json({ step: row.onboarding_step, dismissed: row.onboarding_dismissed === 1 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Task 15: logging out invalidates the CURRENT token (and any other
// outstanding token for this user) by bumping token_version -- there's no
// separate blacklist to maintain. This is a single-admin app, so there's
// no "log out this device but keep my other sessions alive" concern to
// design around; bumping the one user's version is sufficient.
router.post('/logout', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  try {
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').run(user.id);
    res.json({ message: 'Logged out successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
