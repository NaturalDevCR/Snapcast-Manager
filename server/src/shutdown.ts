/**
 * Task 27, Part 2: the graceful-shutdown sequence run on SIGTERM/SIGINT.
 *
 * Pulled out of index.ts into its own module specifically so it's testable
 * in isolation with mocked dependencies -- index.ts runs `start()` as an
 * unconditional top-level side effect (module-load time), which the test
 * suite already relies on never happening just from importing a module (no
 * test file imports index.ts -- see task-27-report.md). Importing THIS
 * file has no side effects of its own: it only exports a function.
 *
 * Order (per the task brief):
 *   1. Stop accepting new HTTP connections (`httpServer.close()`).
 *   2. Close every open SSE connection (Task 25's routes/events.ts).
 *   3. Disconnect the persistent snapserver WebSocket client (Task 25's
 *      services/snapcastLive.ts).
 *   4. Stop the watchdog auto-cleanup timer, if running (Task 26's
 *      services/watchdog.ts).
 *   5. Close the SQLite database handle (better-sqlite3 is fully
 *      synchronous -- every `db.prepare(...).run()` call already
 *      completed by the time it returned to its caller, so there is no
 *      "in-flight write" this step could interrupt; WAL mode's own
 *      crash-safety is what protects against an UNCLEAN kill, independent
 *      of this step. `db.close()` here is a clean handle close, not a
 *      recovery mechanism).
 *   6. Exit with code 0.
 *   7. A hard timeout force-exits (code 1) if any step hangs, so a
 *      `systemctl stop` is bounded rather than relying on systemd's own
 *      TimeoutStopSec + SIGKILL.
 *
 * `httpServer.close()`'s own callback only fires once every existing
 * connection has ended -- including a long-lived SSE keep-alive one. This
 * function does NOT await that callback before moving on to step 2: doing
 * so would deadlock (step 1 waiting on step 2, which hasn't run yet).
 * Calling `.close()` still takes effect immediately for its actual job here
 * ("stop accepting NEW connections"), regardless of when its callback
 * eventually fires.
 *
 * Every step is independently wrapped in try/catch: a failure in one
 * cleanup step (e.g. the WS client throwing while disconnecting) must not
 * prevent the remaining steps from running, or the process from exiting.
 */

export interface ShutdownLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface ShutdownDeps {
  /** Only the one method this module actually calls -- lets tests pass a minimal fake instead of a real http.Server. */
  httpServer: { close(callback?: (err?: Error) => void): void };
  closeSse: () => void | Promise<void>;
  disconnectSnapcastLive: () => void | Promise<void>;
  stopWatchdog: () => void | Promise<void>;
  closeDb: () => void | Promise<void>;
  exit: (code: number) => void;
  /** Hard force-exit bound in ms -- 10s in production (see index.ts); tests pass something much shorter so RED/GREEN doesn't require waiting on a real 10s timer. */
  timeoutMs: number;
  logger: ShutdownLogger;
}

export async function gracefulShutdown(deps: ShutdownDeps): Promise<void> {
  const { logger } = deps;
  let settled = false;

  const forceExitTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    logger.error(`[shutdown] did not complete within ${deps.timeoutMs}ms -- forcing exit`);
    deps.exit(1);
  }, deps.timeoutMs);
  // Doesn't affect the real process (which calls the real process.exit()
  // long before this would ever fire on the happy path) -- unref() just
  // keeps this timer from being counted as an open handle by itself, which
  // matters for tests that never call the real process.exit().
  forceExitTimer.unref?.();

  const step = async (name: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err: any) {
      logger.error(`[shutdown] ${name} failed: ${err?.message ?? err}`);
    }
  };

  // Step 1: stop accepting new connections. Deliberately NOT awaited -- see
  // this file's header for why waiting on this callback here would
  // deadlock against step 2.
  try {
    deps.httpServer.close((err?: Error) => {
      if (err) logger.error(`[shutdown] http server close reported an error: ${err.message}`);
    });
  } catch (err: any) {
    logger.error(`[shutdown] http server close threw: ${err?.message ?? err}`);
  }

  await step('close SSE connections', deps.closeSse);
  await step('disconnect snapcast WebSocket', deps.disconnectSnapcastLive);
  await step('stop watchdog timer', deps.stopWatchdog);
  await step('close database', deps.closeDb);

  if (settled) return; // the hard timeout already fired and force-exited; nothing left to do
  settled = true;
  clearTimeout(forceExitTimer);
  logger.info('[shutdown] graceful shutdown complete');
  deps.exit(0);
}
