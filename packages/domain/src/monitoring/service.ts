import { getConfig, type Config } from "../../../config/src/index.js";
import type { SslCheckResult } from "../../../shared/src/index.js";
import { withTransaction } from "../../../db/src/client.js";
import { inspectTls } from "../ssl/engine.js";
import * as checks from "../checks/repository.js";
import * as domains from "../domains/repository.js";
import * as notifications from "../notifications/service.js";
import { dispatchAlert } from "../notifications/delivery.js";
import * as alertService from "../alerts/service.js";

export interface MonitoringExecutionOptions {
  dnsTimeoutMs: number;
  tlsTimeoutMs: number;
  checkTimeoutMs: number;
  monitorIntervalMs: number;
  retryDelayMs: number;
  retryMaxAttempts: number;
  now?: () => Date;
}

export function calculateNextCheckAt(
  now: Date,
  success: boolean,
  currentRetryCount: number,
  retryDelayMs: number,
  retryMaxAttempts: number,
  monitorIntervalMs: number,
): { nextCheckAt: Date; retryCount: number; retryScheduled: boolean } {
  if (success) {
    return {
      nextCheckAt: new Date(now.getTime() + monitorIntervalMs),
      retryCount: 0,
      retryScheduled: false,
    };
  }

  if (currentRetryCount < retryMaxAttempts) {
    const exponent = Math.min(currentRetryCount, 10);
    const delay = Math.min(retryDelayMs * 2 ** exponent, monitorIntervalMs);
    return {
      nextCheckAt: new Date(now.getTime() + delay),
      retryCount: currentRetryCount + 1,
      retryScheduled: true,
    };
  }

  return {
    nextCheckAt: new Date(now.getTime() + monitorIntervalMs),
    retryCount: 0,
    retryScheduled: false,
  };
}

function timeoutResult(hostname: string): SslCheckResult {
  return {
    hostname,
    success: false,
    status: "error",
    validFrom: null,
    validUntil: null,
    daysRemaining: null,
    issuer: null,
    subject: null,
    dnsNames: [],
    tlsVersion: null,
    chainValid: null,
    chainInfo: null,
    errorCode: "TIMEOUT",
    errorMessage: "SSL monitoring check timed out",
    latencyMs: 0,
  };
}

function unexpectedFailure(hostname: string): SslCheckResult {
  return {
    hostname,
    success: false,
    status: "error",
    validFrom: null,
    validUntil: null,
    daysRemaining: null,
    issuer: null,
    subject: null,
    dnsNames: [],
    tlsVersion: null,
    chainValid: null,
    chainInfo: null,
    errorCode: "WORKER_ERROR",
    errorMessage: "SSL monitoring check failed unexpectedly",
    latencyMs: 0,
  };
}

export async function runBoundedCheck<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function executeScheduledCheck(
  domain: domains.DomainRow,
  claimToken: string,
  options: MonitoringExecutionOptions,
) {
  const now = (options.now ?? (() => new Date()))();
  let result: SslCheckResult;
  try {
    result = await runBoundedCheck(
      inspectTls(domain.hostname, options.dnsTimeoutMs, options.tlsTimeoutMs),
      options.checkTimeoutMs,
      () => timeoutResult(domain.hostname),
    );
  } catch {
    result = unexpectedFailure(domain.hostname);
  }

  const schedule = calculateNextCheckAt(
    now,
    result.success,
    domain.monitoring_retry_count,
    options.retryDelayMs,
    options.retryMaxAttempts,
    options.monitorIntervalMs,
  );

  const persisted = await withTransaction(async (client) => {
    const row = await checks.saveCheck(domain.id, result, client);
    const state = await domains.finalizeMonitoringCheck(
      client,
      domain.id,
      claimToken,
      result.success,
      result.status,
      schedule.nextCheckAt,
      schedule.retryCount,
    );
    return { row, state };
  });

  try {
    const settings = await notifications.get(domain.user_id);
    await alertService.evaluatePersistAndNotify(
      {
        userId: domain.user_id,
        domainId: domain.id,
        hostname: domain.hostname,
        result,
        expiryThresholdDays: settings.expiryThresholdDays,
        consecutiveFailures: persisted.state.consecutive_failures,
      },
      settings,
      dispatchAlert,
    );
  } catch {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        component: "ssl-monitor-worker",
        event: "alert_processing_failed",
        domainId: domain.id,
        message: "Alert processing failed after monitoring state was committed",
      }),
    );
  }

  return { result, ...schedule, ...persisted };
}

export function monitoringOptionsFromConfig(
  config: Config = getConfig(),
): MonitoringExecutionOptions {
  return {
    dnsTimeoutMs: config.DNS_TIMEOUT_MS,
    tlsTimeoutMs: config.TLS_TIMEOUT_MS,
    checkTimeoutMs: config.MONITOR_CHECK_TIMEOUT_MS,
    monitorIntervalMs: config.MONITOR_INTERVAL_MS,
    retryDelayMs: config.MONITOR_RETRY_DELAY_MS,
    retryMaxAttempts: config.MONITOR_RETRY_MAX_ATTEMPTS,
  };
}
