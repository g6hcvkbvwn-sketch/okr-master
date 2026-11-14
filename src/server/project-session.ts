import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createActiveInitiative,
  createActiveKeyResult,
  createActiveObjective,
  activateFirstCycle,
  addUser,
  assertProjectAutosaveAllowed,
  createProject,
  deleteUser,
  parseProject,
  updateActiveInitiative,
  updateActiveKeyResult,
  updateActiveObjective,
  updateUser,
  submitCycleReview,
} from "../domain/project";
import {
  ActiveKeyResultInputSchema,
  ActiveObjectiveInputSchema,
  ActiveObjectiveUpdateSchema,
  CreateProjectRequestSchema,
  InitiativeInputSchema,
  UserInputSchema,
} from "../shared/schemas";
import type {
  ActiveKeyResultInput,
  ActiveObjectiveUpdate,
  InitiativeInput,
  UserInput,
} from "../shared/schemas";
import type { Project } from "../shared/types";
import type { ProjectFilePicker } from "./file-picker";
import type { ProjectPersistenceAdapter } from "./persistence/project-repository";
import { RecentProjectStore } from "./recent-project";

export class ProjectSession {
  private activeFilePath: string | null = null;
  private activeProject: Project | null = null;
  private recoveryMessage: string | null = null;
  private recentProjectMessage: string | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly repository: ProjectPersistenceAdapter,
    private readonly filePicker: ProjectFilePicker,
    private readonly recentProjectStore?: RecentProjectStore,
  ) {}

  getSession(): {
    project: Project | null;
    fileName: string | null;
    recoveryMessage: string | null;
  } {
    return {
      project: this.activeProject,
      fileName: this.activeFilePath ? basename(this.activeFilePath) : null,
      recoveryMessage: [this.recoveryMessage, this.recentProjectMessage]
        .filter((message): message is string => message !== null)
        .join(" ") || null,
    };
  }

  async restoreLastProject(): Promise<void> {
    if (!this.recentProjectStore) return;
    let filePath: string | null;
    try {
      filePath = await this.recentProjectStore.read();
    } catch (error) {
      this.recentProjectMessage =
        `The last project could not be remembered or reopened. Open it manually. ${
          error instanceof Error ? error.message : "The saved setting is invalid."
        }`;
      return;
    }
    if (!filePath) return;

    try {
      const loaded = await this.repository.load(filePath);
      this.setActiveProject(filePath, loaded.project);
      this.recoveryMessage = loaded.recoveryMessage;
    } catch (error) {
      this.recentProjectMessage =
        `The last-opened project could not be reopened. Open it manually or choose another project. ${
          error instanceof Error ? error.message : "Unknown project loading error."
        }`;
    }
  }

  async createProject(input: unknown): Promise<Project | null> {
    return this.serialized(async () => {
      const request = CreateProjectRequestSchema.parse(input);
      const filePath = await this.filePicker.chooseNewProjectPath();
      if (!filePath) return null;
      const project = createProject(request);
      const saved = await this.repository.create(filePath, project);
      this.setActiveProject(filePath, saved);
      this.recoveryMessage = null;
      await this.rememberProjectPath(filePath);
      return saved;
    });
  }

  async openProject(): Promise<Project | null> {
    return this.serialized(async () => {
      const filePath = await this.filePicker.chooseOpenProject();
      if (!filePath) return null;
      const loaded = await this.repository.load(filePath);
      this.setActiveProject(filePath, loaded.project);
      this.recoveryMessage = loaded.recoveryMessage;
      await this.rememberProjectPath(filePath);
      return loaded.project;
    });
  }

  async saveProject(input: unknown): Promise<Project> {
    return this.serialized(async () => {
      const { filePath, currentProject } = this.requireProject();
      const parsedProject = parseProject(input);
      if (parsedProject.id !== currentProject.id) {
        throw new Error(
          "Cannot replace the currently open project with another project.",
        );
      }
      assertProjectAutosaveAllowed(currentProject, parsedProject);
      const project = await this.repository.save(filePath, parsedProject);
      this.activeProject = project;
      return project;
    });
  }

  async addUser(input: unknown): Promise<Project> {
    return this.serialized(async () => {
      const user = UserInputSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      const project = addUser(currentProject, user, randomUUID);
      return this.saveCurrent(filePath, project);
    });
  }

  async updateUser(userId: string, input: unknown): Promise<Project> {
    return this.serialized(async () => {
      const changes: UserInput = UserInputSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      const project = updateUser(currentProject, userId, changes);
      return this.saveCurrent(filePath, project);
    });
  }

  async deleteUser(userId: string): Promise<Project> {
    return this.serialized(async () => {
      const { filePath, currentProject } = this.requireProject();
      const project = deleteUser(currentProject, userId);
      return this.saveCurrent(filePath, project);
    });
  }

  async activateFirstCycle(): Promise<Project> {
    return this.serialized(async () => {
      const { filePath, currentProject } = this.requireProject();
      const project = activateFirstCycle(currentProject);
      return this.saveCurrent(filePath, project);
    });
  }

  async submitReview(input: unknown): Promise<Project> {
    return this.serialized(async () => {
      const { filePath, currentProject } = this.requireProject();
      const project = submitCycleReview(currentProject, input);
      return this.saveCurrent(filePath, project);
    });
  }

  async createObjective(input: unknown): Promise<Project> {
    return this.serialized(async () => {
      const parsed = ActiveObjectiveInputSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      return this.saveCurrent(
        filePath,
        createActiveObjective(currentProject, parsed),
      );
    });
  }

  async updateObjective(
    objectiveId: string,
    input: unknown,
  ): Promise<Project> {
    return this.serialized(async () => {
      const parsed: ActiveObjectiveUpdate =
        ActiveObjectiveUpdateSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      return this.saveCurrent(
        filePath,
        updateActiveObjective(currentProject, objectiveId, parsed),
      );
    });
  }

  async createKeyResult(
    objectiveId: string,
    input: unknown,
  ): Promise<Project> {
    return this.serialized(async () => {
      const parsed: ActiveKeyResultInput =
        ActiveKeyResultInputSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      return this.saveCurrent(
        filePath,
        createActiveKeyResult(currentProject, objectiveId, parsed),
      );
    });
  }

  async updateKeyResult(
    keyResultId: string,
    input: unknown,
  ): Promise<Project> {
    return this.serialized(async () => {
      const parsed: ActiveKeyResultInput =
        ActiveKeyResultInputSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      return this.saveCurrent(
        filePath,
        updateActiveKeyResult(currentProject, keyResultId, parsed),
      );
    });
  }

  async createInitiative(input: unknown): Promise<Project> {
    return this.serialized(async () => {
      const parsed: InitiativeInput = InitiativeInputSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      return this.saveCurrent(
        filePath,
        createActiveInitiative(currentProject, parsed),
      );
    });
  }

  async updateInitiative(
    initiativeId: string,
    input: unknown,
  ): Promise<Project> {
    return this.serialized(async () => {
      const parsed: InitiativeInput = InitiativeInputSchema.parse(input);
      const { filePath, currentProject } = this.requireProject();
      return this.saveCurrent(
        filePath,
        updateActiveInitiative(currentProject, initiativeId, parsed),
      );
    });
  }

  private async saveCurrent(
    filePath: string,
    project: Project,
  ): Promise<Project> {
    const saved = await this.repository.save(filePath, project);
    this.activeProject = saved;
    return saved;
  }

  private requireProject(): {
    filePath: string;
    currentProject: Project;
  } {
    if (!this.activeFilePath || !this.activeProject) {
      throw new Error("Create or open a project first.");
    }
    return { filePath: this.activeFilePath, currentProject: this.activeProject };
  }

  private setActiveProject(filePath: string, project: Project): void {
    this.activeFilePath = filePath;
    this.activeProject = project;
  }

  private async rememberProjectPath(filePath: string): Promise<void> {
    if (!this.recentProjectStore) return;
    try {
      await this.recentProjectStore.write(filePath);
      this.recentProjectMessage = null;
    } catch (error) {
      this.recentProjectMessage =
        `The project is open, but OKR Master could not remember it for next launch. ${
          error instanceof Error ? error.message : "Unknown settings error."
        }`;
    }
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
