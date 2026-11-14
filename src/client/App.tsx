import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { CurrentCycle } from "./CurrentCycle";
import { History } from "./History";
import { Publishing } from "./Publishing";
import { UserAvatar } from "./OwnerBadge";
import { ProgressBadge } from "./ProgressBadge";
import { Review } from "./Review";
import { UserColorsContext } from "./user-colors";
import logoUrl from "./assets/logo-128.png";
import { assignUserColors } from "../domain/user-colors";
import {
  movePlanningCompanyGoal,
  removePlanningCompanyGoal,
  validateFirstCycleDraft,
} from "../domain/project";
import {
  calculateKeyResultProgress,
} from "../domain/progress";
import {
  calculateCycleEndMonth,
  calculateNextCycleStartMonth,
  getCurrentLocalMonth,
} from "../domain/cycles";
import { api } from "./api";
import type {
  Cadence,
  KeyResultDraft,
  PlanningDraft,
  Project,
  ReviewDraft,
  Cycle,
  User,
  EditorSaveState,
  ViewerPublishResult,
  ViewerPublishSettings,
} from "../shared/types";
import type { SaveStatus } from "./publishing-types";

type View =
  | "Current Cycle"
  | "Review"
  | "Planning"
  | "History"
  | "People"
  | "Publishing";

const NAV_ITEMS: { view: View; label: string }[] = [
  { view: "Current Cycle", label: "Current Cycle" },
  { view: "Review", label: "Review" },
  { view: "Planning", label: "Planning" },
  { view: "History", label: "History" },
  { view: "People", label: "Team" },
  { view: "Publishing", label: "Publishing" },
];

function uuid(): string {
  return crypto.randomUUID();
}

function makeKeyResultDraft(): KeyResultDraft {
  return {
    id: uuid(),
    title: "",
    description: "",
    ownerId: "",
    metricType: "number_target",
    startValue: 0,
    currentValue: 0,
    targetValue: null,
    yesNoValue: false,
  };
}

function makeObjectiveDraft(): PlanningDraft["objectives"][number] {
  return {
    id: uuid(),
    title: "",
    description: "",
    ownerId: "",
    companyGoalIds: [],
    keyResults: [makeKeyResultDraft()],
  };
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const projectRef = useRef<Project | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [view, setView] = useState<View>("Current Cycle");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [publishSettings, setPublishSettings] = useState<ViewerPublishSettings>({
    directory: "",
    publishOnClose: false,
    lastPublishedFingerprint: null,
    lastPublishedPath: null,
    lastPublishedAt: null,
  });
  const [publishSettingsLoading, setPublishSettingsLoading] = useState(true);
  const [publishResult, setPublishResult] =
    useState<ViewerPublishResult | null>(null);
  const [publishError, setPublishError] = useState("");
  const [publishBusy, setPublishBusy] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [operationError, setOperationError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userActive, setUserActive] = useState(true);
  const revisionRef = useRef(0);
  const saveStateSequenceRef = useRef(0);

  const installProject = useCallback((nextProject: Project | null) => {
    projectRef.current = nextProject;
    setProject(nextProject);
    revisionRef.current += 1;
    setSaveStatus("saved");
  }, []);

  useEffect(() => {
    let mounted = true;
    api
      .getSession()
      .then((session) => {
        if (!mounted) return;
        installProject(session.project);
        setFileName(session.fileName);
        setRecoveryMessage(session.recoveryMessage ?? "");
        setView(session.project?.currentCycleId ? "Current Cycle" : "Planning");
      })
      .catch((error: unknown) => {
        if (mounted) setLoadError(errorText(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [installProject]);

  useEffect(() => {
    let mounted = true;
    api
      .getViewerPublishSettings()
      .then((settings) => {
        if (mounted) {
          setPublishSettings(settings);
          setPublishSettingsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setPublishError(errorText(error));
          setPublishSettingsLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const state = {
      sequence: ++saveStateSequenceRef.current,
      saveStatus,
    } satisfies EditorSaveState;
    api.updateEditorSaveState(state).catch((error: unknown) => {
      setOperationError(errorText(error));
    });
  }, [saveStatus]);

  useEffect(() => {
    if (saveStatus === "saved") return;
    const warnBeforeDiscard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeDiscard);
    return () => window.removeEventListener("beforeunload", warnBeforeDiscard);
  }, [saveStatus]);

  useEffect(() => {
    if (saveStatus !== "pending") return;
    const revision = revisionRef.current;
    const timer = window.setTimeout(() => {
      const currentProject = projectRef.current;
      if (!currentProject) return;
      setSaveStatus("saving");
      api
        .saveProject(currentProject)
        .then((savedProject) => {
          if (revisionRef.current !== revision) {
            setSaveStatus("pending");
            return;
          }
          installProject(savedProject);
        })
        .catch((error: unknown) => {
          if (revisionRef.current === revision) {
            setOperationError(errorText(error));
            setSaveStatus("failed");
          } else {
            setSaveStatus("pending");
          }
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [installProject, project, saveStatus]);

  const setDraft = useCallback(
    (update: (draft: PlanningDraft) => PlanningDraft) => {
      const current = projectRef.current;
      if (!current?.planningDraft) return;
      const next = {
        ...current,
        planningDraft: update(current.planningDraft),
      };
      projectRef.current = next;
      revisionRef.current += 1;
      setProject(next);
      setSaveStatus("pending");
      setOperationError("");
    },
    [],
  );

  const changeReviewDraft = useCallback(
    (field: keyof Omit<ReviewDraft, "cycleId">, value: string) => {
      const current = projectRef.current;
      if (!current?.reviewDraft) return;
      const next = {
        ...current,
        reviewDraft: { ...current.reviewDraft, [field]: value },
      };
      projectRef.current = next;
      revisionRef.current += 1;
      setProject(next);
      setSaveStatus("pending");
      setOperationError("");
    },
    [],
  );

  const activeUsers = useMemo(
    () => project?.users.filter((user) => user.active) ?? [],
    [project?.users],
  );
  const userColors = useMemo(
    () => (project ? assignUserColors(project) : new Map()),
    [project],
  );
  const planningErrors = useMemo(
    () => (project ? validateFirstCycleDraft(project) : []),
    [project],
  );

  async function flushPendingChanges(): Promise<void> {
    const currentProject = projectRef.current;
    if (!currentProject || saveStatus === "saved") return;
    const revision = revisionRef.current;
    setSaveStatus("saving");
    try {
      const saved = await api.saveProject(currentProject);
      if (revisionRef.current === revision) {
        installProject(saved);
      } else {
        setSaveStatus("pending");
      }
    } catch (error) {
      setOperationError(errorText(error));
      setSaveStatus("failed");
      throw error;
    }
  }

  async function saveChangesNow(): Promise<void> {
    try {
      await flushPendingChanges();
    } catch (error) {
      setOperationError(errorText(error));
    }
  }

  function changePublishSettings(
    changes: Partial<Pick<ViewerPublishSettings, "directory" | "publishOnClose">>,
  ) {
    setPublishSettings((current) => ({ ...current, ...changes }));
    setPublishResult(null);
    setPublishError("");
  }

  async function choosePublishFolder() {
    setPublishError("");
    try {
      const directory = await api.chooseViewerPublishDirectory();
      if (directory) changePublishSettings({ directory });
    } catch (error) {
      setPublishError(errorText(error));
    }
  }

  async function savePublishSettings(): Promise<ViewerPublishSettings> {
    const saved = await api.saveViewerPublishSettings({
      directory: publishSettings.directory,
      publishOnClose: publishSettings.publishOnClose,
    });
    setPublishSettings(saved);
    return saved;
  }

  async function savePublishSettingsFromUi() {
    setPublishBusy(true);
    setPublishError("");
    setPublishResult(null);
    try {
      await savePublishSettings();
    } catch (error) {
      setPublishError(errorText(error));
    } finally {
      setPublishBusy(false);
    }
  }

  async function publishViewer(pushToGit: boolean) {
    if (saveStatus !== "saved") {
      setPublishError(
        "Publishing is blocked until all project changes are saved successfully.",
      );
      return;
    }
    setPublishBusy(true);
    setPublishError("");
    setPublishResult(null);
    try {
      await savePublishSettings();
      const result = pushToGit
        ? await api.publishViewerAndPush()
        : await api.publishViewer();
      setPublishResult(result);
      setPublishSettings(await api.getViewerPublishSettings());
    } catch (error) {
      setPublishError(errorText(error));
    } finally {
      setPublishBusy(false);
    }
  }

  async function createNewProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsWorking(true);
    setOperationError("");
    try {
      await flushPendingChanges();
      const created = await api.createProject({
        name: projectName,
        description: projectDescription,
      });
      if (created) {
        installProject(created);
        const session = await api.getSession();
        setFileName(session.fileName);
        setRecoveryMessage(session.recoveryMessage ?? "");
        setView("People");
        setCreateFormOpen(false);
        setProjectName("");
        setProjectDescription("");
      }
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setIsWorking(false);
    }
  }

  async function openExistingProject() {
    setIsWorking(true);
    setOperationError("");
    try {
      await flushPendingChanges();
      const opened = await api.openProject();
      if (opened) {
        installProject(opened);
        const session = await api.getSession();
        setFileName(session.fileName);
        setRecoveryMessage(session.recoveryMessage ?? "");
        setView(opened.currentCycleId ? "Current Cycle" : "Planning");
      }
    } catch (error) {
      setOperationError(errorText(error));
    } finally {
      setIsWorking(false);
    }
  }

  async function activateCycle() {
    if (
      !project ||
      planningErrors.length > 0 ||
      saveStatus !== "saved" ||
      isWorking
    ) {
      return;
    }
    setIsWorking(true);
    setSaveStatus("saving");
    setOperationError("");
    try {
      const activated = await api.activateFirstCycle();
      installProject(activated);
      setView("Current Cycle");
    } catch (error) {
      setSaveStatus("failed");
      setOperationError(errorText(error));
    } finally {
      setIsWorking(false);
    }
  }

  async function submitReview() {
    const current = projectRef.current;
    const draftReview = current?.reviewDraft;
    if (!current || !draftReview || isWorking || saveStatus !== "saved") return;
    setIsWorking(true);
    setSaveStatus("saving");
    setOperationError("");
    try {
      const completed = await api.submitReview(draftReview);
      installProject(completed);
      setView("Planning");
    } catch (error) {
      setSaveStatus("failed");
      setOperationError(errorText(error));
    } finally {
      setIsWorking(false);
    }
  }

  const saveActiveCycleChange = useCallback(
    async (operation: () => Promise<Project>) => {
      setSaveStatus("saving");
      setOperationError("");
      try {
        const saved = await operation();
        installProject(saved);
        return saved;
      } catch (error) {
        setSaveStatus("failed");
        setOperationError(errorText(error));
        throw error;
      }
    },
    [installProject],
  );

  function beginUserEdit(user: User) {
    setEditingUserId(user.id);
    setUserName(user.name);
    setUserEmail(user.email);
    setUserActive(user.active);
    setOperationError("");
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserName("");
    setUserEmail("");
    setUserActive(true);
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsWorking(true);
    setSaveStatus("saving");
    setOperationError("");
    try {
      await flushPendingChanges();
      const changes = { name: userName, email: userEmail, active: userActive };
      const updated = editingUserId
        ? await api.updateUser(editingUserId, changes)
        : await api.createUser(changes);
      installProject(updated);
      resetUserForm();
    } catch (error) {
      setSaveStatus("failed");
      setOperationError(errorText(error));
    } finally {
      setIsWorking(false);
    }
  }

  async function removeUser(user: User) {
    if (!window.confirm(`Delete ${user.name}?`)) return;
    setSaveStatus("saving");
    setOperationError("");
    try {
      await flushPendingChanges();
      installProject(await api.deleteUser(user.id));
      if (editingUserId === user.id) resetUserForm();
    } catch (error) {
      setSaveStatus("failed");
      setOperationError(errorText(error));
    }
  }

  function changeGoal(
    goalId: string,
    changes: Partial<Pick<PlanningDraft["companyGoals"][number], "title" | "description">>,
  ) {
    setDraft((draft) => ({
      ...draft,
      companyGoals: draft.companyGoals.map((goal) =>
        goal.id === goalId ? { ...goal, ...changes } : goal,
      ),
    }));
  }

  function changeObjective(
    objectiveId: string,
    changes: Partial<
      Pick<
        PlanningDraft["objectives"][number],
        "title" | "description" | "ownerId" | "companyGoalIds"
      >
    >,
  ) {
    setDraft((draft) => ({
      ...draft,
      objectives: draft.objectives.map((objective) =>
        objective.id === objectiveId ? { ...objective, ...changes } : objective,
      ),
    }));
  }

  function changeKeyResult(
    objectiveId: string,
    keyResultId: string,
    changes: Partial<KeyResultDraft>,
  ) {
    setDraft((draft) => ({
      ...draft,
      objectives: draft.objectives.map((objective) =>
        objective.id === objectiveId
          ? {
              ...objective,
              keyResults: objective.keyResults.map((keyResult) =>
                keyResult.id === keyResultId
                  ? { ...keyResult, ...changes }
                  : keyResult,
              ),
            }
          : objective,
      ),
    }));
  }

  if (loading) {
    return <main className="boot-message">Loading OKR Master…</main>;
  }

  const activeCycle = project?.cycles.find(
    (cycle) => cycle.id === project.currentCycleId,
  );
  const draft = project?.planningDraft ?? null;
  const precedingCycle = project?.cycles.reduce<Cycle | undefined>(
    (latest, cycle) =>
      !latest || cycle.endMonth > latest.endMonth ? cycle : latest,
    undefined,
  );
  const plannedStartMonth = draft
    ? precedingCycle
      ? calculateNextCycleStartMonth(precedingCycle.endMonth)
      : getCurrentLocalMonth()
    : null;
  const plannedEndMonth =
    draft && plannedStartMonth
      ? calculateCycleEndMonth(plannedStartMonth, draft.cadence)
      : null;
  const prioritiesReady = Boolean(
    draft &&
      draft.planningFocus.trim() &&
      draft.companyGoals.length >= 1 &&
      draft.companyGoals.length <= 3 &&
      draft.companyGoals.every(
        (goal) => goal.title.trim() && goal.description.trim(),
      ),
  );
  const objectivesReady = Boolean(
    draft &&
      draft.objectives.length > 0 &&
      !planningErrors.some(
        (error) =>
          error.startsWith("Objective") ||
          error === "Add at least one Objective.",
      ),
  );
  return (
    <UserColorsContext.Provider value={userColors}>
    <div className="app-shell">
      <div className="app-chrome">
        <header className="topbar">
          <div className="brand">
            <img alt="" className="brand-logo" src={logoUrl} />
            <span>
              <strong>OKR Master</strong>
              <small>{project?.name ?? "Private, local planning"}</small>
              <small className="app-version">{__APP_VERSION__}</small>
            </span>
          </div>
          <div className="header-actions">
            {project && (
              <SaveIndicator
                onSaveNow={() => void saveChangesNow()}
                status={saveStatus}
              />
            )}
            {fileName && <span className="file-label">{fileName}</span>}
            {project && (
              <>
                <button
                  className="button button-secondary"
                  disabled={isWorking}
                  onClick={() => setCreateFormOpen(true)}
                  type="button"
                >
                  New project
                </button>
                <button
                  className="button button-secondary"
                  disabled={isWorking}
                  onClick={() => void openExistingProject()}
                  type="button"
                >
                  Open project
                </button>
              </>
            )}
          </div>
        </header>

        <nav className="primary-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map(({ view: destination, label }) => {
            const unavailable =
              !project ||
              ((destination === "Current Cycle" || destination === "Review") &&
                activeCycle?.status !== "active") ||
              (destination === "Planning" && activeCycle?.status === "active");
            return (
              <button
                aria-current={project && view === destination ? "page" : undefined}
                className={
                  project && view === destination ? "nav-item selected" : "nav-item"
                }
                disabled={unavailable}
                key={destination}
                onClick={() => setView(destination)}
                title={
                  destination === "Planning" && activeCycle?.status === "active"
                    ? "Planning opens after submitting the active cycle's review."
                    : undefined
                }
                type="button"
              >
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <main className="page-content">
        {(loadError || operationError) && (
          <div className="notice notice-error" role="alert">
            {loadError || operationError}
          </div>
        )}
        {recoveryMessage && (
          <div className="notice notice-warning" role="status">
            {recoveryMessage}
          </div>
        )}

        {!project ? (
          <section className="card welcome-card">
            <img alt="" className="welcome-logo" src={logoUrl} />
            <p className="eyebrow">YOUR NEXT STEP</p>
            <h2>Your OKR workspace</h2>
            <p>
              Create a local project file or open an existing
              <code> project.json</code> to begin.
            </p>
            <div className="button-row">
              <button
                className="button button-primary"
                onClick={() => setCreateFormOpen(true)}
                type="button"
              >
                Create project
              </button>
              <button
                className="button button-secondary"
                disabled={isWorking}
                onClick={() => void openExistingProject()}
                type="button"
              >
                Open project
              </button>
            </div>
          </section>
        ) : (
          <>
            {view === "Current Cycle" && (
              <CurrentCycle
                activeUsers={activeUsers}
                onSave={saveActiveCycleChange}
                project={project}
              />
            )}

            {view === "Planning" && (
              <section className="stack">
                {activeCycle ? (
                  <EmptyState
                    title="A cycle is active"
                    description="Planning for the next cycle opens after you submit the active cycle's review."
                    action={
                      <button
                        className="button button-primary"
                        onClick={() => setView("Review")}
                        type="button"
                      >
                        Go to Review
                      </button>
                    }
                  />
                ) : draft ? (
                  <>
                    <nav className="planning-stage-nav" aria-label="Planning stages">
                      {[
                        {
                          id: "planning-priorities",
                          title: "Priorities",
                          ready: prioritiesReady,
                        },
                        {
                          id: "planning-okrs",
                          title: "Objectives and Key Results",
                          ready: objectivesReady,
                        },
                        {
                          id: "planning-review",
                          title: "Review and activate",
                          ready: planningErrors.length === 0,
                        },
                      ].map((stage, index) => (
                        <a className="planning-stage-link" href={`#${stage.id}`} key={stage.id}>
                          <span className="planning-stage-number">{index + 1}</span>
                          <span>
                            <strong>{stage.title}</strong>
                            <small
                              className={
                                stage.ready
                                  ? "planning-stage-status ready"
                                  : "planning-stage-status needs-input"
                              }
                            >
                              {stage.ready ? "Ready" : "Needs input"}
                            </small>
                          </span>
                        </a>
                      ))}
                    </nav>

                    <div className="stack compact-stack">
                    <section className="card" id="planning-priorities">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">1 · PRIORITIES FOR THIS CYCLE</p>
                          <h2>Cycle priorities</h2>
                          <p className="muted">
                            These priorities describe this cycle and may be
                            revised when planning the next one. Order one to
                            three priorities by importance.
                          </p>
                        </div>
                        <span className="counter">
                          {draft.companyGoals.length} / 3
                        </span>
                      </div>
                      <div className="stack compact-stack">
                        {draft.companyGoals.map((goal, index) => (
                          <div className="goal-editor" key={goal.id}>
                            <div className="priority-badge">{index + 1}</div>
                            <div className="goal-order-controls">
                              <button
                                aria-label={`Move cycle priority ${index + 1} up`}
                                className="icon-button"
                                disabled={index === 0}
                                onClick={() =>
                                  setDraft((current) =>
                                    movePlanningCompanyGoal(
                                      current,
                                      goal.id,
                                      -1,
                                    ),
                                  )
                                }
                                type="button"
                              >
                                ↑
                              </button>
                              <button
                                aria-label={`Move cycle priority ${index + 1} down`}
                                className="icon-button"
                                disabled={index === draft.companyGoals.length - 1}
                                onClick={() =>
                                  setDraft((current) =>
                                    movePlanningCompanyGoal(
                                      current,
                                      goal.id,
                                      1,
                                    ),
                                  )
                                }
                                type="button"
                              >
                                ↓
                              </button>
                            </div>
                            <label className="field">
                              <span>Goal title</span>
                              <input
                                onChange={(event) =>
                                  changeGoal(goal.id, {
                                    title: event.target.value,
                                  })
                                }
                                placeholder="e.g. Build a sustainable business"
                                required
                                value={goal.title}
                              />
                            </label>
                            <label className="field">
                              <span>Description</span>
                              <input
                                onChange={(event) =>
                                  changeGoal(goal.id, {
                                    description: event.target.value,
                                  })
                                }
                                placeholder="Describe the strategic goal"
                                required
                                value={goal.description}
                              />
                            </label>
                            {draft.companyGoals.length > 1 && (
                              <button
                                aria-label={`Remove cycle priority ${index + 1}`}
                                className="icon-button remove-button"
                                onClick={() =>
                                  setDraft((current) =>
                                    removePlanningCompanyGoal(
                                      current,
                                      goal.id,
                                    ),
                                  )
                                }
                                type="button"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {draft.companyGoals.length < 3 && (
                        <button
                          className="button button-tertiary add-button"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              companyGoals: [
                                ...current.companyGoals,
                                { id: uuid(), title: "", description: "" },
                              ],
                            }))
                          }
                          type="button"
                        >
                          + Add cycle priority
                        </button>
                      )}
                    </section>

                    <section className="card">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">
                            CYCLE {project.cycles.length + 1}
                          </p>
                          <h2>Cadence and focus</h2>
                        </div>
                      </div>
                      <div className="form-grid">
                        <label className="field">
                          <span>Cycle cadence and duration</span>
                          <select
                            required
                            value={draft.cadence}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                cadence: event.target.value as Cadence,
                              }))
                            }
                          >
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Quarterly (recommended)</option>
                            <option value="yearly">Yearly</option>
                          </select>
                        </label>
                        <label className="field field-wide">
                          <span>What is the most impactful thing to achieve this cycle?</span>
                          <textarea
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                planningFocus: event.target.value,
                              }))
                            }
                            placeholder="What outcome will move you closer to this cycle's priorities?"
                            required
                            rows={2}
                            value={draft.planningFocus}
                          />
                        </label>
                      </div>
                      {plannedStartMonth && plannedEndMonth && (
                        <p className="planned-period">
                          This cadence means the cycle will run from{" "}
                          <strong>
                            {formatMonthLabel(plannedStartMonth)} –{" "}
                            {formatMonthLabel(plannedEndMonth)}
                          </strong>
                        </p>
                      )}
                    </section>
                    </div>

                    <section
                      className="stack compact-stack planning-objectives-stage"
                      id="planning-okrs"
                    >
                      <div className="section-heading objectives-heading">
                        <div>
                          <p className="eyebrow">2 · OUTCOMES & MEASURES</p>
                          <h2>Objectives and Key Results</h2>
                          <p className="muted">
                            An Objective is the outcome sought. A Key Result is
                            evidence that measures it; an Initiative is work
                            intended to influence a Key Result.
                          </p>
                          <p className="planning-example">
                            Example: “Increase qualified customer adoption”
                            (Objective) · “Raise activation from 40% to 60%”
                            (Key Result) · “Run onboarding workshops”
                            (Initiative)
                          </p>
                        </div>
                        <button
                          className="button button-primary"
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              objectives: [
                                ...current.objectives,
                                makeObjectiveDraft(),
                              ],
                            }))
                          }
                          type="button"
                        >
                          + Add Objective
                        </button>
                      </div>
                      {draft.objectives.map((objective, objectiveIndex) => (
                        <section className="card planning-objective" key={objective.id}>
                          <div className="section-heading">
                            <div>
                              <p className="eyebrow">
                                OBJECTIVE {objectiveIndex + 1}
                              </p>
                              <h2>{objective.title.trim() || "New Objective"}</h2>
                            </div>
                            {draft.objectives.length > 1 && (
                              <button
                                aria-label={`Remove Objective ${objectiveIndex + 1}`}
                                className="icon-button remove-button"
                                onClick={() =>
                                  setDraft((current) => ({
                                    ...current,
                                    objectives: current.objectives.filter(
                                      (item) => item.id !== objective.id,
                                    ),
                                  }))
                                }
                                type="button"
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <div className="form-grid">
                            <label className="field">
                              <span>Objective title</span>
                              <input
                                onChange={(event) =>
                                  changeObjective(objective.id, {
                                    title: event.target.value,
                                  })
                                }
                                placeholder="What outcome do you want to achieve?"
                                required
                                value={objective.title}
                              />
                            </label>
                            <label className="field">
                              <span>Owner</span>
                              <select
                                required
                                onChange={(event) =>
                                  changeObjective(objective.id, {
                                    ownerId: event.target.value,
                                  })
                                }
                                value={objective.ownerId}
                              >
                                <option value="">Select a user</option>
                                {activeUsers.map((user) => (
                                  <option key={user.id} value={user.id}>
                                    {user.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="field field-wide">
                              <span>Description</span>
                              <textarea
                                onChange={(event) =>
                                  changeObjective(objective.id, {
                                    description: event.target.value,
                                  })
                                }
                                placeholder="Describe the outcome"
                                required
                                rows={2}
                                value={objective.description}
                              />
                            </label>
                          </div>
                          <div className="field goal-link-field">
                            <span>Cycle priorities this Objective supports</span>
                            {draft.companyGoals.map((goal, index) => (
                              <label className="checkbox-row" key={goal.id}>
                                <input
                                  checked={objective.companyGoalIds.includes(
                                    goal.id,
                                  )}
                                  onChange={(event) =>
                                    changeObjective(objective.id, {
                                      companyGoalIds: event.target.checked
                                        ? [...objective.companyGoalIds, goal.id]
                                        : objective.companyGoalIds.filter(
                                            (id) => id !== goal.id,
                                          ),
                                    })
                                  }
                                  type="checkbox"
                                />
                                <span>
                                  {goal.title.trim() ||
                                    `Cycle priority ${index + 1}`}
                                </span>
                              </label>
                            ))}
                          </div>
                          {objective.companyGoalIds.length > 0 && (
                            <div className="planning-priority-selection">
                              <span className="field-caption">Aligned priorities</span>
                              <div className="goal-pills">
                                {draft.companyGoals
                                  .filter((goal) =>
                                    objective.companyGoalIds.includes(goal.id),
                                  )
                                  .map((goal) => (
                                    <span className="goal-pill" key={goal.id}>
                                      <b>
                                        {draft.companyGoals.indexOf(goal) + 1}
                                      </b>{" "}
                                      {goal.title.trim() || "Untitled priority"}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          )}
                          <div className="planning-key-results">
                            <div className="section-heading">
                              <div>
                                <p className="eyebrow">MEASURES</p>
                                <h3>Key Results</h3>
                                <p className="muted">
                                  At least one measurable result is required.
                                </p>
                              </div>
                            </div>
                            <div className="stack">
                              {objective.keyResults.map((keyResult, index) => (
                                <KeyResultEditor
                                  activeUsers={activeUsers}
                                  index={index}
                                  key={keyResult.id}
                                  keyResult={keyResult}
                                  onChange={(changes) =>
                                    changeKeyResult(
                                      objective.id,
                                      keyResult.id,
                                      changes,
                                    )
                                  }
                                  onRemove={() =>
                                    setDraft((current) => ({
                                      ...current,
                                      objectives: current.objectives.map(
                                        (item) =>
                                          item.id === objective.id
                                            ? {
                                                ...item,
                                                keyResults:
                                                  item.keyResults.filter(
                                                    (result) =>
                                                      result.id !== keyResult.id,
                                                  ),
                                              }
                                            : item,
                                      ),
                                    }))
                                  }
                                  removable={objective.keyResults.length > 1}
                                />
                              ))}
                            </div>
                            <button
                              className="button button-tertiary add-button"
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  objectives: current.objectives.map((item) =>
                                    item.id === objective.id
                                      ? {
                                          ...item,
                                          keyResults: [
                                            ...item.keyResults,
                                            makeKeyResultDraft(),
                                          ],
                                        }
                                      : item,
                                  ),
                                }))
                              }
                              type="button"
                            >
                              + Add Key Result
                            </button>
                          </div>
                        </section>
                      ))}
                    </section>

                    <section className="card planning-review-summary" id="planning-review">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">3 · REVIEW AND ACTIVATE</p>
                          <h2>Review the planned cycle</h2>
                          <p className="muted">
                            Activating starts this cycle and makes its
                            priorities, Objectives, and Key Results active.
                            Initiatives can be added after activation.
                          </p>
                        </div>
                      </div>
                      {planningErrors.length > 0 && (
                        <div className="notice notice-warning" role="status">
                          <strong>Complete these requirements before activation:</strong>
                          <ul>
                            {planningErrors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                          {project.users.length === 0 && (
                            <button
                              className="button button-tertiary"
                              onClick={() => setView("People")}
                              type="button"
                            >
                              Add people for assignments
                            </button>
                          )}
                        </div>
                      )}
                      <div className="planning-readonly-summary">
                        <div>
                          <h3>Cycle</h3>
                          <p>
                            {plannedStartMonth && plannedEndMonth
                              ? `${formatMonthLabel(plannedStartMonth)} – ${formatMonthLabel(plannedEndMonth)}`
                              : "Cycle dates unavailable"}{" "}
                            · {draft.cadence}
                          </p>
                          <span className="field-caption">Focus</span>
                          <p>{draft.planningFocus || "Not entered yet"}</p>
                        </div>
                        <div>
                          <h3>Cycle priorities</h3>
                          {draft.companyGoals.map((goal, index) => (
                            <p key={goal.id}>
                              <strong>{index + 1}. {goal.title || "Untitled priority"}</strong>
                              {goal.description && <span>{` — ${goal.description}`}</span>}
                            </p>
                          ))}
                        </div>
                        <div>
                          <h3>Objectives and Key Results</h3>
                          {draft.objectives.map((objective, index) => (
                            <article className="planning-summary-objective" key={objective.id}>
                              <h4>{index + 1}. {objective.title || "Untitled Objective"}</h4>
                              <p>
                                Owner:{" "}
                                {activeUsers.find((user) => user.id === objective.ownerId)?.name ??
                                  "Not assigned"}
                              </p>
                              <p>
                                Aligned priorities:{" "}
                                {draft.companyGoals
                                  .filter((goal) => objective.companyGoalIds.includes(goal.id))
                                  .map((goal) => goal.title || "Untitled priority")
                                  .join(", ") || "None"}
                              </p>
                              <ul>
                                {objective.keyResults.map((keyResult) => (
                                  <li key={keyResult.id}>
                                    <strong>{keyResult.title || "Untitled Key Result"}</strong>
                                    {" — "}
                                    {draftMetricSummary(keyResult)}
                                  </li>
                                ))}
                              </ul>
                            </article>
                          ))}
                        </div>
                      </div>
                      <div className="submit-row planning-activation-row">
                        <span className="muted">
                          {saveStatus === "saved"
                            ? "Review the summary above, then activate when the plan is ready."
                            : "Save changes successfully before activating this cycle."}
                        </span>
                        <button
                          className="button button-primary"
                          disabled={
                            planningErrors.length > 0 ||
                            isWorking ||
                            saveStatus !== "saved"
                          }
                          onClick={() => void activateCycle()}
                          type="button"
                        >
                          {isWorking ? "Activating…" : "Activate cycle"}
                        </button>
                      </div>
                    </section>
                  </>
                ) : (
                  <EmptyState
                    title="Planning draft is unavailable"
                    description="Open or create a project to prepare a cycle."
                  />
                )}
              </section>
            )}

            {view === "People" && (
              <section className="user-layout">
                <div className="card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">PROJECT PEOPLE</p>
                      <h2>Users</h2>
                    </div>
                    <span className="counter">{project.users.length}</span>
                  </div>
                  {project.users.length === 0 ? (
                    <p className="empty-inline">
                      No users yet. Add at least one user to assign as an
                      Objective and Key Result owner.
                    </p>
                  ) : (
                    <div className="user-list">
                      {project.users.map((user) => (
                        <div className="user-row" key={user.id}>
                          <UserAvatar user={user} />
                          <div className="user-details">
                            <strong>{user.name}</strong>
                            <span>{user.email}</span>
                          </div>
                          <span
                            className={
                              user.active ? "status-tag active" : "status-tag"
                            }
                          >
                            {user.active ? "Active" : "Inactive"}
                          </span>
                          <button
                            className="button button-tertiary"
                            onClick={() => beginUserEdit(user)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="icon-button remove-button"
                            onClick={() => void removeUser(user)}
                            type="button"
                            aria-label={`Delete ${user.name}`}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <form className="card user-form" onSubmit={saveUser}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">
                        {editingUserId ? "EDIT USER" : "NEW PERSON"}
                      </p>
                      <h2>{editingUserId ? "Update user" : "Add a user"}</h2>
                    </div>
                  </div>
                  <label className="field">
                    <span>Name</span>
                    <input
                      onChange={(event) => setUserName(event.target.value)}
                      required
                      value={userName}
                    />
                  </label>
                  <label className="field">
                    <span>Email</span>
                    <input
                      onChange={(event) => setUserEmail(event.target.value)}
                      required
                      type="email"
                      value={userEmail}
                    />
                  </label>
                  <label className="checkbox-row active-check">
                    <input
                      checked={userActive}
                      onChange={(event) => setUserActive(event.target.checked)}
                      type="checkbox"
                    />
                    <span>Active and available for new assignments</span>
                  </label>
                  <div className="button-row">
                    <button
                      className="button button-primary"
                      disabled={isWorking}
                      type="submit"
                    >
                      {editingUserId ? "Save changes" : "Add user"}
                    </button>
                    {editingUserId && (
                      <button
                        className="button button-secondary"
                        onClick={resetUserForm}
                        type="button"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </section>
            )}

            {view === "Review" && (
              <Review
                draft={project.reviewDraft}
                onDraftChange={changeReviewDraft}
                onSubmit={() => void submitReview()}
                project={project}
                working={isWorking}
                canSubmit={saveStatus === "saved"}
              />
            )}

            {view === "History" && <History project={project} />}

            {view === "Publishing" && (
              <Publishing
                busy={publishBusy}
                error={publishError}
                settingsLoading={publishSettingsLoading}
                onChooseFolder={() => void choosePublishFolder()}
                onPublish={() => void publishViewer(false)}
                onPublishAndPush={() => void publishViewer(true)}
                onSaveSettings={() => void savePublishSettingsFromUi()}
                onSettingsChange={changePublishSettings}
                result={publishResult}
                saveStatus={saveStatus}
                settings={publishSettings}
              />
            )}
          </>
        )}
      </main>

      {createFormOpen && (
        <div className="modal-backdrop" role="presentation">
          <form
            aria-labelledby="create-project-title"
            className="modal-card"
            onSubmit={createNewProject}
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">NEW WORKSPACE</p>
                <h2 id="create-project-title">Create a project</h2>
              </div>
              <button
                aria-label="Close"
                className="icon-button"
                onClick={() => setCreateFormOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <p className="muted">
              Choose a name and short description. Safari will then open a
              native dialog to choose where to save your project.json file.
            </p>
            <label className="field">
              <span>Project name</span>
              <input
                autoFocus
                onChange={(event) => setProjectName(event.target.value)}
                required
                value={projectName}
              />
            </label>
            <label className="field optional-field">
              <span>Description</span>
              <textarea
                onChange={(event) => setProjectDescription(event.target.value)}
                rows={3}
                value={projectDescription}
              />
            </label>
            <div className="button-row modal-actions">
              <button
                className="button button-secondary"
                onClick={() => setCreateFormOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={isWorking}
                type="submit"
              >
                {isWorking ? "Choose file…" : "Choose project file"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
    </UserColorsContext.Provider>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}

function formatMonthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function draftMetricSummary(keyResult: KeyResultDraft): string {
  if (keyResult.metricType === "yes_no") {
    return `Measure Yes / No · Current ${keyResult.yesNoValue ? "Yes" : "No"} · Target Yes`;
  }
  const suffix = keyResult.metricType === "percentage_target" ? "%" : "";
  return `Start ${keyResult.startValue}${suffix} · Current ${keyResult.currentValue}${suffix} · Target ${
    keyResult.targetValue === null ? "not set" : `${keyResult.targetValue}${suffix}`
  }`;
}

function SaveIndicator({
  status,
  onSaveNow,
}: {
  status: SaveStatus;
  onSaveNow: () => void;
}) {
  const labels: Record<SaveStatus, string> = {
    saved: "Saved",
    pending: "Changes pending",
    saving: "Saving…",
    failed: "Save failed",
  };
  return (
    <div className={`save-state ${status}`}>
      <span className="save-indicator" role="status">
        <span className="save-dot" />
        {labels[status]}
      </span>
      {status !== "saved" && status !== "saving" && (
        <button className="button button-tertiary" onClick={onSaveNow} type="button">
          {status === "failed" ? "Retry save" : "Save now"}
        </button>
      )}
    </div>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="card empty-state">
      <div className="empty-state-mark">○</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

function KeyResultEditor({
  activeUsers,
  index,
  keyResult,
  onChange,
  onRemove,
  removable,
}: {
  activeUsers: User[];
  index: number;
  keyResult: KeyResultDraft;
  onChange: (changes: Partial<KeyResultDraft>) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const changeType = (metricType: KeyResultDraft["metricType"]) => {
    onChange({
      metricType,
      startValue: 0,
      currentValue: 0,
      targetValue: null,
      yesNoValue: false,
    });
  };

  return (
    <div className="key-result-editor">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">KEY RESULT {index + 1}</p>
          <h3>Measure progress</h3>
        </div>
        {removable && (
          <button
            aria-label={`Remove Key Result ${index + 1}`}
            className="icon-button remove-button"
            onClick={onRemove}
            type="button"
          >
            ×
          </button>
        )}
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Title</span>
          <input
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="How will you measure success?"
            value={keyResult.title}
          />
        </label>
        <label className="field">
          <span>Owner</span>
          <select
            onChange={(event) => onChange({ ownerId: event.target.value })}
            value={keyResult.ownerId}
          >
            <option value="">Select a user</option>
            {activeUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-wide">
          <span>Description (optional)</span>
          <input
            onChange={(event) => onChange({ description: event.target.value })}
            placeholder="Optional context beyond the title and metric"
            value={keyResult.description}
          />
        </label>
        <label className="field">
          <span>Metric type</span>
          <select
            onChange={(event) =>
              changeType(event.target.value as KeyResultDraft["metricType"])
            }
            value={keyResult.metricType}
          >
            <option value="number_target">Number target</option>
            <option value="percentage_target">Percentage target</option>
            <option value="yes_no">Yes / No</option>
          </select>
        </label>
      </div>
      {keyResult.metricType === "yes_no" ? (
        <div className="form-grid metric-endpoints">
          <p className="metric-caption">
            Starting value: <strong>No</strong> · Target value: <strong>Yes</strong>
          </p>
          <label className="field">
            <span>Current value</span>
            <select
              onChange={(event) =>
                onChange({ yesNoValue: event.target.value === "yes" })
              }
              value={keyResult.yesNoValue ? "yes" : "no"}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="metric-grid">
          <NumberField
            label={keyResult.metricType === "number_target" ? "Start value" : "Start (%)"}
            onChange={(value) =>
              onChange({
                startValue: value === "" ? 0 : Number(value),
              })
            }
            value={String(keyResult.startValue)}
          />
          <NumberField
            label={keyResult.metricType === "number_target" ? "Current value" : "Current (%)"}
            onChange={(value) =>
              onChange({
                currentValue: value === "" ? 0 : Number(value),
              })
            }
            value={String(keyResult.currentValue)}
          />
          <NumberField
            label={keyResult.metricType === "number_target" ? "Target value" : "Target (%)"}
            onChange={(value) =>
              onChange({
                targetValue: value === "" ? null : Number(value),
              })
            }
            value={keyResult.targetValue === null ? "" : String(keyResult.targetValue)}
          />
        </div>
      )}
      <DraftProgress keyResult={keyResult} />
    </div>
  );
}

function NumberField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    </label>
  );
}

function DraftProgress({ keyResult }: { keyResult: KeyResultDraft }) {
  let progress: number | null = null;
  let error = "";
  try {
    if (keyResult.metricType === "yes_no") {
      progress = calculateKeyResultProgress({
        id: keyResult.id,
        objectiveId: "",
        title: keyResult.title,
        description: keyResult.description,
        ownerId: keyResult.ownerId,
        metricType: "yes_no",
        value: keyResult.yesNoValue,
      });
    } else if (keyResult.targetValue === null) {
      error = keyResult.metricType === "number_target"
        ? "Enter a target value."
        : "Enter a target percentage.";
    } else {
      progress = calculateKeyResultProgress({
        id: keyResult.id,
        objectiveId: "",
        title: keyResult.title,
        description: keyResult.description,
        ownerId: keyResult.ownerId,
        metricType: keyResult.metricType,
        startValue: keyResult.startValue,
        currentValue: keyResult.currentValue,
        targetValue: keyResult.targetValue,
      });
    }
  } catch (caught) {
    error = errorText(caught);
  }

  return progress === null ? (
    <p className="field-error">{error || "Enter a valid target to calculate progress."}</p>
  ) : (
    <ProgressBar label="Current progress" progress={progress} />
  );
}

function ProgressBar({
  label,
  progress,
  compact = false,
}: {
  label: string;
  progress: number;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "progress-wrap compact" : "progress-wrap"}>
      <div className="progress-label">
        <span>{label}</span>
        <ProgressBadge progress={progress} />
      </div>
      <div
        aria-label={`${progress}% progress`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="progress-track progress-neutral"
        role="progressbar"
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
