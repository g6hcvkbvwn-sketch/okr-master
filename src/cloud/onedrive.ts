import type { CloudDatabase } from "./project-store";

const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access Files.ReadWrite.AppFolder";
const COOKIE = "okr_backup_auth";

export interface BackupEnvironment {
  DB: CloudDatabase;
  ONEDRIVE_CLIENT_ID?: string;
  ONEDRIVE_CLIENT_SECRET?: string;
  ONEDRIVE_REDIRECT_URI?: string;
  BACKUP_ENCRYPTION_KEY?: string;
}

class BackupBusyError extends Error {}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode64(value: string): Uint8Array<ArrayBuffer> {
  const text = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(text.padEnd(Math.ceil(text.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
}

function randomString(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function encryptionKey(env: BackupEnvironment): Promise<CryptoKey> {
  if (!env.BACKUP_ENCRYPTION_KEY) throw new Error("The OneDrive encryption key is missing.");
  const key = decode64(env.BACKUP_ENCRYPTION_KEY);
  if (key.length !== 32) throw new Error("The OneDrive encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(env: BackupEnvironment, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(env), new TextEncoder().encode(value));
  return `${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

async function decrypt(env: BackupEnvironment, value: string): Promise<string> {
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid encrypted OneDrive credentials.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode64(parts[0]) }, await encryptionKey(env), decode64(parts[1]));
  return new TextDecoder().decode(plaintext);
}

function config(env: BackupEnvironment): { redirect: URL; clientId: string; clientSecret: string } {
  if (!env.ONEDRIVE_CLIENT_ID || !env.ONEDRIVE_CLIENT_SECRET || !env.ONEDRIVE_REDIRECT_URI || !env.BACKUP_ENCRYPTION_KEY) {
    throw new Error("OneDrive is not configured.");
  }
  const redirect = new URL(env.ONEDRIVE_REDIRECT_URI);
  if (redirect.protocol !== "https:" || redirect.pathname !== "/api/onedrive/callback" || redirect.search || redirect.hash || redirect.username || redirect.password) {
    throw new Error("The OneDrive redirect URI is invalid.");
  }
  return { redirect, clientId: env.ONEDRIVE_CLIENT_ID, clientSecret: env.ONEDRIVE_CLIENT_SECRET };
}

interface Token { access_token: string; refresh_token: string }

async function tokenRequest(env: BackupEnvironment, parameters: Record<string, string>): Promise<Token> {
  const { clientId, clientSecret } = config(env);
  const response = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: SCOPES, ...parameters }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("Microsoft authentication failed. Reconnect OneDrive.");
  const token: unknown = await response.json();
  if (typeof token !== "object" || token === null || !("access_token" in token) || typeof token.access_token !== "string" || !("refresh_token" in token) || typeof token.refresh_token !== "string") {
    throw new Error("Microsoft did not return complete credentials.");
  }
  return { access_token: token.access_token, refresh_token: token.refresh_token };
}

async function startAuth(request: Request, env: BackupEnvironment): Promise<Response> {
  const { redirect, clientId } = config(env);
  if (new URL(request.url).origin !== redirect.origin) return json({ error: "Use the configured main app address to connect OneDrive." }, 400);
  const state = randomString();
  const verifier = randomString();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const cookie = await encrypt(env, JSON.stringify({ state, verifier, created: Date.now() }));
  const url = new URL(`${AUTHORITY}/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId, response_type: "code", redirect_uri: redirect.href, response_mode: "query",
    scope: SCOPES, state, code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  return new Response(null, { status: 302, headers: {
    Location: url.href,
    "Cache-Control": "no-store",
    "Set-Cookie": `${COOKIE}=${cookie}; Path=/api/onedrive/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  } });
}

async function callback(request: Request, env: BackupEnvironment): Promise<Response> {
  const { redirect } = config(env);
  const url = new URL(request.url);
  const cookie = (request.headers.get("Cookie") ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (url.origin !== redirect.origin || !cookie || !url.searchParams.get("state") || !url.searchParams.get("code")) {
    return json({ error: "OneDrive sign-in was cancelled or invalid." }, 400);
  }
  let pending: unknown;
  try {
    pending = JSON.parse(await decrypt(env, cookie.slice(COOKIE.length + 1))) as unknown;
  } catch {
    return json({ error: "OneDrive sign-in expired or was invalid." }, 400);
  }
  if (typeof pending !== "object" || pending === null || !("state" in pending) || pending.state !== url.searchParams.get("state") ||
    !("verifier" in pending) || typeof pending.verifier !== "string" || !("created" in pending) ||
    typeof pending.created !== "number" || Date.now() - pending.created > 600_000 || pending.created > Date.now()) {
    return json({ error: "OneDrive sign-in expired or was invalid." }, 400);
  }
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "OneDrive sign-in was cancelled or invalid." }, 400);
  const token = await tokenRequest(env, {
    grant_type: "authorization_code", code, redirect_uri: redirect.href, code_verifier: pending.verifier,
  });
  const encrypted = await encrypt(env, token.refresh_token);
  await env.DB.prepare("INSERT INTO backup_settings (id, refresh_token) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET refresh_token = excluded.refresh_token").bind(encrypted).run();
  await env.DB.prepare("UPDATE backup_tracking SET last_revision = NULL WHERE id = 1").run();
  return new Response(null, { status: 303, headers: {
    Location: "/", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "Set-Cookie": `${COOKIE}=; Path=/api/onedrive/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  } });
}

async function graphRequest(path: string, token: string, options: RequestInit = {}): Promise<void> {
  const response = await fetch(`${GRAPH}${path}`, {
    ...options, signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) throw new Error(`OneDrive backup failed (Microsoft HTTP ${response.status}).`);
}

interface BackupSettings { refresh_token: string | null; last_error: string | null }
interface SnapshotRow { revision: number; data: string | null }

export async function runBackup(env: BackupEnvironment, options: { pendingOnly?: boolean; skipIfBusy?: boolean } = {}): Promise<boolean> {
  const lockToken = crypto.randomUUID();
  const now = Date.now();
  const lock = await env.DB.prepare("INSERT INTO backup_tracking (id, lock_token, lock_until) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET lock_token = excluded.lock_token, lock_until = excluded.lock_until WHERE backup_tracking.lock_until IS NULL OR backup_tracking.lock_until < ? RETURNING lock_token").bind(lockToken, now + 600_000, now).first<{ lock_token: string }>();
  if (!lock) {
    if (options.skipIfBusy) return false;
    throw new BackupBusyError("A backup is already running.");
  }
  const attempt = new Date().toISOString();
  try {
    config(env);
    const settings = await env.DB.prepare("SELECT refresh_token, last_error FROM backup_settings WHERE id = 1").first<BackupSettings>();
    if (!settings?.refresh_token) throw new Error("OneDrive is not connected.");
    const snapshot = await env.DB.prepare("SELECT project_changes.revision, projects.data FROM project_changes LEFT JOIN projects ON 1 = 1 WHERE project_changes.id = 1 ORDER BY projects.id").all<SnapshotRow>();
    const revision = snapshot.results[0]?.revision;
    if (revision === undefined) throw new Error("The project database is not initialized.");
    if (options.pendingOnly) {
      const tracking = await env.DB.prepare("SELECT last_revision FROM backup_tracking WHERE id = 1").first<{ last_revision: number | null }>();
      if (tracking?.last_revision === revision && !settings.last_error) return false;
    }
    const token = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: await decrypt(env, settings.refresh_token) });
    const rotated = await encrypt(env, token.refresh_token);
    const stored = await env.DB.prepare("UPDATE backup_settings SET refresh_token = ? WHERE id = 1 AND refresh_token = ?").bind(rotated, settings.refresh_token).run();
    if (stored.meta.changes !== 1) throw new Error("The OneDrive connection changed during backup.");
    await graphRequest("/me/drive/special/approot", token.access_token);
    const name = `okr-master-${attempt.replace(/[:.]/g, "-")}-${crypto.randomUUID()}.json`;
    await graphRequest(`/me/drive/special/approot:/${name}:/content`, token.access_token, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "okr-master-backup", version: 1, projects: snapshot.results.flatMap((row) => row.data === null ? [] : [JSON.parse(row.data) as unknown]) }),
    });
    const marked = await env.DB.prepare("UPDATE backup_tracking SET last_revision = ? WHERE id = 1 AND lock_token = ?").bind(revision, lockToken).run();
    if (marked.meta.changes !== 1) throw new Error("The backup lock expired; backup status was not confirmed.");
    await env.DB.prepare("INSERT INTO backup_settings (id, last_attempt, last_success, last_error) VALUES (1, ?, ?, NULL) ON CONFLICT(id) DO UPDATE SET last_attempt = excluded.last_attempt, last_success = excluded.last_success, last_error = NULL").bind(attempt, new Date().toISOString()).run();
    return true;
  } catch (error) {
    console.error("OneDrive backup failed.");
    await env.DB.prepare("INSERT INTO backup_settings (id, last_attempt, last_error) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET last_attempt = excluded.last_attempt, last_error = excluded.last_error").bind(attempt, "Backup failed. Check the OneDrive connection and Worker configuration.").run();
    throw error;
  } finally {
    await env.DB.prepare("UPDATE backup_tracking SET lock_token = NULL, lock_until = NULL WHERE id = 1 AND lock_token = ?").bind(lockToken).run();
  }
}

export async function runPendingBackup(env: BackupEnvironment): Promise<boolean> {
  const settings = await env.DB.prepare("SELECT refresh_token FROM backup_settings WHERE id = 1").first<{ refresh_token: string | null }>();
  return settings?.refresh_token ? runBackup(env, { pendingOnly: true, skipIfBusy: true }) : false;
}

export async function handleBackupApi(request: Request, env: BackupEnvironment): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/onedrive/status" && request.method === "GET") {
      const settings = await env.DB.prepare("SELECT refresh_token IS NOT NULL AS connected, last_attempt, last_success, last_error FROM backup_settings WHERE id = 1").first<{ connected: number; last_attempt: string | null; last_success: string | null; last_error: string | null }>();
      const tracking = await env.DB.prepare("SELECT project_changes.revision, backup_tracking.last_revision FROM project_changes LEFT JOIN backup_tracking ON backup_tracking.id = 1 WHERE project_changes.id = 1").first<{ revision: number; last_revision: number | null }>();
      return json({ configured: Boolean(env.ONEDRIVE_CLIENT_ID && env.ONEDRIVE_CLIENT_SECRET && env.ONEDRIVE_REDIRECT_URI && env.BACKUP_ENCRYPTION_KEY), connected: Boolean(settings?.connected), lastAttempt: settings?.last_attempt ?? null, lastSuccess: settings?.last_success ?? null, error: settings?.last_error ?? null, pending: Boolean(tracking && tracking.last_revision !== tracking.revision) });
    }
    if (url.pathname === "/api/onedrive/connect" && request.method === "GET") return await startAuth(request, env);
    if (url.pathname === "/api/onedrive/callback" && request.method === "GET") return await callback(request, env);
    if (url.pathname === "/api/onedrive/backup" && request.method === "POST") {
      if (request.headers.get("Origin") !== url.origin) return json({ error: "Invalid request origin." }, 403);
      await runBackup(env);
      return json({ saved: true });
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof BackupBusyError) return json({ error: error.message }, 409);
    console.error("OneDrive request failed.");
    return json({ error: "OneDrive request failed. Check the connection and Worker configuration." }, 500);
  }
}
