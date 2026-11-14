import { calculateCycleProgress, calculateKeyResultProgress, calculateObjectiveProgress } from "./progress";
import type {
  CompanyGoal,
  Cycle,
  Initiative,
  KeyResult,
  Objective,
  Project,
  Review,
} from "../shared/types";

export interface HistoricalUser {
  id: string;
  name: string;
  email: string;
}

export interface HistoricalInitiative {
  initiative: Initiative;
  owner: HistoricalUser;
  collaborators: HistoricalUser[];
}

export interface HistoricalKeyResult {
  keyResult: KeyResult;
  progress: number;
  owner: HistoricalUser;
  initiatives: HistoricalInitiative[];
}

export interface HistoricalObjective {
  objective: Objective;
  progress: number;
  owner: HistoricalUser;
  companyGoals: CompanyGoal[];
  keyResults: HistoricalKeyResult[];
}

export interface CycleHistory {
  cycle: Cycle;
  companyGoals: CompanyGoal[];
  objectives: HistoricalObjective[];
  review: Review | undefined;
  overallProgress: number;
}

export function completedCyclesChronologically(
  project: Project,
): Cycle[] {
  return project.cycles
    .filter((cycle) => cycle.status === "completed")
    .sort(
      (left, right) =>
        left.startMonth.localeCompare(right.startMonth) ||
        left.endMonth.localeCompare(right.endMonth) ||
        left.id.localeCompare(right.id),
    );
}

function historicalUser(project: Project, cycle: Cycle, userId: string): HistoricalUser {
  const snapshot = cycle.userSnapshots.find((user) => user.id === userId);
  if (snapshot) return snapshot;

  const currentUser = project.users.find((user) => user.id === userId);
  if (currentUser) {
    return {
      id: currentUser.id,
      name: currentUser.name,
      email: currentUser.email,
    };
  }

  return { id: userId, name: "Unknown user", email: "" };
}

function historicalCompanyGoals(project: Project, cycle: Cycle): CompanyGoal[] {
  if (cycle.companyGoalSnapshots.length > 0) {
    return cycle.companyGoalSnapshots
      .map((goal) => ({ ...goal, cycleId: cycle.id }))
      .sort((left, right) => left.priority - right.priority);
  }

  return project.companyGoals
    .filter((goal) => goal.cycleId === cycle.id)
    .sort((left, right) => left.priority - right.priority);
}

export function getCycleHistory(
  project: Project,
  cycleId: string,
): CycleHistory | undefined {
  const cycle = project.cycles.find(
    (candidate) => candidate.id === cycleId && candidate.status === "completed",
  );
  if (!cycle) return undefined;

  const companyGoals = historicalCompanyGoals(project, cycle);
  const objectives = project.objectives
    .filter((objective) => objective.cycleId === cycle.id)
    .map((objective) => {
      const keyResults = project.keyResults
        .filter((keyResult) => keyResult.objectiveId === objective.id)
        .map((keyResult) => {
          const initiatives = project.initiatives
            .filter((initiative) => initiative.keyResultId === keyResult.id)
            .sort(
              (left, right) =>
                left.priority - right.priority ||
                left.title.localeCompare(right.title),
            )
            .map((initiative) => ({
              initiative,
              owner: historicalUser(project, cycle, initiative.ownerId),
              collaborators: initiative.collaboratorIds.map((userId) =>
                historicalUser(project, cycle, userId),
              ),
            }));
          return {
            keyResult,
            progress: calculateKeyResultProgress(keyResult),
            owner: historicalUser(project, cycle, keyResult.ownerId),
            initiatives,
          };
        });

      return {
        objective,
        progress: calculateObjectiveProgress(
          keyResults.map(({ keyResult }) => keyResult),
        ),
        owner: historicalUser(project, cycle, objective.ownerId),
        companyGoals: companyGoals.filter((goal) =>
          objective.companyGoalIds.includes(goal.id),
        ),
        keyResults,
      };
    });

  const review = project.reviews.find(
    (candidate) => candidate.cycleId === cycle.id && candidate.completed,
  );
  const objectiveProgress = objectives.map(({ progress }) => progress);

  return {
    cycle,
    companyGoals,
    objectives,
    review,
    overallProgress:
      review?.overallProgress ??
      (objectiveProgress.length > 0
        ? calculateCycleProgress(objectiveProgress)
        : 0),
  };
}
