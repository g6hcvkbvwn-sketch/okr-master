import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  calculateCycleEndMonth,
  getNextCycleMilestone,
  getCycleTimeline,
  isBeforeCycleEnd,
} from "./cycles";
import {
  completedCyclesChronologically,
  getCycleHistory,
} from "./history";
import {
  activateFirstCycle,
  assertProjectAutosaveAllowed,
  assertProjectIntegrity,
  canDeleteUser,
  calculateInitiativeTaskProgress,
  createProject,
  createActiveInitiative,
  createActiveKeyResult,
  createActiveObjective,
  deleteUser,
  movePlanningCompanyGoal,
  removePlanningCompanyGoal,
  parseProject,
  submitCycleReview,
  statusAfterInitiativeProgressChange,
  updateActiveInitiative,
  updateActiveKeyResult,
  updateActiveObjective,
  updateUser,
  UnsupportedSchemaVersionError,
  validateFirstCycleDraft,
} from "./project";
import {
  calculateCycleProgress,
  getProgressBand,
  calculateNumberTargetProgress,
  calculateObjectiveProgress,
  calculatePercentageTargetProgress,
  calculateYesNoProgress,
} from "./progress";
import type { Cadence, KeyResult, Project } from "../shared/types";

function testKeyResult(
  metricType: KeyResult["metricType"],
  values: Record<string, number | boolean> = {},
): KeyResult {
  const common = {
    id: randomUUID(),
    objectiveId: randomUUID(),
    title: "Improve customer retention",
    description: "Measure customer retention improvement.",
    ownerId: randomUUID(),
  };
  if (metricType === "yes_no") {
    return {
      ...common,
      metricType,
      value: typeof values.value === "boolean" ? values.value : false,
    };
  }
  return {
    ...common,
    metricType,
    startValue: Number(values.startValue ?? 0),
    currentValue: Number(values.currentValue ?? 0),
    targetValue: Number(values.targetValue ?? 1),
  };
}

function withValidFirstCycle(
  cadence: Cadence = "monthly",
): { project: Project; userId: string } {
  let project = createProject({
    name: "Test project",
    description: "A project for the automated tests.",
  });
  const user = {
    id: randomUUID(),
    name: "Alex Example",
    email: "alex@example.com",
    active: true,
  };
  project = { ...project, users: [user] };
  const draft = project.planningDraft;
  if (!draft) throw new Error("Expected a new planning draft.");
  const goal = draft.companyGoals[0];
  const objective = draft.objectives[0];
  const keyResult = objective?.keyResults[0];
  if (!goal || !keyResult) throw new Error("Expected initialized planning fields.");

  project = {
    ...project,
    planningDraft: {
      ...draft,
      cadence,
      planningFocus: "Improve customer retention.",
      companyGoals: [
        {
          ...goal,
          title: "Grow sustainably",
          description: "Build durable growth.",
        },
      ],
      objectives: [
        {
          ...objective,
          title: "Improve retention",
          description: "Help more customers succeed.",
          ownerId: user.id,
          companyGoalIds: [goal.id],
          keyResults: [
            {
              ...keyResult,
              title: "Increase retained customers",
              description: "Measure retained customer growth.",
              ownerId: user.id,
              metricType: "number_target",
              startValue: 0,
              currentValue: 5,
              targetValue: 10,
            },
          ],
        },
      ],
    },
  };
  return { project: parseProject(project), userId: user.id };
}

describe("Key Result progress", () => {
  it("calculates Number Target progress from start, current, and target", () => {
    expect(calculateNumberTargetProgress(10, 25, 40)).toBe(50);
  });

  it("calculates Percentage Target progress", () => {
    expect(calculatePercentageTargetProgress(10, 40, 70)).toBe(50);
  });

  it("calculates progress toward decreasing targets", () => {
    expect(calculateNumberTargetProgress(10, 7.5, 5)).toBe(50);
    expect(calculatePercentageTargetProgress(40, 30, 20)).toBe(50);
  });

  it("calculates Yes / No progress", () => {
    expect(calculateYesNoProgress(false)).toBe(0);
    expect(calculateYesNoProgress(true)).toBe(100);
  });

  it("clamps progress at zero and one hundred", () => {
    expect(calculateNumberTargetProgress(0, -3, 10)).toBe(0);
    expect(calculateNumberTargetProgress(0, 13, 10)).toBe(100);
  });

  it("rejects zero targets, targets equal to start, and invalid percentages", () => {
    expect(() => calculateNumberTargetProgress(0, 2, 0)).toThrow(
      "Target must be a finite non-zero number",
    );
    expect(() => calculateNumberTargetProgress(4, 5, 4)).toThrow(
      "different from the start value",
    );
    expect(() => calculatePercentageTargetProgress(0, 60, 0)).toThrow(
      "different from the start value",
    );
    expect(() => calculatePercentageTargetProgress(0, 101, 90)).toThrow(
      "from 0 to 100",
    );
  });

  it("rounds the arithmetic mean of Key Result progress", () => {
    const results = [
      testKeyResult("number_target", {
        startValue: 0,
        currentValue: 2,
        targetValue: 3,
      }),
      testKeyResult("yes_no", { value: true }),
      testKeyResult("yes_no", { value: false }),
    ];
    expect(calculateObjectiveProgress(results)).toBe(56);
  });

  it("rejects an Objective with no Key Results", () => {
    expect(() => calculateObjectiveProgress([])).toThrow(
      "An Objective must have at least one Key Result.",
    );
  });
});

describe("progress bands", () => {
  it.each([
    [0, "off-track"],
    [29, "off-track"],
    [30, "at-risk"],
    [70, "at-risk"],
    [71, "on-track"],
    [100, "on-track"],
  ] as const)("classifies %i%% as %s", (progress, expected) => {
    expect(getProgressBand(progress)).toBe(expected);
  });
});

describe("Cycle review completion", () => {
  it("calculates overall cycle performance as the rounded mean of Objectives", () => {
    expect(calculateCycleProgress([20, 51])).toBe(36);
    expect(() => calculateCycleProgress([])).toThrow("at least one Objective");
  });

  it("completes a cycle with goal and assigned-user snapshots and unlocks planning", () => {
    const active = activateFirstCycle(withValidFirstCycle().project);
    const firstUser = active.users[0];
    const keyResult = active.keyResults[0];
    const goal = active.companyGoals[0];
    if (!firstUser || !keyResult || !goal) {
      throw new Error("Expected an active cycle with assigned records.");
    }
    const secondUser = {
      id: randomUUID(),
      name: "Taylor Collaborator",
      email: "taylor@example.com",
      active: true,
    };
    const withSecondUser = parseProject({
      ...active,
      users: [...active.users, secondUser],
    });
    const withInitiative = createActiveInitiative(withSecondUser, {
      keyResultId: keyResult.id,
      title: "Run customer interviews",
      description: "Gather customer feedback.",
      ownerId: firstUser.id,
      collaboratorIds: [secondUser.id],
      priority: 1,
      targetDate: "2026-12-15",
      status: "in_progress",
      progress: 40,
    });

    const completed = submitCycleReview(withInitiative, {
      cycleId: active.currentCycleId,
      successes: "Retention improved.",
      failures: "Some customers churned.",
      lessonsLearned: "Onboarding needs simplification.",
      nextActions: "Test a shorter onboarding flow.",
    });
    const completedCycle = completed.cycles[0];

    expect(completed.currentCycleId).toBeNull();
    expect(completed.planningDraft).not.toBeNull();
    expect(completed.reviewDraft).toBeNull();
    expect(completed.reviews).toHaveLength(1);
    expect(completed.reviews[0]).toMatchObject({
      cycleId: active.currentCycleId,
      overallProgress: 50,
      completed: true,
    });
    expect(completedCycle?.status).toBe("completed");
    expect(completedCycle?.companyGoalSnapshots).toEqual([
      {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        priority: goal.priority,
      },
    ]);
    expect(completedCycle?.userSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: firstUser.id }),
        expect.objectContaining({ id: secondUser.id }),
      ]),
    );
    expect(completed.planningDraft?.companyGoals).toMatchObject([
      { title: goal.title, description: goal.description },
    ]);
    expect(completed.planningDraft?.companyGoals[0]?.id).not.toBe(goal.id);
    expect(() =>
      assertProjectAutosaveAllowed(withInitiative, completed),
    ).toThrow("explicit workflow");
  });

  it("rejects incomplete and mismatched review submissions", () => {
    const active = activateFirstCycle(withValidFirstCycle().project);
    expect(() =>
      submitCycleReview(active, {
        cycleId: active.currentCycleId,
        successes: "Completed an objective.",
        failures: "",
        lessonsLearned: "Learned something.",
        nextActions: "Take action.",
      }),
    ).toThrow();
    expect(() =>
      submitCycleReview(active, {
        cycleId: randomUUID(),
        successes: "Completed an objective.",
        failures: "Something failed.",
        lessonsLearned: "Learned something.",
        nextActions: "Take action.",
      }),
    ).toThrow("does not belong to the active cycle");
    expect(active.cycles[0]?.status).toBe("active");
    expect(active.reviews).toHaveLength(0);
  });

  it("plans a consecutive cycle with revised ordered goals and an independent cadence", () => {
    const firstCycleActive = activateFirstCycle(
      withValidFirstCycle("quarterly").project,
      { now: new Date(2026, 9, 4) },
    );
    const firstCycleId = firstCycleActive.currentCycleId;
    if (!firstCycleId) throw new Error("Expected an active first cycle.");
    expect(firstCycleActive.cycles[0]?.endMonth).toBe("2026-12");
    expect(() => activateFirstCycle(firstCycleActive)).toThrow(
      "There is no planning draft",
    );

    const completed = submitCycleReview(firstCycleActive, {
      cycleId: firstCycleId,
      successes: "Improved retention.",
      failures: "Some customers churned.",
      lessonsLearned: "Onboarding can be clearer.",
      nextActions: "Test a shorter onboarding flow.",
    });
    expect(() =>
      assertProjectAutosaveAllowed(firstCycleActive, {
        ...firstCycleActive,
        planningDraft: completed.planningDraft,
      }),
    ).toThrow("unavailable until the active cycle review is submitted");
    const priorCycles = structuredClone(completed.cycles);
    const previousGoals = structuredClone(
      completed.companyGoals.filter((goal) => goal.cycleId === firstCycleId),
    );
    const draft = completed.planningDraft;
    const proposal = draft?.companyGoals[0];
    const objective = draft?.objectives[0];
    const keyResult = objective?.keyResults[0];
    const user = completed.users[0];
    if (!draft || !proposal || !objective || !keyResult || !user) {
      throw new Error("Expected a seeded next-cycle planning draft.");
    }
    const addedGoal = {
      id: randomUUID(),
      title: "Expand into new markets",
      description: "Build a sustainable presence in new markets.",
    };
    const removedGoal = {
      id: randomUUID(),
      title: "Temporary proposal",
      description: "This proposal will be removed.",
    };
    const draftWithThreeGoals = {
      ...draft,
      cadence: "yearly" as const,
      planningFocus: "Expand while retaining existing customers.",
      companyGoals: [
        {
          ...proposal,
          title: "Grow sustainably",
          description: "Build durable customer growth.",
        },
        addedGoal,
        removedGoal,
      ],
      objectives: [
        {
          ...objective,
          title: "Improve customer retention",
          description: "Help customers achieve their intended outcomes.",
          ownerId: user.id,
          companyGoalIds: [proposal.id, addedGoal.id, removedGoal.id],
          keyResults: [
            {
              ...keyResult,
              title: "Retained customer rate",
              description: "Measure retained customers.",
              ownerId: user.id,
              metricType: "number_target" as const,
              startValue: 0,
              currentValue: 20,
              targetValue: 40,
            },
          ],
        },
      ],
    };
    const withoutRemovedGoal = removePlanningCompanyGoal(
      draftWithThreeGoals,
      removedGoal.id,
    );
    expect(withoutRemovedGoal.companyGoals.map((goal) => goal.id)).toEqual([
      proposal.id,
      addedGoal.id,
    ]);
    expect(withoutRemovedGoal.objectives[0]?.companyGoalIds).toEqual([
      proposal.id,
      addedGoal.id,
    ]);
    const singleGoalDraft = removePlanningCompanyGoal(
      withoutRemovedGoal,
      addedGoal.id,
    );
    expect(removePlanningCompanyGoal(singleGoalDraft, proposal.id)).toBe(
      singleGoalDraft,
    );

    const reorderedDraft = movePlanningCompanyGoal(
      withoutRemovedGoal,
      addedGoal.id,
      -1,
    );
    expect(reorderedDraft.companyGoals.map((goal) => goal.id)).toEqual([
      addedGoal.id,
      proposal.id,
    ]);
    expect(
      movePlanningCompanyGoal(reorderedDraft, addedGoal.id, -1),
    ).toBe(reorderedDraft);

    const planned = parseProject({
      ...completed,
      planningDraft: reorderedDraft,
    });
    const secondCycleActive = activateFirstCycle(planned, {
      now: new Date(2030, 0, 1),
    });
    const secondCycle = secondCycleActive.cycles.find(
      (cycle) => cycle.id === secondCycleActive.currentCycleId,
    );
    expect(secondCycle).toMatchObject({
      startMonth: "2027-01",
      endMonth: "2027-12",
      cadence: "yearly",
      planningFocus: "Expand while retaining existing customers.",
      status: "active",
    });
    expect(
      secondCycleActive.companyGoals
        .filter((goal) => goal.cycleId === secondCycle?.id)
        .map(({ title, priority }) => ({ title, priority })),
    ).toEqual([
      { title: "Expand into new markets", priority: 1 },
      { title: "Grow sustainably", priority: 2 },
    ]);
    expect(secondCycleActive.cycles.slice(0, priorCycles.length)).toEqual(
      priorCycles,
    );
    expect(
      secondCycleActive.companyGoals.filter(
        (goal) => goal.cycleId === firstCycleId,
      ),
    ).toEqual(previousGoals);

    if (!secondCycle) throw new Error("Expected the next active cycle.");
    expect(() =>
      parseProject({
        ...secondCycleActive,
        cycles: secondCycleActive.cycles.map((cycle) =>
          cycle.id === secondCycle.id
            ? { ...cycle, startMonth: "2026-12", endMonth: "2027-11" }
            : cycle,
        ),
      }),
    ).toThrow("Cycle periods must be consecutive and non-overlapping.");
  });
});

describe("completed cycle history", () => {
  it("lists only completed cycles in chronological order", () => {
    const active = activateFirstCycle(withValidFirstCycle().project);
    const activeCycle = active.cycles[0];
    if (!activeCycle) throw new Error("Expected an active cycle.");
    const olderCycle = {
      ...activeCycle,
      id: randomUUID(),
      startMonth: "2025-10",
      endMonth: "2025-12",
      status: "completed" as const,
    };
    const newerCycle = {
      ...activeCycle,
      id: randomUUID(),
      startMonth: "2026-01",
      endMonth: "2026-03",
      status: "completed" as const,
    };
    const cycles = completedCyclesChronologically({
      ...active,
      cycles: [newerCycle, activeCycle, olderCycle],
    });

    expect(cycles.map((cycle) => cycle.startMonth)).toEqual([
      "2025-10",
      "2026-01",
    ]);
  });

  it("displays completed results and snapshot users after rename, deactivation, and deletion", () => {
    const { project, userId } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const keyResult = active.keyResults[0];
    const goal = active.companyGoals[0];
    if (!keyResult || !goal) throw new Error("Expected active cycle records.");
    expect(getCycleHistory(active, active.currentCycleId!)).toBeUndefined();
    const collaborator = {
      id: randomUUID(),
      name: "Taylor Snapshot",
      email: "taylor@example.com",
      active: true,
    };
    const withCollaborator = parseProject({
      ...active,
      users: [...active.users, collaborator],
    });
    const withInitiative = createActiveInitiative(withCollaborator, {
      keyResultId: keyResult.id,
      title: "Interview current customers",
      description: "Collect customer feedback.",
      ownerId: userId,
      collaboratorIds: [collaborator.id],
      priority: 1,
      targetDate: "2026-12-15",
      status: "in_progress",
      progress: 65,
    });
    const completed = submitCycleReview(withInitiative, {
      cycleId: active.currentCycleId,
      successes: "Retention improved.",
      failures: "Some customers churned.",
      lessonsLearned: "Onboarding needs work.",
      nextActions: "Test a shorter onboarding flow.",
    });
    const renamedOwner = updateUser(completed, userId, {
      name: "Changed Current Name",
      email: "changed@example.com",
      active: false,
    });
    const withoutCollaborator = deleteUser(renamedOwner, collaborator.id);
    const cycleId = completed.cycles[0]?.id;
    if (!cycleId) throw new Error("Expected the completed cycle.");
    const history = getCycleHistory(withoutCollaborator, cycleId);

    expect(history).toBeDefined();
    expect(history?.companyGoals).toMatchObject([
      { id: goal.id, title: goal.title, description: goal.description },
    ]);
    expect(history?.overallProgress).toBe(50);
    expect(history?.objectives[0]).toMatchObject({
      progress: 50,
      owner: {
        id: userId,
        name: "Alex Example",
        email: "alex@example.com",
      },
      companyGoals: [{ id: goal.id, title: goal.title }],
      keyResults: [
        {
          progress: 50,
          owner: { id: userId, name: "Alex Example" },
          initiatives: [
            {
              initiative: {
                title: "Interview current customers",
                progress: 65,
              },
              owner: { id: userId, name: "Alex Example" },
              collaborators: [
                {
                  id: collaborator.id,
                  name: "Taylor Snapshot",
                  email: "taylor@example.com",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(history?.review).toMatchObject({
      successes: "Retention improved.",
      failures: "Some customers churned.",
      lessonsLearned: "Onboarding needs work.",
      nextActions: "Test a shorter onboarding flow.",
    });
    expect(getCycleHistory(withoutCollaborator, randomUUID())).toBeUndefined();
  });
});

describe("cycle duration", () => {
  it.each([
    ["monthly", "2026-10", "2026-10"],
    ["quarterly", "2026-10", "2026-12"],
    ["yearly", "2026-10", "2027-09"],
    ["monthly", "2026-12", "2026-12"],
  ] as const)("calculates %s end month", (cadence, start, expected) => {
    expect(calculateCycleEndMonth(start, cadence)).toBe(expected);
  });

  it("rejects invalid year-month input", () => {
    expect(() => calculateCycleEndMonth("2026-13", "monthly")).toThrow(
      "Invalid year-month",
    );
  });

  it("positions current day and planning markers inside a calendar-month timeline", () => {
    const active = activateFirstCycle(withValidFirstCycle("quarterly").project, {
      now: new Date(2026, 9, 4),
    });
    const cycle = active.cycles[0];
    if (!cycle) throw new Error("Expected an active cycle.");
    const timeline = getCycleTimeline(cycle, new Date(2026, 10, 15));

    expect(timeline.startDate).toBe("2026-10-01");
    expect(timeline.endDate).toBe("2026-12-31");
    expect(timeline.months).toHaveLength(3);
    expect(timeline.weekPositions).toHaveLength(13);
    expect(timeline.weekPositions[0]).toBeCloseTo((7 / 91) * 100);
    expect(timeline.weekPositions.at(-1)).toBeCloseTo((91 / 91) * 100);
    expect(timeline.currentDay).toBe(45);
    expect(timeline.alignmentDate).toBe("2026-12-10");
    expect(timeline.reviewPlanningDate).toBe("2026-12-17");
    expect(timeline.alignmentPosition).toBeGreaterThan(0);
    expect(timeline.reviewPlanningPosition).toBeGreaterThan(
      timeline.alignmentPosition,
    );
    expect(timeline.reviewPlanningPosition).toBeLessThan(100);
    expect(getCycleTimeline(cycle, new Date(2027, 0, 1)).currentDay).toBeNull();
  });

  it("uses quarterly cadence for newly created projects and planning drafts", () => {
    const project = createProject({
      name: "Test project",
      description: "A project for the automated tests.",
    });

    expect(project.cadence).toBe("quarterly");
    expect(project.planningDraft?.cadence).toBe("quarterly");
  });

  it("selects the next relevant cycle milestone", () => {
    const active = activateFirstCycle(withValidFirstCycle("quarterly").project, {
      now: new Date(2026, 9, 4),
    });
    const cycle = active.cycles[0];
    if (!cycle) throw new Error("Expected an active cycle.");

    expect(getNextCycleMilestone(cycle, new Date(2026, 9, 2))).toEqual({
      label: "Team alignment",
      date: "2026-12-10",
    });
    expect(getNextCycleMilestone(cycle, new Date(2026, 11, 11))).toEqual({
      label: "Review and planning",
      date: "2026-12-17",
    });
    expect(getNextCycleMilestone(cycle, new Date(2026, 11, 18))).toEqual({
      label: "Cycle ends",
      date: "2026-12-31",
    });
    expect(isBeforeCycleEnd(cycle, new Date(2026, 11, 30))).toBe(true);
    expect(isBeforeCycleEnd(cycle, new Date(2026, 11, 31))).toBe(false);
  });
});

describe("project validation and first-cycle activation", () => {
  it("rejects more than three Company Goals in a planning draft", () => {
    const project = createProject({
      name: "Project",
      description: "A project description.",
    });
    const draft = project.planningDraft;
    if (!draft) throw new Error("Expected a planning draft.");
    const tooManyGoals = [
      ...draft.companyGoals,
      { id: randomUUID(), title: "", description: "" },
      { id: randomUUID(), title: "", description: "" },
      { id: randomUUID(), title: "", description: "" },
    ];
    expect(() =>
      parseProject({
        ...project,
        planningDraft: { ...draft, companyGoals: tooManyGoals },
      }),
    ).toThrow("Invalid project data");
  });

  it("requires consecutive Company Goal priorities", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const duplicatePriority = {
      ...active,
      companyGoals: active.companyGoals.map((goal) => ({
        ...goal,
        priority: 2,
      })),
    };
    expect(() => assertProjectIntegrity(duplicatePriority)).toThrow(
      "consecutive starting at 1",
    );
  });

  it("reports incomplete first-cycle planning and blocks activation", () => {
    const project = createProject({
      name: "Project",
      description: "A project description.",
    });
    expect(validateFirstCycleDraft(project).length).toBeGreaterThan(0);
    expect(() => activateFirstCycle(project)).toThrow(
      "Enter the planning focus.",
    );
  });

  it("activates a valid first cycle with one owner and a Company Goal link", () => {
    const { project, userId } = withValidFirstCycle("quarterly");
    const active = activateFirstCycle(project, {
      now: new Date(2026, 9, 4),
    });
    expect(active.schemaVersion).toBe(1);
    expect(active.cycles).toHaveLength(1);
    expect(active.cycles[0]).toMatchObject({
      startMonth: "2026-10",
      endMonth: "2026-12",
      cadence: "quarterly",
      status: "active",
    });
    expect(active.currentCycleId).toBe(active.cycles[0]?.id);
    expect(active.objectives[0]?.ownerId).toBe(userId);
    expect(active.objectives[0]?.companyGoalIds).toEqual([
      active.companyGoals[0]?.id,
    ]);
    expect(active.objectives[0]?.keyResultIds).toHaveLength(1);
    expect(active.planningDraft).toBeNull();
  });

  it("allows a Key Result without a description during planning and activation", () => {
    const { project } = withValidFirstCycle();
    const draft = project.planningDraft;
    const objective = draft?.objectives[0];
    const keyResult = objective?.keyResults[0];
    if (!draft || !objective || !keyResult) {
      throw new Error("Expected an initialized planning draft.");
    }
    const withoutDescription: Project = {
      ...project,
      planningDraft: {
        ...draft,
        objectives: [
          {
            ...objective,
            keyResults: [{ ...keyResult, description: "" }],
          },
        ],
      },
    };

    expect(validateFirstCycleDraft(withoutDescription)).toEqual([]);
    expect(activateFirstCycle(withoutDescription).keyResults[0]?.description).toBe(
      "",
    );
  });

  it("rejects multiple active cycles", () => {
    const active = activateFirstCycle(withValidFirstCycle().project);
    const cycle = active.cycles[0];
    if (!cycle) throw new Error("Expected active cycle.");
    expect(() =>
      parseProject({
        ...active,
        cycles: [...active.cycles, { ...cycle, id: randomUUID() }],
      }),
    ).toThrow("Only one cycle may be active");
  });

  it("rejects unsupported newer schema versions", () => {
    const project = createProject({
      name: "Project",
      description: "A project description.",
    });
    expect(() =>
      parseProject({ ...project, schemaVersion: 2 }),
    ).toThrow(UnsupportedSchemaVersionError);
  });

  it("serializes and deserializes a version-one project", () => {
    const project = createProject({
      name: "Project",
      description: "A project description.",
    });
    const parsed = parseProject(JSON.parse(JSON.stringify(project)) as unknown);
    expect(parsed).toEqual(project);
  });

  it("normalizes a legacy single-Objective planning draft", () => {
    const project = createProject({
      name: "Legacy project",
      description: "A project with the earlier planning shape.",
    });
    const draft = project.planningDraft;
    const objective = draft?.objectives[0];
    if (!draft || !objective) throw new Error("Expected a planning Objective.");
    const legacy = {
      ...project,
      planningDraft: {
        cadence: draft.cadence,
        planningFocus: draft.planningFocus,
        companyGoals: draft.companyGoals,
        objective,
      },
    };

    expect(parseProject(legacy).planningDraft?.objectives).toEqual([objective]);
  });

  it("allows a missing project description", () => {
    expect(
      createProject({ name: "No description project" }).description,
    ).toBe("");
    expect(
      parseProject({
        ...createProject({
          name: "Legacy project without description",
          description: "Temporary description",
        }),
        description: undefined,
      }).description,
    ).toBe("");
  });

  it("activates multiple planning Objectives with their own Key Results", () => {
    const { project } = withValidFirstCycle();
    const draft = project.planningDraft;
    const objective = draft?.objectives[0];
    const keyResult = objective?.keyResults[0];
    if (!draft || !objective || !keyResult) {
      throw new Error("Expected an initialized planning Objective.");
    }
    const additionalObjective = {
      ...objective,
      id: randomUUID(),
      title: "Improve onboarding",
      description: "Help new customers start successfully.",
      keyResults: [
        {
          ...keyResult,
          id: randomUUID(),
          title: "Increase onboarding completion",
          description: "Measure completed customer onboarding.",
        },
      ],
    };
    const planned = parseProject({
      ...project,
      planningDraft: {
        ...draft,
        objectives: [objective, additionalObjective],
      },
    });

    const activated = activateFirstCycle(planned);
    expect(activated.objectives).toHaveLength(2);
    expect(activated.keyResults).toHaveLength(2);
    expect(activated.objectives[1]?.keyResultIds).toEqual([
      activated.keyResults[1]?.id,
    ]);
    expect(activated.keyResults[1]?.objectiveId).toBe(
      activated.objectives[1]?.id,
    );
  });

  it("requires every planning Objective to have a Key Result", () => {
    const { project } = withValidFirstCycle();
    const draft = project.planningDraft;
    const objective = draft?.objectives[0];
    if (!draft || !objective) throw new Error("Expected a planning Objective.");
    const secondObjective = {
      ...objective,
      id: randomUUID(),
      title: "Improve onboarding",
      description: "Help new customers start successfully.",
      keyResults: [],
    };
    const planned = parseProject({
      ...project,
      planningDraft: {
        ...draft,
        objectives: [...draft.objectives, secondObjective],
      },
    });

    expect(validateFirstCycleDraft(planned)).toContain(
      "Objective 2: add at least one Key Result.",
    );
    expect(() => activateFirstCycle(planned)).toThrow(
      "Objective 2: add at least one Key Result.",
    );
  });

  it("updates users and blocks deletion while assigned in the planning draft", () => {
    const { project, userId } = withValidFirstCycle();
    const user = project.users[0];
    if (!user) throw new Error("Expected the test user.");
    const updated = updateUser(project, userId, {
      name: "Alex Updated",
      email: "updated@example.com",
      active: false,
    });
    expect(updated.users[0]?.name).toBe("Alex Updated");
    expect(() => deleteUser(project, userId)).toThrow(
      "assigned to a planned or active cycle",
    );
    const draft = project.planningDraft;
    if (!draft) throw new Error("Expected a planning draft.");
    const unassigned = parseProject({
      ...project,
      planningDraft: {
        ...draft,
        objectives: draft.objectives.map((objective) => ({
          ...objective,
          ownerId: "",
          keyResults: objective.keyResults.map((keyResult) => ({
            ...keyResult,
            ownerId: "",
          })),
        })),
      },
    });
    expect(deleteUser(unassigned, userId).users).toHaveLength(0);
  });

  it("creates multiple Objectives linked to cycle goals and their own Key Results", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const userId = active.users[0]?.id;
    const goalId = active.companyGoals[0]?.id;
    if (!userId || !goalId) throw new Error("Expected an active owner and goal.");

    const expanded = createActiveObjective(active, {
      title: "Improve onboarding",
      description: "Help new customers succeed.",
      ownerId: userId,
      companyGoalIds: [goalId],
      keyResults: [
        {
          title: "Onboarding completion",
          description: "Measure onboarding completion.",
          ownerId: userId,
          metricType: "percentage_target",
          startValue: 20,
          currentValue: 40,
          targetValue: 80,
        },
      ],
    });
    expect(expanded.objectives).toHaveLength(2);
    expect(expanded.objectives[1]?.keyResultIds).toHaveLength(1);
    expect(expanded.keyResults[1]?.objectiveId).toBe(
      expanded.objectives[1]?.id,
    );
  });

  it("adds Key Results to an Objective in the active cycle", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const objective = active.objectives[0];
    const userId = active.users[0]?.id;
    if (!objective || !userId) {
      throw new Error("Expected an active Objective and owner.");
    }

    const updated = createActiveKeyResult(active, objective.id, {
      title: "Reduce support wait time",
      description: "Measure the average response time.",
      ownerId: userId,
      metricType: "number_target",
      startValue: 20,
      currentValue: 15,
      targetValue: 10,
    });
    expect(updated.objectives[0]?.keyResultIds).toHaveLength(2);
    expect(updated.keyResults).toHaveLength(2);
  });

  it("edits active Objective links and Key Result values with recalculated progress", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const objective = active.objectives[0];
    const keyResult = active.keyResults[0];
    const userId = active.users[0]?.id;
    const goalId = active.companyGoals[0]?.id;
    if (!objective || !keyResult || !userId || !goalId) {
      throw new Error("Expected an activated Objective and Key Result.");
    }

    const changedObjective = updateActiveObjective(active, objective.id, {
      title: "Edited objective",
      description: "Revised outcome.",
      ownerId: userId,
      companyGoalIds: [goalId],
    });
    const changedKeyResult = updateActiveKeyResult(
      changedObjective,
      keyResult.id,
      {
        title: keyResult.title,
        description: keyResult.description,
        ownerId: userId,
        metricType: "number_target",
        startValue: 0,
        currentValue: 8,
        targetValue: 10,
      },
    );
    expect(changedKeyResult.objectives[0]?.title).toBe("Edited objective");
    expect(changedKeyResult.keyResults[0]).toMatchObject({ currentValue: 8 });
    expect(calculateObjectiveProgress(changedKeyResult.keyResults)).toBe(80);
  });

  it("creates and updates Initiatives and enforces done progress transitions", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const keyResult = active.keyResults[0];
    const userId = active.users[0]?.id;
    if (!keyResult || !userId) throw new Error("Expected an active Key Result.");
    const created = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Interview current customers",
      description: "Collect customer feedback.",
      ownerId: userId,
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 20,
    });
    const initiative = created.initiatives[0];
    if (!initiative) throw new Error("Expected Initiative creation.");
    expect(initiative.progress).toBe(20);
    expect(initiative.status).toBe("in_progress");

    const autoCompleted = updateActiveInitiative(created, initiative.id, {
      keyResultId: keyResult.id,
      title: initiative.title,
      description: initiative.description,
      ownerId: userId,
      collaboratorIds: [],
      priority: 1,
      targetDate: initiative.targetDate,
      status: "in_progress",
      progress: 100,
    });

    expect(autoCompleted.initiatives[0]).toMatchObject({
      status: "done",
      progress: 100,
    });

    const done = updateActiveInitiative(created, initiative.id, {
      keyResultId: keyResult.id,
      title: initiative.title,
      description: initiative.description,
      ownerId: userId,
      collaboratorIds: [],
      priority: 1,
      targetDate: initiative.targetDate,
      status: "done",
      progress: 32,
    });
    expect(done.initiatives[0]?.progress).toBe(100);

    expect(() =>
      updateActiveInitiative(done, initiative.id, {
        keyResultId: keyResult.id,
        title: initiative.title,
        description: initiative.description,
        ownerId: userId,
        collaboratorIds: [],
        priority: 1,
        targetDate: initiative.targetDate,
        status: "done",
        progress: 45,
      }),
    ).toThrow("Select another status");

    expect(() =>
      updateActiveInitiative(done, initiative.id, {
        keyResultId: keyResult.id,
        title: initiative.title,
        description: initiative.description,
        ownerId: userId,
        collaboratorIds: [],
        priority: 1,
        targetDate: initiative.targetDate,
        status: "in_progress",
        progress: 100,
      }),
    ).toThrow("below 100%");

    const reopened = updateActiveInitiative(done, initiative.id, {
      keyResultId: keyResult.id,
      title: initiative.title,
      description: initiative.description,
      ownerId: userId,
      collaboratorIds: [],
      priority: 1,
      targetDate: initiative.targetDate,
      status: "in_progress",
      progress: 45,
    });
    expect(reopened.initiatives[0]?.progress).toBe(45);
  });

  it("allows Initiative descriptions to be blank or omitted", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const keyResult = active.keyResults[0];
    const userId = active.users[0]?.id;
    if (!keyResult || !userId) throw new Error("Expected an active Key Result.");

    const withoutDescription = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Send customer update",
      description: "",
      ownerId: userId,
      collaboratorIds: [],
      priority: 2,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 0,
    });
    expect(withoutDescription.initiatives[0]?.description).toBe("");

    const omittedDescription = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Follow up with customer",
      ownerId: userId,
      collaboratorIds: [],
      priority: 2,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 0,
    });
    expect(omittedDescription.initiatives[0]?.description).toBe("");
  });

  it("calculates synchronized Initiative progress from the ordered task list", () => {
    const tasks = [
      { id: randomUUID(), text: "First task", completed: true },
      { id: randomUUID(), text: "Second task", completed: false },
      { id: randomUUID(), text: "Third task", completed: false },
    ];
    expect(calculateInitiativeTaskProgress([])).toBeNull();
    expect(calculateInitiativeTaskProgress(tasks)).toBe(33);
    expect(
      calculateInitiativeTaskProgress(
        tasks.map((task) => ({ ...task, completed: true })),
      ),
    ).toBe(100);

    const active = activateFirstCycle(withValidFirstCycle().project);
    const keyResult = active.keyResults[0];
    const ownerId = active.users[0]?.id;
    if (!keyResult || !ownerId) throw new Error("Expected an active Key Result.");
    const withSyncedTasks = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Complete onboarding",
      description: "",
      ownerId,
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 92,
      tasks,
      syncProgressToTasks: true,
    });
    const initiative = withSyncedTasks.initiatives[0];
    if (!initiative) throw new Error("Expected a created Initiative.");
    expect(initiative).toMatchObject({
      progress: 33,
      status: "in_progress",
      syncProgressToTasks: true,
    });

    const completed = updateActiveInitiative(withSyncedTasks, initiative.id, {
      keyResultId: initiative.keyResultId,
      title: initiative.title,
      description: initiative.description,
      ownerId: initiative.ownerId,
      collaboratorIds: initiative.collaboratorIds,
      priority: initiative.priority,
      targetDate: initiative.targetDate,
      status: "in_progress",
      progress: initiative.progress,
      tasks: initiative.tasks.map((task) => ({ ...task, completed: true })),
      syncProgressToTasks: true,
    });
    expect(completed.initiatives[0]).toMatchObject({
      progress: 100,
      status: "done",
    });

    const reopened = updateActiveInitiative(
      completed,
      initiative.id,
      {
        keyResultId: initiative.keyResultId,
        title: initiative.title,
        description: initiative.description,
        ownerId: initiative.ownerId,
        collaboratorIds: initiative.collaboratorIds,
        priority: initiative.priority,
        targetDate: initiative.targetDate,
        status: "in_progress",
        progress: 100,
        tasks: initiative.tasks.map((task, index) => ({
          ...task,
          completed: index === 0,
        })),
        syncProgressToTasks: true,
      },
    );
    expect(reopened.initiatives[0]).toMatchObject({
      progress: 33,
      status: "in_progress",
    });
  });

  it("keeps task edits independent in manual mode and blocks moving open tasks to Done", () => {
    const active = activateFirstCycle(withValidFirstCycle().project);
    const keyResult = active.keyResults[0];
    const ownerId = active.users[0]?.id;
    if (!keyResult || !ownerId) throw new Error("Expected an active Key Result.");
    const withInitiative = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Prepare launch",
      description: "",
      ownerId,
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "in_progress",
      progress: 45,
      tasks: [{ id: randomUUID(), text: "Draft launch plan", completed: false }],
      syncProgressToTasks: false,
    });
    const initiative = withInitiative.initiatives[0];
    if (!initiative) throw new Error("Expected a created Initiative.");

    const taskUpdated = updateActiveInitiative(withInitiative, initiative.id, {
      keyResultId: initiative.keyResultId,
      title: initiative.title,
      description: initiative.description,
      ownerId: initiative.ownerId,
      collaboratorIds: initiative.collaboratorIds,
      priority: initiative.priority,
      targetDate: initiative.targetDate,
      status: initiative.status,
      progress: initiative.progress,
      tasks: initiative.tasks.map((task) => ({ ...task, completed: true })),
      syncProgressToTasks: false,
    });
    expect(taskUpdated.initiatives[0]).toMatchObject({
      progress: 45,
      status: "in_progress",
      tasks: [{ completed: true }],
    });

    expect(() =>
      updateActiveInitiative(withInitiative, initiative.id, {
        keyResultId: initiative.keyResultId,
        title: initiative.title,
        description: initiative.description,
        ownerId: initiative.ownerId,
        collaboratorIds: initiative.collaboratorIds,
        priority: initiative.priority,
        targetDate: initiative.targetDate,
        status: "done",
        progress: 100,
        tasks: initiative.tasks,
        syncProgressToTasks: false,
      }),
    ).toThrow("Complete all open tasks");
  });

  it("moves To Do Initiatives to In Progress when progress is entered", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const keyResult = active.keyResults[0];
    const userId = active.users[0]?.id;
    if (!keyResult || !userId) throw new Error("Expected an active Key Result.");
    const created = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Prepare a customer interview",
      description: "Schedule a customer interview.",
      ownerId: userId,
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 0,
    });
    const initiative = created.initiatives[0];
    if (!initiative) throw new Error("Expected Initiative creation.");
    expect(initiative.status).toBe("todo");
    expect(statusAfterInitiativeProgressChange("todo", 0)).toBe("in_progress");

    const enteredProgress = updateActiveInitiative(created, initiative.id, {
      keyResultId: initiative.keyResultId,
      title: initiative.title,
      description: initiative.description,
      ownerId: initiative.ownerId,
      collaboratorIds: initiative.collaboratorIds,
      priority: initiative.priority,
      targetDate: initiative.targetDate,
      status: "todo",
      progress: 35,
    });
    expect(enteredProgress.initiatives[0]).toMatchObject({
      status: "in_progress",
      progress: 35,
    });

    const startedAtZero = updateActiveInitiative(created, initiative.id, {
      keyResultId: initiative.keyResultId,
      title: initiative.title,
      description: initiative.description,
      ownerId: initiative.ownerId,
      collaboratorIds: initiative.collaboratorIds,
      priority: initiative.priority,
      targetDate: initiative.targetDate,
      status: "in_progress",
      progress: 0,
    });
    expect(startedAtZero.initiatives[0]).toMatchObject({
      status: "in_progress",
      progress: 0,
    });

    const blockedAtZero = updateActiveInitiative(created, initiative.id, {
      keyResultId: initiative.keyResultId,
      title: initiative.title,
      description: initiative.description,
      ownerId: initiative.ownerId,
      collaboratorIds: initiative.collaboratorIds,
      priority: initiative.priority,
      targetDate: initiative.targetDate,
      status: "blocked",
      progress: 0,
    });
    expect(blockedAtZero.initiatives[0]).toMatchObject({
      status: "blocked",
      progress: 0,
    });

    const blocked = updateActiveInitiative(created, initiative.id, {
      keyResultId: initiative.keyResultId,
      title: initiative.title,
      description: initiative.description,
      ownerId: initiative.ownerId,
      collaboratorIds: initiative.collaboratorIds,
      priority: initiative.priority,
      targetDate: initiative.targetDate,
      status: "blocked",
      progress: 99,
    });
    expect(blocked.initiatives[0]).toMatchObject({
      status: "blocked",
      progress: 99,
    });
    expect(statusAfterInitiativeProgressChange("todo", 100)).toBe("done");
    expect(statusAfterInitiativeProgressChange("blocked", 50)).toBe("blocked");
  });

  it("prevents deleting a user assigned as an Initiative owner or collaborator", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const keyResult = active.keyResults[0];
    const userId = active.users[0]?.id;
    if (!keyResult || !userId) throw new Error("Expected an active Key Result.");
    const withInitiative = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Coordinate outreach",
      description: "Coordinate customer outreach.",
      ownerId: userId,
      collaboratorIds: [],
      priority: 2,
      targetDate: "2026-11-30",
      status: "todo",
      progress: 0,
    });
    expect(canDeleteUser(withInitiative, userId)).toBe(false);
    expect(() => deleteUser(withInitiative, userId)).toThrow(
      "assigned to a planned or active cycle",
    );
  });

  it("preserves completed-cycle Initiative assignments when deleting a user", () => {
    const { project } = withValidFirstCycle();
    const active = activateFirstCycle(project);
    const keyResult = active.keyResults[0];
    const userId = active.users[0]?.id;
    if (!keyResult || !userId) throw new Error("Expected an active Key Result.");
    const withInitiative = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Complete customer interviews",
      description: "Gather customer feedback.",
      ownerId: userId,
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "done",
      progress: 100,
    });
    const completed = parseProject({
      ...withInitiative,
      currentCycleId: null,
      reviewDraft: null,
      cycles: withInitiative.cycles.map((cycle) => ({
        ...cycle,
        status: "completed",
      })),
    });

    const withoutUser = deleteUser(completed, userId);
    expect(withoutUser.users).toHaveLength(0);
    expect(withoutUser.initiatives).toHaveLength(1);
    expect(withoutUser.cycles[0]?.userSnapshots).toContainEqual(
      expect.objectContaining({ id: userId }),
    );
    expect(() =>
      updateActiveInitiative(
        withoutUser,
        withInitiative.initiatives[0]!.id,
        {
          keyResultId: keyResult.id,
          title: "Edited historical Initiative",
          description: "Should remain immutable.",
          ownerId: userId,
          collaboratorIds: [],
          priority: 1,
          targetDate: "2026-12-15",
          status: "done",
          progress: 100,
        },
      ),
    ).toThrow("active cycle");
  });

  it("preserves older schema-version-one files without an initiatives property", () => {
    const project = createProject({
      name: "Older project",
      description: "Created before initiative support.",
    });
    const { initiatives: _initiatives, ...olderProject } = project;
    const parsed = parseProject(olderProject);
    expect(parsed.initiatives).toEqual([]);
  });

  it("defaults newly added Initiative task fields when loading older version-one projects", () => {
    const active = activateFirstCycle(withValidFirstCycle().project);
    const keyResult = active.keyResults[0];
    const ownerId = active.users[0]?.id;
    if (!keyResult || !ownerId) throw new Error("Expected an active Key Result.");
    const withInitiative = createActiveInitiative(active, {
      keyResultId: keyResult.id,
      title: "Old Initiative",
      description: "",
      ownerId,
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 0,
    });
    const olderProject = {
      ...withInitiative,
      initiatives: withInitiative.initiatives.map(
        ({ tasks: _tasks, syncProgressToTasks: _sync, ...initiative }) =>
          initiative,
      ),
    };
    const parsed = parseProject(olderProject);
    expect(parsed.initiatives[0]).toMatchObject({
      tasks: [],
      syncProgressToTasks: false,
    });
  });
});
