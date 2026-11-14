import type { KeyResult } from "../shared/types";

export type ProgressBand = "off-track" | "at-risk" | "on-track";

export function getProgressBand(progress: number): ProgressBand {
  if (progress < 30) return "off-track";
  if (progress <= 70) return "at-risk";
  return "on-track";
}

export class InvalidTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTargetError";
  }
}

function clampAndRound(progress: number): number {
  return Math.round(Math.min(100, Math.max(0, progress)));
}

export function calculateNumberTargetProgress(
  startValue: number,
  currentValue: number,
  targetValue: number,
): number {
  if (
    !Number.isFinite(startValue) ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(targetValue) ||
    targetValue === 0 ||
    targetValue === startValue
  ) {
    throw new InvalidTargetError(
      "Target must be a finite non-zero number different from the start value.",
    );
  }

  return clampAndRound(
    ((currentValue - startValue) / (targetValue - startValue)) * 100,
  );
}

export function calculatePercentageTargetProgress(
  startValue: number,
  currentValue: number,
  targetValue: number,
): number {
  if (
    [startValue, currentValue, targetValue].some(
      (value) => !Number.isFinite(value) || value < 0 || value > 100,
    )
  ) {
    throw new InvalidTargetError(
      "Percentage values must be finite numbers from 0 to 100.",
    );
  }

  return calculateNumberTargetProgress(startValue, currentValue, targetValue);
}

export function calculateYesNoProgress(value: boolean): number {
  return value ? 100 : 0;
}

export function calculateKeyResultProgress(keyResult: KeyResult): number {
  switch (keyResult.metricType) {
    case "number_target":
      return calculateNumberTargetProgress(
        keyResult.startValue,
        keyResult.currentValue,
        keyResult.targetValue,
      );
    case "percentage_target":
      return calculatePercentageTargetProgress(
        keyResult.startValue,
        keyResult.currentValue,
        keyResult.targetValue,
      );
    case "yes_no":
      return calculateYesNoProgress(keyResult.value);
  }
}

export function calculateObjectiveProgress(
  keyResults: readonly KeyResult[],
): number {
  if (keyResults.length === 0) {
    throw new Error("An Objective must have at least one Key Result.");
  }

  const totalProgress = keyResults.reduce(
    (total, keyResult) => total + calculateKeyResultProgress(keyResult),
    0,
  );
  return Math.round(totalProgress / keyResults.length);
}

export function calculateCycleProgress(
  objectiveProgressValues: readonly number[],
): number {
  if (objectiveProgressValues.length === 0) {
    throw new Error("A cycle must contain at least one Objective.");
  }
  return Math.round(
    objectiveProgressValues.reduce((total, progress) => total + progress, 0) /
      objectiveProgressValues.length,
  );
}
