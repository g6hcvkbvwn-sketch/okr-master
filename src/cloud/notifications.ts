import { z, ZodError } from "zod";
import { parseProject } from "../domain/project";
import { NotificationSettingsUpdateSchema } from "../shared/notification-schemas";
import { reminderLink } from "../shared/cloud-links";
import { UUIDSchema } from "../shared/schemas";
import type { Project } from "../shared/types";
import type { CloudDatabase } from "./project-store";

export interface NotificationEnvironment {
  DB: CloudDatabase;
  SMTP_HOST?: string;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  APP_BASE_URL?: string;
}

interface SettingsRow {
  project_id: string;
  version: number;
  enabled: number;
  due_enabled: number;
  inactivity_enabled: number;
  last_attempt: number | null;
  last_success: number | null;
  last_error: string | null;
}

interface ProjectRow extends SettingsRow {
  data: string;
  last_changed: number;
  change_revision: number;
}

interface Reminder {
  projectId: string;
  rule: "initiative_due" | "inactivity";
  eventKey: string;
  recipient: string;
  subject: string;
  text: string;
}

class NotificationInputError extends Error {}

async function jsonBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("Content-Length")) > 10_000) {
    throw new NotificationInputError("Notification request is too large.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 10_000) throw new NotificationInputError("Notification request is too large.");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new NotificationInputError("The request is not valid JSON.");
  }
}

type SendEmail = (env: NotificationEnvironment, email: Pick<Reminder, "recipient" | "subject" | "text">) => Promise<void>;

const TWO_WEEKS = 14 * 24 * 60 * 60;
const RETRY_AFTER = 60 * 60;
const LOCK_FOR = 10 * 60;
const MAX_SENDS_PER_RUN = 20;
const SEND_ERROR = "Email delivery failed. Check the SMTP configuration and try again.";
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function smtpConfigured(env: NotificationEnvironment): boolean {
  return Boolean(
    env.SMTP_HOST && /^[a-z0-9.-]+$/i.test(env.SMTP_HOST) &&
    env.SMTP_USERNAME && z.email().safeParse(env.SMTP_USERNAME).success &&
    env.SMTP_PASSWORD,
  );
}

async function sendEmail(env: NotificationEnvironment, email: Pick<Reminder, "recipient" | "subject" | "text">): Promise<void> {
  if (!smtpConfigured(env) || !env.SMTP_HOST || !env.SMTP_USERNAME || !env.SMTP_PASSWORD) {
    throw new Error("SMTP is not configured.");
  }
  const { WorkerMailer, LogLevel } = await import("worker-mailer");
  const mailer = await WorkerMailer.connect({
    host: env.SMTP_HOST,
    port: 465,
    secure: true,
    credentials: { username: env.SMTP_USERNAME, password: env.SMTP_PASSWORD },
    authType: ["plain", "login"],
    logLevel: LogLevel.NONE,
    socketTimeoutMs: 15_000,
    responseTimeoutMs: 15_000,
  });
  try {
    await mailer.send({
      from: env.SMTP_USERNAME,
      to: email.recipient,
      subject: email.subject,
      text: email.text,
    });
  } finally {
    try {
      await mailer.close();
    } catch {
      console.error("Could not close the SMTP connection.");
    }
  }
}

function status(row: SettingsRow, env: NotificationEnvironment) {
  return {
    version: row.version,
    enabled: Boolean(row.enabled),
    dueEnabled: Boolean(row.due_enabled),
    inactivityEnabled: Boolean(row.inactivity_enabled),
    configured: smtpConfigured(env),
    lastAttempt: row.last_attempt === null ? null : new Date(row.last_attempt * 1000).toISOString(),
    lastSuccess: row.last_success === null ? null : new Date(row.last_success * 1000).toISOString(),
    lastError: row.last_error,
  };
}

async function settings(db: CloudDatabase, projectId: string): Promise<SettingsRow | null> {
  return db.prepare("SELECT * FROM notification_settings WHERE project_id = ?")
    .bind(projectId).first<SettingsRow>();
}

async function recordAttempt(db: CloudDatabase, projectId: string, now: number, error: string | null): Promise<void> {
  await db.prepare(
    "UPDATE notification_settings SET last_attempt = ?, last_success = CASE WHEN ? IS NULL THEN ? ELSE last_success END, last_error = ? WHERE project_id = ?",
  ).bind(now, error, now, error, projectId).run();
}

export async function handleNotificationApi(request: Request, env: NotificationEnvironment, send: SendEmail = sendEmail): Promise<Response> {
  try {
    const url = new URL(request.url);
    const match = /^\/api\/notifications\/([^/]+)(\/test)?$/.exec(url.pathname);
    if (!match) return Response.json({ error: "Not found." }, { status: 404 });
    const projectId = UUIDSchema.parse(match[1]);
    if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) {
      return Response.json({ error: "Invalid request origin." }, { status: 403 });
    }
    const current = await settings(env.DB, projectId);
    if (!current) return Response.json({ error: "Project not found or notification database not initialized." }, { status: 404 });

    if (request.method === "GET" && !match[2]) return Response.json(status(current, env), { headers: { "Cache-Control": "no-store" } });

    if (request.method === "PUT" && !match[2]) {
      const input = NotificationSettingsUpdateSchema.parse(await jsonBody(request));
      if (input.enabled && !smtpConfigured(env)) {
        return Response.json({ error: "Configure SMTP before enabling reminders." }, { status: 400 });
      }
      const updated = await env.DB.prepare(
        "UPDATE notification_settings SET enabled = ?, due_enabled = ?, inactivity_enabled = ?, version = version + 1 WHERE project_id = ? AND version = ? RETURNING *",
      ).bind(Number(input.enabled), Number(input.dueEnabled), Number(input.inactivityEnabled), projectId, input.version).first<SettingsRow>();
      return updated
        ? Response.json(status(updated, env), { headers: { "Cache-Control": "no-store" } })
        : Response.json({ error: "Notification settings changed elsewhere. Reopen them and try again." }, { status: 409 });
    }

    if (request.method === "POST" && match[2] === "/test") {
      if (!smtpConfigured(env) || !env.SMTP_USERNAME) {
        return Response.json({ error: "Configure SMTP before sending a test email." }, { status: 400 });
      }
      let recipient = env.SMTP_USERNAME;
      if (request.body !== null) {
        const { recipientId } = z.object({ recipientId: UUIDSchema }).strict().parse(await jsonBody(request));
        const row = await env.DB.prepare("SELECT data FROM projects WHERE id = ?").bind(projectId).first<{ data: string }>();
        if (!row) return Response.json({ error: "Project not found." }, { status: 404 });
        const project = parseProject(JSON.parse(row.data) as unknown);
        const user = project.users.find((item) => item.id === recipientId);
        if (!user) return Response.json({ error: "The selected team member is no longer in this project. Reopen the project and try again." }, { status: 400 });
        recipient = user.email;
      }
      const now = Math.floor(Date.now() / 1000);
      try {
        await send(env, {
          recipient,
          subject: "OKR Master test email",
          text: "This is a test of the OKR Master reminder email connection.",
        });
      } catch {
        await recordAttempt(env.DB, projectId, now, SEND_ERROR);
        console.error("Notification test email failed.");
        return Response.json({ error: SEND_ERROR }, { status: 502 });
      }
      await recordAttempt(env.DB, projectId, now, null);
      return Response.json({ sent: true, recipient }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Method not supported." }, { status: 405 });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "Invalid notification settings." }, { status: 400 });
    if (error instanceof NotificationInputError) return Response.json({ error: error.message }, { status: 400 });
    console.error("Notification request failed.");
    return Response.json({ error: "Notification request failed. Check the server logs and database setup." }, { status: 500 });
  }
}

function zurichDate(now: Date): { hour: number; tomorrow: string } {
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const date = new Date(Date.UTC(part("year"), part("month") - 1, part("day") + 1));
  return { hour: part("hour"), tomorrow: date.toISOString().slice(0, 10) };
}

function reminders(project: Project, row: ProjectRow, now: number, tomorrow: string, appBaseUrl: string | undefined): Reminder[] {
  const result: Reminder[] = [];
  if (row.due_enabled && project.currentCycleId && project.cycles.some((cycle) => cycle.id === project.currentCycleId && cycle.status === "active")) {
    const objectives = new Set(project.objectives.filter((item) => item.cycleId === project.currentCycleId).map((item) => item.id));
    const keyResults = new Set(project.keyResults.filter((item) => objectives.has(item.objectiveId)).map((item) => item.id));
    for (const initiative of project.initiatives) {
      const owner = project.users.find((user) => user.id === initiative.ownerId);
      if (initiative.status === "done" || initiative.targetDate !== tomorrow || !keyResults.has(initiative.keyResultId) || !owner) continue;
      result.push({
        projectId: project.id,
        rule: "initiative_due",
        eventKey: `${initiative.id}:${initiative.targetDate}`,
        recipient: owner.email,
        subject: "[OKR Master] initiative due tomorrow",
        text: `Project: ${project.name}\nInitiative: ${initiative.title}\nDue date: ${initiative.targetDate}\n\nThis initiative is due tomorrow. Track your progress on your project dashboard.\n\nInitiatives board: ${reminderLink(appBaseUrl, project.id, "initiatives")}`,
      });
    }
  }
  const period = Math.floor((now - row.last_changed) / TWO_WEEKS);
  if (row.inactivity_enabled && period >= 1) {
    for (const recipient of new Set(project.users.filter((user) => user.active).map((user) => user.email))) {
      result.push({
        projectId: project.id,
        rule: "inactivity",
        eventKey: `${row.change_revision}:${period}`,
        recipient,
        subject: "[OKR Master] your OKRs are missing you",
        text: `Project: ${project.name}\n\nThere have been no updates on your project dashboard for at least two weeks. Track your progress and success on your dashboard.\n\nProject dashboard: ${reminderLink(appBaseUrl, project.id, "okr")}`,
      });
    }
  }
  return result;
}

export async function runNotifications(env: NotificationEnvironment, nowMs?: number, send: SendEmail = sendEmail): Promise<void> {
  const clock = nowMs === undefined ? Date.now : () => nowMs;
  const now = Math.floor(clock() / 1000);
  const local = zurichDate(new Date(now * 1000));
  if (local.hour < 9) return;
  const rows = await env.DB.prepare(
    "SELECT projects.data, project_activity.last_changed, project_activity.change_revision, notification_settings.* FROM notification_settings JOIN projects ON projects.id = notification_settings.project_id JOIN project_activity ON project_activity.project_id = projects.id WHERE notification_settings.enabled = 1 ORDER BY projects.id",
  ).all<ProjectRow>();
  let attempted = 0;
  for (const row of rows.results) {
    const project = parseProject(JSON.parse(row.data) as unknown);
    for (const reminder of reminders(project, row, now, local.tomorrow, env.APP_BASE_URL)) {
      if (attempted >= MAX_SENDS_PER_RUN) return;
      const token = crypto.randomUUID();
      const claimed = await env.DB.prepare(
        "INSERT INTO notification_deliveries (project_id, rule, event_key, recipient, state, lock_token, lock_until, last_attempt) VALUES (?, ?, ?, ?, 'sending', ?, ?, ?) ON CONFLICT(project_id, rule, event_key, recipient) DO UPDATE SET state = 'sending', lock_token = excluded.lock_token, lock_until = excluded.lock_until, last_attempt = excluded.last_attempt WHERE (state = 'failed' AND last_attempt <= ?) OR (state = 'sending' AND lock_until < ?) RETURNING lock_token",
      ).bind(reminder.projectId, reminder.rule, reminder.eventKey, reminder.recipient, token, now + LOCK_FOR, now, now - RETRY_AFTER, now).first<{ lock_token: string }>();
      if (!claimed) continue;
      attempted += 1;
      const latest = await env.DB.prepare(
        "SELECT projects.data, project_activity.last_changed, project_activity.change_revision, notification_settings.* FROM notification_settings JOIN projects ON projects.id = notification_settings.project_id JOIN project_activity ON project_activity.project_id = projects.id WHERE projects.id = ? AND notification_settings.enabled = 1",
      ).bind(reminder.projectId).first<ProjectRow>();
      const currentTime = clock();
      const currentLocal = zurichDate(new Date(currentTime));
      const latestReminder = latest && currentLocal.hour >= 9
        ? reminders(parseProject(JSON.parse(latest.data) as unknown), latest, Math.floor(currentTime / 1000), currentLocal.tomorrow, env.APP_BASE_URL)
          .find((item) => item.rule === reminder.rule && item.eventKey === reminder.eventKey && item.recipient === reminder.recipient)
        : undefined;
      if (!latestReminder) {
        await env.DB.prepare("DELETE FROM notification_deliveries WHERE project_id = ? AND rule = ? AND event_key = ? AND recipient = ? AND lock_token = ?")
          .bind(reminder.projectId, reminder.rule, reminder.eventKey, reminder.recipient, token).run();
        continue;
      }
      try {
        await send(env, latestReminder);
      } catch {
        await env.DB.prepare("UPDATE notification_deliveries SET state = 'failed' WHERE project_id = ? AND rule = ? AND event_key = ? AND recipient = ? AND lock_token = ?")
          .bind(reminder.projectId, reminder.rule, reminder.eventKey, reminder.recipient, token).run();
        await recordAttempt(env.DB, reminder.projectId, now, SEND_ERROR);
        console.error("Scheduled notification delivery failed.");
        continue;
      }
      await env.DB.prepare("UPDATE notification_deliveries SET state = 'sent' WHERE project_id = ? AND rule = ? AND event_key = ? AND recipient = ? AND lock_token = ?")
        .bind(reminder.projectId, reminder.rule, reminder.eventKey, reminder.recipient, token).run();
      await recordAttempt(env.DB, reminder.projectId, now, null);
    }
  }
}
