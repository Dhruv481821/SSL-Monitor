import { UnsafeTargetError } from "../../../shared/src/index.js";
import { validateWebhookUrl } from "../ssl/networkSafety.js";
import * as repo from "./repository.js";

export interface NotificationSettingsView {
  emailEnabled: boolean;
  emailAddress: string | null;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  expiryThresholdDays: number[];
  createdAt: string;
  updatedAt: string;
}

function toView(row: repo.NotificationSettingsRow): NotificationSettingsView {
  return {
    emailEnabled: row.email_enabled,
    emailAddress: row.email_address,
    webhookEnabled: row.webhook_enabled,
    webhookUrl: row.webhook_url,
    expiryThresholdDays: row.expiry_threshold_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function get(userId: string): Promise<NotificationSettingsView> {
  const row = (await repo.get(userId)) ?? (await repo.createDefaults(userId));
  return toView(row);
}

export async function update(
  userId: string,
  settings: {
    emailEnabled: boolean;
    emailAddress: string | null;
    webhookEnabled: boolean;
    webhookUrl: string | null;
    expiryThresholdDays: number[];
  },
): Promise<NotificationSettingsView> {
  let webhookUrl = settings.webhookUrl;
  if (settings.webhookEnabled && !webhookUrl) {
    throw new UnsafeTargetError(
      "Webhook URL is required when webhook notifications are enabled",
    );
  }
  if (webhookUrl) webhookUrl = await validateWebhookUrl(webhookUrl);

  const row = await repo.upsert(userId, { ...settings, webhookUrl });
  return toView(row);
}
