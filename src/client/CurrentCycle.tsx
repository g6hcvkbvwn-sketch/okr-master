import { useMemo, useState, type FormEvent } from "react";
import {
  calculateKeyResultProgress,
  calculateObjectiveProgress,
} from "../domain/progress";
import { statusAfterInitiativeProgressChange } from "../domain/project";
import { getNextCycleMilestone } from "../domain/cycles";
import {
  EMPTY_INITIATIVE_FILTER,
  filterInitiatives,
  type InitiativeFilter,
} from "../domain/initiative-filters";
import { api } from "./api";
import { CycleTimeline } from "./CycleTimeline";
import { InitiativeFiltersBar } from "./InitiativeFiltersBar";
import { OwnerBadge } from "./OwnerBadge";
import { ProgressBadge } from "./ProgressBadge";
import { ProgressBar } from "./ProgressBar";
import type {
  ActiveKeyResultInput,
  ActiveObjectiveUpdate,
  InitiativeInput,
} from "../shared/schemas";
import type {
  Initiative,
  InitiativeTask,
  KeyResult,
  Project,
  User,
} from "../shared/types";

type SaveMutation = (operation: () => Promise<Project>) => Promise<Project>;

interface CurrentCycleProps {
  project: Project;
  activeUsers: User[];
  onSave: SaveMutation;
  initialView?: "okr" | "initiatives";
}

interface KeyResultFormState {
  title: string;
  description: string;
  ownerId: string;
  metricType: KeyResult["metricType"];
  startValue: string;
  currentValue: string;
  targetValue: string;
  yesNoValue: boolean;
}

interface InitiativeFormState {
  keyResultId: string;
  title: string;
  description: string;
  ownerId: string;
  collaboratorIds: string[];
  priority: string;
  targetDate: string;
  status: Initiative["status"];
  progress: string;
  tasks: InitiativeTask[];
  syncProgressToTasks: boolean;
}

const INITIATIVE_STATUSES: Initiative["status"][] = [
  "todo",
  "in_progress",
  "blocked",
  "done",
];

function newInitiativeTask(): InitiativeTask {
  return { id: crypto.randomUUID(), text: "", completed: false };
}

function emptyKeyResult(): KeyResultFormState {
  return {
    title: "",
    description: "",
    ownerId: "",
    metricType: "number_target",
    startValue: "0",
    currentValue: "0",
    targetValue: "",
    yesNoValue: false,
  };
}

function emptyInitiative(
  keyResultId: string,
  status: Initiative["status"] = "todo",
): InitiativeFormState {
  return {
    keyResultId,
    title: "",
    description: "",
    ownerId: "",
    collaboratorIds: [],
    priority: "2",
    targetDate: "",
    status,
    progress: status === "done" ? "100" : "0",
    tasks: [newInitiativeTask()],
    syncProgressToTasks: false,
  };
}

function keyResultInput(state: KeyResultFormState): ActiveKeyResultInput {
  const base = {
    title: state.title,
    description: state.description,
    ownerId: state.ownerId,
  };
  if (state.metricType === "yes_no") {
    return { ...base, metricType: "yes_no", value: state.yesNoValue };
  }
  return {
    ...base,
    metricType: state.metricType,
    startValue: Number(state.startValue),
    currentValue: Number(state.currentValue),
    targetValue: Number(state.targetValue),
  };
}

function initiativeInput(state: InitiativeFormState): InitiativeInput {
  return {
    keyResultId: state.keyResultId,
    title: state.title,
    description: state.description,
    ownerId: state.ownerId,
    collaboratorIds: state.collaboratorIds,
    priority: Number(state.priority) as 1 | 2 | 3,
    targetDate: state.targetDate,
    status: state.status,
    progress: state.status === "done" ? 100 : Number(state.progress),
    tasks: state.tasks.filter((task) => task.text.trim().length > 0),
    syncProgressToTasks: state.syncProgressToTasks,
  };
}

export function CurrentCycle({ project, activeUsers, onSave, initialView = "okr" }: CurrentCycleProps) {
  const cycle = project.cycles.find(
    (candidate) =>
      candidate.id === project.currentCycleId && candidate.status === "active",
  );
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
    const activeObjectiveIds = new Set(objectives.map((objective) => objective.id));
    return new Set(
      project.keyResults
        .filter((keyResult) => activeObjectiveIds.has(keyResult.objectiveId))
        .map((keyResult) => keyResult.id),
    );
  }, [objectives, project.keyResults]);
  const activeInitiatives = useMemo(
    () =>
      project.initiatives.filter((initiative) =>
        activeKeyResultIds.has(initiative.keyResultId),
      ),
    [activeKeyResultIds, project.initiatives],
  );

  const [cycleView, setCycleView] = useState<"okr" | "initiatives">(initialView);
  const [initiativeFilter, setInitiativeFilter] = useState<InitiativeFilter>({
    ...EMPTY_INITIATIVE_FILTER,
  });
  const [addingBoardInitiative, setAddingBoardInitiative] = useState(false);
  const [addingObjective, setAddingObjective] = useState(false);
  const [objectiveEditId, setObjectiveEditId] = useState<string | null>(null);
  const [addingKeyResultTo, setAddingKeyResultTo] = useState<string | null>(null);
  const [keyResultEditId, setKeyResultEditId] = useState<string | null>(null);
  const [addingInitiativeTo, setAddingInitiativeTo] = useState<string | null>(
    null,
  );
  const [newInitiativeStatus, setNewInitiativeStatus] =
    useState<Initiative["status"]>("todo");
  const [initiativeEditId, setInitiativeEditId] = useState<string | null>(null);
  const [boardEdit, setBoardEdit] = useState<{
    initiativeId: string;
    initial: InitiativeFormState;
  } | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const filteredInitiatives = useMemo(
    () => filterInitiatives(activeInitiatives, project.keyResults, initiativeFilter),
    [activeInitiatives, initiativeFilter, project.keyResults],
  );

  function clearFilters() {
    setInitiativeFilter({ ...EMPTY_INITIATIVE_FILTER });
  }

  async function submit(
    event: FormEvent<HTMLFormElement>,
    operation: () => Promise<Project>,
    complete: (saved: Project) => void,
  ) {
    event.preventDefault();
    setError("");
    setWorking(true);
    try {
      const saved = await onSave(operation);
      complete(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function changeBoardStatus(
    initiative: Initiative,
    nextStatus: Initiative["status"],
  ) {
    if (initiative.status === nextStatus) return;
    if (
      (initiative.status === "done" && nextStatus !== "done") ||
      (initiative.status === "todo" &&
        nextStatus === "in_progress" &&
        !initiative.syncProgressToTasks)
    ) {
      setBoardEdit({
        initiativeId: initiative.id,
        initial: {
          keyResultId: initiative.keyResultId,
          title: initiative.title,
          description: initiative.description,
          ownerId: initiative.ownerId,
          collaboratorIds: [...initiative.collaboratorIds],
          priority: String(initiative.priority),
          targetDate: initiative.targetDate,
          status: nextStatus,
          progress: "",
          tasks: initiative.tasks.map((task) => ({ ...task })),
          syncProgressToTasks: initiative.syncProgressToTasks,
        },
      });
      setError("");
      return;
    }

    setError("");
    setWorking(true);
    try {
      await onSave(() =>
        api.updateInitiative(initiative.id, {
          keyResultId: initiative.keyResultId,
          title: initiative.title,
          description: initiative.description,
          ownerId: initiative.ownerId,
          collaboratorIds: initiative.collaboratorIds,
          priority: initiative.priority,
          targetDate: initiative.targetDate,
          status: nextStatus,
          progress: nextStatus === "done" ? 100 : initiative.progress,
          tasks: initiative.tasks,
          syncProgressToTasks: initiative.syncProgressToTasks,
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The Initiative status could not be saved.",
      );
    } finally {
      setWorking(false);
    }
  }

  if (!cycle) {
    return (
      <section className="card empty-state">
        <div className="empty-state-mark">○</div>
        <h2>No active cycle</h2>
        <p>Prepare and activate a cycle in Planning to start tracking OKRs.</p>
      </section>
    );
  }

  const nextMilestone = getNextCycleMilestone(cycle);
  return (
    <div className="stack">
      <section className="card cycle-summary">
        <div>
          <p className="eyebrow">ACTIVE CYCLE</p>
          <h2>
            {formatMonth(cycle.startMonth)} – {formatMonth(cycle.endMonth)}
          </h2>
        </div>
        <p className="cycle-next-milestone">
          Next: <strong>{nextMilestone.label}</strong> ·{" "}
          {formatDate(nextMilestone.date)}
        </p>
        <div className="cycle-timeline-details">
          <CycleTimeline cycle={cycle} />
        </div>
      </section>

      <section className="cycle-priority-strip">
        <div className="cycle-priority-heading">
          <strong>Cycle priorities</strong>
        </div>
        {goals.length > 0 ? (
          <div className="goal-pills">
            {goals.map((goal) => (
              <span className="goal-pill" key={goal.id}>
                <b>{goal.priority}</b> {goal.title}
              </span>
            ))}
          </div>
        ) : (
          <p className="empty-inline">No priorities are assigned to this cycle.</p>
        )}
      </section>

      <div className="cycle-view-toolbar">
        <div className="cycle-view-switch" role="group" aria-label="Current Cycle view">
          <button
            aria-pressed={cycleView === "okr"}
            className={cycleView === "okr" ? "selected" : ""}
            onClick={() => setCycleView("okr")}
            type="button"
          >
            OKR View
          </button>
          <button
            aria-pressed={cycleView === "initiatives"}
            className={cycleView === "initiatives" ? "selected" : ""}
            onClick={() => setCycleView("initiatives")}
            type="button"
          >
            Initiatives
          </button>
        </div>
        <button
          className="button button-primary"
          disabled={activeKeyResultIds.size === 0}
          onClick={() => {
            setCycleView("initiatives");
            setAddingBoardInitiative(true);
          }}
          type="button"
        >
          + Add Initiative
        </button>
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {cycleView === "initiatives" ? (
        <>
        {boardEdit && (
          <button
            aria-label="Close Initiative editor"
            className="initiative-board-backdrop"
            onClick={() => setBoardEdit(null)}
            type="button"
          />
        )}
        {addingBoardInitiative && (
          <section className="card board-initiative-create">
            <h3>Add Initiative</h3>
            <InitiativeForm
              activeUsers={activeUsers}
              initial={emptyInitiative("")}
              keyResults={project.keyResults.filter((result) =>
                activeKeyResultIds.has(result.id),
              )}
              objectives={objectives}
              onCancel={() => setAddingBoardInitiative(false)}
              onSubmit={(event, state) => {
                const existingIds = new Set(
                  project.initiatives.map((item) => item.id),
                );
                void submit(
                  event,
                  () => api.createInitiative(initiativeInput(state)),
                  (saved) => {
                    setAddingBoardInitiative(false);
                    clearFilters();
                    const created = saved.initiatives.find(
                      (item) => !existingIds.has(item.id),
                    );
                    if (created) scrollToNewItem(`initiative-${created.id}`);
                  },
                );
              }}
              working={working}
            />
          </section>
        )}
        <InitiativeFiltersBar
          filter={initiativeFilter}
          keyResults={project.keyResults.filter((result) =>
            activeKeyResultIds.has(result.id),
          )}
          matchingCount={filteredInitiatives.length}
          objectives={objectives}
          onClear={clearFilters}
          onFilterChange={setInitiativeFilter}
          users={project.users}
        />
        <div className="initiative-board" aria-label="Initiatives Kanban board">
          {INITIATIVE_STATUSES.map((status) => {
            const columnInitiatives = filteredInitiatives.filter(
              (initiative) => initiative.status === status,
            );
            return (
              <section
                className={`initiative-column ${status}`}
                key={status}
                aria-labelledby={`initiative-column-${status}`}
              >
                <div className="initiative-column-heading">
                  <h3 id={`initiative-column-${status}`}>
                    {statusLabel(status)}
                  </h3>
                  <span>{columnInitiatives.length}</span>
                </div>
                <div className="initiative-column-cards">
                  {columnInitiatives.map((initiative) => {
                    const linkedKeyResult = project.keyResults.find(
                      (result) => result.id === initiative.keyResultId,
                    );
                    const parentObjective = project.objectives.find(
                      (objective) =>
                        objective.id === linkedKeyResult?.objectiveId,
                    );
                    return (
                    <article
                      aria-label={
                        boardEdit?.initiativeId === initiative.id
                          ? `Edit ${initiative.title}`
                          : undefined
                      }
                      aria-modal={
                        boardEdit?.initiativeId === initiative.id
                          ? "true"
                          : undefined
                      }
                      className={
                        boardEdit?.initiativeId === initiative.id
                          ? "initiative-board-card is-editing"
                          : "initiative-board-card"
                      }
                      id={`initiative-${initiative.id}`}
                      key={initiative.id}
                      role={
                        boardEdit?.initiativeId === initiative.id
                          ? "dialog"
                          : undefined
                      }
                    >
                      <div className="initiative-board-title">
                        <strong>{initiative.title}</strong>
                        <span className="initiative-status-tag">
                          {statusLabel(initiative.status)}
                        </span>
                        <button
                          className="button button-tertiary"
                          disabled={working}
                          onClick={() =>
                            setBoardEdit((current) =>
                              current?.initiativeId === initiative.id
                                ? null
                                : {
                                    initiativeId: initiative.id,
                                    initial: {
                                      keyResultId: initiative.keyResultId,
                                      title: initiative.title,
                                      description: initiative.description,
                                      ownerId: initiative.ownerId,
                                      collaboratorIds: [
                                        ...initiative.collaboratorIds,
                                      ],
                                      priority: String(initiative.priority),
                                      targetDate: initiative.targetDate,
                                      status: initiative.status,
                                      progress: String(initiative.progress),
                                      tasks: initiative.tasks.map((task) => ({
                                        ...task,
                                      })),
                                      syncProgressToTasks:
                                        initiative.syncProgressToTasks,
                                    },
                                  },
                            )
                          }
                          type="button"
                        >
                          {boardEdit?.initiativeId === initiative.id
                            ? "Cancel"
                            : "Edit"}
                        </button>
                      </div>
                      <div className="initiative-board-meta">
                        <span>
                          Owner: {displayUser(project.users, initiative.ownerId)}
                        </span>
                        <span>Priority: {initiative.priority}</span>
                        <span>Target: {initiative.targetDate}</span>
                      </div>
                      <ProgressBar
                        label="Progress"
                        progress={initiative.progress}
                        compact
                      />
                      <details className="initiative-card-details">
                        <summary>
                          OKR & details
                          {initiative.tasks.length > 0
                            ? ` · ${initiative.tasks.length} tasks`
                            : ""}
                        </summary>
                        <dl className="initiative-linked-result">
                          <dt>Objective</dt>
                          <dd>{parentObjective?.title ?? "Unknown Objective"}</dd>
                          <dt>Key Result</dt>
                          <dd>{linkedKeyResult?.title ?? "Unknown Key Result"}</dd>
                        </dl>
                        {initiative.description && <p>{initiative.description}</p>}
                        {initiative.tasks.length > 0 && (
                          <ul
                            aria-label="Initiative tasks"
                            className="initiative-board-task-list"
                          >
                            {initiative.tasks.map((task) => (
                              <li
                                className={
                                  task.completed ? "completed" : undefined
                                }
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
                      </details>
                      <label className="field initiative-status-select">
                        <span>Move to</span>
                        <select
                          aria-label={`Move ${initiative.title} to status`}
                          disabled={
                            working ||
                            boardEdit?.initiativeId === initiative.id ||
                            (initiative.syncProgressToTasks &&
                              initiative.status === "done")
                          }
                          onChange={(event) =>
                            void changeBoardStatus(
                              initiative,
                              event.target.value as Initiative["status"],
                            )
                          }
                          value={
                            boardEdit?.initiativeId === initiative.id
                              ? boardEdit.initial.status
                              : initiative.status
                          }
                        >
                          {INITIATIVE_STATUSES.map((option) => (
                            <option key={option} value={option}>
                              {statusLabel(option)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {boardEdit?.initiativeId === initiative.id && (
                        <InitiativeForm
                          activeUsers={activeUsers}
                          initial={boardEdit.initial}
                          onCancel={() => setBoardEdit(null)}
                          onSubmit={(event, state) =>
                            void submit(
                              event,
                              () =>
                                api.updateInitiative(
                                  initiative.id,
                                  initiativeInput(state),
                                ),
                              () => setBoardEdit(null),
                            )
                          }
                          working={working}
                        />
                      )}
                    </article>
                    );
                  })}
                  {columnInitiatives.length === 0 && (
                    <p className="initiative-column-empty">
                      {Object.values(initiativeFilter).some(Boolean)
                        ? "No initiatives match these filters in this status."
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
      ) : (
        <>
      <div className="section-heading objectives-heading">
        <div>
          <p className="eyebrow">OUTCOMES & MEASURES</p>
          <h2>Objectives</h2>
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setAddingObjective(true);
            setObjectiveEditId(null);
          }}
          type="button"
        >
          + Add Objective
        </button>
      </div>

      {addingObjective && (
        <NewObjectiveForm
          activeUsers={activeUsers}
          goals={goals}
          onCancel={() => setAddingObjective(false)}
          onSubmit={(event, input) => {
            const existingIds = new Set(
              project.objectives.map((item) => item.id),
            );
            void submit(
              event,
              () => api.createObjective(input),
              (saved) => {
                setAddingObjective(false);
                const created = saved.objectives.find(
                  (item) => !existingIds.has(item.id),
                );
                if (created) scrollToNewItem(`objective-${created.id}`);
              },
            );
          }}
          working={working}
        />
      )}

      {objectives.length === 0 && !addingObjective ? (
        <section className="card empty-state">
          <div className="empty-state-mark">◎</div>
          <h2>No Objectives yet</h2>
          <p>Add an Objective and at least one Key Result to this active cycle.</p>
        </section>
      ) : (
        objectives.map((objective) => {
          const keyResults = project.keyResults.filter(
            (keyResult) => keyResult.objectiveId === objective.id,
          );
          const linkedGoals = goals.filter((goal) =>
            objective.companyGoalIds.includes(goal.id),
          );
          const editingObjective = objectiveEditId === objective.id;
          return (
            <details
              className="card hierarchy-objective"
              id={`objective-${objective.id}`}
              key={objective.id}
              open
            >
              <summary className="hierarchy-summary">
                <span className="disclosure-chevron" aria-hidden="true" />
                <span className="hierarchy-title">
                  <span className="eyebrow">OBJECTIVE</span>
                  <strong>{objective.title}</strong>
                </span>
                <OwnerBadge
                  user={{
                    id: objective.ownerId,
                    name: displayUser(project.users, objective.ownerId),
                  }}
                />
                <ProgressBadge
                  className="objective-progress"
                  progress={objectiveProgress(keyResults)}
                />
              </summary>

              <div className="hierarchy-body">
                {objective.description && (
                  <p className="objective-description-text">{objective.description}</p>
                )}
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
                  progress={objectiveProgress(keyResults)}
                  showLabel={false}
                />

                <div className="hierarchy-actions">
                  <button
                    className="button button-tertiary"
                    onClick={() => {
                      setObjectiveEditId(editingObjective ? null : objective.id);
                      setAddingObjective(false);
                    }}
                    type="button"
                  >
                    {editingObjective ? "Cancel edit" : "Edit Objective"}
                  </button>
                  <button
                    className="button button-secondary"
                    onClick={() => setAddingKeyResultTo(objective.id)}
                    type="button"
                  >
                    + Add Key Result
                  </button>
                </div>

                {editingObjective && (
                  <ObjectiveEditForm
                    activeUsers={activeUsers}
                    goals={goals}
                    objective={objective}
                    onCancel={() => setObjectiveEditId(null)}
                    onSubmit={(event, input) =>
                      void submit(
                        event,
                        () => api.updateObjective(objective.id, input),
                        () => setObjectiveEditId(null),
                      )
                    }
                    working={working}
                  />
                )}

                {addingKeyResultTo === objective.id && (
                  <NewKeyResultForm
                    activeUsers={activeUsers}
                    onCancel={() => setAddingKeyResultTo(null)}
                    onSubmit={(event, input) => {
                      const existingIds = new Set(
                        project.keyResults.map((item) => item.id),
                      );
                      void submit(
                        event,
                        () => api.createKeyResult(objective.id, input),
                        (saved) => {
                          setAddingKeyResultTo(null);
                          const created = saved.keyResults.find(
                            (item) =>
                              !existingIds.has(item.id) &&
                              item.objectiveId === objective.id,
                          );
                          if (created) scrollToNewItem(`key-result-${created.id}`);
                        },
                      );
                    }}
                    working={working}
                  />
                )}

                <div className="hierarchy-children">
                  {keyResults.map((keyResult) => {
                    const initiatives = project.initiatives.filter(
                      (initiative) => initiative.keyResultId === keyResult.id,
                    );
                    return (
                      <KeyResultNode
                        activeUsers={activeUsers}
                        key={keyResult.id}
                        keyResult={keyResult}
                        initiatives={initiatives}
                        keyResultEditing={keyResultEditId === keyResult.id}
                        initiativeEditingId={initiativeEditId}
                        addingInitiative={addingInitiativeTo === keyResult.id}
                        onAddInitiative={() => {
                          setAddingInitiativeTo(keyResult.id);
                          setInitiativeEditId(null);
                          setNewInitiativeStatus("todo");
                        }}
                        onEditInitiative={setInitiativeEditId}
                        onEditKeyResult={() =>
                          setKeyResultEditId(
                            keyResultEditId === keyResult.id
                              ? null
                              : keyResult.id,
                          )
                        }
                        onSave={submit}
                        onSetAddingInitiative={setAddingInitiativeTo}
                        onSetError={setError}
                        onSetWorking={setWorking}
                        newInitiativeStatus={newInitiativeStatus}
                        project={project}
                        working={working}
                      />
                    );
                  })}
                </div>
              </div>
            </details>
          );
        })
      )}
        </>
      )}
    </div>
  );
}

function NewObjectiveForm({
  activeUsers,
  goals,
  onCancel,
  onSubmit,
  working,
}: {
  activeUsers: User[];
  goals: Project["companyGoals"];
  onCancel: () => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: Parameters<typeof api.createObjective>[0],
  ) => void;
  working: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [companyGoalIds, setCompanyGoalIds] = useState<string[]>([]);
  const [keyResult, setKeyResult] = useState(emptyKeyResult);

  return (
    <form
      className="card active-edit-form"
      onSubmit={(event) =>
        onSubmit(event, {
          title,
          description,
          ownerId,
          companyGoalIds,
          keyResults: [keyResultInput(keyResult)],
        })
      }
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">NEW ACTIVE-CYCLE OUTCOME</p>
          <h3>Create Objective</h3>
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Objective title</span>
          <input onChange={(event) => setTitle(event.target.value)} required value={title} />
        </label>
        <UserSelect
          activeUsers={activeUsers}
          label="Objective owner"
          onChange={setOwnerId}
          value={ownerId}
        />
        <label className="field field-wide">
          <span>Description</span>
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={2}
            value={description}
          />
        </label>
      </div>
      <GoalCheckboxes
        goals={goals}
        selectedIds={companyGoalIds}
        onChange={setCompanyGoalIds}
      />
      <KeyResultFields
        activeUsers={activeUsers}
        state={keyResult}
        onChange={setKeyResult}
      />
      <FormActions
        hasUnsavedInput={Boolean(
          title.trim() ||
            description.trim() ||
            ownerId ||
            companyGoalIds.length ||
            JSON.stringify(keyResult) !== JSON.stringify(emptyKeyResult()),
        )}
        onCancel={onCancel}
        working={working}
        submitLabel="Create Objective"
      />
    </form>
  );
}

function ObjectiveEditForm({
  activeUsers,
  goals,
  objective,
  onCancel,
  onSubmit,
  working,
}: {
  activeUsers: User[];
  goals: Project["companyGoals"];
  objective: Project["objectives"][number];
  onCancel: () => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: ActiveObjectiveUpdate,
  ) => void;
  working: boolean;
}) {
  const [title, setTitle] = useState(objective.title);
  const [description, setDescription] = useState(objective.description);
  const [ownerId, setOwnerId] = useState(objective.ownerId);
  const [companyGoalIds, setCompanyGoalIds] = useState(
    objective.companyGoalIds,
  );

  return (
    <form
      className="active-edit-form inset-form"
      onSubmit={(event) =>
        onSubmit(event, { title, description, ownerId, companyGoalIds })
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>Objective title</span>
          <input onChange={(event) => setTitle(event.target.value)} required value={title} />
        </label>
        <UserSelect
          activeUsers={activeUsers}
          label="Objective owner"
          onChange={setOwnerId}
          value={ownerId}
        />
        <label className="field field-wide">
          <span>Description</span>
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            required
            rows={2}
            value={description}
          />
        </label>
      </div>
      <GoalCheckboxes
        goals={goals}
        selectedIds={companyGoalIds}
        onChange={setCompanyGoalIds}
      />
      <FormActions
        hasUnsavedInput={
          title !== objective.title ||
          description !== objective.description ||
          ownerId !== objective.ownerId ||
          JSON.stringify(companyGoalIds) !==
            JSON.stringify(objective.companyGoalIds)
        }
        onCancel={onCancel}
        working={working}
        submitLabel="Save Objective"
      />
    </form>
  );
}

function KeyResultNode({
  activeUsers,
  keyResult,
  initiatives,
  keyResultEditing,
  initiativeEditingId,
  addingInitiative,
  onAddInitiative,
  onEditInitiative,
  onEditKeyResult,
  onSave,
  onSetAddingInitiative,
  onSetError,
  onSetWorking,
  newInitiativeStatus,
  project,
  working,
}: {
  activeUsers: User[];
  keyResult: KeyResult;
  initiatives: Initiative[];
  keyResultEditing: boolean;
  initiativeEditingId: string | null;
  addingInitiative: boolean;
  onAddInitiative: () => void;
  onEditInitiative: (id: string | null) => void;
  onEditKeyResult: () => void;
  onSave: (
    event: FormEvent<HTMLFormElement>,
    operation: () => Promise<Project>,
    complete: (saved: Project) => void,
  ) => void;
  onSetAddingInitiative: (id: string | null) => void;
  onSetError: (error: string) => void;
  onSetWorking: (working: boolean) => void;
  newInitiativeStatus: Initiative["status"];
  project: Project;
  working: boolean;
}) {
  const [keyResultError, setKeyResultError] = useState("");
  const progress = calculateKeyResultProgress(keyResult);

  async function saveInitiative(
    event: FormEvent<HTMLFormElement>,
    initiativeId: string | null,
    input: InitiativeInput,
    complete: (saved: Project) => void,
  ) {
    event.preventDefault();
    onSetError("");
    setKeyResultError("");
    onSetWorking(true);
    try {
      const operation = initiativeId
        ? () => api.updateInitiative(initiativeId, input)
        : () => api.createInitiative(input);
      const existingIds = new Set(project.initiatives.map((item) => item.id));
      await onSave(event, operation, (saved) => {
        if (!initiativeId) {
          const created = saved.initiatives.find(
            (item) => !existingIds.has(item.id),
          );
          if (created) scrollToNewItem(`initiative-${created.id}`);
        }
        complete(saved);
      });
    } catch (caught) {
      setKeyResultError(
        caught instanceof Error ? caught.message : "The Initiative could not be saved.",
      );
    } finally {
      onSetWorking(false);
    }
  }

  return (
    <details className="key-result-node" id={`key-result-${keyResult.id}`} >
      <summary className="key-result-summary">
        <span className="disclosure-chevron" aria-hidden="true" />
        <span className="key-result-name">
          <strong>{keyResult.title}</strong>
          <small className="key-result-metric">{metricSummary(keyResult)}</small>
        </span>
        <span className="key-result-summary-meta">
          <span className="key-result-initiative-count">
            {initiatives.length} {initiatives.length === 1 ? "Initiative" : "Initiatives"}
          </span>
          <OwnerBadge
            user={{
              id: keyResult.ownerId,
              name: displayUser(project.users, keyResult.ownerId),
            }}
          />
          <ProgressBadge className="progress-number" progress={progress} />
        </span>
      </summary>
      <div className="key-result-body">
        {keyResult.description && (
          <p className="key-result-description">{keyResult.description}</p>
        )}
        <ProgressBar
          label="Key Result progress"
          progress={progress}
          compact
          showLabel={false}
        />
        <div className="hierarchy-actions">
          <button className="button button-tertiary" onClick={onEditKeyResult} type="button">
            {keyResultEditing ? "Cancel edit" : "Edit Key Result"}
          </button>
          <button className="button button-secondary" onClick={onAddInitiative} type="button">
            + Add Initiative
          </button>
        </div>

        {keyResultEditing && (
          <KeyResultEditForm
            activeUsers={activeUsers}
            keyResult={keyResult}
            onCancel={onEditKeyResult}
            onSubmit={onSave}
            working={working}
          />
        )}

        {addingInitiative && (
          <InitiativeForm
            activeUsers={activeUsers}
            initial={emptyInitiative(keyResult.id, newInitiativeStatus)}
            onCancel={() => onSetAddingInitiative(null)}
            onSubmit={(event, state) =>
              void saveInitiative(event, null, initiativeInput(state), () =>
                onSetAddingInitiative(null),
              )
            }
            working={working}
          />
        )}

        {keyResultError && (
          <div className="notice notice-error" role="alert">
            {keyResultError}
          </div>
        )}

        <div className="initiative-list">
          {initiatives.map((initiative) => (
            <div
              className="initiative-row"
              id={`initiative-${initiative.id}`}
              key={initiative.id}
            >
              <div className="initiative-info">
                <span className={`initiative-status ${initiative.status}`}>
                  {statusLabel(initiative.status)}
                </span>
                <strong>{initiative.title}</strong>
                {initiative.description && <small>{initiative.description}</small>}
                <span className="initiative-meta">
                  Owner:{" "}
                  <OwnerBadge
                    user={{
                      id: initiative.ownerId,
                      name: displayUser(project.users, initiative.ownerId),
                    }}
                  />{" "}
                  · P{initiative.priority} · Due {initiative.targetDate}
                </span>
                {initiative.collaboratorIds.length > 0 && (
                  <span className="initiative-meta">
                    Collaborators:{" "}
                    {initiative.collaboratorIds.map((id, index) => (
                      <span key={id}>
                        {index > 0 ? ", " : ""}
                        <OwnerBadge
                          user={{ id, name: displayUser(project.users, id) }}
                        />
                      </span>
                    ))}
                  </span>
                )}
                <ProgressBar
                  label="Initiative progress"
                  progress={initiative.progress}
                  compact
                />
              </div>
              <button
                className="button button-tertiary"
                onClick={() =>
                  onEditInitiative(
                    initiativeEditingId === initiative.id ? null : initiative.id,
                  )
                }
                type="button"
              >
                {initiativeEditingId === initiative.id ? "Cancel" : "Edit"}
              </button>
              {initiativeEditingId === initiative.id && (
                <InitiativeForm
                  activeUsers={activeUsers}
                  initial={initiative}
                  onCancel={() => onEditInitiative(null)}
                  onSubmit={(event, state) =>
                    void saveInitiative(
                      event,
                      initiative.id,
                      initiativeInput(state),
                      () => onEditInitiative(null),
                    )
                  }
                  working={working}
                />
              )}
            </div>
          ))}
          {initiatives.length === 0 && !addingInitiative && (
            <p className="empty-inline">
              No initiatives yet. Add work to move this Key Result forward.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

function KeyResultEditForm({
  activeUsers,
  keyResult,
  onCancel,
  onSubmit,
  working,
}: {
  activeUsers: User[];
  keyResult: KeyResult;
  onCancel: () => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    operation: () => Promise<Project>,
    complete: (saved: Project) => void,
  ) => void;
  working: boolean;
}) {
  const [initialState] = useState<KeyResultFormState>(() => ({
    title: keyResult.title,
    description: keyResult.description,
    ownerId: keyResult.ownerId,
    metricType: keyResult.metricType,
    startValue:
      keyResult.metricType === "yes_no" ? "0" : String(keyResult.startValue),
    currentValue:
      keyResult.metricType === "yes_no"
        ? ""
        : String(keyResult.currentValue),
    targetValue:
      keyResult.metricType === "yes_no" ? "" : String(keyResult.targetValue),
    yesNoValue: keyResult.metricType === "yes_no" ? keyResult.value : false,
  }));
  const [state, setState] = useState(initialState);

  return (
    <KeyResultForm
      activeUsers={activeUsers}
      initialState={initialState}
      onCancel={onCancel}
      onSubmit={(event) =>
        onSubmit(
          event,
          () => api.updateKeyResult(keyResult.id, keyResultInput(state)),
          onCancel,
        )
      }
      state={state}
      setState={setState}
      submitLabel="Save Key Result"
      title="Edit Key Result"
      working={working}
    />
  );
}

function NewKeyResultForm({
  activeUsers,
  onCancel,
  onSubmit,
  working,
}: {
  activeUsers: User[];
  onCancel: () => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    input: ActiveKeyResultInput,
  ) => void;
  working: boolean;
}) {
  const [initialState] = useState(emptyKeyResult);
  const [state, setState] = useState(initialState);
  return (
    <KeyResultForm
      activeUsers={activeUsers}
      initialState={initialState}
      onCancel={onCancel}
      onSubmit={(event) => onSubmit(event, keyResultInput(state))}
      state={state}
      setState={setState}
      submitLabel="Add Key Result"
      title="New Key Result"
      working={working}
    />
  );
}

function KeyResultForm({
  activeUsers,
  initialState,
  onCancel,
  onSubmit,
  state,
  setState,
  submitLabel,
  title,
  working,
}: {
  activeUsers: User[];
  initialState: KeyResultFormState;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  state: KeyResultFormState;
  setState: (state: KeyResultFormState) => void;
  submitLabel: string;
  title: string;
  working: boolean;
}) {
  return (
    <form
      className="active-edit-form inset-form"
      onSubmit={onSubmit}
    >
      <p className="eyebrow">{title.toUpperCase()}</p>
      <KeyResultFields
        activeUsers={activeUsers}
        state={state}
        onChange={setState}
      />
      <FormActions
        hasUnsavedInput={JSON.stringify(state) !== JSON.stringify(initialState)}
        onCancel={onCancel}
        working={working}
        submitLabel={submitLabel}
      />
    </form>
  );
}

function KeyResultFields({
  activeUsers,
  state,
  onChange,
}: {
  activeUsers: User[];
  state: KeyResultFormState;
  onChange: (state: KeyResultFormState) => void;
}) {
  function change<K extends keyof KeyResultFormState>(
    field: K,
    value: KeyResultFormState[K],
  ) {
    onChange({ ...state, [field]: value });
  }
  return (
    <>
      <div className="form-grid">
        <label className="field">
          <span>Key Result title</span>
          <input
            onChange={(event) => change("title", event.target.value)}
            required
            value={state.title}
          />
        </label>
        <UserSelect
          activeUsers={activeUsers}
          label="Key Result owner"
          onChange={(value) => change("ownerId", value)}
          value={state.ownerId}
        />
        <label className="field field-wide">
          <span>Description (optional)</span>
          <input
            onChange={(event) => change("description", event.target.value)}
            value={state.description}
          />
        </label>
        <p className="metric-caption key-result-description-guidance">
          Add context only when the title and metric need clarification, such as
          the data source or measurement scope.
        </p>
        <label className="field">
          <span>Metric type</span>
          <select
            onChange={(event) => {
              const metricType = event.target.value as KeyResult["metricType"];
              onChange({
                ...state,
                metricType,
                startValue: "0",
                currentValue: metricType === "yes_no" ? "" : "0",
                targetValue: "",
                yesNoValue: false,
              });
            }}
            value={state.metricType}
          >
            <option value="number_target">Number target</option>
            <option value="percentage_target">Percentage target</option>
            <option value="yes_no">Yes / No</option>
          </select>
        </label>
      </div>
      {state.metricType === "yes_no" ? (
        <div className="form-grid metric-endpoints">
          <p className="metric-caption">
            Starting value: <strong>No</strong> · Target value: <strong>Yes</strong>
          </p>
          <label className="field">
            <span>Current value</span>
            <select
              onChange={(event) =>
                change("yesNoValue", event.target.value === "yes")
              }
              value={state.yesNoValue ? "yes" : "no"}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="metric-grid">
          <NumberField
            label={
              state.metricType === "number_target" ? "Start value" : "Start (%)"
            }
            onChange={(value) => change("startValue", value)}
            value={state.startValue}
          />
          <NumberField
            label={
              state.metricType === "number_target"
                ? "Current value"
                : "Current (%)"
            }
            onChange={(value) => change("currentValue", value)}
            value={state.currentValue}
          />
          <NumberField
            label={
              state.metricType === "number_target"
                ? "Target value"
                : "Target (%)"
            }
            onChange={(value) => change("targetValue", value)}
            value={state.targetValue}
          />
        </div>
      )}
      <p className="metric-caption">
        {state.metricType === "number_target"
          ? "Example: customer wait time falls from 10 to 5 days. Progress is measured from start toward target, whether the target rises or falls."
          : state.metricType === "percentage_target"
            ? "Example: conversion rises from 20% to 35%. Progress is measured from start toward target, including targets that decrease."
            : "Choose Yes when the measurable outcome is achieved."}
      </p>
      <ProgressPreview state={state} />
    </>
  );
}

function InitiativeForm({
  activeUsers,
  initial,
  keyResults,
  objectives,
  onCancel,
  onSubmit,
  working,
}: {
  activeUsers: User[];
  initial: Initiative | InitiativeFormState;
  keyResults?: KeyResult[];
  objectives?: Project["objectives"];
  onCancel: () => void;
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    state: InitiativeFormState,
  ) => void;
  working: boolean;
}) {
  const [originalState] = useState<InitiativeFormState>(() => ({
    keyResultId: initial.keyResultId,
    title: initial.title,
    description: initial.description,
    ownerId: initial.ownerId,
    collaboratorIds: [...initial.collaboratorIds],
    priority: String(initial.priority),
    targetDate: initial.targetDate,
    status: initial.status,
    progress: String(initial.progress),
    tasks:
      initial.tasks.length > 0
        ? initial.tasks.map((task) => ({ ...task }))
        : [newInitiativeTask()],
    syncProgressToTasks: initial.syncProgressToTasks,
  }));
  const [state, setState] = useState(originalState);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState("");

  function update<K extends keyof InitiativeFormState>(
    field: K,
    value: InitiativeFormState[K],
  ) {
    if (field === "progress") {
      const progress = String(value);
      setState((current) => {
        if (
          current.syncProgressToTasks &&
          current.tasks.some((task) => task.text.trim())
        ) {
          return current;
        }
        if (progress === "") return { ...current, progress };
        const progressValue = Number(progress);
        if (
          !Number.isInteger(progressValue) ||
          progressValue < 0 ||
          progressValue > 100
        ) {
          return { ...current, progress };
        }
        return {
          ...current,
          progress,
          status: statusAfterInitiativeProgressChange(
            current.status,
            progressValue,
          ),
        };
      });
      return;
    }
    setState((current) => ({ ...current, [field]: value }));
  }

  function applyTaskListProgress(
    current: InitiativeFormState,
    tasks: InitiativeTask[],
  ): InitiativeFormState {
    const definedTasks = tasks.filter((task) => task.text.trim().length > 0);
    if (!current.syncProgressToTasks || definedTasks.length === 0) {
      return { ...current, tasks };
    }
    const progress = Math.round(
      (definedTasks.filter((task) => task.completed).length /
        definedTasks.length) *
        100,
    );
    return {
      ...current,
      tasks,
      progress: String(progress),
      status:
        progress === 100
          ? "done"
          : current.status === "done" ||
              (current.status === "todo" && progress > 0)
            ? "in_progress"
            : current.status,
    };
  }

  function updateTasks(tasks: InitiativeTask[]) {
    setState((current) => applyTaskListProgress(current, tasks));
  }

  function toggleTaskProgressSync(syncProgressToTasks: boolean) {
    const hasDefinedTasks = state.tasks.some(
      (task) => task.text.trim().length > 0,
    );
    if (
      hasDefinedTasks &&
      !window.confirm(
        syncProgressToTasks
          ? "Progress will be automatically calculated from completed tasks and replace the manually entered progress. Continue?"
          : "Progress will no longer be automatically calculated from tasks. The current progress will be kept as the manual value. Continue?",
      )
    ) {
      return;
    }

    setState((current) => {
      const next = { ...current, syncProgressToTasks };
      return syncProgressToTasks
        ? applyTaskListProgress(next, current.tasks)
        : next;
    });
  }

  const doneProgressMismatch =
    state.status === "done" && state.progress !== "100";
  const hasOpenTasks = state.tasks.some(
    (task) => task.text.trim().length > 0 && !task.completed,
  );

  return (
    <form
      className="active-edit-form initiative-form"
      onSubmit={(event) => {
        if (doneProgressMismatch || (state.status === "done" && hasOpenTasks)) {
          event.preventDefault();
          return;
        }
        onSubmit(event, state);
      }}
    >
      <div className="form-grid">
        {objectives && (
          <label className="field">
            <span>Objective</span>
            <select
              onChange={(event) => {
                setSelectedObjectiveId(event.target.value);
                update("keyResultId", "");
              }}
              required
              value={selectedObjectiveId}
            >
              <option value="">Select an Objective</option>
              {objectives.map((objective) => (
                <option key={objective.id} value={objective.id}>
                  {objective.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {keyResults && (
          <label className="field">
            <span>Key Result</span>
            <select
              disabled={Boolean(objectives && !selectedObjectiveId)}
              onChange={(event) => update("keyResultId", event.target.value)}
              required
              value={state.keyResultId}
            >
              <option value="">Select a Key Result</option>
              {keyResults
                .filter(
                  (result) =>
                    !objectives || result.objectiveId === selectedObjectiveId,
                )
                .map((result) => (
                  <option key={result.id} value={result.id}>
                    {result.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Initiative title</span>
          <input
            onChange={(event) => update("title", event.target.value)}
            required
            value={state.title}
          />
        </label>
        <UserSelect
          activeUsers={activeUsers}
          label="Owner"
          onChange={(value) => update("ownerId", value)}
          value={state.ownerId}
        />
        <label className="field">
          <span>Priority</span>
          <select
            onChange={(event) => update("priority", event.target.value)}
            value={state.priority}
          >
            <option value="1">1 — Highest</option>
            <option value="2">2</option>
            <option value="3">3 — Lowest</option>
          </select>
        </label>
        <label className="field">
          <span>Target date</span>
          <input
            onChange={(event) => update("targetDate", event.target.value)}
            required
            type="date"
            value={state.targetDate}
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Status</span>
          <select
            onChange={(event) => {
              const nextStatus = event.target.value as Initiative["status"];
              if (nextStatus === "done") {
                update("status", nextStatus);
                update("progress", "100");
              } else if (
                state.status === "done" ||
                (state.status === "todo" && nextStatus === "in_progress")
              ) {
                update("status", nextStatus);
                update("progress", "");
              } else {
                update("status", nextStatus);
              }
            }}
            disabled={state.syncProgressToTasks && state.progress === "100"}
            value={state.status}
          >
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="blocked">Blocked</option>
            <option value="done">Done</option>
          </select>
        </label>
        <label className="field">
          <span>Progress (%)</span>
          <input
            disabled={
              state.syncProgressToTasks &&
              state.tasks.some((task) => task.text.trim())
            }
            max="100"
            min="0"
            onChange={(event) => update("progress", event.target.value)}
            required
            type="number"
            value={state.progress}
          />
        </label>
      </div>

      <details className="initiative-optional-details">
        <summary>Optional details</summary>
        <label className="field field-wide optional-field">
          <span>Description (optional)</span>
          <textarea
            onChange={(event) => update("description", event.target.value)}
            rows={2}
            value={state.description}
          />
        </label>
      <fieldset className="initiative-task-editor">
        <legend>Tasks</legend>
        <p className="muted">
          Tasks are an optional checklist. Enable synchronization to calculate
          Initiative progress from completed tasks.
        </p>
        <div className="initiative-task-list">
          {state.tasks.map((task, index) => (
            <div className="initiative-task-row" key={task.id}>
              <input
                aria-label={`Mark task ${index + 1} as done`}
                checked={task.completed}
                onChange={(event) =>
                  updateTasks(
                    state.tasks.map((item) =>
                      item.id === task.id
                        ? { ...item, completed: event.target.checked }
                        : item,
                    ),
                  )
                }
                type="checkbox"
              />
              <input
                aria-label={`Task ${index + 1}`}
                className={
                  task.completed ? "initiative-task-text completed" : "initiative-task-text"
                }
                onChange={(event) =>
                  updateTasks(
                    state.tasks.map((item) =>
                      item.id === task.id
                        ? { ...item, text: event.target.value }
                        : item,
                    ),
                  )
                }
                placeholder="Enter a task"
                value={task.text}
              />
              <div className="initiative-task-actions">
                <button
                  aria-label={`Move task ${index + 1} up`}
                  className="button button-tertiary"
                  disabled={index === 0}
                  onClick={() =>
                    updateTasks(moveTask(state.tasks, index, -1))
                  }
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={`Move task ${index + 1} down`}
                  className="button button-tertiary"
                  disabled={index === state.tasks.length - 1}
                  onClick={() =>
                    updateTasks(moveTask(state.tasks, index, 1))
                  }
                  type="button"
                >
                  ↓
                </button>
                <button
                  aria-label={`Delete task ${index + 1}`}
                  className="button task-delete-button"
                  onClick={() =>
                    updateTasks(
                      state.tasks.length === 1
                        ? [newInitiativeTask()]
                        : state.tasks.filter((item) => item.id !== task.id),
                    )
                  }
                  type="button"
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          className="button button-secondary initiative-add-task"
          onClick={() => updateTasks([...state.tasks, newInitiativeTask()])}
          type="button"
        >
          + Add Task
        </button>
        <label className="initiative-task-sync">
          <input
            checked={state.syncProgressToTasks}
            onChange={(event) =>
              toggleTaskProgressSync(event.target.checked)
            }
            type="checkbox"
          />
          <span>Sync task completion to Initiative progress</span>
        </label>
        {state.syncProgressToTasks && (
          <p className="metric-caption">
            {state.tasks.some((task) => task.text.trim())
              ? "Progress is the percentage of defined tasks completed."
              : "Add a task to calculate progress from the task list."}
          </p>
        )}
      </fieldset>

      <fieldset className="initiative-collaborators">
        <legend>Collaborators (optional)</legend>
        <div className="initiative-collaborator-list">
          {activeUsers.map((user) => (
            <label key={user.id}>
              <input
                checked={state.collaboratorIds.includes(user.id)}
                onChange={(event) =>
                  update(
                    "collaboratorIds",
                    event.target.checked
                      ? [...state.collaboratorIds, user.id]
                      : state.collaboratorIds.filter((id) => id !== user.id),
                  )
                }
                type="checkbox"
              />
              <span>{user.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      </details>
      {state.status === "done" && hasOpenTasks ? (
        <p className="field-error" role="alert">
          Complete all open tasks before moving this Initiative to Done.
        </p>
      ) : doneProgressMismatch ? (
        <p className="field-error" role="alert">
          A Done Initiative must have 100% progress. Select another status
          before saving a lower progress value.
        </p>
      ) : state.status === "done" ? (
        <p className="metric-caption">Done automatically sets progress to 100%.</p>
      ) : state.progress === "" &&
        (state.status === "in_progress" || initial.status === "done") ? (
        <p className="field-error">
          {initial.status === "todo" && state.status === "in_progress"
            ? "Enter a progress value to move a To Do Initiative into In Progress."
            : "Enter a new progress value below 100% before saving this status change."}
        </p>
      ) : null}
      <FormActions
        hasUnsavedInput={JSON.stringify(state) !== JSON.stringify(originalState)}
        onCancel={onCancel}
        working={working}
        submitLabel={initial.title ? "Save Initiative" : "Add Initiative"}
      />
    </form>
  );
}

function moveTask(
  tasks: InitiativeTask[],
  index: number,
  offset: -1 | 1,
): InitiativeTask[] {
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= tasks.length) return tasks;
  const next = [...tasks];
  [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
  return next;
}

function scrollToNewItem(id: string): void {
  window.requestAnimationFrame(() => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

function UserSelect({
  activeUsers,
  label,
  onChange,
  value,
}: {
  activeUsers: User[];
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      >
        <option value="">Select a user</option>
        {activeUsers.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function GoalCheckboxes({
  goals,
  selectedIds,
  onChange,
}: {
  goals: Project["companyGoals"];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="field goal-link-field">
      <span>Cycle priorities this Objective supports</span>
      <div className="goal-checkbox-list">
        {goals.map((goal) => (
          <label className="checkbox-row" key={goal.id}>
            <input
              checked={selectedIds.includes(goal.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selectedIds, goal.id]
                    : selectedIds.filter((id) => id !== goal.id),
                )
              }
              type="checkbox"
            />
            <span>{goal.priority}. {goal.title}</span>
          </label>
        ))}
      </div>
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
        required
        type="number"
        value={value}
      />
    </label>
  );
}

function ProgressPreview({ state }: { state: KeyResultFormState }) {
  let progress: number | null = null;
  let error = "";
  try {
    if (state.metricType === "yes_no") {
      progress = state.yesNoValue ? 100 : 0;
    } else if (state.targetValue.trim() === "") {
      error = "Enter a target to calculate progress.";
    } else {
      const startValue = Number(state.startValue);
      const currentValue = Number(state.currentValue);
      const targetValue = Number(state.targetValue);
      if (
        state.metricType === "percentage_target" &&
        [startValue, currentValue, targetValue].some(
          (value) => value < 0 || value > 100,
        )
      ) {
        error = "Percentage values must be from 0 to 100.";
      } else if (targetValue === 0 || targetValue === startValue) {
        error = "Target must be non-zero and different from the start value.";
      } else {
        progress = Math.round(
          Math.min(
            100,
            Math.max(
              0,
              ((currentValue - startValue) / (targetValue - startValue)) * 100,
            ),
          ),
        );
      }
    }
  } catch {
    error = "Enter valid metric values.";
  }
  return progress === null ? (
    <p className="field-error">{error}</p>
  ) : (
    <ProgressBar label="Calculated Key Result progress" progress={progress} compact />
  );
}

function FormActions({
  hasUnsavedInput = false,
  onCancel,
  submitLabel,
  working,
}: {
  hasUnsavedInput?: boolean;
  onCancel: () => void;
  submitLabel: string;
  working: boolean;
}) {
  return (
    <div className="button-row form-actions">
      <button className="button button-primary" disabled={working} type="submit">
        {working ? "Saving…" : submitLabel}
      </button>
      <button
        className="button button-secondary"
        disabled={working}
        onClick={() => {
          if (
            hasUnsavedInput &&
            !window.confirm("Discard this form? Any unsaved input will be lost.")
          ) {
            return;
          }
          onCancel();
        }}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}

function objectiveProgress(keyResults: KeyResult[]): number {
  try {
    return calculateObjectiveProgress(keyResults);
  } catch {
    return 0;
  }
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function displayUser(users: User[], id: string): string {
  return users.find((user) => user.id === id)?.name ?? "Unknown user";
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function statusLabel(status: Initiative["status"]): string {
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

function metricSummary(keyResult: KeyResult): string {
  switch (keyResult.metricType) {
    case "number_target":
      return `Start ${keyResult.startValue} · Current ${keyResult.currentValue} · Target ${keyResult.targetValue}`;
    case "percentage_target":
      return `Start ${keyResult.startValue}% · Current ${keyResult.currentValue}% · Target ${keyResult.targetValue}%`;
    case "yes_no":
      return `Measure: Yes / No · Current ${keyResult.value ? "Yes" : "No"} · Target Yes`;
  }
}
