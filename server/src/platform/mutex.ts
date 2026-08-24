/**
 * Minimal in-process async mutex, keyed by an arbitrary string.
 *
 * Why in-process (not an OS-level `flock`): this is a single-process Node
 * server (see server/src/index.ts -- one `app.listen()`, no cluster/worker
 * fork), so there is no OTHER process that could interleave a
 * read-modify-write cycle on the same config file. An in-process lock
 * genuinely covers 100% of the concurrency that exists here -- two
 * overlapping `await`-based HTTP request handlers in the SAME event loop.
 * Reaching for `flock`/a lockfile-on-disk would add real complexity (stale
 * lock cleanup, cross-platform behavior, an extra syscall per write) to
 * solve a multi-process problem this deployment doesn't have.
 *
 * Implementation: one promise chain ("tail") per key. Each `withLock` call
 * tacks its work onto the current tail for that key and becomes the new
 * tail, so calls for the same key run strictly one after another, in the
 * order `withLock` was invoked (JS's single-threaded run-to-completion
 * semantics mean there's no way for two `.then()` callbacks chained this
 * way to run concurrently). Calls for DIFFERENT keys are fully independent
 * -- they never wait on each other.
 *
 * The tail stored in the map always resolves (a failing critical section's
 * rejection is swallowed via `.catch()`) so that one caller's error can
 * never wedge the queue for every subsequent caller on that key. The
 * promise returned to the ORIGINAL caller of `withLock`, however, still
 * rejects with the real error -- swallowing is only for the internal
 * bookkeeping tail, never for the caller-visible result.
 */
export class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();

  /**
   * Runs `fn` exclusively with respect to every other `withLock` call made
   * on this same `key` (on this instance) -- a call for `key` never starts
   * until every previously-queued call for that same `key` has settled
   * (resolved OR rejected). Returns/rejects with exactly what `fn` did.
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(() => fn());
    this.tails.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
