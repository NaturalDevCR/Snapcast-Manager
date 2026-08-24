import { randomBytes } from 'crypto';

// Task 28: short-lived, single-use tickets that let a browser's native
// EventSource (which cannot set an Authorization header -- see
// task-28-brief.md) authenticate `GET /api/events` via a query param
// instead of a long-lived JWT. Minted by `POST /api/auth/sse-ticket`
// (behind the normal `authenticateToken` middleware, same as every other
// route) and consumed exactly once by `routes/events.ts`'s auth fallback
// (see `auth.ts`'s `authenticateTokenOrSseTicket`).
//
// In-memory `Map`, matching this codebase's precedent for ephemeral
// server-side state before Task 15 moved the login rate-limiter to SQLite
// for restart-survival -- these tickets do NOT need that: a client
// reconnecting after a restart just mints a fresh one.
//
// ---- Security tradeoff (documented per the task brief) ----
// This puts a bearer credential -- even a short-lived, single-use one --
// in a URL, which is a genuinely new (if narrow) attack surface: it can
// end up in server access logs, browser history, or a reverse proxy's
// request log. Mitigated by:
//   1. A short TTL (`TICKET_TTL_MS`, 30s) -- long enough to immediately
//      open the EventSource connection, short enough that a leaked ticket
//      in a log is nearly useless by the time anyone reads it.
//   2. Single-use: `consume()` deletes the entry on the FIRST lookup,
//      success or failure, so a captured ticket is only ever good for a
//      race against the legitimate client, never a standing replay.
//   3. IP binding: each ticket is tied to the IP that minted it (see
//      `issuedIp` below). A ticket captured from a server/proxy log and
//      replayed from a different address is rejected even inside its TTL
//      window. This is NOT a strong guarantee on its own (IP
//      spoofing/NAT-sharing exist), but it's a cheap, low-complexity
//      narrowing appropriate for this single-admin LAN app -- per the
//      brief's explicit invitation to add "a cheap additional mitigation
//      ... without much complexity." Deliberately NOT doing anything
//      heavier (e.g. a signed/HMAC ticket, binding to a session cookie) --
//      that would be over-engineering for this app's actual threat model.
export const TICKET_TTL_MS = 30_000;

/** Full sweep of expired entries every this many mints, so a ticket that's minted but never consumed (e.g. an abandoned tab) doesn't sit in the Map forever. Lazy per-lookup expiry checks in `consume()` handle the common case; this just bounds worst-case growth. */
const SWEEP_EVERY_N_MINTS = 50;

interface TicketRecord {
  userId: number;
  issuedIp: string;
  expiresAt: number;
}

export interface SseTicketStoreDeps {
  now: () => number;
  /** Generates the random token itself -- injectable so tests can produce deterministic, predictable ticket values. Defaults to a cryptographically random 32-byte hex string. */
  randomToken: () => string;
  ttlMs: number;
}

const defaultDeps: SseTicketStoreDeps = {
  now: () => Date.now(),
  randomToken: () => randomBytes(32).toString('hex'),
  ttlMs: TICKET_TTL_MS,
};

export class SseTicketStore {
  private tickets = new Map<string, TicketRecord>();
  private mintCount = 0;
  private deps: SseTicketStoreDeps;

  constructor(deps: Partial<SseTicketStoreDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  /** Mints a fresh single-use ticket for `userId`, bound to `issuedIp`. Returns the ticket token and its expiry timestamp (ms epoch). */
  mint(userId: number, issuedIp: string): { ticket: string; expiresAt: number } {
    this.mintCount += 1;
    if (this.mintCount % SWEEP_EVERY_N_MINTS === 0) this.sweep();

    const ticket = this.deps.randomToken();
    const expiresAt = this.deps.now() + this.deps.ttlMs;
    this.tickets.set(ticket, { userId, issuedIp, expiresAt });
    return { ticket, expiresAt };
  }

  /**
   * Validates and immediately consumes a ticket. The entry is deleted on
   * this call regardless of outcome -- single-use is enforced by deletion,
   * not a separate "used" flag, so a second call with the same token can
   * never succeed even if it raced with the first. Returns the ticket's
   * `userId` on success, or `null` if the ticket is missing, expired, or
   * was issued to a different IP than `requestIp`.
   */
  consume(token: string, requestIp: string): number | null {
    const record = this.tickets.get(token);
    this.tickets.delete(token);
    if (!record) return null;
    if (this.deps.now() > record.expiresAt) return null;
    if (record.issuedIp !== requestIp) return null;
    return record.userId;
  }

  private sweep(): void {
    const now = this.deps.now();
    for (const [token, record] of this.tickets) {
      if (now > record.expiresAt) this.tickets.delete(token);
    }
  }

  /** Number of live (not-yet-consumed, not-yet-swept) tickets. Exposed mainly for tests. */
  size(): number {
    return this.tickets.size;
  }
}

/** Production singleton, shared between `auth.ts`'s mint route and `auth.ts`'s ticket-auth middleware used by `routes/events.ts`. */
export const sseTicketStore = new SseTicketStore();
