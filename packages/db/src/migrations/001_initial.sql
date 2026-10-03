CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(320) NOT NULL UNIQUE,
 password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 hostname varchar(253) NOT NULL, status varchar(32) NOT NULL DEFAULT 'unknown', monitoring_enabled boolean NOT NULL DEFAULT true,
 last_checked_at timestamptz, next_check_at timestamptz, last_success_at timestamptz,
 consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id, hostname)
);
CREATE INDEX domains_worker_idx ON domains(monitoring_enabled, next_check_at);
CREATE INDEX domains_user_created_idx ON domains(user_id, created_at);
CREATE INDEX domains_user_status_idx ON domains(user_id, status);
CREATE TABLE ssl_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), domain_id uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
 checked_at timestamptz NOT NULL DEFAULT now(), success boolean NOT NULL, status varchar(32) NOT NULL,
 valid_from timestamptz, valid_until timestamptz, days_remaining integer, issuer text, subject text,
 dns_names jsonb, tls_version varchar(32), chain_valid boolean, chain_info jsonb,
 error_code varchar(64), error_message text, latency_ms integer CHECK (latency_ms >= 0)
);
CREATE INDEX ssl_checks_domain_time_idx ON ssl_checks(domain_id, checked_at DESC);
CREATE INDEX ssl_checks_domain_success_time_idx ON ssl_checks(domain_id, success, checked_at DESC);
CREATE TABLE alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 domain_id uuid NOT NULL REFERENCES domains(id) ON DELETE CASCADE, type varchar(32) NOT NULL, severity varchar(16) NOT NULL,
 state varchar(16) NOT NULL, fingerprint varchar(255) NOT NULL, message text NOT NULL,
 first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_user_idx ON alerts(user_id, created_at DESC);
CREATE INDEX alerts_domain_idx ON alerts(domain_id, state);
CREATE UNIQUE INDEX alerts_active_fingerprint_idx ON alerts(user_id, fingerprint) WHERE state='open';
CREATE TABLE notification_settings (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email_enabled boolean NOT NULL DEFAULT false,
 email_address varchar(320), webhook_enabled boolean NOT NULL DEFAULT false, webhook_url text,
 expiry_threshold_days integer[] NOT NULL DEFAULT ARRAY[30,14,7,1], created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mcp_api_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 key_prefix varchar(16) NOT NULL, key_hash varchar(128) NOT NULL UNIQUE, name varchar(100) NOT NULL,
 last_used_at timestamptz, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE INDEX mcp_api_keys_user_idx ON mcp_api_keys(user_id, created_at DESC);
