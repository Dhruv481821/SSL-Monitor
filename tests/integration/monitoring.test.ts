import { beforeAll, afterAll, describe, expect, it } from "vitest";

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;

suite("monitoring claim integration", () => {
  let query: typeof import("../../packages/db/src/client.js").query;
  let pool: typeof import("../../packages/db/src/client.js").pool;
  let claimDueDomains: typeof import("../../packages/domain/src/domains/repository.js").claimDueDomains;

  beforeAll(async () => {
    const db = await import("../../packages/db/src/client.js");
    const domains =
      await import("../../packages/domain/src/domains/repository.js");
    query = db.query;
    pool = db.pool;
    claimDueDomains = domains.claimDueDomains;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it("selects only due active domains", async () => {
    const user = await query<{ id: string }>(
      `INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id`,
      [`phase05-selection-${Date.now()}@example.com`, "test-hash"],
    );
    const userId = user.rows[0].id;
    const suffix = Date.now();
    const rows = await query<{ id: string; hostname: string }>(
      `INSERT INTO domains(user_id,hostname,next_check_at,monitoring_enabled)
       VALUES
         ($1,$2,now() - interval '1 hour',true),
         ($1,$3,now() + interval '1 hour',true),
         ($1,$4,now(),false)
       RETURNING id,hostname`,
      [
        userId,
        `phase05-due-${suffix}.example.com`,
        `phase05-future-${suffix}.example.com`,
        `phase05-inactive-${suffix}.example.com`,
      ],
    );

    try {
      const result = await claimDueDomains(10, 120000);
      const claimedIds = new Set(result.domains.map((item) => item.id));
      expect(claimedIds.has(rows.rows[0].id)).toBe(true);
      expect(claimedIds.has(rows.rows[1].id)).toBe(false);
      expect(claimedIds.has(rows.rows[2].id)).toBe(false);
    } finally {
      await query("DELETE FROM users WHERE id=$1", [userId]);
    }
  });
  it("atomically claims a due domain only once across concurrent workers", async () => {
    const user = await query<{ id: string }>(
      `INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id`,
      [`phase05-${Date.now()}@example.com`, "test-hash"],
    );
    const userId = user.rows[0].id;
    const domain = await query<{ id: string }>(
      `INSERT INTO domains(user_id,hostname,next_check_at) VALUES($1,$2,now() - interval '1 day') RETURNING id`,
      [userId, `phase05-${Date.now()}.example.com`],
    );
    const domainId = domain.rows[0].id;

    try {
      const [a, b] = await Promise.all([
        claimDueDomains(1, 120000),
        claimDueDomains(1, 120000),
      ]);
      const claimed = [...a.domains, ...b.domains].filter(
        (item) => item.id === domainId,
      );
      expect(claimed).toHaveLength(1);
      expect(claimed[0].monitoring_claim_token).toBeTruthy();
    } finally {
      await query("DELETE FROM users WHERE id=$1", [userId]);
    }
  });

  it("recovers a stale claim and makes the domain claimable again", async () => {
    const user = await query<{ id: string }>(
      `INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id`,
      [`phase05-stale-${Date.now()}@example.com`, "test-hash"],
    );
    const userId = user.rows[0].id;
    const domain = await query<{ id: string }>(
      `INSERT INTO domains(user_id,hostname,next_check_at,monitoring_claimed_at,monitoring_claim_token)
       VALUES($1,$2,now() - interval '1 hour',now() - interval '10 minutes',gen_random_uuid()) RETURNING id`,
      [userId, `phase05-stale-${Date.now()}.example.com`],
    );
    const domainId = domain.rows[0].id;

    try {
      const result = await claimDueDomains(1, 60_000);
      expect(result.recoveredStale).toBeGreaterThanOrEqual(1);
      expect(result.domains.some((item) => item.id === domainId)).toBe(true);
    } finally {
      await query("DELETE FROM users WHERE id=$1", [userId]);
    }
  });
});
