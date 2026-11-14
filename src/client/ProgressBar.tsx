import { ProgressBadge } from "./ProgressBadge";
import { getProgressBand } from "../domain/progress";

export function ProgressBar({
  label,
  progress,
  compact = false,
  showLabel = true,
}: {
  label: string;
  progress: number;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const band = getProgressBand(progress);
  return (
    <div className={compact ? "progress-wrap compact" : "progress-wrap"}>
      {showLabel && (
        <div className="progress-label">
          <span>{label}</span>
          <ProgressBadge progress={progress} />
        </div>
      )}
      <div
        aria-label={`${label}: ${progress}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className={`progress-track progress-${band}`}
        role="progressbar"
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
