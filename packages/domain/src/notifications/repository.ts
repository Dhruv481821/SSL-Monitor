import { query } from "../../../db/src/client.js";

export interface NotificationSettingsRow {
  user_id: string;
  email_enabled: boolean;
  email_address: string | null;
  webhook_enabled: boolean;
  webhook_url: string | null;
  expiry_threshold_days: number[];
  created_at: string;
  updated_at: string;
}

export async function get(
  userId: string,
): Promise<NotificationSettingsRow | null> {
  return (
    (
      await query<NotificationSettingsRow>(
        "SELECT * FROM notification_settings WHERE user_id=$1",
        [userId],
      )
    ).rows[0] ?? null
  );
}

export async function createDefaults(
  userId: string,
): Promise<NotificationSettingsRow> {
  return (
    (
      await query<NotificationSettingsRow>(
        `INSERT INTO notification_settings(user_id) VALUES($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING *`,
        [userId],
      )
    ).rows[0] ?? (await get(userId))!
  );
}

export async function upsert(
  userId: string,
  settings: {
    emailEnabled: boolean;
    emailAddress: string | null;
    webhookEnabled: boolean;
    webhookUrl: string | null;
    expiryThresholdDays: number[];
  },
): Promise<NotificationSettingsRow> {
  return (
    await query<NotificationSettingsRow>(
      `INSERT INTO notification_settings
        (user_id,email_enabled,email_address,webhook_enabled,webhook_url,expiry_threshold_days)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         email_enabled=EXCLUDED.email_enabled,
         email_address=EXCLUDED.email_address,
         webhook_enabled=EXCLUDED.webhook_enabled,
         webhook_url=EXCLUDED.webhook_url,
         expiry_threshold_days=EXCLUDED.expiry_threshold_days,
         updated_at=now()
       RETURNING *`,
      [
        userId,
        settings.emailEnabled,
        settings.emailAddress,
        settings.webhookEnabled,
        settings.webhookUrl,
        settings.expiryThresholdDays,
      ],
    )
  ).rows[0];
}
