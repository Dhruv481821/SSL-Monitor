import { getConfig } from "../../../config/src/index.js";
import {
  ConflictError,
  NotFoundError,
  UnsafeTargetError,
} from "../../../shared/src/index.js";
import { normalizeHostname, resolveSafeTarget } from "../ssl/networkSafety.js";
import { inspectTls } from "../ssl/engine.js";
import * as repo from "./repository.js";
import * as checks from "../checks/repository.js";
import * as notifications from "../notifications/service.js";
import * as alertService from "../alerts/service.js";
import { dispatchAlert } from "../notifications/delivery.js";

export async function add(userId: string, rawHostname: string) {
  const hostname = normalizeHostname(rawHostname);

  try {
    await resolveSafeTarget(hostname, getConfig().DNS_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof UnsafeTargetError) throw e;
    throw e;
  }

  try {
    return await repo.createDomain(userId, hostname);
  } catch (e: unknown) {
    if (e && typeof e === "object" && "code" in e && e.code === "23505") {
      throw new ConflictError("Domain already exists");
    }

    throw e;
  }
}

export async function list(userId: string) {
  return repo.listDomains(userId);
}

export async function get(userId: string, id: string) {
  const d = await repo.getDomain(userId, id);

  if (!d) {
    throw new NotFoundError("Domain not found");
  }

  return d;
}

export async function remove(userId: string, id: string) {
  const ok = await repo.deleteDomain(userId, id);

  if (!ok) {
    throw new NotFoundError("Domain not found");
  }
}

export async function setMonitoring(
  userId: string,
  id: string,
  enabled: boolean,
) {
  const domain = await repo.setMonitoring(userId, id, enabled);

  if (!domain) {
    throw new NotFoundError("Domain not found");
  }

  return domain;
}

export async function check(userId: string, id: string) {
  const d = await get(userId, id);

  const result = await inspectTls(
    d.hostname,
    getConfig().DNS_TIMEOUT_MS,
    getConfig().TLS_TIMEOUT_MS,
  );

  const row = await checks.saveCheck(id, result);

  await repo.updateAfterCheck(id, result.success, result.status);

  try {
    const settings = await notifications.get(d.user_id);

    await alertService.evaluatePersistAndNotify(
      {
        userId: d.user_id,
        domainId: d.id,
        hostname: d.hostname,
        result,
        expiryThresholdDays: settings.expiryThresholdDays,
        consecutiveFailures: result.success ? 0 : d.consecutive_failures + 1,
      },
      settings,
      dispatchAlert,
    );
  } catch {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        component: "ssl-monitor-api",
        event: "alert_processing_failed",
        domainId: d.id,
        message: "Alert processing failed after manual check was persisted",
      }),
    );
  }

  return {
    ...result,
    id: row.id,
    checkedAt: row.checked_at,
  };
}

export async function current(userId: string, id: string) {
  await get(userId, id);

  return checks.latestCheck(id);
}

export async function certificate(userId: string, id: string) {
  await get(userId, id);

  const c = await checks.latestCheck(id, true);

  if (!c) {
    return null;
  }

  return {
    validFrom: c.validFrom,
    validUntil: c.validUntil,
    daysRemaining: c.daysRemaining,
    issuer: c.issuer,
    subject: c.subject,
    dnsNames: c.dnsNames,
    tlsVersion: c.tlsVersion,
    chainValid: c.chainValid,
    chainInfo: c.chainInfo,
  };
}

export async function history(
  userId: string,
  id: string,
  limit: number,
  cursor?: string,
) {
  await get(userId, id);

  return checks.history(id, limit, cursor);
}

export async function listExpiring(userId: string, days: number) {
  const domainList = await list(userId);

  const results = await Promise.all(
    domainList.map(async (domain) => {
      const current = await checks.latestCheck(domain.id);

      if (
        current?.daysRemaining == null ||
        current.daysRemaining < 0 ||
        current.daysRemaining > days
      ) {
        return null;
      }

      return {
        domainId: domain.id,
        hostname: domain.hostname,
        status: current.status,
        daysRemaining: current.daysRemaining,
        validUntil: current.validUntil,
        checkedAt: current.checked_at,
      };
    }),
  );

  return results
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export async function listSslErrors(userId: string) {
  const domainList = await list(userId);

  const results = await Promise.all(
    domainList.map(async (domain) => {
      const current = await checks.latestCheck(domain.id);

      if (
        !current ||
        (current.success !== false &&
          current.status !== "expired" &&
          current.status !== "error")
      ) {
        return null;
      }

      return {
        domainId: domain.id,
        hostname: domain.hostname,
        status: current.status,
        success: current.success,
        checkedAt: current.checked_at,
        errorCode: current.errorCode,
        errorMessage: current.errorMessage,
        daysRemaining: current.daysRemaining,
      };
    }),
  );

  return results.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );
}
