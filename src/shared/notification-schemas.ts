import { z } from "zod";

export const NotificationSettingsUpdateSchema = z.object({
  version: z.number().int().positive(),
  enabled: z.boolean(),
  dueEnabled: z.boolean(),
  inactivityEnabled: z.boolean(),
}).strict();

export const NotificationStatusSchema = NotificationSettingsUpdateSchema.extend({
  configured: z.boolean(),
  lastAttempt: z.string().nullable(),
  lastSuccess: z.string().nullable(),
  lastError: z.string().nullable(),
}).strict();

export type NotificationSettingsUpdate = z.infer<typeof NotificationSettingsUpdateSchema>;
