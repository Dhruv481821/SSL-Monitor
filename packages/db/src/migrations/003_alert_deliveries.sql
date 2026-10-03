CREATE TABLE alert_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel varchar(16) NOT NULL CHECK (channel IN ('webhook','email')),
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(alert_id, channel)
);

CREATE INDEX alert_deliveries_retry_idx ON alert_deliveries(status, next_attempt_at)
WHERE status = 'pending';
CREATE INDEX alert_deliveries_user_idx ON alert_deliveries(user_id, created_at DESC);
