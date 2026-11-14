import { useEffect, useState } from "react";
import { z } from "zod";
import { NotificationStatusSchema } from "../shared/notification-schemas";

type Status = z.infer<typeof NotificationStatusSchema>;

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...options, cache: "no-store" });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(error.success ? error.data.error : `Request failed (HTTP ${response.status}).`);
  }
  return value;
}

export function CloudNotifications({ projectId, onClose }: {
  projectId: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const endpoint = `/api/notifications/${encodeURIComponent(projectId)}`;

  useEffect(() => {
    let mounted = true;
    request(endpoint)
      .then((value) => { if (mounted) setStatus(NotificationStatusSchema.parse(value)); })
      .catch((caught: unknown) => { if (mounted) setError(errorText(caught)); });
    return () => { mounted = false; };
  }, [endpoint]);

  async function save() {
    if (!status) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await request(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: status.version,
          enabled: status.enabled,
          dueEnabled: status.dueEnabled,
          inactivityEnabled: status.inactivityEnabled,
        }),
      });
      setStatus(NotificationStatusSchema.parse(value));
      setMessage("Reminder settings saved.");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError("");
    setMessage("");
    let accepted = false;
    try {
      await request(`${endpoint}/test`, { method: "POST" });
      accepted = true;
      const updated = NotificationStatusSchema.parse(await request(endpoint));
      setStatus((current) => current ? {
        ...current,
        configured: updated.configured,
        lastAttempt: updated.lastAttempt,
        lastSuccess: updated.lastSuccess,
        lastError: updated.lastError,
      } : updated);
      setMessage("Test email accepted by the mail server. Check the configured mailbox, including spam.");
    } catch (caught) {
      setError(accepted ? `The test email was accepted, but status could not be refreshed: ${errorText(caught)}` : errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop notification-backdrop" role="presentation">
      <section className="modal-card notification-card" role="dialog" aria-modal="true" aria-labelledby="notification-title">
        <div className="section-heading">
          <h2 id="notification-title">Email reminders</h2>
          <button aria-label="Close" className="icon-button" disabled={busy} onClick={onClose} type="button">×</button>
        </div>
        <p>These settings apply to the open cloud project. Reminders use Zurich time and are sent no earlier than 09:00.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {message && <div className="notice notice-success" role="status">{message}</div>}
        {!status ? (
          !error && <p>Loading reminder settings…</p>
        ) : (
          <>
            {!status.configured && <div className="notice notice-warning" role="status">Email is not configured in Cloudflare yet.</div>}
            <label className="checkbox-row">
              <input checked={status.enabled} disabled={busy} onChange={(event) => setStatus({ ...status, enabled: event.target.checked })} type="checkbox" />
              Enable email reminders for this project
            </label>
            <label className="checkbox-row">
              <input checked={status.dueEnabled} disabled={busy} onChange={(event) => setStatus({ ...status, dueEnabled: event.target.checked })} type="checkbox" />
              Initiative owner: one day before the due date
            </label>
            <label className="checkbox-row">
              <input checked={status.inactivityEnabled} disabled={busy} onChange={(event) => setStatus({ ...status, inactivityEnabled: event.target.checked })} type="checkbox" />
              Active team members: every two weeks without changes
            </label>
            <p>Completed initiatives are excluded. Cloud project changes reset the inactivity timer.</p>
            {status.lastSuccess && <p>Last successful email: {new Date(status.lastSuccess).toLocaleString()}</p>}
            {status.lastError && <div className="notice notice-warning" role="alert">{status.lastError}</div>}
            <div className="button-row modal-actions">
              <button className="button button-secondary" disabled={busy || !status.configured} onClick={() => void sendTest()} type="button">Send test to configured mailbox</button>
              <button className="button button-primary" disabled={busy} onClick={() => void save()} type="button">Save settings</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The notification operation failed.";
}
