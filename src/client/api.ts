import type {
  CreateProjectRequest,
  UserInput,
} from "../shared/schemas";
import {
  ProjectSchema,
  ReviewSubmissionSchema,
  SessionStateSchema,
  ViewerPublishResultSchema,
  ViewerPublishSettingsSchema,
} from "../shared/schemas";
import { z } from "zod";
import type {
  Project,
  SessionState,
  ViewerPublishResult,
  ViewerPublishSettings,
  EditorSaveState,
} from "../shared/types";
import type {
  ActiveKeyResultInput,
  ActiveObjectiveInput,
  ActiveObjectiveUpdate,
  InitiativeInput,
} from "../shared/schemas";

async function request<Schema extends z.ZodTypeAny>(
  url: string,
  schema: Schema,
  options?: RequestInit,
): Promise<z.output<Schema> | null> {
  const headers = new Headers(options?.headers);
  if (options?.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204) return null;

  const result: unknown = await response.json();
  if (!response.ok) {
    const error =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `Request failed with status ${response.status}.`;
    throw new Error(error);
  }
  return schema.parse(result);
}

export const api = {
  getSession(): Promise<SessionState> {
    return request("/api/session", SessionStateSchema).then((value) => {
      if (!value) throw new Error("The server returned an empty session.");
      return value;
    });
  },
  updateEditorSaveState(state: EditorSaveState): Promise<{ accepted: true }> {
    return request(
      "/api/editor/save-state",
      z.object({ accepted: z.literal(true) }).strict(),
      {
        method: "POST",
        body: JSON.stringify(state),
      },
    ).then(requireResponse);
  },
  getViewerPublishSettings(): Promise<ViewerPublishSettings> {
    return request(
      "/api/publish/settings",
      ViewerPublishSettingsSchema,
    ).then(requireResponse);
  },
  chooseViewerPublishDirectory(): Promise<string | null> {
    return request(
      "/api/publish/choose-folder",
      z.object({ directory: z.string().nullable() }).strict(),
      { method: "POST" },
    ).then(requireResponse).then(({ directory }) => directory);
  },
  saveViewerPublishSettings(input: {
    directory: string;
    publishOnClose: boolean;
  }): Promise<ViewerPublishSettings> {
    return request("/api/publish/settings", ViewerPublishSettingsSchema, {
      method: "PUT",
      body: JSON.stringify(input),
    }).then(requireResponse);
  },
  publishViewer(): Promise<ViewerPublishResult> {
    return request("/api/publish", ViewerPublishResultSchema, {
      method: "POST",
    }).then(requireResponse);
  },
  publishViewerAndPush(): Promise<ViewerPublishResult> {
    return request("/api/publish/git", ViewerPublishResultSchema, {
      method: "POST",
    }).then(requireResponse);
  },
  createProject(input: CreateProjectRequest): Promise<Project | null> {
    return request("/api/project/create", ProjectSchema, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  openProject(): Promise<Project | null> {
    return request("/api/project/open", ProjectSchema, { method: "POST" });
  },
  saveProject(project: Project): Promise<Project> {
    return request("/api/project", ProjectSchema, {
      method: "PUT",
      body: JSON.stringify(project),
    }).then((value) => {
      if (!value) throw new Error("The project save returned no data.");
      return value;
    });
  },
  activateFirstCycle(): Promise<Project> {
    return request("/api/project/activate", ProjectSchema, {
      method: "POST",
    }).then((value) => {
      if (!value) throw new Error("Cycle activation returned no data.");
      return value;
    });
  },
  submitReview(input: z.input<typeof ReviewSubmissionSchema>): Promise<Project> {
    return request("/api/review/submit", ProjectSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }).then((value) => {
      if (!value) throw new Error("Review submission returned no project.");
      return value;
    });
  },
  createUser(input: UserInput): Promise<Project> {
    return request("/api/users", ProjectSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }).then((value) => {
      if (!value) throw new Error("User creation returned no project.");
      return value;
    });
  },
  updateUser(id: string, input: UserInput): Promise<Project> {
    return request(`/api/users/${encodeURIComponent(id)}`, ProjectSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then((value) => {
      if (!value) throw new Error("User update returned no project.");
      return value;
    });
  },
  deleteUser(id: string): Promise<Project> {
    return request(`/api/users/${encodeURIComponent(id)}`, ProjectSchema, {
      method: "DELETE",
    }).then((value) => {
      if (!value) throw new Error("User deletion returned no project.");
      return value;
    });
  },
  createObjective(input: ActiveObjectiveInput): Promise<Project> {
    return request("/api/objectives", ProjectSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }).then(requireProjectResponse);
  },
  updateObjective(
    id: string,
    input: ActiveObjectiveUpdate,
  ): Promise<Project> {
    return request(`/api/objectives/${encodeURIComponent(id)}`, ProjectSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then(requireProjectResponse);
  },
  createKeyResult(
    objectiveId: string,
    input: ActiveKeyResultInput,
  ): Promise<Project> {
    return request(
      `/api/objectives/${encodeURIComponent(objectiveId)}/key-results`,
      ProjectSchema,
      { method: "POST", body: JSON.stringify(input) },
    ).then(requireProjectResponse);
  },
  updateKeyResult(
    id: string,
    input: ActiveKeyResultInput,
  ): Promise<Project> {
    return request(`/api/key-results/${encodeURIComponent(id)}`, ProjectSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then(requireProjectResponse);
  },
  createInitiative(input: InitiativeInput): Promise<Project> {
    return request("/api/initiatives", ProjectSchema, {
      method: "POST",
      body: JSON.stringify(input),
    }).then(requireProjectResponse);
  },
  updateInitiative(id: string, input: InitiativeInput): Promise<Project> {
    return request(`/api/initiatives/${encodeURIComponent(id)}`, ProjectSchema, {
      method: "PATCH",
      body: JSON.stringify(input),
    }).then(requireProjectResponse);
  },
};

function requireProjectResponse(value: Project | null): Project {
  if (!value) throw new Error("The server returned no updated project.");
  return value;
}

function requireResponse<T>(value: T | null): T {
  if (!value) throw new Error("The server returned no publishing response.");
  return value;
}
