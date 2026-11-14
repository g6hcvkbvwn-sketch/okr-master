import {
  ActiveKeyResultInputSchema,
  ActiveObjectiveInputSchema,
  ActiveObjectiveUpdateSchema,
  InitiativeInputSchema,
  ProjectSchema,
  ReviewSubmissionSchema,
  type CreateProjectRequest,
  type ActiveKeyResultInput,
  type ActiveObjectiveInput,
  type ActiveObjectiveUpdate,
  type InitiativeInput,
  type ValidatedInitiativeInput,
} from "../shared/schemas";
import type {
  CompanyGoal,
  Cycle,
  Initiative,
  InitiativeTask,
  KeyResult,
  Objective,
  PlanningDraft,
  Project,
  User,
  Review,
} from "../shared/types";
import {
  calculateCycleEndMonth,
  calculateNextCycleStartMonth,
  createActiveCycle,
  getCurrentLocalMonth,
} from "./cycles";
import {
  calculateCycleProgress,
  calculateKeyResultProgress,
  calculateObjectiveProgress,
  InvalidTargetError,
} from "./progress";

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly schemaVersion: number) {
    super(`Project schema version ${schemaVersion} is newer than supported version 1.`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

function createUuid(): string {
  return globalThis.crypto.randomUUID();
}

export function statusAfterInitiativeProgressChange(
  currentStatus: Initiative["status"],
  progress: number,
): Initiative["status"] {
  if (progress === 100) return "done";
  if (currentStatus === "todo") return "in_progress";
  return currentStatus;
}

export function calculateInitiativeTaskProgress(
  tasks: InitiativeTask[],
): number | null {
  if (tasks.length === 0) return null;
  return Math.round(
    (tasks.filter((task) => task.completed).length / tasks.length) * 100,
  );
}

function resolveInitiativeProgress(
  input: ValidatedInitiativeInput,
  current?: Initiative,
): Pick<Initiative, "progress" | "status"> {
  const taskProgress = input.syncProgressToTasks
    ? calculateInitiativeTaskProgress(input.tasks)
    : null;
  const progress = taskProgress ?? input.progress;
  const tasksChanged =
    current !== undefined &&
    JSON.stringify(input.tasks) !== JSON.stringify(current.tasks);
  let status = input.status;

  if (progress === 100) {
    status = "done";
  } else if (!current && status === "todo" && progress > 0) {
    status = statusAfterInitiativeProgressChange(status, progress);
  } else if (
    current?.status === "todo" &&
    input.status === "todo" &&
    input.progress !== current.progress
  ) {
    status = statusAfterInitiativeProgressChange(current.status, input.progress);
  } else if (
    taskProgress !== null &&
    tasksChanged &&
    current?.syncProgressToTasks &&
    current.status === "done"
  ) {
    status = "in_progress";
  } else if (
    taskProgress !== null &&
    tasksChanged &&
    current?.status === "todo" &&
    progress > 0
  ) {
    status = "in_progress";
  }

  return { progress, status };
}

function assertDoneInitiativeHasNoOpenTasks(
  status: Initiative["status"],
  tasks: InitiativeTask[],
  currentStatus?: Initiative["status"],
): void {
  if (
    status === "done" &&
    currentStatus !== "done" &&
    tasks.some((task) => !task.completed)
  ) {
    throw new ProjectValidationError(
      "Complete all open tasks before moving this Initiative to Done.",
    );
  }
}

function allEntityIds(project: Project): string[] {
  const ids = [
    project.id,
    ...project.users.map((user) => user.id),
    ...project.companyGoals.map((goal) => goal.id),
    ...project.cycles.map((cycle) => cycle.id),
    ...project.objectives.map((objective) => objective.id),
    ...project.keyResults.map((keyResult) => keyResult.id),
    ...project.initiatives.map((initiative) => initiative.id),
    ...project.initiatives.flatMap((initiative) =>
      initiative.tasks.map((task) => task.id),
    ),
    ...project.reviews.map((review) => review.id),
  ];
  if (project.planningDraft) {
    ids.push(
      ...project.planningDraft.objectives.map((objective) => objective.id),
      ...project.planningDraft.companyGoals.map((goal) => goal.id),
      ...project.planningDraft.objectives.flatMap((objective) =>
        objective.keyResults.map((keyResult) => keyResult.id),
      ),
    );
  }
  return ids;
}

export function parseProject(value: unknown): Project {
  if (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > 1
  ) {
    throw new UnsupportedSchemaVersionError(value.schemaVersion);
  }

  const parsed = ProjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProjectValidationError(
      `Invalid project data: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const project = parsed.data;
  const activeCycle = project.cycles.find(
    (cycle) => cycle.id === project.currentCycleId && cycle.status === "active",
  );
  if (activeCycle && !project.reviewDraft) {
    project.reviewDraft = {
      cycleId: activeCycle.id,
      successes: "",
      failures: "",
      lessonsLearned: "",
      nextActions: "",
    };
  }
  assertProjectIntegrity(project);
  return project;
}

export function assertProjectAutosaveAllowed(
  current: Project,
  next: Project,
): void {
  const immutableFields: (keyof Project)[] = [
    "id",
    "name",
    "description",
    "schemaVersion",
    "cadence",
    "currentCycleId",
    "users",
    "companyGoals",
    "cycles",
    "objectives",
    "keyResults",
    "initiatives",
    "reviews",
  ];
  if (
    immutableFields.some(
      (field) =>
        JSON.stringify(current[field]) !== JSON.stringify(next[field]),
    )
  ) {
    throw new ProjectValidationError(
      "This save can only update planning or review drafts. Cycle data must be changed through its explicit workflow.",
    );
  }
  const activeCycle = current.cycles.find(
    (cycle) => cycle.id === current.currentCycleId && cycle.status === "active",
  );
  if (
    activeCycle &&
    JSON.stringify(current.planningDraft) !== JSON.stringify(next.planningDraft)
  ) {
    throw new ProjectValidationError(
      "Planning for the next cycle is unavailable until the active cycle review is submitted.",
    );
  }
  if (
    !activeCycle &&
    JSON.stringify(current.reviewDraft) !== JSON.stringify(next.reviewDraft)
  ) {
    throw new ProjectValidationError(
      "A review draft can only be changed for the active cycle.",
    );
  }
}

export function assertProjectIntegrity(project: Project): void {
  const ids = allEntityIds(project);
  if (new Set(ids).size !== ids.length) {
    throw new ProjectValidationError("Every project entity must have a unique UUID.");
  }

  const users = new Map(project.users.map((user) => [user.id, user]));
  const cycles = new Map(project.cycles.map((cycle) => [cycle.id, cycle]));
  const objectives = new Map(
    project.objectives.map((objective) => [objective.id, objective]),
  );
  const keyResults = new Map(
    project.keyResults.map((keyResult) => [keyResult.id, keyResult]),
  );
  const goals = new Map(project.companyGoals.map((goal) => [goal.id, goal]));
  const activeCycles = project.cycles.filter((cycle) => cycle.status === "active");
  if (project.reviews.some((review) => !cycles.has(review.cycleId))) {
    throw new ProjectValidationError("Reviews must reference an existing cycle.");
  }
  if (
    project.reviewDraft &&
    !activeCycles.some((cycle) => cycle.id === project.reviewDraft?.cycleId)
  ) {
    throw new ProjectValidationError(
      "A review draft must reference the active cycle.",
    );
  }

  if (activeCycles.length > 1) {
    throw new ProjectValidationError("Only one cycle may be active at a time.");
  }
  if (
    project.currentCycleId !== null &&
    !activeCycles.some((cycle) => cycle.id === project.currentCycleId)
  ) {
    throw new ProjectValidationError(
      "The currentCycleId must reference the active cycle.",
    );
  }
  if (activeCycles.length === 1 && project.currentCycleId !== activeCycles[0]?.id) {
    throw new ProjectValidationError(
      "The active cycle must be referenced by currentCycleId.",
    );
  }
  if (activeCycles.length === 1 && project.planningDraft !== null) {
    throw new ProjectValidationError(
      "Planning cannot begin until the active cycle review is submitted.",
    );
  }

  for (const cycle of project.cycles) {
    if (cycle.endMonth !== calculateCycleEndMonth(cycle.startMonth, cycle.cadence)) {
      throw new ProjectValidationError(
        `Cycle ${cycle.id} has an end month that does not match its cadence.`,
      );
    }
  }
  const orderedCycles = [...project.cycles].sort((left, right) =>
    left.startMonth.localeCompare(right.startMonth),
  );
  for (let index = 1; index < orderedCycles.length; index += 1) {
    const previous = orderedCycles[index - 1];
    const current = orderedCycles[index];
    if (
      previous &&
      current &&
      current.startMonth !==
        calculateNextCycleStartMonth(previous.endMonth)
    ) {
      throw new ProjectValidationError(
        "Cycle periods must be consecutive and non-overlapping.",
      );
    }
  }

  for (const goal of project.companyGoals) {
    const cycle = cycles.get(goal.cycleId);
    if (!cycle) {
      throw new ProjectValidationError("Cycle priorities must reference a cycle.");
    }
    if (goal.priority > 3) {
      throw new ProjectValidationError("Cycle priority must be from 1 to 3.");
    }
  }
  for (const cycle of project.cycles) {
    const cycleGoals = project.companyGoals
      .filter((goal) => goal.cycleId === cycle.id)
      .sort((left, right) => left.priority - right.priority);
    if (cycleGoals.length > 3) {
      throw new ProjectValidationError("A cycle may have at most three priorities.");
    }
    if (
      cycleGoals.some((goal, index) => goal.priority !== index + 1)
    ) {
      throw new ProjectValidationError(
        "Cycle priority order must be consecutive starting at 1.",
      );
    }
  }

  for (const objective of project.objectives) {
    const objectiveCycle = cycles.get(objective.cycleId);
    const ownerExists =
      users.has(objective.ownerId) ||
      (objectiveCycle?.status === "completed" &&
        objectiveCycle.userSnapshots.some(
          (snapshot) => snapshot.id === objective.ownerId,
        ));
    if (!objectiveCycle || !ownerExists) {
      throw new ProjectValidationError(
        "Objectives must reference an existing cycle and owner.",
      );
    }
    for (const goalId of objective.companyGoalIds) {
      if (goals.get(goalId)?.cycleId !== objective.cycleId) {
        throw new ProjectValidationError(
          "Objectives must link to cycle priorities in their cycle.",
        );
      }
    }
    if (
      objective.keyResultIds.some(
        (keyResultId) => keyResults.get(keyResultId)?.objectiveId !== objective.id,
      )
    ) {
      throw new ProjectValidationError(
        "Objective Key Result links must reference its Key Results.",
      );
    }
  }
  for (const keyResult of project.keyResults) {
    const parentObjective = objectives.get(keyResult.objectiveId);
    const ownerExists =
      users.has(keyResult.ownerId) ||
      (parentObjective !== undefined &&
        cycles.get(parentObjective.cycleId)?.status === "completed" &&
        cycles
          .get(parentObjective.cycleId)
          ?.userSnapshots.some((snapshot) => snapshot.id === keyResult.ownerId));
    if (!parentObjective || !ownerExists) {
      throw new ProjectValidationError(
        "Key Results must reference an existing Objective and owner.",
      );
    }
    try {
      calculateKeyResultProgress(keyResult);
    } catch (error) {
      if (error instanceof InvalidTargetError) {
        throw new ProjectValidationError(error.message);
      }
      throw error;
    }
  }

  for (const initiative of project.initiatives) {
    const keyResult = keyResults.get(initiative.keyResultId);
    const objective = keyResult
      ? objectives.get(keyResult.objectiveId)
      : undefined;
    const initiativeCycle = objective
      ? cycles.get(objective.cycleId)
      : undefined;
    if (!keyResult || !objective || !initiativeCycle) {
      throw new ProjectValidationError(
        "Initiatives must reference a Key Result in an existing cycle.",
      );
    }
    const ownerExists =
      users.has(initiative.ownerId) ||
      (initiativeCycle.status === "completed" &&
        initiativeCycle.userSnapshots.some(
          (snapshot) => snapshot.id === initiative.ownerId,
        ));
    const collaboratorsExist = initiative.collaboratorIds.every(
      (collaboratorId) =>
        users.has(collaboratorId) ||
        (initiativeCycle.status === "completed" &&
          initiativeCycle.userSnapshots.some(
            (snapshot) => snapshot.id === collaboratorId,
          )),
    );
    if (
      !ownerExists ||
      !collaboratorsExist
    ) {
      throw new ProjectValidationError(
        "Initiative owners and collaborators must reference existing users.",
      );
    }
    if (
      (initiative.status === "done" && initiative.progress !== 100) ||
      (initiative.progress === 100 && initiative.status !== "done")
    ) {
      throw new ProjectValidationError(
        "An Initiative at 100% progress must be Done, and a Done Initiative must have 100% progress.",
      );
    }
  }

  for (const cycle of activeCycles) {
    const cycleObjectives = project.objectives.filter(
      (objective) => objective.cycleId === cycle.id,
    );
    const cycleGoals = project.companyGoals.filter(
      (goal) => goal.cycleId === cycle.id,
    );
    if (
      cycleGoals.length < 1 ||
      cycleObjectives.length < 1 ||
      !cycleObjectives.some((objective) => objective.keyResultIds.length > 0)
    ) {
      throw new ProjectValidationError(
        "An active cycle requires at least one cycle priority, Objective, and Key Result.",
      );
    }
  }
}

function newPlanningDraft(
  idFactory: () => string,
  previousGoals: readonly CompanyGoal[] = [],
  cadence: PlanningDraft["cadence"] = "quarterly",
): PlanningDraft {
  const newObjective = () => ({
    id: idFactory(),
    title: "",
    description: "",
    ownerId: "",
    companyGoalIds: [],
    keyResults: [
      {
        id: idFactory(),
        title: "",
        description: "",
        ownerId: "",
        metricType: "number_target" as const,
        startValue: 0,
        currentValue: 0,
        targetValue: null,
        yesNoValue: false,
      },
    ],
  });
  return {
    cadence,
    planningFocus: "",
    companyGoals:
      previousGoals.length > 0
        ? [...previousGoals]
            .sort((left, right) => left.priority - right.priority)
            .map((goal) => ({
              id: idFactory(),
              title: goal.title,
              description: goal.description,
            }))
        : [{ id: idFactory(), title: "", description: "" }],
    objectives: [newObjective()],
  };
}

export function removePlanningCompanyGoal(
  draft: PlanningDraft,
  goalId: string,
): PlanningDraft {
  if (
    draft.companyGoals.length <= 1 ||
    !draft.companyGoals.some((goal) => goal.id === goalId)
  ) {
    return draft;
  }

  return {
    ...draft,
    companyGoals: draft.companyGoals.filter((goal) => goal.id !== goalId),
    objectives: draft.objectives.map((objective) => ({
      ...objective,
      companyGoalIds: objective.companyGoalIds.filter((id) => id !== goalId),
    })),
  };
}

export function movePlanningCompanyGoal(
  draft: PlanningDraft,
  goalId: string,
  direction: -1 | 1,
): PlanningDraft {
  const currentIndex = draft.companyGoals.findIndex((goal) => goal.id === goalId);
  const nextIndex = currentIndex + direction;
  if (
    currentIndex < 0 ||
    nextIndex < 0 ||
    nextIndex >= draft.companyGoals.length
  ) {
    return draft;
  }

  const companyGoals = [...draft.companyGoals];
  [companyGoals[currentIndex], companyGoals[nextIndex]] = [
    companyGoals[nextIndex]!,
    companyGoals[currentIndex]!,
  ];
  return { ...draft, companyGoals };
}

export function createProject(
  input: CreateProjectRequest,
  idFactory: () => string = createUuid,
): Project {
  return parseProject({
    id: idFactory(),
    name: input.name,
    description: input.description,
    schemaVersion: 1,
    cadence: "quarterly",
    currentCycleId: null,
    users: [],
    companyGoals: [],
    cycles: [],
    objectives: [],
    keyResults: [],
    initiatives: [],
    reviews: [],
    reviewDraft: null,
    planningDraft: newPlanningDraft(idFactory),
  });
}

export function validatePlanningDraft(
  project: Project,
): string[] {
  const draft = project.planningDraft;
  if (!draft) {
    return ["There is no planning draft to submit."];
  }

  const errors: string[] = [];
  if (project.cycles.some((cycle) => cycle.status === "active")) {
    errors.push("Complete the active cycle review before planning the next cycle.");
  }
  if (!draft.planningFocus.trim()) {
    errors.push("Enter the planning focus.");
  }
  if (draft.companyGoals.length < 1 || draft.companyGoals.length > 3) {
    errors.push("Add between one and three cycle priorities.");
  }
  draft.companyGoals.forEach((goal, index) => {
    if (!goal.title.trim()) errors.push(`Cycle priority ${index + 1}: enter a title.`);
    if (!goal.description.trim())
      errors.push(`Cycle priority ${index + 1}: enter a description.`);
  });
  if (draft.objectives.length < 1) errors.push("Add at least one Objective.");
  draft.objectives.forEach((objective, objectiveIndex) => {
    const objectivePrefix = `Objective ${objectiveIndex + 1}`;
    if (!objective.title.trim())
      errors.push(`${objectivePrefix}: enter a title.`);
    if (!objective.description.trim())
      errors.push(`${objectivePrefix}: enter a description.`);
    if (!usersHas(project.users, objective.ownerId)) {
      errors.push(`${objectivePrefix}: select an active owner.`);
    }
    if (
      objective.companyGoalIds.length < 1 ||
      objective.companyGoalIds.some(
        (id) => !draft.companyGoals.some((goal) => goal.id === id),
      )
    ) {
      errors.push(
        `${objectivePrefix}: link to at least one planned cycle priority.`,
      );
    }
    if (objective.keyResults.length < 1) {
      errors.push(`${objectivePrefix}: add at least one Key Result.`);
    }
    objective.keyResults.forEach((keyResult, keyResultIndex) => {
      const prefix = `${objectivePrefix}, Key Result ${keyResultIndex + 1}`;
      if (!keyResult.title.trim()) errors.push(`${prefix}: enter a title.`);
      if (!usersHas(project.users, keyResult.ownerId))
        errors.push(`${prefix}: select an active owner.`);
      try {
        const normalized = keyResultFromDraft(keyResult, objective.id);
        calculateKeyResultProgress(normalized);
      } catch (error) {
        errors.push(
          `${prefix}: ${error instanceof Error ? error.message : "invalid metric values."}`,
        );
      }
    });
  });

  return errors;
}

export const validateFirstCycleDraft = validatePlanningDraft;

function usersHas(users: readonly User[], id: string): boolean {
  return users.some((user) => user.id === id && user.active);
}

function keyResultFromDraft(
  draft: PlanningDraft["objectives"][number]["keyResults"][number],
  objectiveId: string,
): KeyResult {
  const shared = {
    id: draft.id,
    objectiveId,
    title: draft.title.trim(),
    description: draft.description.trim(),
    ownerId: draft.ownerId,
  };
  switch (draft.metricType) {
    case "number_target":
      if (draft.targetValue === null) {
        throw new InvalidTargetError("Enter a target value.");
      }
      return {
        ...shared,
        metricType: "number_target",
        startValue: draft.startValue,
        currentValue: draft.currentValue,
        targetValue: draft.targetValue,
      };
    case "percentage_target":
      if (draft.targetValue === null) {
        throw new InvalidTargetError("Enter a target percentage.");
      }
      return {
        ...shared,
        metricType: "percentage_target",
        startValue: draft.startValue,
        currentValue: draft.currentValue,
        targetValue: draft.targetValue,
      };
    case "yes_no":
      return { ...shared, metricType: "yes_no", value: draft.yesNoValue };
  }
}

export function activateFirstCycle(
  project: Project,
  options: { idFactory?: () => string; now?: Date } = {},
): Project {
  const errors = validatePlanningDraft(project);
  if (errors.length > 0) {
    throw new ProjectValidationError(errors.join(" "));
  }

  const idFactory = options.idFactory ?? createUuid;
  const draft = project.planningDraft;
  if (!draft) {
    throw new ProjectValidationError("There is no planning draft to submit.");
  }

  const cycleId = idFactory();
  const goals: CompanyGoal[] = draft.companyGoals.map((goal, index) => ({
    id: goal.id,
    cycleId,
    title: goal.title.trim(),
    description: goal.description.trim(),
    priority: index + 1,
  }));
  const keyResults = draft.objectives.flatMap((objective) =>
    objective.keyResults.map((keyResult) =>
      keyResultFromDraft(keyResult, objective.id),
    ),
  );
  const objectives: Objective[] = draft.objectives.map((objective) => ({
      id: objective.id,
      cycleId,
      title: objective.title.trim(),
      description: objective.description.trim(),
      ownerId: objective.ownerId,
      companyGoalIds: [...objective.companyGoalIds],
      keyResultIds: objective.keyResults.map((keyResult) => keyResult.id),
    }));
  const assignedUserIds = new Set([
    ...objectives.map((objective) => objective.ownerId),
    ...keyResults.map((keyResult) => keyResult.ownerId),
  ]);
  const userSnapshots = project.users
    .filter((user) => assignedUserIds.has(user.id))
    .map(({ id, name, email }) => ({ id, name, email }));
  const precedingCycle = [...project.cycles].sort((left, right) =>
    left.endMonth.localeCompare(right.endMonth),
  ).at(-1);
  const cycle = createActiveCycle({
    id: cycleId,
    startMonth: precedingCycle
      ? calculateNextCycleStartMonth(precedingCycle.endMonth)
      : getCurrentLocalMonth(options.now),
    cadence: draft.cadence,
    planningFocus: draft.planningFocus.trim(),
    userSnapshots,
    companyGoalSnapshots: goals.map(({ id, title, description, priority }) => ({
      id,
      title,
      description,
      priority,
    })),
  });

  return parseProject({
    ...project,
    cadence: draft.cadence,
    currentCycleId: cycle.id,
    cycles: [...project.cycles, cycle],
    companyGoals: [...project.companyGoals, ...goals],
    objectives: [...project.objectives, ...objectives],
    keyResults: [...project.keyResults, ...keyResults],
    reviewDraft: {
      cycleId: cycle.id,
      successes: "",
      failures: "",
      lessonsLearned: "",
      nextActions: "",
    },
    planningDraft: null,
  });
}

export function submitCycleReview(
  project: Project,
  input: unknown,
  options: { idFactory?: () => string } = {},
): Project {
  const parsed = ReviewSubmissionSchema.parse(input);
  const activeCycle = project.cycles.find(
    (cycle) =>
      cycle.id === project.currentCycleId &&
      cycle.status === "active",
  );
  if (!activeCycle) {
    throw new ProjectValidationError("There is no active cycle to review.");
  }
  if (parsed.cycleId !== activeCycle.id) {
    throw new ProjectValidationError(
      "The review does not belong to the active cycle.",
    );
  }

  const cycleObjectives = project.objectives.filter(
    (objective) => objective.cycleId === activeCycle.id,
  );
  const objectiveProgress = cycleObjectives.map((objective) =>
    calculateObjectiveProgress(
      project.keyResults.filter(
        (keyResult) => keyResult.objectiveId === objective.id,
      ),
    ),
  );
  const overallProgress = calculateCycleProgress(objectiveProgress);
  const cycleGoalSnapshots = project.companyGoals
    .filter((goal) => goal.cycleId === activeCycle.id)
    .sort((left, right) => left.priority - right.priority)
    .map(({ id, title, description, priority }) => ({
      id,
      title,
      description,
      priority,
    }));

  const cycleObjectiveIds = new Set(cycleObjectives.map(({ id }) => id));
  const cycleKeyResultIds = new Set(
    project.keyResults
      .filter((keyResult) => cycleObjectiveIds.has(keyResult.objectiveId))
      .map(({ id }) => id),
  );
  const assignedUserIds = new Set([
    ...cycleObjectives.map(({ ownerId }) => ownerId),
    ...project.keyResults
      .filter((keyResult) => cycleObjectiveIds.has(keyResult.objectiveId))
      .map(({ ownerId }) => ownerId),
    ...project.initiatives
      .filter((initiative) => cycleKeyResultIds.has(initiative.keyResultId))
      .flatMap((initiative) => [
        initiative.ownerId,
        ...initiative.collaboratorIds,
      ]),
  ]);
  const userSnapshots = project.users
    .filter((user) => assignedUserIds.has(user.id))
    .map(({ id, name, email }) => ({ id, name, email }));
  const completedCycle = {
    ...activeCycle,
    status: "completed" as const,
    companyGoalSnapshots: cycleGoalSnapshots,
    userSnapshots,
  };
  const review: Review = {
    id: options.idFactory?.() ?? createUuid(),
    cycleId: activeCycle.id,
    successes: parsed.successes.trim(),
    failures: parsed.failures.trim(),
    lessonsLearned: parsed.lessonsLearned.trim(),
    nextActions: parsed.nextActions.trim(),
    overallProgress,
    completed: true,
  };
  const planningDraft = newPlanningDraft(
    options.idFactory ?? createUuid,
    project.companyGoals.filter((goal) => goal.cycleId === activeCycle.id),
    activeCycle.cadence,
  );

  const nextProject: Project = {
    ...project,
    currentCycleId: null,
    cycles: project.cycles.map((cycle) =>
      cycle.id === activeCycle.id ? completedCycle : cycle,
    ),
    reviews: [...project.reviews, review],
    reviewDraft: null,
    planningDraft,
  };
  return parseProject(nextProject);
}

export function updateUser(
  project: Project,
  userId: string,
  changes: Pick<User, "name" | "email" | "active">,
): Project {
  const exists = project.users.some((user) => user.id === userId);
  if (!exists) throw new ProjectValidationError("User not found.");
  return parseProject({
    ...project,
    users: project.users.map((user) =>
      user.id === userId ? { ...user, ...changes } : user,
    ),
  });
}

export function addUser(
  project: Project,
  changes: Pick<User, "name" | "email" | "active">,
  idFactory: () => string = createUuid,
): Project {
  const user: User = { id: idFactory(), ...changes };
  return parseProject({ ...project, users: [...project.users, user] });
}

export function canDeleteUser(project: Project, userId: string): boolean {
  const activeCycleIds = new Set(
    project.cycles
      .filter((cycle) => cycle.status === "active")
      .map((cycle) => cycle.id),
  );
  if (project.planningDraft) {
    for (const objective of project.planningDraft.objectives) {
      if (objective.ownerId === userId) return false;
      if (objective.keyResults.some((keyResult) => keyResult.ownerId === userId)) {
        return false;
      }
    }
  }
  const activeObjectiveIds = new Set(
    project.objectives
      .filter((objective) => activeCycleIds.has(objective.cycleId))
      .map((objective) => objective.id),
  );
  const activeKeyResultIds = new Set(
    project.keyResults
      .filter((keyResult) => activeObjectiveIds.has(keyResult.objectiveId))
      .map((keyResult) => keyResult.id),
  );
  return (
    !project.objectives.some(
      (objective) =>
        activeCycleIds.has(objective.cycleId) && objective.ownerId === userId,
    ) &&
    !project.keyResults.some(
      (keyResult) =>
        activeObjectiveIds.has(keyResult.objectiveId) &&
        keyResult.ownerId === userId,
    ) &&
    !project.initiatives.some(
      (initiative) =>
        activeKeyResultIds.has(initiative.keyResultId) &&
        (initiative.ownerId === userId ||
          initiative.collaboratorIds.includes(userId)),
    )
  );
}

function requireActiveCycle(project: Project): Cycle {
  const cycle = project.cycles.find(
    (candidate) =>
      candidate.id === project.currentCycleId && candidate.status === "active",
  );
  if (!cycle) {
    throw new ProjectValidationError("There is no active cycle to edit.");
  }
  return cycle;
}

function requireActiveUser(project: Project, userId: string): User {
  const user = project.users.find(
    (candidate) => candidate.id === userId && candidate.active,
  );
  if (!user) {
    throw new ProjectValidationError(
      "Select an existing active user for this assignment.",
    );
  }
  return user;
}

function requireActiveObjective(
  project: Project,
  objectiveId: string,
): Objective {
  const cycle = requireActiveCycle(project);
  const objective = project.objectives.find(
    (candidate) =>
      candidate.id === objectiveId && candidate.cycleId === cycle.id,
  );
  if (!objective) {
    throw new ProjectValidationError(
      "The Objective does not belong to the active cycle.",
    );
  }
  return objective;
}

function requireGoalLinks(
  project: Project,
  cycleId: string,
  companyGoalIds: readonly string[],
): void {
  if (
    companyGoalIds.length === 0 ||
    companyGoalIds.some(
      (id) =>
        !project.companyGoals.some(
          (goal) => goal.id === id && goal.cycleId === cycleId,
        ),
    )
  ) {
    throw new ProjectValidationError(
      "Link the Objective to at least one cycle priority in its cycle.",
    );
  }
}

function withActiveCycleSnapshot(
  project: Project,
  userIds: readonly string[],
): Project["cycles"] {
  const activeCycle = requireActiveCycle(project);
  const snapshots = new Map(
    activeCycle.userSnapshots.map((snapshot) => [snapshot.id, snapshot]),
  );
  for (const userId of userIds) {
    const user = requireActiveUser(project, userId);
    snapshots.set(user.id, { id: user.id, name: user.name, email: user.email });
  }
  return project.cycles.map((cycle) =>
    cycle.id === activeCycle.id
      ? { ...cycle, userSnapshots: [...snapshots.values()] }
      : cycle,
  );
}

function createKeyResult(
  input: ActiveKeyResultInput,
  objectiveId: string,
  idFactory: () => string,
): KeyResult {
  const parsed = ActiveKeyResultInputSchema.parse(input);
  return { ...parsed, id: idFactory(), objectiveId };
}

export function createActiveObjective(
  project: Project,
  input: ActiveObjectiveInput,
  idFactory: () => string = createUuid,
): Project {
  const parsed = ActiveObjectiveInputSchema.parse(input);
  const cycle = requireActiveCycle(project);
  requireActiveUser(project, parsed.ownerId);
  requireGoalLinks(project, cycle.id, parsed.companyGoalIds);
  const objectiveId = idFactory();
  const keyResults = parsed.keyResults.map((keyResult) =>
    createKeyResult(keyResult, objectiveId, idFactory),
  );
  keyResults.forEach((keyResult) => requireActiveUser(project, keyResult.ownerId));
  const objective: Objective = {
    id: objectiveId,
    cycleId: cycle.id,
    title: parsed.title,
    description: parsed.description,
    ownerId: parsed.ownerId,
    companyGoalIds: parsed.companyGoalIds,
    keyResultIds: keyResults.map((keyResult) => keyResult.id),
  };
  const withSnapshots = withActiveCycleSnapshot(project, [
    parsed.ownerId,
    ...keyResults.map((keyResult) => keyResult.ownerId),
  ]);
  return parseProject({
    ...project,
    cycles: withSnapshots,
    objectives: [...project.objectives, objective],
    keyResults: [...project.keyResults, ...keyResults],
  });
}

export function updateActiveObjective(
  project: Project,
  objectiveId: string,
  input: ActiveObjectiveUpdate,
): Project {
  const parsed = ActiveObjectiveUpdateSchema.parse(input);
  const objective = requireActiveObjective(project, objectiveId);
  requireActiveUser(project, parsed.ownerId);
  requireGoalLinks(project, objective.cycleId, parsed.companyGoalIds);
  const cycles = withActiveCycleSnapshot(project, [parsed.ownerId]);
  return parseProject({
    ...project,
    cycles,
    objectives: project.objectives.map((candidate) =>
      candidate.id === objectiveId
        ? {
            ...candidate,
            title: parsed.title,
            description: parsed.description,
            ownerId: parsed.ownerId,
            companyGoalIds: parsed.companyGoalIds,
          }
        : candidate,
    ),
  });
}

export function createActiveKeyResult(
  project: Project,
  objectiveId: string,
  input: ActiveKeyResultInput,
  idFactory: () => string = createUuid,
): Project {
  const parsed = ActiveKeyResultInputSchema.parse(input);
  const objective = requireActiveObjective(project, objectiveId);
  requireActiveUser(project, parsed.ownerId);
  const keyResult = createKeyResult(parsed, objectiveId, idFactory);
  const cycles = withActiveCycleSnapshot(project, [parsed.ownerId]);
  return parseProject({
    ...project,
    cycles,
    keyResults: [...project.keyResults, keyResult],
    objectives: project.objectives.map((candidate) =>
      candidate.id === objective.id
        ? {
            ...candidate,
            keyResultIds: [...candidate.keyResultIds, keyResult.id],
          }
        : candidate,
    ),
  });
}

export function updateActiveKeyResult(
  project: Project,
  keyResultId: string,
  input: ActiveKeyResultInput,
): Project {
  const parsed = ActiveKeyResultInputSchema.parse(input);
  const keyResult = project.keyResults.find(
    (candidate) => candidate.id === keyResultId,
  );
  if (!keyResult) throw new ProjectValidationError("Key Result not found.");
  requireActiveObjective(project, keyResult.objectiveId);
  requireActiveUser(project, parsed.ownerId);
  const updated: KeyResult = { ...parsed, id: keyResult.id, objectiveId: keyResult.objectiveId };
  const cycles = withActiveCycleSnapshot(project, [parsed.ownerId]);
  return parseProject({
    ...project,
    cycles,
    keyResults: project.keyResults.map((candidate) =>
      candidate.id === keyResultId ? updated : candidate,
    ),
  });
}

export function createActiveInitiative(
  project: Project,
  input: InitiativeInput,
  idFactory: () => string = createUuid,
): Project {
  const parsed = InitiativeInputSchema.parse(input);
  const keyResult = project.keyResults.find(
    (candidate) => candidate.id === parsed.keyResultId,
  );
  if (!keyResult) throw new ProjectValidationError("Key Result not found.");
  requireActiveObjective(project, keyResult.objectiveId);
  requireActiveUser(project, parsed.ownerId);
  parsed.collaboratorIds.forEach((id) => requireActiveUser(project, id));
  const progressAndStatus = resolveInitiativeProgress(parsed);
  assertDoneInitiativeHasNoOpenTasks(progressAndStatus.status, parsed.tasks);
  const normalized = {
    ...parsed,
    ...progressAndStatus,
  };
  const initiative: Initiative = {
    ...normalized,
    id: idFactory(),
    progress: normalized.status === "done" ? 100 : normalized.progress,
  };
  const cycles = withActiveCycleSnapshot(project, [
    parsed.ownerId,
    ...parsed.collaboratorIds,
  ]);
  return parseProject({
    ...project,
    cycles,
    initiatives: [...project.initiatives, initiative],
  });
}

export function updateActiveInitiative(
  project: Project,
  initiativeId: string,
  input: InitiativeInput,
): Project {
  const parsed = InitiativeInputSchema.parse(input);
  const current = project.initiatives.find(
    (initiative) => initiative.id === initiativeId,
  );
  if (!current) throw new ProjectValidationError("Initiative not found.");
  const currentKeyResult = project.keyResults.find(
    (candidate) => candidate.id === current.keyResultId,
  );
  if (!currentKeyResult) {
    throw new ProjectValidationError("Key Result not found.");
  }
  requireActiveObjective(project, currentKeyResult.objectiveId);
  const keyResult = project.keyResults.find(
    (candidate) => candidate.id === parsed.keyResultId,
  );
  if (!keyResult) throw new ProjectValidationError("Key Result not found.");
  requireActiveObjective(project, keyResult.objectiveId);
  const progressAndStatus = resolveInitiativeProgress(parsed, current);
  if (
    current.status === "done" &&
    parsed.status !== "done" &&
    progressAndStatus.progress >= 100
  ) {
    throw new ProjectValidationError(
      "Enter a new progress value below 100% when moving an Initiative out of Done.",
    );
  }
  if (
    current.status === "done" &&
    parsed.status === "done" &&
    progressAndStatus.progress < 100 &&
    !(parsed.syncProgressToTasks &&
      JSON.stringify(parsed.tasks) !== JSON.stringify(current.tasks))
  ) {
    throw new ProjectValidationError(
      "Select another status before saving progress below 100% for a Done Initiative.",
    );
  }
  const normalized = {
    ...parsed,
    ...progressAndStatus,
  };
  assertDoneInitiativeHasNoOpenTasks(
    normalized.status,
    normalized.tasks,
    current.status,
  );
  requireActiveUser(project, normalized.ownerId);
  normalized.collaboratorIds.forEach((id) => requireActiveUser(project, id));
  if (normalized.keyResultId !== current.keyResultId) {
    requireActiveObjective(project, keyResult.objectiveId);
  }
  const updated: Initiative = {
    ...normalized,
    id: current.id,
    progress: normalized.status === "done" ? 100 : normalized.progress,
  };
  const cycles = withActiveCycleSnapshot(project, [
    normalized.ownerId,
    ...normalized.collaboratorIds,
  ]);
  return parseProject({
    ...project,
    cycles,
    initiatives: project.initiatives.map((initiative) =>
      initiative.id === initiativeId ? updated : initiative,
    ),
  });
}

export function deleteUser(project: Project, userId: string): Project {
  if (!project.users.some((user) => user.id === userId)) {
    throw new ProjectValidationError("User not found.");
  }
  if (!canDeleteUser(project, userId)) {
    throw new ProjectValidationError(
      "This user is assigned to a planned or active cycle. Remove or replace the user in those assignments before deleting.",
    );
  }
  return parseProject({
    ...project,
    users: project.users.filter((user) => user.id !== userId),
  });
}
