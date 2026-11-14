import type { ViewerPublishResult, ViewerPublishSettings } from "../shared/types";
import type { SaveStatus } from "./publishing-types";

export function Publishing({
  settings,
  saveStatus,
  busy,
  error,
  result,
  settingsLoading,
  onChooseFolder,
  onSettingsChange,
  onSaveSettings,
  onPublish,
  onPublishAndPush,
}: {
  settings: ViewerPublishSettings;
  saveStatus: SaveStatus;
  busy: boolean;
  settingsLoading: boolean;
  error: string;
  result: ViewerPublishResult | null;
  onChooseFolder: () => void;
  onSettingsChange: (changes: Partial<Pick<ViewerPublishSettings, "directory" | "publishOnClose">>) => void;
  onSaveSettings: () => void;
  onPublish: () => void;
  onPublishAndPush: () => void;
}) {
  const savedProject = saveStatus === "saved";
  return (
    <div className="stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">TEAM VIEWER</p>
            <h2>Publishing settings</h2>
            <p className="muted">
              Publish a read-only snapshot as <code>okr-viewer.html</code> to a
              synced SharePoint folder or a Git repository.
            </p>
          </div>
        </div>

        <div className="field">
          <span>Publishing folder</span>
          <div className="publish-folder-row">
            <input
              aria-label="Publishing folder"
              disabled={settingsLoading}
              onChange={(event) =>
                onSettingsChange({ directory: event.target.value })
              }
              placeholder="Choose a folder"
              value={settings.directory}
            />
            <button
              className="button button-secondary"
              disabled={busy || settingsLoading}
              onClick={onChooseFolder}
              type="button"
            >
              Choose folder…
            </button>
          </div>
        </div>

        <label className="publish-close-setting">
          <input
            checked={settings.publishOnClose}
            disabled={settingsLoading}
            onChange={(event) =>
              onSettingsChange({ publishOnClose: event.target.checked })
            }
            type="checkbox"
          />
          <span>
            Ask whether to publish when closing the editor
            <small>
              When enabled, closing asks Publish, Skip, or Cancel close if
              saved project data has changed since the last snapshot.
            </small>
          </span>
        </label>

        {settings.lastPublishedAt && settings.lastPublishedPath && (
          <p className="muted publish-last-result">
            Last published {new Date(settings.lastPublishedAt).toLocaleString()}{" "}
            to <code>{settings.lastPublishedPath}</code>
          </p>
        )}

        <div className="button-row publish-actions">
          <button
            className="button button-secondary"
            disabled={busy || settingsLoading}
            onClick={onSaveSettings}
            type="button"
          >
            Save settings
          </button>
          <button
            className="button button-primary"
            disabled={
              busy || settingsLoading || !settings.directory || !savedProject
            }
            onClick={onPublish}
            type="button"
          >
            {busy ? "Publishing…" : "Publish viewer"}
          </button>
          <button
            className="button button-secondary"
            disabled={
              busy || settingsLoading || !settings.directory || !savedProject
            }
            onClick={onPublishAndPush}
            type="button"
          >
            Publish and push
          </button>
        </div>
        {settingsLoading && (
          <p className="muted" role="status">
            Loading publishing settings…
          </p>
        )}
        {!savedProject && (
          <p className="notice notice-warning publish-blocked" role="status">
            Publishing is blocked until all project changes are saved
            successfully.
          </p>
        )}
      </section>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="notice notice-success" role="status">
          <strong>{result.message}</strong>
          <span>
            {result.publishedAt
              ? ` Published at ${new Date(result.publishedAt).toLocaleString()}.`
              : ""}
          </span>
          <br />
          <code>{result.path}</code>
        </div>
      )}
    </div>
  );
}
