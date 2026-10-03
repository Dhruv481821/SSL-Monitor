import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default("15m"),
  TLS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  DNS_TIMEOUT_MS: z.coerce.number().int().min(500).max(30000).default(5000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  MANUAL_CHECK_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .positive()
    .default(20),
  MCP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  MONITOR_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .default(10000),
  MONITOR_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  MONITOR_CHECK_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(15000),
  MONITOR_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(3600000)
    .default(60000),
  MONITOR_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(3),
  MONITOR_STALE_CLAIM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .max(3600000)
    .default(120000),
  MONITOR_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  MONITOR_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(60000)
    .max(604800000)
    .default(3600000),
  MONITOR_SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(30000),
  NOTIFICATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(5000),
  NOTIFICATION_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60000)
    .default(1000),
  NOTIFICATION_MAX_RETRY_DELAY_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300000)
    .default(30000),
  NOTIFICATION_RETRY_MAX_ATTEMPTS: z.coerce
    .number()
    .int()
    .min(0)
    .max(5)
    .default(2),
  SMTP_HOST: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z.coerce.boolean().default(true),
  SMTP_USER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
  SMTP_PASSWORD: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
  SMTP_FROM: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().email().optional(),
  ),
});

export type Config = z.output<typeof schema>;
let cached: Config | undefined;

export function getConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!cached || env !== process.env) cached = schema.parse(env);
  return cached;
}
