ALTER TABLE domains
  ADD COLUMN monitoring_claimed_at timestamptz,
  ADD COLUMN monitoring_claim_token uuid,
  ADD COLUMN monitoring_retry_count integer NOT NULL DEFAULT 0 CHECK (monitoring_retry_count >= 0);

CREATE INDEX domains_due_monitoring_idx
  ON domains(monitoring_enabled, next_check_at, monitoring_claimed_at);

CREATE INDEX domains_stale_claim_idx
  ON domains(monitoring_claimed_at)
  WHERE monitoring_claimed_at IS NOT NULL;
