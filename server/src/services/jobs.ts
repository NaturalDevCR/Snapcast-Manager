import { randomUUID } from 'crypto';

export interface Job {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  log: string[];
  output?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const MAX_KEPT_JOBS = 20;
const MAX_LOG_LINES = 500;

/**
 * Tracks long-running system tasks (package installs, updates) so HTTP
 * requests can return immediately and the client polls for progress instead
 * of holding a connection open for minutes (which times out).
 *
 * Only one job runs at a time — system tasks share apt/dpkg locks anyway.
 */
class JobService {
  private jobs = new Map<string, Job>();
  private currentJobId: string | null = null;

  get busy(): boolean {
    return this.currentJobId !== null;
  }

  start(label: string, task: () => Promise<string>): Job {
    if (this.currentJobId) {
      const current = this.jobs.get(this.currentJobId);
      throw new Error(`Another system task is already running: ${current?.label || 'unknown'}`);
    }
    const job: Job = {
      id: randomUUID(),
      label,
      status: 'running',
      log: [],
      startedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.currentJobId = job.id;

    task()
      .then(output => {
        job.status = 'done';
        job.output = output;
      })
      .catch(err => {
        job.status = 'error';
        job.error = err?.message || String(err);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.currentJobId = null;
        this.pruneOldJobs();
      });

    return job;
  }

  /** Append a progress line to the currently running job (no-op if idle). */
  log(line: string): void {
    if (!this.currentJobId) return;
    const job = this.jobs.get(this.currentJobId);
    if (!job) return;
    job.log.push(line);
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  private pruneOldJobs(): void {
    const finished = [...this.jobs.values()].filter(j => j.status !== 'running');
    while (finished.length > MAX_KEPT_JOBS) {
      const oldest = finished.shift()!;
      this.jobs.delete(oldest.id);
    }
  }
}

export const jobService = new JobService();
