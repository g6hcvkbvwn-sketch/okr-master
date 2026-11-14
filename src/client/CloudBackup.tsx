import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { z } from "zod";
import { ProjectSchema } from "../shared/schemas";
import type { Project } from "../shared/types";
import { importCloudProject, listCloudProjects, restoreCloudProject } from "./cloud-api";

const StatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  lastAttempt: z.string().nullable(),
  lastSuccess: z.string().nullable(),
  error: z.string().nullable(),
  pending: z.boolean(),
}).strict();
const BackupSchema = z.object({
  type: z.literal("okr-master-backup"),
  version: z.literal(1),
  projects: z.array(ProjectSchema),
}).strict();

async function backupRequest(path: string, method = "GET"): Promise<unknown> {
  const response = await fetch(path, { method, cache: "no-store" });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(error.success ? error.data.error : `Backup request failed (HTTP ${response.status}).`);
  }
  return body;
}

export function CloudBackup({ project, onClose, onRestore }: {
  project: Project | null;
  onClose: () => void;
  onRestore: (project: Project) => void;
}) {
  const [status, setStatus] = useState<z.infer<typeof StatusSchema> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backupProjects, setBackupProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      backupRequest("/api/onedrive/status")
        .then((value) => { if (mounted) setStatus(StatusSchema.parse(value)); })
        .catch((caught: unknown) => { if (mounted) setError(errorText(caught)); });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);

  async function backupNow() {
    setBusy(true);
    setError("");
    try {
      await backupRequest("/api/onedrive/backup", "POST");
      setStatus(StatusSchema.parse(await backupRequest("/api/onedrive/status")));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      const backup = BackupSchema.parse(JSON.parse(await file.text()) as unknown);
      setBackupProjects(backup.projects);
      setSelectedId(backup.projects[0]?.id ?? "");
      if (!backup.projects.length) setError("This backup contains no projects.");
    } catch (caught) {
      setBackupProjects([]);
      setSelectedId("");
      setError(errorText(caught));
    }
  }

  async function restore() {
    const selected = backupProjects.find((item) => item.id === selectedId);
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const projects = await listCloudProjects();
      const exists = projects.some((item) => item.id === selected.id);
      if (exists && project?.id !== selected.id) throw new Error("Open this cloud project before restoring it, then return to Backups.");
      const confirmation = exists
        ? `Replace the current cloud project "${selected.name}" with its backup? Changes since this backup will be lost.`
        : `Import "${selected.name}" from this backup as a new cloud project?`;
      if (!window.confirm(confirmation)) return;
      onRestore(exists ? await restoreCloudProject(selected) : await importCloudProject(selected));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="backup-title">
        <div className="section-heading">
          <h2 id="backup-title">OneDrive backups</h2>
          <button aria-label="Close" className="icon-button" disabled={busy} onClick={onClose} type="button">×</button>
        </div>
        <p>Backups contain all cloud projects and are stored in the dedicated OneDrive app folder. Local desktop files are not synchronized.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {!status ? <p>Loading backup status…</p> : (
          <>
            <p>{!status.configured ? "OneDrive has not been configured." : !status.connected ? "OneDrive is not connected." : status.pending ? "Changes are waiting for backup." : "The current cloud data is backed up."}</p>
            {status.lastSuccess && <p>Last successful backup: {new Date(status.lastSuccess).toLocaleString()}</p>}
            {status.error && <div className="notice notice-warning" role="alert">{status.error}</div>}
            <div className="button-row">
              <button className="button button-secondary" disabled={!status.configured || busy} onClick={() => { window.location.href = "/api/onedrive/connect"; }} type="button">{status.connected ? "Reconnect OneDrive" : "Connect OneDrive"}</button>
              <button className="button button-secondary" disabled={!status.connected || busy} onClick={() => void backupNow()} type="button">Back up now</button>
            </div>
          </>
        )}
        <h3>Restore one project</h3>
        <p>Download a backup JSON file from the OneDrive app folder first. Existing cloud projects must be open before restoring.</p>
        <input ref={inputRef} accept=".json,application/json" hidden onChange={(event) => void chooseBackup(event)} type="file" />
        <button className="button button-secondary" disabled={busy} onClick={() => inputRef.current?.click()} type="button">Choose backup file</button>
        {backupProjects.length > 0 && (
          <div className="button-row">
            <select aria-label="Project in backup" onChange={(event) => setSelectedId(event.target.value)} value={selectedId}>
              {backupProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button className="button button-primary" disabled={busy} onClick={() => void restore()} type="button">Restore project</button>
          </div>
        )}
      </section>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The backup operation failed.";
}
