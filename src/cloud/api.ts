import { z, ZodError } from "zod";
import {
  activateFirstCycle,
  addUser,
  assertProjectAutosaveAllowed,
  createActiveInitiative,
  createActiveKeyResult,
  createActiveObjective,
  createProject,
  deleteUser,
  parseProject,
  ProjectValidationError,
  submitCycleReview,
  UnsupportedSchemaVersionError,
  updateActiveInitiative,
  updateActiveKeyResult,
  updateActiveObjective,
  updateUser,
} from "../domain/project";
import {
  ActiveKeyResultInputSchema,
  ActiveObjectiveInputSchema,
  ActiveObjectiveUpdateSchema,
  CreateProjectRequestSchema,
  InitiativeInputSchema,
  UserInputSchema,
  UUIDSchema,
} from "../shared/schemas";
import type { Project } from "../shared/types";
import {
  CloudProjectConflictError,
  CloudProjectExistsError,
  CloudProjectStore,
  type StoredProject,
} from "./project-store";

const BodySchema = z.object({
  action: z.string(),
  id: UUIDSchema.optional(),
  input: z.unknown().optional(),
}).strict();
const MAX_BODY_BYTES = 2_000_000;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function body(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (declaredLength > MAX_BODY_BYTES) throw new ProjectValidationError("Project data is too large.");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) throw new ProjectValidationError("Project data is too large.");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ProjectValidationError("The request is not valid JSON.");
  }
}

function requiredId(id: string | undefined): string {
  return UUIDSchema.parse(id);
}

function applyAction(project: Project, raw: unknown): Project {
  const { action, input, id } = BodySchema.parse(raw);
  switch (action) {
    case "activate": return activateFirstCycle(project);
    case "review": return submitCycleReview(project, input);
    case "add-user": return addUser(project, UserInputSchema.parse(input));
    case "update-user": return updateUser(project, requiredId(id), UserInputSchema.parse(input));
    case "delete-user": return deleteUser(project, requiredId(id));
    case "create-objective": return createActiveObjective(project, ActiveObjectiveInputSchema.parse(input));
    case "update-objective": return updateActiveObjective(project, requiredId(id), ActiveObjectiveUpdateSchema.parse(input));
    case "create-key-result": return createActiveKeyResult(project, requiredId(id), ActiveKeyResultInputSchema.parse(input));
    case "update-key-result": return updateActiveKeyResult(project, requiredId(id), ActiveKeyResultInputSchema.parse(input));
    case "create-initiative": return createActiveInitiative(project, InitiativeInputSchema.parse(input));
    case "update-initiative": return updateActiveInitiative(project, requiredId(id), InitiativeInputSchema.parse(input));
    default: throw new ProjectValidationError("Unknown project operation.");
  }
}

function expectedRevision(request: Request): number {
  const value = request.headers.get("If-Match");
  if (!value || !/^"[1-9]\d*"$/.test(value)) {
    throw new ProjectValidationError("A valid project revision is required.");
  }
  const revision = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(revision)) throw new ProjectValidationError("A valid project revision is required.");
  return revision;
}

function result(value: StoredProject, status = 200): Response {
  return json(value, status);
}

export async function handleProjectApi(request: Request, store: CloudProjectStore): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) {
      return json({ error: "Invalid request origin." }, 403);
    }

    if (path === "/api/projects" && request.method === "GET") {
      const projects = await store.list();
      return json(projects.map(({ project, revision }) => ({
        id: project.id, name: project.name, description: project.description, revision,
      })));
    }
    if (path === "/api/projects" && request.method === "POST") {
      const input = z.object({ kind: z.enum(["create", "import"]), project: z.unknown() }).strict().parse(await body(request));
      const project = input.kind === "create"
        ? createProject(CreateProjectRequestSchema.parse(input.project))
        : parseProject(input.project);
      return result(await store.create(project), 201);
    }

    const match = /^\/api\/projects\/([^/]+)(\/actions|\/restore)?$/.exec(path);
    if (!match) return json({ error: "Not found." }, 404);
    const projectId = UUIDSchema.parse(match[1]);
    if (!match[2] && request.method === "GET") {
      const project = await store.load(projectId);
      return project ? result(project) : json({ error: "Project not found." }, 404);
    }
    if ((request.method === "PUT" && !match[2]) || (request.method === "POST" && match[2])) {
      const revision = expectedRevision(request);
      const current = await store.load(projectId);
      if (!current) return json({ error: "Project not found." }, 404);
      if (current.revision !== revision) throw new CloudProjectConflictError();
      const input = await body(request);
      let project: Project;
      if (match[2] === "/actions") {
        project = applyAction(current.project, input);
      } else if (match[2] === "/restore") {
        project = parseProject(input);
      } else {
        project = parseProject(input);
        assertProjectAutosaveAllowed(current.project, project);
      }
      if (project.id !== projectId) throw new ProjectValidationError("Cannot replace a project with a different project.");
      return result(await store.save(projectId, revision, project));
    }
    return json({ error: "Method not supported." }, 405);
  } catch (error) {
    if (error instanceof CloudProjectConflictError || error instanceof CloudProjectExistsError || error instanceof UnsupportedSchemaVersionError) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof ZodError || error instanceof ProjectValidationError) {
      return json({ error: error instanceof ZodError ? error.issues.map((issue) => issue.message).join(" ") : error.message }, 400);
    }
    console.error("Cloud project request failed.");
    return json({ error: "The project request failed. Check the server logs." }, 500);
  }
}
