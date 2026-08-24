/**
 * Task 27, Part 1: the app's structured (pino) root logger.
 *
 * Level: `LOG_LEVEL` env var if set, else `info` in production, `debug`
 * everywhere else (per the task brief). Computed by `buildLoggerOptions()`,
 * a pure function of an env-var bag, so its rules are directly unit-tested
 * without needing to spin up a real logger or fork a process to vary
 * `NODE_ENV`/`LOG_LEVEL` -- see logger.test.ts.
 *
 * Output shape: plain NDJSON in production (composes with
 * journalctl/log-aggregation, per the brief), pretty-printed everywhere
 * else. See buildLogger() below for why `pino-pretty` is required
 * conditionally, at runtime, rather than imported statically.
 *
 * Redaction: a fixed list of common secret-shaped field names is redacted
 * via pino's built-in `redact` option (backed by `fast-redact`) as
 * defense-in-depth. As of this task, an audit of every log call site this
 * task touches (and every `jobService.log()` call site, which is a
 * separate, user-facing log stream -- see jobs.ts -- not this one) found no
 * place that actually logs a token, password hash, or the JWT secret today
 * (see task-27-report.md's audit section) -- this redact list guards
 * against a FUTURE call site accidentally logging a raw object that
 * happens to carry one of these keys, it isn't papering over a found leak.
 */
import pino from 'pino';
import type { LoggerOptions } from 'pino';

/** Field names/paths redacted wherever they appear in a logged object -- see this file's header for why this exists as defense-in-depth rather than a fix for a found leak. Uses fast-redact's wildcard syntax (`*.foo` matches `foo` one level under any key) -- this app doesn't currently log deeply-nested objects, so one wildcard level is sufficient for every call site this task migrated. */
const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  'token',
  '*.token',
  'authorization',
  'Authorization',
  'req.headers.authorization',
  'JWT_SECRET',
  'jwtSecret',
  'secret',
  '*.secret',
];

/**
 * Pure function of an env-var bag -> pino options. Defaults to
 * `process.env` but takes an explicit bag so tests can exercise every
 * NODE_ENV/LOG_LEVEL combination without mutating real process state.
 */
export function buildLoggerOptions(env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  const isProduction = env.NODE_ENV === 'production';
  const level = env.LOG_LEVEL || (isProduction ? 'info' : 'debug');
  return {
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  };
}

/**
 * Builds the actual destination stream. Production gets pino's default
 * (plain NDJSON to stdout -- no second argument needed).
 *
 * Non-production gets pretty-printed output via `pino-pretty` -- but
 * deliberately NOT via pino's `transport: { target: 'pino-pretty' }`
 * option. That option runs pino-pretty in a worker thread (`thread-stream`)
 * for production-grade throughput, which is the right tradeoff for a
 * long-lived dev server but a bad one here: this repo's whole test suite
 * (`node --test`, no global teardown hook) exercises every migrated file's
 * real `logger.child(...)` calls as an ordinary side effect of running
 * their existing service tests, and a lingering worker-thread handle is
 * exactly the kind of thing that can make a test runner hang waiting to
 * exit instead of finishing cleanly. `pino-pretty`'s package itself also
 * exports a synchronous, same-thread pretty-print STREAM factory (used
 * below) -- no worker thread, no extra open handle, just a normal
 * Transform stream.
 *
 * `pino-pretty` is a devDependency (not a runtime `dependency`), so a
 * production install (`npm ci --omit=dev`) never has it in
 * `node_modules` at all -- the `require('pino-pretty')` call below only
 * ever executes on the non-production branch, and is wrapped in try/catch
 * so a NODE_ENV left unset in some non-dev, non-production, non-devDeps
 * environment (e.g. a minimal container that still leaves NODE_ENV unset)
 * degrades to plain JSON instead of crashing the process over a pure
 * formatting nicety.
 */
function buildDestination(): NodeJS.WritableStream | undefined {
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see this function's doc comment: this must be a runtime-conditional require(), not a static import, or it would always execute (including in production).
    const pretty = require('pino-pretty');
    return pretty({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    });
  } catch {
    return undefined;
  }
}

/** The app's root logger. Prefer `logger.child({ component: '<name>' })` per subsystem over logging through this directly, so every line is filterable by component. */
export const logger = pino(buildLoggerOptions(), buildDestination());
