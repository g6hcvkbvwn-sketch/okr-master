import { getCycleTimeline } from "../domain/cycles";
import type { Project } from "../shared/types";

export function CycleTimeline({
  cycle,
  now = new Date(),
}: {
  cycle: Project["cycles"][number];
  now?: Date;
}) {
  const timeline = getCycleTimeline(cycle, now);
  const todayPosition =
    timeline.currentDay === null
      ? null
      : (timeline.currentDay / (timeline.totalDays - 1)) * 100;
  const currentIsBefore = now < new Date(`${timeline.startDate}T00:00:00`);
  const currentMessage =
    todayPosition !== null
      ? `Today, ${formatDate(dateKey(now))}`
      : currentIsBefore
        ? "Cycle has not started yet"
        : "Cycle period has ended";

  return (
    <div
      aria-label={`Cycle timeline from ${formatDate(timeline.startDate)} to ${formatDate(timeline.endDate)}`}
      className="cycle-timeline"
      role="group"
    >
      <div className="cycle-timeline-track">
        {timeline.weekPositions.map((position, index) => (
          <span
            aria-hidden="true"
            className="cycle-timeline-week"
            key={index}
            style={{ left: `${position}%` }}
          />
        ))}
        {timeline.months.map((month) => (
          <span
            aria-hidden="true"
            className="cycle-timeline-month"
            key={`${month.label}-${month.position}`}
            style={{ left: `${month.position}%` }}
          >
            {month.label}
          </span>
        ))}
        <span
          aria-label={`Alignment with other teams, ${formatDate(timeline.alignmentDate)}`}
          className="cycle-timeline-marker cycle-timeline-alignment"
          role="img"
          style={{ left: `${timeline.alignmentPosition}%` }}
        />
        <span
          aria-label={`Review and planning, ${formatDate(timeline.reviewPlanningDate)}`}
          className="cycle-timeline-marker cycle-timeline-review"
          role="img"
          style={{ left: `${timeline.reviewPlanningPosition}%` }}
        />
        {todayPosition !== null && (
          <span
            aria-label={currentMessage}
            className="cycle-timeline-marker cycle-timeline-today"
            role="img"
            style={{ left: `${todayPosition}%` }}
          />
        )}
      </div>
      <div className="cycle-timeline-key">
        <span>
          <i className="timeline-key-dot timeline-today-dot" /> {currentMessage}
        </span>
        <span>
          <i className="timeline-key-dot timeline-alignment-dot" /> Alignment
          with other teams · {formatDate(timeline.alignmentDate)}
        </span>
        <span>
          <i className="timeline-key-dot timeline-review-dot" /> Review and
          planning · {formatDate(timeline.reviewPlanningDate)}
        </span>
      </div>
    </div>
  );
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}
