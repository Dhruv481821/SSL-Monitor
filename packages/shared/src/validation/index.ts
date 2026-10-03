import { z } from "zod";

export const authSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12),
});

export const hostnameSchema = z.object({
  hostname: z.string().trim().min(1).max(253),
});

export const domainParamsSchema = z.object({ domainId: z.string().uuid() });

export const monitoringToggleSchema = z.object({ enabled: z.boolean() });

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().datetime().optional(),
});

export const alertQuerySchema = z.object({
  state: z.enum(["open", "resolved"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const notificationSettingsSchema = z
  .object({
    emailEnabled: z.boolean(),
    emailAddress: z.string().trim().toLowerCase().email().max(320).nullable(),
    webhookEnabled: z.boolean(),
    webhookUrl: z.string().trim().url().nullable(),
    expiryThresholdDays: z
      .array(z.coerce.number().int().min(1).max(3650))
      .min(1)
      .max(10),
  })
  .superRefine((value, ctx) => {
    if (value.emailEnabled && !value.emailAddress) {
      ctx.addIssue({
        code: "custom",
        path: ["emailAddress"],
        message:
          "Email address is required when email notifications are enabled",
      });
    }
    if (value.webhookEnabled && !value.webhookUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["webhookUrl"],
        message:
          "Webhook URL is required when webhook notifications are enabled",
      });
    }
    if (
      new Set(value.expiryThresholdDays).size !==
      value.expiryThresholdDays.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expiryThresholdDays"],
        message: "Expiry thresholds must be unique",
      });
    }
  });
