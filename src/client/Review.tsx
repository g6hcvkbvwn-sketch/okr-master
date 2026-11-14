import {
  calculateCycleProgress,
  calculateKeyResultProgress,
  calculateObjectiveProgress,
} from "../domain/progress";
import { getCycleTimeline, isBeforeCycleEnd } from "../domain/cycles";
import { OwnerBadge } from "./OwnerBadge";
import { ProgressBadge } from "./ProgressBadge";
import type { KeyResult, ReviewDraft, Project } from "../shared/types";

interface ReviewProps {
  project: Project;
  draft: ReviewDraft | null;
  working: boolean;
  canSubmit: boolean;
  onDraftChange: (field: keyof Omit<ReviewDraft, "cycleId">, value: string) => void;
  onSubmit: () => void;
}

const REVIEW_FIELDS = [
  {
    field: "successes",
    title: "What changed, and what helped us make progress?",
    hint: "Capture the choices, strengths, and conditions that supported results.",
  },
  {
    field: "failures",
    title: "What got in the way, or turned out differently than expected?",
    hint: "Describe obstacles and unexpected outcomes without treating a lower percentage as failure by itself.",
  },
  {
    field: "lessonsLearned",
    title: "What did we learn that should shape the next cycle?",
    hint: "Turn the experience into a practical adjustment or insight.",
  },
  {
    field: "nextActions",
    title: "What needs to happen next, and who will take it forward?",
    hint: "Record concrete follow-up actions for the next cycle.",
  },
] as const;

export function Review({
  project,
  draft,
  working,
  canSubmit,
  onDraftChange,
  onSubmit,
}: ReviewProps) {
  const cycle = project.cycles.find(
    (candidate) =>
      candidate.id === project.currentCycleId && candidate.status === "active",
  );
  if (!cycle) {
    return (
      <section className="card empty-state">
        <div className="empty-state-mark">○</div>
        <h2>No active cycle to review</h2>
        <p>
          Activate a cycle in Planning before preparing its review. Submitting a
          review completes and locks that cycle.
        </p>
      </section>
    );
  }

  const objectives = project.objectives.filter(
    (objective) => objective.cycleId === cycle.id,
  );
  const priorities = project.companyGoals
    .filter((goal) => goal.cycleId === cycle.id)
    .sort((left, right) => left.priority - right.priority);
  const objectiveProgresses = objectives.map((objective) =>
    calculateObjectiveProgress(
      project.keyResults.filter(
        (keyResult) => keyResult.objectiveId === objective.id,
      ),
    ),
  );
  const overallProgress = calculateCycleProgress(objectiveProgresses);
  const responsesComplete =
    draft !== null &&
    REVIEW_FIELDS.every(({ field }) => draft[field].trim().length > 0);
  const reviewTime = new Date();
  const timeline = getCycleTimeline(cycle, reviewTime);
  const closesEarly = isBeforeCycleEnd(cycle, reviewTime);

  return (
    <div className="stack review-flow">
      <section className="card review-overview">
        <div>
          <p className="eyebrow">CYCLE REVIEW</p>
          <h2>
            {formatMonth(cycle.startMonth)} – {formatMonth(cycle.endMonth)}
          </h2>
          <p className="muted">
            Start with the outcomes, then capture what you learned and what
            should happen next.
          </p>
        </div>
        <div className="review-aggregate">
          <span>Approximate cycle summary</span>
          <ProgressBadge progress={overallProgress} />
          <details>
            <summary>How is this calculated?</summary>
            <p>
              It is the rounded average of Objective completion percentages,
              with each Objective weighted equally. It is a summary, not a
              team grade or a measure of context.
            </p>
          </details>
        </div>
      </section>

      <section className="card review-results" aria-labelledby="review-results-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">1 · INSPECT OUTCOMES</p>
            <h2 id="review-results-title">Final Key Result outcomes</h2>
          </div>
        </div>
        {objectives.map((objective, index) => {
          const keyResults = project.keyResults.filter(
            (keyResult) => keyResult.objectiveId === objective.id,
          );
          const linkedPriorities = priorities.filter((goal) =>
            objective.companyGoalIds.includes(goal.id),
          );
          return (
            <article className="review-objective" key={objective.id}>
              <div className="review-objective-heading">
                <div>
                  <p className="eyebrow">OBJECTIVE {index + 1}</p>
                  <h3>{objective.title}</h3>
                  {objective.description && (
                    <p className="muted">{objective.description}</p>
                  )}
                </div>
                <OwnerBadge user={displayUser(project, objective.ownerId)} />
              </div>
              {linkedPriorities.length > 0 && (
                <div className="review-priority-list">
                  <span className="field-caption">Aligned cycle priorities</span>
                  <div className="goal-pills">
                    {linkedPriorities.map((goal) => (
                      <span className="goal-pill" key={goal.id}>
                        <b>{goal.priority}</b> {goal.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="review-key-results">
                {keyResults.map((keyResult) => (
                  <ReviewKeyResult key={keyResult.id} keyResult={keyResult} project={project} />
                ))}
              </div>
            </article>
          );
        })}
        {objectives.length === 0 && (
          <p className="empty-inline">No Objectives are assigned to this cycle.</p>
        )}
      </section>

      {draft?.cycleId !== cycle.id ? (
        <div className="notice notice-error" role="alert">
          The saved review draft does not match the active cycle. Reload the
          project before continuing.
        </div>
      ) : (
        <>
          <section className="card review-reflections">
            <div className="section-heading">
              <div>
                <p className="eyebrow">2–5 · REFLECT AND LEARN</p>
                <h2>What happened, and what comes next?</h2>
                <p className="muted">
                  Your responses save automatically. Use the outcomes above
                  together with their context.
                </p>
              </div>
            </div>
            <div className="review-fields">
              {REVIEW_FIELDS.map(({ field, title, hint }, index) => (
                <section className="review-prompt" key={field}>
                  <span className="review-step-number">{index + 2}</span>
                  <label className="field">
                    <span>{title}</span>
                    <small className="review-prompt-hint">{hint}</small>
                    <textarea
                      onChange={(event) =>
                        onDraftChange(field, event.target.value)
                      }
                      required
                      rows={3}
                      value={draft[field]}
                    />
                  </label>
                </section>
              ))}
            </div>
          </section>

          <section className="card review-final-check">
            <div className="section-heading">
              <div>
                <p className="eyebrow">6 · FINAL CHECK</p>
                <h2>Review your results and responses</h2>
                <p className="muted">
                  Check that the outcomes and reflections tell the story you
                  want to preserve in cycle history.
                </p>
              </div>
            </div>
            <div className="review-final-results">
              {objectives.map((objective) => (
                <div key={objective.id}>
                  <strong>{objective.title}</strong>
                  <ul>
                    {project.keyResults
                      .filter((keyResult) => keyResult.objectiveId === objective.id)
                      .map((keyResult) => (
                        <li key={keyResult.id}>
                          {keyResult.title}: {formatMetric(keyResult)}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="review-final-responses">
              {REVIEW_FIELDS.map(({ field, title }) => (
                <section key={field}>
                  <h3>{title}</h3>
                  <p className={draft[field].trim() ? "" : "review-unanswered"}>
                    {draft[field].trim() || "Not answered yet"}
                  </p>
                </section>
              ))}
            </div>
            {closesEarly && (
              <div className="notice notice-warning" role="status">
                This cycle is scheduled to end on {formatDate(timeline.endDate)}.
                Submitting now closes it immediately; the cycle will not remain
                active until its scheduled end.
              </div>
            )}
            {!responsesComplete && (
              <p className="field-error">
                Complete all four responses before submitting the review.
              </p>
            )}
            {!canSubmit && (
              <p className="field-error">
                Save the pending changes successfully before submitting the
                review.
              </p>
            )}
            <div className="button-row form-actions">
              <button
                className="button button-primary"
                disabled={!responsesComplete || working || !canSubmit}
                onClick={onSubmit}
                type="button"
              >
                {working
                  ? "Submitting…"
                  : closesEarly
                    ? "Submit review and close cycle now"
                    : "Submit review and complete cycle"}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function ReviewKeyResult({
  keyResult,
  project,
}: {
  keyResult: KeyResult;
  project: Project;
}) {
  const progress = calculateKeyResultProgress(keyResult);
  return (
    <article className="review-key-result">
      <div className="review-key-result-title">
        <strong>{keyResult.title}</strong>
        <OwnerBadge user={displayUser(project, keyResult.ownerId)} />
      </div>
      <div className="review-key-result-measures">
        <p className="metric-caption">{formatMetric(keyResult)}</p>
        <ProgressBadge className="progress-number" progress={progress} />
      </div>
      {keyResult.description && (
        <details className="review-key-result-description">
          <summary>Key Result context</summary>
          <p className="muted">{keyResult.description}</p>
        </details>
      )}
    </article>
  );
}

function displayUser(project: Project, id: string): { id: string; name: string } {
  return {
    id,
    name: project.users.find((user) => user.id === id)?.name ?? "Unknown user",
  };
}

function formatMetric(keyResult: KeyResult): string {
  switch (keyResult.metricType) {
    case "number_target":
      return `Start ${keyResult.startValue} · Current ${keyResult.currentValue} · Target ${keyResult.targetValue}`;
    case "percentage_target":
      return `Start ${keyResult.startValue}% · Current ${keyResult.currentValue}% · Target ${keyResult.targetValue}%`;
    case "yes_no":
      return `Measure Yes / No · Current ${keyResult.value ? "Yes" : "No"} · Target Yes`;
  }
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}
