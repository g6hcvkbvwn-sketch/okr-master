import { z } from "zod";
import { ProjectSchema, UUIDSchema } from "../shared/schemas";
import type {
  ActiveKeyResultInput,
  ActiveObjectiveInput,
  ActiveObjectiveUpdate,
  CreateProjectRequest,
  InitiativeInput,
  UserInput,
} from "../shared/schemas";
import type {
  EditorSaveState,
  Project,
  ReviewDraft,
  SessionState,
  ViewerPublishResult,
  ViewerPublishSettings,
} from "../shared/types";

const StoredProjectSchema = z.object({
  project: ProjectSchema,
  revision: z.number().int().positive(),
}).strict();
const ProjectSummarySchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  description: z.string(),
  revision: z.number().int().positive(),
}).strict();

export type CloudProjectSummary = z.infer<typeof ProjectSummarySchema>;
let active: { id: string; revision: number } | null = null;
let queue: Promise<void> = Promise.resolve();

async function request<T extends z.ZodTypeAny>(
  path: string,
  schema: T,
  options?: RequestInit,
): Promise<z.output<T>> {
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, cache: "no-store" });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(`The server returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(value);
    throw new Error(error.success ? error.data.error : `Request failed (HTTP ${response.status}).`);
  }
  return schema.parse(value);
}

function install(value: z.output<typeof StoredProjectSchema>): Project {
  active = { id: value.project.id, revision: value.revision };
  sessionStorage.setItem("okr-cloud-project", value.project.id);
  return value.project;
}

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

async function mutate(action: string, input?: unknown, id?: string): Promise<Project> {
  return serialized(async () => {
    if (!active) throw new Error("Open a cloud project first.");
    const value = await request(`/api/projects/${encodeURIComponent(active.id)}/actions`, StoredProjectSchema, {
      method: "POST",
      headers: { "If-Match": `"${active.revision}"` },
      body: JSON.stringify({ action, input, id }),
    });
    return install(value);
  });
}

export async function listCloudProjects(): Promise<CloudProjectSummary[]> {
  return request("/api/projects", z.array(ProjectSummarySchema));
}

export async function selectCloudProject(id: string): Promise<Project> {
  return serialized(async () => {
    const value = await request(`/api/projects/${encodeURIComponent(id)}`, StoredProjectSchema);
    return install(value);
  });
}

export async function importCloudProject(project: unknown): Promise<Project> {
  return serialized(async () => install(await request("/api/projects", StoredProjectSchema, {
    method: "POST",
    body: JSON.stringify({ kind: "import", project }),
  })));
}

export async function restoreCloudProject(project: Project): Promise<Project> {
  return serialized(async () => {
    if (!active || active.id !== project.id) throw new Error("Open this project before restoring it.");
    return install(await request(`/api/projects/${encodeURIComponent(project.id)}/restore`, StoredProjectSchema, {
      method: "POST",
      headers: { "If-Match": `"${active.revision}"` },
      body: JSON.stringify(project),
    }));
  });
}

function unavailable(): never {
  throw new Error("Viewer publishing is available in the desktop app only.");
}

export const cloudApi = {
  async getSession(): Promise<SessionState> {
    const id = sessionStorage.getItem("okr-cloud-project");
    const project = id ? await selectCloudProject(id) : null;
    return { project, fileName: null, recoveryMessage: null };
  },
  async updateEditorSaveState(_state: EditorSaveState): Promise<{ accepted: true }> {
    return { accepted: true };
  },
  async getViewerPublishSettings(): Promise<ViewerPublishSettings> { return unavailable(); },
  async chooseViewerPublishDirectory(): Promise<string | null> { return unavailable(); },
  async saveViewerPublishSettings(_input: { directory: string; publishOnClose: boolean }): Promise<ViewerPublishSettings> { return unavailable(); },
  async publishViewer(): Promise<ViewerPublishResult> { return unavailable(); },
  async publishViewerAndPush(): Promise<ViewerPublishResult> { return unavailable(); },
  async createProject(input: CreateProjectRequest): Promise<Project | null> {
    return serialized(async () => install(await request("/api/projects", StoredProjectSchema, {
      method: "POST",
      body: JSON.stringify({ kind: "create", project: input }),
    })));
  },
  async openProject(): Promise<Project | null> { throw new Error("Choose a cloud project from the list."); },
  async saveProject(project: Project): Promise<Project> {
    return serialized(async () => {
      if (!active || active.id !== project.id) throw new Error("The open project changed before saving.");
      return install(await request(`/api/projects/${encodeURIComponent(project.id)}`, StoredProjectSchema, {
        method: "PUT",
        headers: { "If-Match": `"${active.revision}"` },
        body: JSON.stringify(project),
      }));
    });
  },
  activateFirstCycle(): Promise<Project> { return mutate("activate"); },
  submitReview(input: Omit<ReviewDraft, never>): Promise<Project> { return mutate("review", input); },
  createUser(input: UserInput): Promise<Project> { return mutate("add-user", input); },
  updateUser(id: string, input: UserInput): Promise<Project> { return mutate("update-user", input, id); },
  deleteUser(id: string): Promise<Project> { return mutate("delete-user", undefined, id); },
  createObjective(input: ActiveObjectiveInput): Promise<Project> { return mutate("create-objective", input); },
  updateObjective(id: string, input: ActiveObjectiveUpdate): Promise<Project> { return mutate("update-objective", input, id); },
  createKeyResult(id: string, input: ActiveKeyResultInput): Promise<Project> { return mutate("create-key-result", input, id); },
  updateKeyResult(id: string, input: ActiveKeyResultInput): Promise<Project> { return mutate("update-key-result", input, id); },
  createInitiative(input: InitiativeInput): Promise<Project> { return mutate("create-initiative", input); },
  updateInitiative(id: string, input: InitiativeInput): Promise<Project> { return mutate("update-initiative", input, id); },
};
