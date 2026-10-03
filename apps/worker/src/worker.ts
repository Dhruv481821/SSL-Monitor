import { getConfig, type Config } from "../../../packages/config/src/index.js";
import type { DomainRow } from "../../../packages/domain/src/domains/repository.js";
import type { MonitoringExecutionOptions } from "../../../packages/domain/src/monitoring/service.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

interface ClaimedJob {
  domainId: string;
  hostname: string;
  claimToken: string;
  promise: Promise<void>;
}

export interface WorkerDependencies {
  config: Config;
  claimDueDomains: (
    batchSize: number,
    staleClaimTimeoutMs: number,
  ) => Promise<{ domains: DomainRow[]; recoveredStale: number }>;
  executeScheduledCheck: (
    domain: DomainRow,
    claimToken: string,
    options: MonitoringExecutionOptions,
  ) => Promise<{
    result: { success: boolean; status: string };
    nextCheckAt: Date;
    retryCount: number;
    retryScheduled: boolean;
    row: unknown;
    state: unknown;
  }>;
  releaseMonitoringClaim: (
    domainId: string,
    claimToken: string,
  ) => Promise<void>;
  closeDatabase: () => Promise<void>;
  log: (event: string, fields?: Record<string, unknown>) => void;
}

function structuredLog(event: string, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      component: "ssl-monitor-worker",
      event,
      ...fields,
    }),
  );
}

function waitForPromises(
  promises: Promise<unknown>[],
  timeoutMs: number,
): Promise<void> {
  if (promises.length === 0) return Promise.resolve();
  return new Promise((resolvePromise) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolvePromise();
      }
    }, timeoutMs);
    Promise.allSettled(promises).finally(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise();
      }
    });
  });
}

export class MonitoringWorker {
  private stopping = false;
  private runningCycle = false;
  private pollTimer: NodeJS.Timeout | undefined;
  private cyclePromise: Promise<void> | undefined;
  private activeJobs = new Map<string, ClaimedJob>();
  private readonly options: MonitoringExecutionOptions;

  constructor(private readonly deps: WorkerDependencies) {
    this.options = {
      dnsTimeoutMs: deps.config.DNS_TIMEOUT_MS,
      tlsTimeoutMs: deps.config.TLS_TIMEOUT_MS,
      checkTimeoutMs: deps.config.MONITOR_CHECK_TIMEOUT_MS,
      monitorIntervalMs: deps.config.MONITOR_INTERVAL_MS,
      retryDelayMs: deps.config.MONITOR_RETRY_DELAY_MS,
      retryMaxAttempts: deps.config.MONITOR_RETRY_MAX_ATTEMPTS,
    };
  }

  async runCycle(): Promise<void> {
    if (this.stopping || this.runningCycle) return;
    this.runningCycle = true;
    const cycle = this.runCycleInternal();
    this.cyclePromise = cycle;
    try {
      await cycle;
    } finally {
      if (this.cyclePromise === cycle) this.cyclePromise = undefined;
      this.runningCycle = false;
    }
  }

  private async runCycleInternal(): Promise<void> {
    try {
      const claimed = await this.deps.claimDueDomains(
        this.deps.config.MONITOR_BATCH_SIZE,
        this.deps.config.MONITOR_STALE_CLAIM_TIMEOUT_MS,
      );

      this.deps.log("polling_cycle", {
        claimed: claimed.domains.length,
        staleClaimsRecovered: claimed.recoveredStale,
      });

      if (claimed.recoveredStale > 0) {
        this.deps.log("stale_claim_recovered", {
          count: claimed.recoveredStale,
        });
      }

      if (this.stopping) {
        await Promise.allSettled(
          claimed.domains.flatMap((domain) =>
            domain.monitoring_claim_token
              ? [
                  this.deps.releaseMonitoringClaim(
                    domain.id,
                    domain.monitoring_claim_token,
                  ),
                ]
              : [],
          ),
        );
        return;
      }

      const jobs = claimed.domains.map((domain) => () => this.startJob(domain));
      await this.runWithConcurrency(
        jobs,
        this.deps.config.MONITOR_WORKER_CONCURRENCY,
      );
    } catch (error) {
      this.deps.log("polling_cycle_failed", {
        message: "Worker polling cycle failed",
      });
    }
  }

  start(): void {
    if (this.pollTimer || this.stopping) return;
    this.deps.log("worker_started", {
      pollingIntervalMs: this.deps.config.MONITOR_POLL_INTERVAL_MS,
      batchSize: this.deps.config.MONITOR_BATCH_SIZE,
      concurrency: this.deps.config.MONITOR_WORKER_CONCURRENCY,
    });

    void this.runCycle();
    this.pollTimer = setInterval(
      () => void this.runCycle(),
      this.deps.config.MONITOR_POLL_INTERVAL_MS,
    );
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.deps.log("graceful_shutdown_started", {
      activeJobs: this.activeJobs.size,
    });

    if (this.cyclePromise)
      await waitForPromises(
        [this.cyclePromise],
        this.deps.config.MONITOR_SHUTDOWN_TIMEOUT_MS,
      );

    const jobs = [...this.activeJobs.values()];
    await waitForPromises(
      jobs.map((job) => job.promise),
      this.deps.config.MONITOR_SHUTDOWN_TIMEOUT_MS,
    );

    const remaining = [...this.activeJobs.values()];
    if (remaining.length > 0) {
      await Promise.allSettled(
        remaining.map((job) =>
          this.deps.releaseMonitoringClaim(job.domainId, job.claimToken),
        ),
      );
      this.deps.log("claims_released_on_shutdown", { count: remaining.length });
    }

    await this.deps.closeDatabase();
    this.deps.log("worker_stopped");
  }

  private startJob(domain: DomainRow): Promise<void> {
    const claimToken = domain.monitoring_claim_token;
    if (!claimToken) return Promise.resolve();

    const job: ClaimedJob = {
      domainId: domain.id,
      hostname: domain.hostname,
      claimToken,
      promise: Promise.resolve(),
    };

    const promise = this.processJob(job, domain);
    job.promise = promise;
    this.activeJobs.set(job.domainId, job);
    void promise.finally(() => this.activeJobs.delete(job.domainId));
    return promise;
  }

  private async processJob(job: ClaimedJob, domain: DomainRow): Promise<void> {
    this.deps.log("check_started", {
      domainId: job.domainId,
      hostname: job.hostname,
    });
    try {
      const result = await this.deps.executeScheduledCheck(
        domain,
        job.claimToken,
        this.options,
      );
      this.deps.log("check_completed", {
        domainId: job.domainId,
        hostname: job.hostname,
        success: result.result.success,
        status: result.result.status,
        nextCheckAt: result.nextCheckAt.toISOString(),
      });
      if (result.retryScheduled) {
        this.deps.log("retry_scheduled", {
          domainId: job.domainId,
          hostname: job.hostname,
          retryCount: result.retryCount,
          nextCheckAt: result.nextCheckAt.toISOString(),
        });
      }
    } catch (error) {
      this.deps.log("check_failed", {
        domainId: job.domainId,
        hostname: job.hostname,
        message: "Worker check processing failed",
      });
      try {
        await this.deps.releaseMonitoringClaim(job.domainId, job.claimToken);
      } catch (releaseError) {
        this.deps.log("claim_release_failed", {
          domainId: job.domainId,
          message: "Monitoring claim release failed",
        });
      }
    }
  }

  private async runWithConcurrency(
    jobs: Array<() => Promise<void>>,
    concurrency: number,
  ): Promise<void> {
    let next = 0;
    const runners = Array.from(
      { length: Math.min(concurrency, jobs.length) },
      async () => {
        while (next < jobs.length) {
          const index = next++;
          await jobs[index]();
        }
      },
    );
    await Promise.all(runners);
  }
}

export function createWorker(config: Config = getConfig()): MonitoringWorker {
  return new MonitoringWorker({
    config,
    claimDueDomains: async (batchSize, staleClaimTimeoutMs) => {
      const repository =
        await import("../../../packages/domain/src/domains/repository.js");
      return repository.claimDueDomains(batchSize, staleClaimTimeoutMs);
    },
    executeScheduledCheck: async (domain, claimToken, options) => {
      const monitoring =
        await import("../../../packages/domain/src/monitoring/service.js");
      return monitoring.executeScheduledCheck(domain, claimToken, options);
    },
    releaseMonitoringClaim: async (domainId, claimToken) => {
      const repository =
        await import("../../../packages/domain/src/domains/repository.js");
      return repository.releaseMonitoringClaim(domainId, claimToken);
    },
    closeDatabase: async () => {
      const db = await import("../../../packages/db/src/client.js");
      await db.pool.end();
    },
    log: structuredLog,
  });
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) {
  const worker = createWorker();
  const shutdown = async (signal: string) => {
    structuredLog("shutdown_signal_received", { signal });
    await worker.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  worker.start();
}
