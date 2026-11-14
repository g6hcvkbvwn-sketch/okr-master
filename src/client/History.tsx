import { useState } from "react";
import { getCycleHistory, completedCyclesChronologically } from "../domain/history";
import { OwnerBadge } from "./OwnerBadge";
import { ProgressBadge } from "./ProgressBadge";
import { ProgressBar } from "./ProgressBar";
import type { Cadence, Initiative, KeyResult, Project } from "../shared/types";

const REVIEW_QUESTIONS = [
  ["successes", "What changed, and what helped us make progress?"],
  ["failures", "What got in the way, or turned out differently than expected?"],
  ["lessonsLearned", "What did we learn that should shape the next cycle?"],
  ["nextActions", "What needs to happen next, and who will take it forward?"],
] as const;

export function History({ project }: { project: Project }) {
  const cycles = completedCyclesChronologically(project);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const selectedId = cycles.some((cycle) => cycle.id === selectedCycleId)
    ? selectedCycleId
    : cycles.at(-1)?.id;
  const history = selectedId
    ? getCycleHistory(project, selectedId)
    : undefined;

  if (cycles.length === 0) {
    return (
      <section className="card empty-state">
        <div className="empty-state-mark">◷</div>
        <h2>No completed cycles yet</h2>
        <p>
          Submitted reviews complete and lock cycles. Completed cycle results
          and review responses will be available here.
        </p>
      </section>
    );
  }

  return (
    <div className="history-layout">
      <nav className="card history-cycle-list" aria-label="Completed cycles">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h2>Completed cycles</h2>
        </div>
        {cycles.map((cycle) => (
          <button
            aria-pressed={cycle.id === selectedId}
            className="history-cycle-option"
            key={cycle.id}
            onClick={() => setSelectedCycleId(cycle.id)}
            type="button"
          >
            <strong>
              {formatMonth(cycle.startMonth)} – {formatMonth(cycle.endMonth)}
            </strong>
            <span>{cadenceLabel(cycle.cadence)}</span>
          </button>
        ))}
      </nav>

      {history ? (
        <div className="stack history-details">
          <section className="card">
            <div className="section-heading history-cycle-heading">
              <div>
                <p className="eyebrow">COMPLETED CYCLE</p>
                <h2>
                  {formatMonth(history.cycle.startMonth)} –{" "}
                  {formatMonth(history.cycle.endMonth)}
                </h2>
                <p className="muted">
                  {cadenceLabel(history.cycle.cadence)} · Read-only historical
                  record
                </p>
              </div>
              <div className="history-overall">
                <span>Final cycle progress</span>
                <ProgressBadge progress={history.overallProgress} />
              </div>
            </div>
            <div className="history-goals">
              <h3>Cycle priorities</h3>
              {history.companyGoals.length > 0 ? (
                <ol>
                  {history.companyGoals.map((goal) => (
                    <li key={goal.id}>
                      <strong>{goal.title}</strong>
                      <span>{goal.description}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">No cycle priority snapshot is available.</p>
              )}
            </div>
            <div className="history-focus">
              <span className="field-caption">Planning focus</span>
              <p>{history.cycle.planningFocus}</p>
            </div>
          </section>

          <section className="card history-review">
            <p className="eyebrow">CYCLE REVIEW</p>
            <h2>Review responses</h2>
            {history.review ? (
              <div className="history-review-responses">
                {REVIEW_QUESTIONS.map(([field, question]) => (
                  <section key={field}>
                    <h3>{question}</h3>
                    <p>{history.review?.[field]}</p>
                  </section>
                ))}
              </div>
            ) : (
              <p className="muted">
                No submitted review is stored for this completed cycle.
              </p>
            )}
          </section>

          <section className="stack compact-stack" aria-label="Historical OKRs">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CYCLE RESULTS</p>
                <h2>Objectives & Key Results</h2>
              </div>
            </div>
            {history.objectives.length > 0 ? (
              history.objectives.map((item) => (
                <details
                  className="card hierarchy-objective history-objective"
                  key={item.objective.id}
                  open
                >
                  <summary className="hierarchy-summary">
                    <span className="disclosure-chevron" aria-hidden="true" />
                    <span className="hierarchy-title">
                      <span className="eyebrow">OBJECTIVE</span>
                      <strong>{item.objective.title}</strong>
                    </span>
                    <OwnerBadge user={item.owner} />
                    <ProgressBadge
                      className="objective-progress"
                      progress={item.progress}
                    />
                  </summary>
                  <div className="hierarchy-body">
                    <details className="objective-description">
                      <summary>Objective description</summary>
                      <p>{item.objective.description}</p>
                    </details>
                    <div className="linked-goals">
                      <span className="field-caption">Aligned cycle priorities</span>
                      <div className="goal-pills">
                        {item.companyGoals.map((goal) => (
                          <span className="goal-pill" key={goal.id}>
                            <b>{goal.priority}</b> {goal.title}
                          </span>
                        ))}
                      </div>
                    </div>
                    <ProgressBar
                      label="Objective progress"
                      progress={item.progress}
                      showLabel={false}
                    />

                    <div className="hierarchy-children">
                      {item.keyResults.map((result) => (
                        <details
                          className="key-result-node"
                          key={result.keyResult.id}
                          open
                        >
                          <summary className="key-result-summary">
                            <span
                              className="disclosure-chevron"
                              aria-hidden="true"
                            />
                            <span className="key-result-name">
                              <strong>{result.keyResult.title}</strong>
                              <small className="key-result-metric">
                                {formatMetric(result.keyResult)}
                              </small>
                            </span>
                            <OwnerBadge user={result.owner} />
                            <ProgressBadge
                              className="progress-number"
                              progress={result.progress}
                            />
                          </summary>
                          <div className="key-result-body">
                            {result.keyResult.description && (
                              <p className="key-result-description">
                                {result.keyResult.description}
                              </p>
                            )}
                            <ProgressBar
                              label="Key Result progress"
                              progress={result.progress}
                              compact
                              showLabel={false}
                            />
                            {result.initiatives.length > 0 ? (
                              <div className="history-initiatives">
                                <h5>Initiatives</h5>
                                {result.initiatives.map(
                                  ({ initiative, owner, collaborators }) => (
                                    <article
                                      className="history-initiative"
                                      key={initiative.id}
                                    >
                                      <div className="history-item-heading">
                                        <div>
                                          <strong>{initiative.title}</strong>
                                          {initiative.description && (
                                            <p className="muted">
                                              {initiative.description}
                                            </p>
                                          )}
                                        </div>
                                        <ProgressBadge
                                          progress={initiative.progress}
                                        />
                                      </div>
                                      <div className="history-initiative-meta">
                                        <span>
                                          Owner: <OwnerBadge user={owner} />
                                        </span>
                                        <span>
                                          Priority {initiative.priority} ·{" "}
                                          {statusLabel(initiative.status)} · Target{" "}
                                          {initiative.targetDate}
                                        </span>
                                        {collaborators.length > 0 && (
                                          <span>
                                            Collaborators:{" "}
                                            {collaborators.map((user, index) => (
                                              <span key={user.id}>
                                                {index > 0 ? ", " : ""}
                                                <OwnerBadge user={user} />
                                              </span>
                                            ))}
                                          </span>
                                        )}
                                      </div>
                                      {initiative.tasks.length > 0 && (
                                        <ul className="history-task-list">
                                          {initiative.tasks.map((task) => (
                                            <li
                                              className={
                                                task.completed
                                                  ? "initiative-task-done"
                                                  : ""
                                              }
                                              key={task.id}
                                            >
                                              <span aria-hidden="true">
                                                {task.completed ? "✓" : "○"}
                                              </span>
                                              <span>{task.text}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </article>
                                  ),
                                )}
                              </div>
                            ) : null}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                </details>
              ))
            ) : (
              <section className="card empty-inline">
                This completed cycle has no stored Objectives.
              </section>
            )}
          </section>

        </div>
      ) : (
        <section className="card empty-state">
          <h2>Historical cycle unavailable</h2>
          <p>Select another completed cycle to inspect its results.</p>
        </section>
      )}
    </div>
  );
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function cadenceLabel(cadence: Cadence): string {
  return cadence.charAt(0).toUpperCase() + cadence.slice(1);
}

function formatMetric(keyResult: KeyResult): string {
  switch (keyResult.metricType) {
    case "number_target":
    case "percentage_target":
      return `Start ${keyResult.startValue}${keyResult.metricType === "percentage_target" ? "%" : ""} · Current ${keyResult.currentValue}${keyResult.metricType === "percentage_target" ? "%" : ""} · Target ${keyResult.targetValue}${keyResult.metricType === "percentage_target" ? "%" : ""}`;
    case "yes_no":
      return `Measure Yes / No · Current ${keyResult.value ? "Yes" : "No"} · Target Yes`;
  }
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
