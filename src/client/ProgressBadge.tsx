import { getProgressBand } from "../domain/progress";

export function ProgressBadge({
  progress,
  className = "",
}: {
  progress: number;
  className?: string;
}) {
  const band = getProgressBand(progress);
  return (
    <span
      aria-label={`${progress}% complete`}
      className={`progress-badge progress-${band} ${className}`.trim()}
    >
      {progress}%
    </span>
  );
}
