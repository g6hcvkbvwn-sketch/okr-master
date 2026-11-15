import { useMemo, useState } from "react";
import {
  calculateKeyResultProgress,
  calculateObjectiveProgress,
} from "../domain/progress";
import {
  isViewerSnapshotStale,
  viewerProjectForDisplay,
} from "../domain/viewer-snapshot";
import {
  EMPTY_INITIATIVE_FILTER,
  filterInitiatives,
  hasInitiativeFilter,
  type InitiativeFilter,
} from "../domain/initiative-filters";
import { getNextCycleMilestone } from "../domain/cycles";
import { assignUserColors } from "../domain/user-colors";
import { ViewerSnapshotSchema } from "../shared/schemas";
import type { Initiative, KeyResult, Project } from "../shared/types";
import { History } from "./History";
import { OwnerBadge } from "./OwnerBadge";
import { ProgressBadge } from "./ProgressBadge";
import { ProgressBar } from "./ProgressBar";
import { CycleTimeline } from "./CycleTimeline";
import { InitiativeFiltersBar } from "./InitiativeFiltersBar";
import { UserColorsContext } from "./user-colors";
import logoUrl from "./assets/logo-128.png";

type EmbeddedSnapshot =
  | { ok: true; project: Project; generatedAt: string }
  | { ok: false; error: string };

type ViewerSection = "Current Cycle" | "History";
type CurrentCycleMode = "okr" | "initiatives";
type InitiativeStatus = Initiative["status"];

const INITIATIVE_STATUSES: InitiativeStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
];

function readEmbeddedSnapshot(): EmbeddedSnapshot {
  const element = document.getElementById("okr-viewer-snapshot");
  if (!element?.textContent) {
    return { ok: false, error: "The viewer snapshot is missing." };
  }

  try {
    const raw: unknown = JSON.parse(element.textContent);
    const parsed = ViewerSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      const projectVersion =
        typeof raw === "object" &&
        raw !== null &&
        "project" in raw &&
        typeof raw.project === "object" &&
        raw.project !== null &&
        "schemaVersion" in raw.project &&
        typeof raw.project.schemaVersion === "number"
          ? raw.project.schemaVersion
          : undefined;
      const version =
        typeof raw === "object" &&
        raw !== null &&
        "schemaVersion" in raw &&
        typeof raw.schemaVersion === "number"
          ? raw.schemaVersion
          : projectVersion;
      return {
        ok: false,
        error:
          version !== undefined && version !== 1
            ? `This viewer supports project schema version 1, but this snapshot uses version ${version}.`
            : `The embedded viewer snapshot is invalid: ${parsed.error.issues
                .map((issue) => issue.message)
                .join("; ")}`,
      };
    }

    return {
      ok: true,
      project: viewerProjectForDisplay(parsed.data.project),
      generatedAt: parsed.data.generatedAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: `The embedded viewer snapshot could not be read: ${
        error instanceof Error ? error.message : "Invalid JSON."
      }`,
    };
  }
}

export function ViewerApp() {
  const [snapshot] = useState(readEmbeddedSnapshot);
  const [section, setSection] = useState<ViewerSection>("Current Cycle");
  const [cycleMode, setCycleMode] = useState<CurrentCycleMode>("okr");
  const colors = useMemo(
    () => (snapshot.ok ? assignUserColors(snapshot.project) : new Map()),
    [snapshot],
  );

  if (!snapshot.ok) {
    return (
      <main className="viewer-error" role="alert">
        <img alt="" className="brand-logo" src={logoUrl} />
        <h1>OKR Master viewer could not open this snapshot</h1>
        <p>{snapshot.error}</p>
      </main>
    );
  }

  const project = snapshot.project;
  const stale = isViewerSnapshotStale(snapshot.generatedAt);

  return (
    <UserColorsContext.Provider value={colors}>
      <div className="app-shell viewer-shell">
        <header className="app-chrome">
          <div className="topbar">
            <div className="brand">
              <img alt="" className="brand-logo" src={logoUrl} />
              <div>
                <strong>OKR Master</strong>
                <small>{project.name}</small>
              </div>
            </div>
            <div className="viewer-snapshot-label">
              <span className="viewer-mode-label">Read-only snapshot</span>
              <span>{formatSnapshotDate(snapshot.generatedAt)}</span>
              <span className="app-version">{__APP_VERSION__}</span>
            </div>
          </div>
          <nav aria-label="Viewer navigation" className="primary-nav">
            {(["Current Cycle", "History"] as const).map((name) => (
              <button
                aria-current={section === name ? "page" : undefined}
                className={`nav-item ${section === name ? "selected" : ""}`}
                key={name}
                onClick={() => setSection(name)}
                type="button"
              >
                {name}
              </button>
            ))}
          </nav>
        </header>

        <main className="page-content">
          {stale && (
            <div className="notice notice-warning" role="status">
              This snapshot is{" "}
              {Math.floor(
                (Date.now() - Date.parse(snapshot.generatedAt)) /
                  (24 * 60 * 60 * 1000),
              )}{" "}
              days old and may be outdated.
            </div>
          )}
          {section === "Current Cycle" ? (
            <ViewerCurrentCycle
              mode={cycleMode}
              onModeChange={setCycleMode}
              project={project}
            />
          ) : (
            <History project={project} />
          )}
        </main>

        <footer className="viewer-footer">
          Read-only snapshot · {project.name}
        </footer>
      </div>
    </UserColorsContext.Provider>
  );
}

function ViewerCurrentCycle({
  project,
  mode,
  onModeChange,
}: {
  project: Project;
  mode: CurrentCycleMode;
  onModeChange: (mode: CurrentCycleMode) => void;
}) {
  const cycle = project.cycles.find(
    (candidate) =>
      candidate.id === project.currentCycleId && candidate.status === "active",
  );
  const nextMilestone = cycle ? getNextCycleMilestone(cycle) : null;
  const goals = useMemo(
    () =>
      cycle
        ? project.companyGoals
            .filter((goal) => goal.cycleId === cycle.id)
            .sort((left, right) => left.priority - right.priority)
        : [],
    [cycle, project.companyGoals],
  );
  const objectives = useMemo(
    () =>
      cycle
        ? project.objectives.filter(
            (objective) => objective.cycleId === cycle.id,
          )
        : [],
    [cycle, project.objectives],
  );
  const activeKeyResultIds = useMemo(() => {
    const objectiveIds = new Set(objectives.map((objective) => objective.id));
    return new Set(
      project.keyResults
        .filter((result) => objectiveIds.has(result.objectiveId))
        .map((result) => result.id),
    );
  }, [objectives, project.keyResults]);
  const initiatives = useMemo(
    () =>
      project.initiatives.filter((initiative) =>
        activeKeyResultIds.has(initiative.keyResultId),
      ),
    [activeKeyResultIds, project.initiatives],
  );
  const [initiativeFilter, setInitiativeFilter] = useState<InitiativeFilter>({
    ...EMPTY_INITIATIVE_FILTER,
  });
  const filteredInitiatives = useMemo(
    () => filterInitiatives(initiatives, project.keyResults, initiativeFilter),
    [initiativeFilter, initiatives, project.keyResults],
  );

  if (!cycle) {
    return (
      <section className="card empty-state">
        <div className="empty-state-mark">○</div>
        <h2>No active cycle</h2>
        <p>No cycle is currently active in this snapshot.</p>
      </section>
    );
  }

  return (
    <div className="stack">
      <section className="card cycle-summary">
        <div>
          <p className="eyebrow">ACTIVE CYCLE</p>
          <h2>
            {formatMonth(cycle.startMonth)} – {formatMonth(cycle.endMonth)}
          </h2>
        </div>
        {nextMilestone && (
          <p className="cycle-next-milestone">
            Next: <strong>{nextMilestone.label}</strong> ·{" "}
            {formatDate(nextMilestone.date)}
          </p>
        )}
        <div className="cycle-timeline-details">
          <CycleTimeline cycle={cycle} />
        </div>
      </section>

      <section className="cycle-priority-strip">
        <div className="cycle-priority-heading">
          <strong>Cycle priorities</strong>
        </div>
        {goals.length ? (
          <div className="goal-pills">
            {goals.map((goal) => (
              <span className="goal-pill" key={goal.id}>
                <b>{goal.priority}</b> {goal.title}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">No priorities are assigned to this cycle.</p>
        )}
      </section>

      <div aria-label="Current Cycle view" className="cycle-view-switch" role="group">
        <button
          aria-pressed={mode === "okr"}
          className={mode === "okr" ? "selected" : ""}
          onClick={() => onModeChange("okr")}
          type="button"
        >
          OKR View
        </button>
        <button
          aria-pressed={mode === "initiatives"}
          className={mode === "initiatives" ? "selected" : ""}
          onClick={() => onModeChange("initiatives")}
          type="button"
        >
          Initiatives
        </button>
      </div>

      {mode === "initiatives" ? (
        <InitiativesBoard
          filter={initiativeFilter}
          initiatives={filteredInitiatives}
          keyResults={project.keyResults.filter((result) =>
            activeKeyResultIds.has(result.id),
          )}
          objectives={objectives}
          onClear={() => setInitiativeFilter({ ...EMPTY_INITIATIVE_FILTER })}
          onFilterChange={setInitiativeFilter}
          project={project}
        />
      ) : (
        <section className="stack compact-stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">OUTCOMES & MEASURES</p>
              <h2>Objectives</h2>
            </div>
          </div>
          {objectives.length === 0 ? (
            <section className="card empty-state">
              <h2>No Objectives yet</h2>
            </section>
          ) : (
            objectives.map((objective) => {
              const keyResults = project.keyResults.filter(
                (result) => result.objectiveId === objective.id,
              );
              const linkedGoals = goals.filter((goal) =>
                objective.companyGoalIds.includes(goal.id),
              );
              const progress = calculateObjectiveProgress(keyResults);
              return (
                <details
                  className="card hierarchy-objective"
                  id={`objective-${objective.id}`}
                  key={objective.id}
                  open
                >
                  <summary className="hierarchy-summary">
                    <span aria-hidden="true" className="disclosure-chevron" />
                    <span className="hierarchy-title">
                      <span className="eyebrow">OBJECTIVE</span>
                      <strong>{objective.title}</strong>
                    </span>
                    <OwnerBadge user={displayUser(project, objective.ownerId)} />
                    <ProgressBadge
                      className="objective-progress"
                      progress={progress}
                    />
                  </summary>
                  <div className="hierarchy-body">
                    <p className="objective-description-text">
                      {objective.description}
                    </p>
                    <div className="linked-goals">
                      <span className="field-caption">Aligned cycle priorities</span>
                      <div className="goal-pills">
                        {linkedGoals.map((goal) => (
                          <span className="goal-pill" key={goal.id}>
                            <b>{goal.priority}</b> {goal.title}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ProgressBar
                      label="Objective progress"
                      progress={progress}
                      showLabel={false}
                    />
                    <div className="hierarchy-children">
                      {keyResults.map((keyResult) => (
                        <ViewerKeyResult
                          key={keyResult.id}
                          keyResult={keyResult}
                          initiatives={project.initiatives.filter(
                            (initiative) =>
                              initiative.keyResultId === keyResult.id,
                          )}
                          project={project}
                        />
                      ))}
                    </div>
                  </div>
                </details>
              );
            })
          )}
        </section>
      )}
    </div>
  );
}

function ViewerKeyResult({
  keyResult,
  initiatives,
  project,
}: {
  keyResult: KeyResult;
  initiatives: Initiative[];
  project: Project;
}) {
  const progress = calculateKeyResultProgress(keyResult);
  return (
    <details className="key-result-node" id={`key-result-${keyResult.id}`}>
      <summary className="key-result-summary">
        <span aria-hidden="true" className="disclosure-chevron" />
        <span className="key-result-name">
          <strong>{keyResult.title}</strong>
          <small className="key-result-metric">{formatMetric(keyResult)}</small>
        </span>
        <span className="key-result-summary-meta">
          <span className="key-result-initiative-count">
            {initiatives.length} {initiatives.length === 1 ? "Initiative" : "Initiatives"}
          </span>
          <OwnerBadge user={displayUser(project, keyResult.ownerId)} />
          <ProgressBadge className="progress-number" progress={progress} />
        </span>
      </summary>
      <div className="key-result-body">
        {keyResult.description && (
          <p className="key-result-description">{keyResult.description}</p>
        )}
        <ProgressBar
          compact
          label="Key Result progress"
          progress={progress}
          showLabel={false}
        />
        {initiatives.length > 0 && (
          <div className="history-initiatives">
            <h5>Initiatives</h5>
            {[...initiatives]
              .sort((left, right) => left.priority - right.priority)
              .map((initiative) => (
              <article className="history-initiative" key={initiative.id}>
                <div className="history-item-heading">
                  <div>
                    <strong>{initiative.title}</strong>
                    {initiative.description && (
                      <p className="muted">{initiative.description}</p>
                    )}
                  </div>
                  <ProgressBadge progress={initiative.progress} />
                </div>
                <div className="history-initiative-meta">
                  <span className="initiative-priority">
                    Priority {initiative.priority}
                  </span>
                  <span>
                    Owner: <OwnerBadge user={displayUser(project, initiative.ownerId)} />
                  </span>
                  {initiative.collaboratorIds.length > 0 && (
                    <span>
                      Collaborators:{" "}
                      {initiative.collaboratorIds.map((id, index) => (
                        <span key={id}>
                          {index > 0 ? ", " : ""}
                          <OwnerBadge user={displayUser(project, id)} />
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <ProgressBar
                  compact
                  label="Initiative progress"
                  progress={initiative.progress}
                  showLabel={false}
                />
              </article>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function InitiativesBoard({
  initiatives,
  project,
  objectives,
  keyResults,
  filter,
  onFilterChange,
  onClear,
}: {
  initiatives: Initiative[];
  project: Project;
  objectives: Project["objectives"];
  keyResults: KeyResult[];
  filter: InitiativeFilter;
  onFilterChange: (filter: InitiativeFilter) => void;
  onClear: () => void;
}) {
  return (
    <>
      <InitiativeFiltersBar
        filter={filter}
        keyResults={keyResults}
        matchingCount={initiatives.length}
        objectives={objectives}
        onClear={onClear}
        onFilterChange={onFilterChange}
        users={project.users}
      />
      <div aria-label="Initiatives Kanban board" className="initiative-board">
        {INITIATIVE_STATUSES.map((status) => {
          const items = initiatives.filter((item) => item.status === status);
          return (
            <section
              aria-labelledby={`viewer-column-${status}`}
              className={`initiative-column ${status}`}
              key={status}
            >
              <div className="initiative-column-heading">
                <h3 id={`viewer-column-${status}`}>{statusLabel(status)}</h3>
                <span>{items.length}</span>
              </div>
              <div className="initiative-column-cards">
                {items.map((initiative) => (
                  <article className="initiative-board-card" key={initiative.id}>
                    <div className="initiative-board-title">
                      <strong>{initiative.title}</strong>
                    </div>
                    {initiative.description && <p>{initiative.description}</p>}
                    <div className="initiative-board-meta">
                      <span>
                        Owner: <OwnerBadge user={displayUser(project, initiative.ownerId)} />
                      </span>
                      <span>Priority: {initiative.priority}</span>
                      <span>Target: {initiative.targetDate}</span>
                    </div>
                    <ProgressBar
                      compact
                      label="Progress"
                      progress={initiative.progress}
                    />
                    {initiative.tasks.length > 0 && (
                      <ul
                        aria-label="Initiative tasks"
                        className="initiative-board-task-list"
                      >
                        {initiative.tasks.map((task) => (
                          <li
                            className={task.completed ? "completed" : undefined}
                            key={task.id}
                          >
                            <span aria-hidden="true">
                              {task.completed ? "✓" : "○"}
                            </span>
                            {task.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
                {items.length === 0 && (
                  <p className="initiative-column-empty">
                    {hasInitiativeFilter(filter)
                      ? "No initiatives match these filters."
                      : status === "todo"
                        ? "No work has been added yet."
                        : `No initiatives are ${statusLabel(status).toLowerCase()} yet.`}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function displayUser(project: Project, userId: string): { id: string; name: string } {
  return {
    id: userId,
    name: project.users.find((user) => user.id === userId)?.name ?? "Unknown user",
  };
}

function formatMetric(keyResult: KeyResult): string {
  if (keyResult.metricType === "yes_no") {
    return `Measure Yes / No · Current ${keyResult.value ? "Yes" : "No"} · Target Yes`;
  }
  const suffix = keyResult.metricType === "percentage_target" ? "%" : "";
  return `Start ${keyResult.startValue}${suffix} · Current ${keyResult.currentValue}${suffix} · Target ${keyResult.targetValue}${suffix}`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year!, month! - 1, day!));
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, 1)));
}

function formatSnapshotDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(status: InitiativeStatus): string {
  switch (status) {
    case "todo":
      return "To Do";
    case "in_progress":
      return "In Progress";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
  }
}
