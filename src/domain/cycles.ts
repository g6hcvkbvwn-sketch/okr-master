import type { Cadence, Cycle } from "../shared/types";

const CADENCE_MONTHS: Record<Cadence, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

function monthIndex(yearMonth: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(yearMonth);
  if (!match) {
    throw new Error(`Invalid year-month value: ${yearMonth}`);
  }
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function yearMonthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function calculateCycleEndMonth(
  startMonth: string,
  cadence: Cadence,
): string {
  return yearMonthFromIndex(monthIndex(startMonth) + CADENCE_MONTHS[cadence] - 1);
}

export function calculateNextCycleStartMonth(previousEndMonth: string): string {
  return yearMonthFromIndex(monthIndex(previousEndMonth) + 1);
}

export function getCurrentLocalMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export interface CycleTimeline {
  startDate: string;
  endDate: string;
  totalDays: number;
  currentDay: number | null;
  months: { label: string; position: number }[];
  weekPositions: number[];
  alignmentDate: string;
  alignmentPosition: number;
  reviewPlanningDate: string;
  reviewPlanningPosition: number;
}

export interface CycleMilestone {
  label: "Cycle starts" | "Team alignment" | "Review and planning" | "Cycle ends";
  date: string;
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayPosition(start: Date, date: Date, totalDays: number): number {
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const currentDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return ((currentDay - startDay) / 86_400_000 / (totalDays - 1)) * 100;
}

export function getCycleTimeline(cycle: Cycle, now = new Date()): CycleTimeline {
  const [startYear, startMonthNumber] = cycle.startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = cycle.endMonth.split("-").map(Number);
  const start = new Date(startYear, startMonthNumber - 1, 1);
  const end = new Date(endYear, endMonthNumber, 0);
  const totalDays =
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86_400_000 +
    1;
  const alignment = new Date(end);
  alignment.setDate(alignment.getDate() - 21);
  const reviewPlanning = new Date(end);
  reviewPlanning.setDate(reviewPlanning.getDate() - 14);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const currentDay =
    today >= start && today <= end
      ? (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
          Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        86_400_000
      : null;
  const months = [];
  for (
    let year = start.getFullYear(), month = start.getMonth();
    year < end.getFullYear() ||
    (year === end.getFullYear() && month <= end.getMonth());
    month += 1
  ) {
    if (month > 11) {
      year += 1;
      month = 0;
    }
    const monthDate = new Date(year, month, 1);
    months.push({
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(
        monthDate,
      ),
      position: Math.max(0, Math.min(100, dayPosition(start, monthDate, totalDays))),
    });
  }
  const weekPositions = [];
  for (let day = 7; day < totalDays; day += 7) {
    weekPositions.push((day / (totalDays - 1)) * 100);
  }

  return {
    startDate: dateKey(start),
    endDate: dateKey(end),
    totalDays,
    currentDay,
    months,
    weekPositions,
    alignmentDate: dateKey(alignment),
    alignmentPosition: dayPosition(start, alignment, totalDays),
    reviewPlanningDate: dateKey(reviewPlanning),
    reviewPlanningPosition: dayPosition(start, reviewPlanning, totalDays),
  };
}

export function getNextCycleMilestone(
  cycle: Cycle,
  now = new Date(),
): CycleMilestone {
  const timeline = getCycleTimeline(cycle, now);
  const today = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  if (today <= timeline.startDate) {
    return { label: "Cycle starts", date: timeline.startDate };
  }
  if (today <= timeline.alignmentDate) {
    return { label: "Team alignment", date: timeline.alignmentDate };
  }
  if (today <= timeline.reviewPlanningDate) {
    return { label: "Review and planning", date: timeline.reviewPlanningDate };
  }
  return { label: "Cycle ends", date: timeline.endDate };
}

export function isBeforeCycleEnd(cycle: Cycle, now = new Date()): boolean {
  const timeline = getCycleTimeline(cycle, now);
  const today = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  return today < timeline.endDate;
}

export function createActiveCycle(input: {
  id: string;
  startMonth: string;
  cadence: Cadence;
  planningFocus: string;
  userSnapshots: Cycle["userSnapshots"];
  companyGoalSnapshots?: Cycle["companyGoalSnapshots"];
}): Cycle {
  return {
    id: input.id,
    startMonth: input.startMonth,
    endMonth: calculateCycleEndMonth(input.startMonth, input.cadence),
    status: "active",
    cadence: input.cadence,
    planningFocus: input.planningFocus,
    companyGoalSnapshots: input.companyGoalSnapshots ?? [],
    userSnapshots: input.userSnapshots,
  };
}
