import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  importCloudProject,
  listCloudProjects,
  restoreCloudProject,
  selectCloudProject,
  type CloudProjectSummary,
} from "./cloud-api";
import { ProjectSchema } from "../shared/schemas";
import type { Project } from "../shared/types";

export function CloudProjects({ currentProject, onClose, onSelect }: {
  currentProject: Project | null;
  onClose: () => void;
  onSelect: (project: Project) => void;
}) {
  const [projects, setProjects] = useState<CloudProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    listCloudProjects()
      .then((items) => { if (mounted) setProjects(items); })
      .catch((caught: unknown) => { if (mounted) setError(errorText(caught)); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      onSelect(await selectCloudProject(id));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 2_000_000) throw new Error("The project file is too large.");
      const data = ProjectSchema.parse(JSON.parse(await file.text()) as unknown);
      const existing = (await listCloudProjects()).some((project) => project.id === data.id);
      if (existing) {
        if (currentProject?.id !== data.id) {
          throw new Error("Open this cloud project before importing its offline copy.");
        }
        if (!window.confirm(`Replace "${currentProject.name}" with this offline copy? Cloud changes since the copy was made will be lost. Download the cloud project first if needed.`)) return;
        onSelect(await restoreCloudProject(data));
      } else {
        onSelect(await importCloudProject(data));
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="cloud-projects-title">
        <div className="section-heading">
          <h2 id="cloud-projects-title">Cloud projects</h2>
          <button aria-label="Close" className="icon-button" disabled={busy} onClick={onClose} type="button">×</button>
        </div>
        <p>All signed-in users can access these projects. To replace a cloud project with an offline copy, open it first.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {loading ? <p>Loading projects…</p> : projects.length === 0 ? <p>No cloud projects yet.</p> : (
          <div className="stack">
            {projects.map((project) => (
              <button className="button button-secondary" disabled={busy} key={project.id} onClick={() => void open(project.id)} type="button">
                {project.name}
              </button>
            ))}
          </div>
        )}
        <input ref={fileInput} accept=".json,application/json" hidden onChange={(event) => void importFile(event)} type="file" />
        <div className="button-row modal-actions">
          <button className="button button-secondary" disabled={busy || loading} onClick={() => fileInput.current?.click()} type="button">Import project JSON</button>
          <button className="button button-secondary" disabled={busy} onClick={onClose} type="button">Cancel</button>
        </div>
      </section>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The operation failed.";
}
