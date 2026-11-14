import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectValidationError } from "../domain/project";
import {
  calculateCycleEndMonth,
  calculateNextCycleStartMonth,
} from "../domain/cycles";
import { getCycleHistory } from "../domain/history";
import type { Project } from "../shared/types";
import type { ProjectFilePicker } from "./file-picker";
import { JsonProjectRepository } from "./persistence/project-repository";
import { ProjectSession } from "./project-session";
import { RecentProjectStore } from "./recent-project";

const directories: string[] = [];

class TestFilePicker implements ProjectFilePicker {
  constructor(
    private readonly newPath: string | null,
    private readonly openPath: string | null,
  ) {}

  async chooseOpenProject(): Promise<string | null> {
    return this.openPath;
  }

  async chooseNewProjectPath(): Promise<string | null> {
    return this.newPath;
  }
}

async function createSession(): Promise<{
  projectPath: string;
  session: ProjectSession;
  repository: JsonProjectRepository;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-okr-session-"));
  directories.push(directory);
  const projectPath = path.join(directory, "project.json");
  const repository = new JsonProjectRepository();
  const session = new ProjectSession(
    repository,
    new TestFilePicker(projectPath, projectPath),
  );
  return { projectPath, session, repository };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("ProjectSession vertical workflow", () => {
  it("remembers and restores the last-opened project", async () => {
    const { projectPath } = await createSession();
    const settingsPath = path.join(path.dirname(projectPath), "settings", "recent.json");
    const repository = new JsonProjectRepository();
    const recentProjectStore = new RecentProjectStore(settingsPath);
    const session = new ProjectSession(
      repository,
      new TestFilePicker(projectPath, projectPath),
      recentProjectStore,
    );

    const created = await session.createProject({ name: "Remembered project" });
    if (!created) throw new Error("Expected the project file dialog to succeed.");
    await recentProjectStore.write(projectPath);

    const restoredSession = new ProjectSession(
      repository,
      new TestFilePicker(null, null),
      recentProjectStore,
    );
    await restoredSession.restoreLastProject();

    expect(restoredSession.getSession().project).toEqual(created);
    expect(restoredSession.getSession().fileName).toBe("project.json");
    expect(restoredSession.getSession().recoveryMessage).toBeNull();
  });

  it("shows a recovery message when the remembered project is unavailable", async () => {
    const { projectPath } = await createSession();
    const settingsPath = path.join(path.dirname(projectPath), "recent.json");
    const recentProjectStore = new RecentProjectStore(settingsPath);
    await recentProjectStore.write(path.join(path.dirname(projectPath), "missing.json"));
    const session = new ProjectSession(
      new JsonProjectRepository(),
      new TestFilePicker(null, null),
      recentProjectStore,
    );

    await session.restoreLastProject();

    expect(session.getSession().project).toBeNull();
    expect(session.getSession().recoveryMessage).toContain(
      "last-opened project could not be reopened",
    );
  });

  it("creates, edits, activates, closes, and reopens a first-cycle project", async () => {
    const { projectPath, session } = await createSession();
    const created = await session.createProject({
      name: "Local OKR project",
      description: "A saved local project.",
    });
    if (!created) throw new Error("Expected the project file dialog to succeed.");

    let project = await session.addUser({
      name: "Morgan Example",
      email: "morgan@example.com",
      active: true,
    });
    const user = project.users[0];
    const draft = project.planningDraft;
    const goal = draft?.companyGoals[0];
    const objectiveDraft = draft?.objectives[0];
    const firstKeyResult = objectiveDraft?.keyResults[0];
    if (!user || !draft || !goal || !objectiveDraft || !firstKeyResult) {
      throw new Error("Expected initialized project planning data.");
    }

    project = await session.saveProject({
      ...project,
      planningDraft: {
        ...draft,
        cadence: "quarterly",
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
            ...objectiveDraft,
            title: "Improve customer retention",
            description: "Help customers achieve their goals.",
            ownerId: user.id,
            companyGoalIds: [goal.id],
            keyResults: [
              {
                ...firstKeyResult,
                title: "Retained customer rate",
                description: "Measure customer retention.",
                ownerId: user.id,
                metricType: "percentage_target",
                startValue: 20,
                currentValue: 45,
                targetValue: 70,
              },
            ],
          },
        ],
      },
    });
    expect(project.planningDraft).not.toBeNull();

    const activated = await session.activateFirstCycle();
    expect(activated.cycles[0]).toMatchObject({
      cadence: "quarterly",
      endMonth: expect.stringMatching(/^\d{4}-(0[1-9]|1[0-2])$/),
      status: "active",
    });
    expect(activated.objectives[0]?.title).toBe("Improve customer retention");
    expect(activated.keyResults[0]?.metricType).toBe("percentage_target");

    const onDisk: unknown = JSON.parse(await readFile(projectPath, "utf8"));
    expect(onDisk).toMatchObject({ schemaVersion: 1, currentCycleId: activated.currentCycleId });

    const reopenedSession = new ProjectSession(
      new JsonProjectRepository(),
      new TestFilePicker(null, projectPath),
    );
    const reopened = await reopenedSession.openProject();
    expect(reopened).toEqual(activated);
    expect(reopenedSession.getSession().fileName).toBe("project.json");
    expect(reopenedSession.getSession().recoveryMessage).toBeNull();
  });

  it("completes the create-to-history workflow across two persisted cycles", async () => {
    const { projectPath, session } = await createSession();
    const created = await session.createProject({ name: "Acceptance workflow" });
    if (!created) throw new Error("Expected the project file dialog to succeed.");
    let project = await session.addUser({
      name: "Casey Owner",
      email: "casey@example.com",
      active: true,
    });
    const user = project.users[0];
    const firstDraft = project.planningDraft;
    const firstGoal = firstDraft?.companyGoals[0];
    const firstObjective = firstDraft?.objectives[0];
    const firstKeyResult = firstObjective?.keyResults[0];
    if (!user || !firstDraft || !firstGoal || !firstObjective || !firstKeyResult) {
      throw new Error("Expected an initialized project.");
    }
    project = await session.saveProject({
      ...project,
      planningDraft: {
        ...firstDraft,
        planningFocus: "Improve customer retention.",
        companyGoals: [
          { ...firstGoal, title: "Grow sustainably", description: "Build durable growth." },
        ],
        objectives: [
          {
            ...firstObjective,
            title: "Improve retention",
            description: "Help customers succeed.",
            ownerId: user.id,
            companyGoalIds: [firstGoal.id],
            keyResults: [
              {
                ...firstKeyResult,
                title: "Retained customers",
                description: "Measure retained customers.",
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
    });
    const firstActive = await session.activateFirstCycle();
    const activeKeyResult = firstActive.keyResults[0];
    if (!activeKeyResult) throw new Error("Expected an active Key Result.");
    const updatedProgress = await session.updateKeyResult(activeKeyResult.id, {
      title: activeKeyResult.title,
      description: activeKeyResult.description,
      ownerId: user.id,
      metricType: "number_target",
      startValue: 0,
      currentValue: 8,
      targetValue: 10,
    });
    const initiativeProject = await session.createInitiative({
      keyResultId: activeKeyResult.id,
      title: "Interview at-risk customers",
      description: "Find ways to improve customer outcomes.",
      ownerId: user.id,
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 10,
    });
    const initiative = initiativeProject.initiatives[0];
    if (!initiative) throw new Error("Expected an Initiative.");
    const doneInitiatives = await session.updateInitiative(initiative.id, {
      keyResultId: initiative.keyResultId,
      title: initiative.title,
      description: initiative.description,
      ownerId: initiative.ownerId,
      collaboratorIds: initiative.collaboratorIds,
      priority: initiative.priority,
      targetDate: initiative.targetDate,
      status: "done",
      progress: 10,
    });
    expect(doneInitiatives.initiatives[0]).toMatchObject({
      status: "done",
      progress: 100,
    });
    expect(updatedProgress.keyResults[0]).toMatchObject({
      metricType: "number_target",
      currentValue: 8,
    });

    const firstCompleted = await session.submitReview({
      cycleId: firstActive.currentCycleId,
      successes: "Retention improved.",
      failures: "Some customers still left.",
      lessonsLearned: "Earlier outreach is useful.",
      nextActions: "Start outreach sooner.",
    });
    const completedFirstCycle = structuredClone(firstCompleted.cycles[0]);
    const secondDraft = firstCompleted.planningDraft;
    const secondGoal = secondDraft?.companyGoals[0];
    const secondObjective = secondDraft?.objectives[0];
    const secondKeyResult = secondObjective?.keyResults[0];
    if (!secondDraft || !secondGoal || !secondObjective || !secondKeyResult) {
      throw new Error("Expected planning to unlock after review submission.");
    }
    const preparedSecondCycle = await session.saveProject({
      ...firstCompleted,
      planningDraft: {
        ...secondDraft,
        cadence: "quarterly",
        planningFocus: "Retain more customers.",
        companyGoals: [
          {
            ...secondGoal,
            title: "Grow sustainably",
            description: "Build durable growth.",
          },
        ],
        objectives: [
          {
            ...secondObjective,
            title: "Improve customer retention",
            description: "Help customers achieve their goals.",
            ownerId: user.id,
            companyGoalIds: [secondGoal.id],
            keyResults: [
              {
                ...secondKeyResult,
                title: "Retained customer rate",
                description: "Measure customers retained.",
                ownerId: user.id,
                metricType: "percentage_target",
                startValue: 50,
                currentValue: 55,
                targetValue: 80,
              },
            ],
          },
        ],
      },
    });
    const secondActive = await session.activateFirstCycle();
    expect(secondActive.cycles[0]).toEqual(completedFirstCycle);
    expect(secondActive.cycles[1]?.startMonth).toBe(
      calculateNextCycleStartMonth(completedFirstCycle!.endMonth),
    );
    expect(secondActive.cycles[1]?.endMonth).toBe(
      calculateCycleEndMonth(secondActive.cycles[1]!.startMonth, "quarterly"),
    );
    expect(preparedSecondCycle.planningDraft?.planningFocus).toBe(
      "Retain more customers.",
    );
    const history = getCycleHistory(secondActive, completedFirstCycle!.id);
    expect(history).toMatchObject({
      overallProgress: 80,
      review: {
        successes: "Retention improved.",
        failures: "Some customers still left.",
        lessonsLearned: "Earlier outreach is useful.",
        nextActions: "Start outreach sooner.",
      },
      objectives: [
        {
          keyResults: [
            {
              progress: 80,
              initiatives: [
                {
                  initiative: { title: "Interview at-risk customers", progress: 100 },
                },
              ],
            },
          ],
        },
      ],
    });

    const restartedSession = new ProjectSession(
      new JsonProjectRepository(),
      new TestFilePicker(null, projectPath),
    );
    const restarted = await restartedSession.openProject();
    expect(restarted).toEqual(secondActive);
    expect(restarted?.currentCycleId).toBe(secondActive.currentCycleId);
    expect(getCycleHistory(restarted!, completedFirstCycle!.id)?.review).toEqual(
      history?.review,
    );
  });

  it("saves and reopens a complete subsequent-cycle draft before activation", async () => {
    const { projectPath, session } = await createSession();
    const created = await session.createProject({
      name: "Subsequent-cycle project",
    });
    if (!created) throw new Error("Expected the project file dialog to succeed.");
    let project = await session.addUser({
      name: "Morgan Example",
      email: "morgan@example.com",
      active: true,
    });
    const user = project.users[0];
    const initialDraft = project.planningDraft;
    const initialGoal = initialDraft?.companyGoals[0];
    const initialObjective = initialDraft?.objectives[0];
    const initialKeyResult = initialObjective?.keyResults[0];
    if (!user || !initialDraft || !initialGoal || !initialObjective || !initialKeyResult) {
      throw new Error("Expected initialized first-cycle planning data.");
    }
    project = await session.saveProject({
      ...project,
      planningDraft: {
        ...initialDraft,
        cadence: "quarterly",
        planningFocus: "Improve customer retention.",
        companyGoals: [
          { ...initialGoal, title: "Grow sustainably", description: "Build durable growth." },
        ],
        objectives: [
          {
            ...initialObjective,
            title: "Improve retention",
            description: "Help customers achieve their goals.",
            ownerId: user.id,
            companyGoalIds: [initialGoal.id],
            keyResults: [
              {
                ...initialKeyResult,
                title: "Retained customers",
                description: "Measure retained customers.",
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
    });
    const firstCycle = await session.activateFirstCycle();
    const completed = await session.submitReview({
      cycleId: firstCycle.currentCycleId,
      successes: "Retention improved.",
      failures: "Some customers churned.",
      lessonsLearned: "Onboarding needs work.",
      nextActions: "Test a shorter onboarding flow.",
    });
    const previousCycle = completed.cycles[0];
    const previousGoals = completed.companyGoals.filter(
      (goal) => goal.cycleId === previousCycle?.id,
    );
    const nextDraft = completed.planningDraft;
    const proposedGoal = nextDraft?.companyGoals[0];
    const nextObjective = nextDraft?.objectives[0];
    const nextKeyResult = nextObjective?.keyResults[0];
    if (!previousCycle || !nextDraft || !proposedGoal || !nextObjective || !nextKeyResult) {
      throw new Error("Expected review completion to seed the next-cycle draft.");
    }
    const newGoal = {
      id: randomUUID(),
      title: "Expand into new markets",
      description: "Build a sustainable presence in new markets.",
    };
    const nextPlanned = await session.saveProject({
      ...completed,
      planningDraft: {
        ...nextDraft,
        cadence: "yearly",
        planningFocus: "Expand while retaining existing customers.",
        companyGoals: [
          { ...proposedGoal, title: "Grow sustainably", description: "Build durable growth." },
          newGoal,
        ],
        objectives: [
          {
            ...nextObjective,
            title: "Improve retention",
            description: "Help customers achieve their goals.",
            ownerId: user.id,
            companyGoalIds: [proposedGoal.id, newGoal.id],
            keyResults: [
              {
                ...nextKeyResult,
                title: "Retained customers",
                description: "Measure retained customers.",
                ownerId: user.id,
                metricType: "percentage_target",
                startValue: 0,
                currentValue: 20,
                targetValue: 80,
              },
            ],
          },
        ],
      },
    });

    const restartedSession = new ProjectSession(
      new JsonProjectRepository(),
      new TestFilePicker(null, projectPath),
    );
    const reopened = await restartedSession.openProject();
    expect(reopened?.planningDraft).toEqual(nextPlanned.planningDraft);
    expect(reopened?.planningDraft).toMatchObject({
      cadence: "yearly",
      planningFocus: "Expand while retaining existing customers.",
      companyGoals: [
        { title: "Grow sustainably" },
        { title: "Expand into new markets" },
      ],
      objectives: [
        {
          title: "Improve retention",
          keyResults: [{ metricType: "percentage_target", targetValue: 80 }],
        },
      ],
    });

    const secondCycleActive = await restartedSession.activateFirstCycle();
    const secondCycle = secondCycleActive.cycles.find(
      (cycle) => cycle.id === secondCycleActive.currentCycleId,
    );
    const expectedStart = calculateNextCycleStartMonth(previousCycle.endMonth);
    expect(secondCycle).toMatchObject({
      startMonth: expectedStart,
      endMonth: calculateCycleEndMonth(expectedStart, "yearly"),
      cadence: "yearly",
      planningFocus: "Expand while retaining existing customers.",
      status: "active",
    });
    expect(secondCycleActive.cycles[0]).toEqual(previousCycle);
    expect(
      secondCycleActive.companyGoals.filter(
        (goal) => goal.cycleId === previousCycle.id,
      ),
    ).toEqual(previousGoals);
  });

  it("surfaces backup recovery after reopening a damaged project", async () => {
    const { projectPath, session } = await createSession();
    const created = await session.createProject({
      name: "Recoverable project",
      description: "A project with a recovery backup.",
    });
    if (!created) throw new Error("Expected the project file dialog to succeed.");
    const draft = created.planningDraft;
    if (!draft) throw new Error("Expected the initial planning draft.");
    await session.saveProject({
      ...created,
      planningDraft: { ...draft, planningFocus: "Updated planning focus." },
    });
    await writeFile(projectPath, "{interrupted write");

    const restartedSession = new ProjectSession(
      new JsonProjectRepository(),
      new TestFilePicker(null, projectPath),
    );
    const recovered = await restartedSession.openProject();

    expect(recovered?.name).toBe("Recoverable project");
    expect(restartedSession.getSession().recoveryMessage).toContain(
      "last valid backup",
    );
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toMatchObject({
      name: "Recoverable project",
    });
  });

  it("persists review, completion, snapshots, and next planning in one save", async () => {
    const { projectPath, session, repository } = await createSession();
    const created = await session.createProject({
      name: "Review workflow",
    });
    if (!created) throw new Error("Expected the project file dialog to succeed.");
    let project = await session.addUser({
      name: "Morgan Example",
      email: "morgan@example.com",
      active: true,
    });
    const draft = project.planningDraft;
    const goal = draft?.companyGoals[0];
    const objective = draft?.objectives[0];
    const keyResult = objective?.keyResults[0];
    const user = project.users[0];
    if (!draft || !goal || !objective || !keyResult || !user) {
      throw new Error("Expected an initialized planning draft.");
    }
    project = await session.saveProject({
      ...project,
      planningDraft: {
        ...draft,
        planningFocus: "Improve retention.",
        companyGoals: [
          { ...goal, title: "Grow sustainably", description: "Build durable growth." },
        ],
        objectives: [
          {
            ...objective,
            title: "Improve retention",
            description: "Help customers succeed.",
            ownerId: user.id,
            companyGoalIds: [goal.id],
            keyResults: [
              {
                ...keyResult,
                title: "Retained customers",
                description: "Measure customer retention.",
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
    });
    const active = await session.activateFirstCycle();
    const originalSave = repository.save.bind(repository);
    let saves = 0;
    repository.save = async (filePath: string, nextProject: Project) => {
      saves += 1;
      return originalSave(filePath, nextProject);
    };

    const input = {
      cycleId: active.currentCycleId,
      successes: "Retention improved.",
      failures: "Some customers churned.",
      lessonsLearned: "Onboarding needs work.",
      nextActions: "Test a shorter onboarding flow.",
    };
    const completed = await session.submitReview(input);
    expect(saves).toBe(1);
    expect(completed.currentCycleId).toBeNull();
    expect(completed.cycles[0]?.status).toBe("completed");
    expect(completed.reviews).toHaveLength(1);
    expect(completed.planningDraft?.companyGoals[0]?.title).toBe(
      "Grow sustainably",
    );
    const diskProject: Project = JSON.parse(
      await readFile(projectPath, "utf8"),
    ) as Project;
    expect(diskProject).toMatchObject({
      currentCycleId: null,
      reviews: [expect.objectContaining({ completed: true })],
      cycles: [expect.objectContaining({ status: "completed" })],
      planningDraft: {
        companyGoals: [
          expect.objectContaining({ title: "Grow sustainably" }),
        ],
      },
    });
  });

  it("does not complete a cycle when the atomic review save fails", async () => {
    const { projectPath, session, repository } = await createSession();
    const created = await session.createProject({
      name: "Failed review save",
    });
    if (!created) throw new Error("Expected the project file dialog to succeed.");
    let project = await session.addUser({
      name: "Morgan Example",
      email: "morgan@example.com",
      active: true,
    });
    const draft = project.planningDraft;
    const goal = draft?.companyGoals[0];
    const objective = draft?.objectives[0];
    const keyResult = objective?.keyResults[0];
    const user = project.users[0];
    if (!draft || !goal || !objective || !keyResult || !user) {
      throw new Error("Expected an initialized planning draft.");
    }
    project = await session.saveProject({
      ...project,
      planningDraft: {
        ...draft,
        planningFocus: "Improve retention.",
        companyGoals: [
          { ...goal, title: "Grow sustainably", description: "Build durable growth." },
        ],
        objectives: [
          {
            ...objective,
            title: "Improve retention",
            description: "Help customers succeed.",
            ownerId: user.id,
            companyGoalIds: [goal.id],
            keyResults: [
              {
                ...keyResult,
                title: "Retained customers",
                description: "Measure customer retention.",
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
    });
    const active = await session.activateFirstCycle();
    const originalSave = repository.save.bind(repository);
    repository.save = async () => {
      throw new Error("Simulated disk write failure.");
    };

    await expect(
      session.submitReview({
        cycleId: active.currentCycleId,
        successes: "Retention improved.",
        failures: "Some customers churned.",
        lessonsLearned: "Onboarding needs work.",
        nextActions: "Test a shorter onboarding flow.",
      }),
    ).rejects.toThrow("Simulated disk write failure");
    expect(session.getSession().project?.currentCycleId).toBe(
      active.currentCycleId,
    );
    expect(session.getSession().project?.cycles[0]?.status).toBe("active");
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toMatchObject({
      currentCycleId: active.currentCycleId,
      cycles: [expect.objectContaining({ status: "active" })],
    });
    repository.save = originalSave;
  });

  it("serializes simultaneous project mutations", async () => {
    const { projectPath, session } = await createSession();
    await session.createProject({
      name: "Serialized project",
      description: "Concurrent mutations must not overlap.",
    });
    const [first, second] = await Promise.all([
      session.addUser({
        name: "First User",
        email: "first@example.com",
        active: true,
      }),
      session.addUser({
        name: "Second User",
        email: "second@example.com",
        active: true,
      }),
    ]);

    expect(first.users).toHaveLength(1);
    expect(second.users).toHaveLength(2);
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({ email: "first@example.com" }),
        expect.objectContaining({ email: "second@example.com" }),
      ]),
    });
  });

  it("does not activate an invalid planning draft", async () => {
    const { session } = await createSession();
    await session.createProject({
      name: "Invalid draft project",
      description: "A saved local project.",
    });
    await expect(session.activateFirstCycle()).rejects.toBeInstanceOf(
      ProjectValidationError,
    );
    expect(session.getSession().project?.currentCycleId).toBeNull();
  });

  it("returns no project when the user cancels project selection", async () => {
    const session = new ProjectSession(
      new JsonProjectRepository(),
      new TestFilePicker(null, null),
    );
    await expect(
      session.createProject({
        name: "Canceled project",
        description: "No file should be created.",
      }),
    ).resolves.toBeNull();
    expect(session.getSession().project).toBeNull();
  });
});
