import { ProjectSchema, ViewerSnapshotSchema } from "../shared/schemas";
import type { Project } from "../shared/types";
import type { z } from "zod";

export type ViewerSnapshot = z.infer<typeof ViewerSnapshotSchema>;

export function createViewerSnapshot(
  value: unknown,
  generatedAt: Date = new Date(),
): ViewerSnapshot {
  if (!Number.isFinite(generatedAt.getTime())) {
    throw new Error("Snapshot generation time must be a valid date.");
  }
  const project = ProjectSchema.parse(value);
  const snapshotProject = {
    ...project,
    users: project.users.map(({ id, name, active }) => ({ id, name, active })),
    cycles: project.cycles.map((cycle) => ({
      ...cycle,
      userSnapshots: cycle.userSnapshots.map(({ id, name }) => ({ id, name })),
    })),
    planningDraft: null,
    reviewDraft: null,
  };

  return ViewerSnapshotSchema.parse({
    snapshotVersion: 1,
    schemaVersion: project.schemaVersion,
    generatedAt: generatedAt.toISOString(),
    projectName: project.name,
    project: snapshotProject,
  });
}

export function viewerProjectForDisplay(
  project: ViewerSnapshot["project"],
): Project {
  return {
    ...project,
    users: project.users.map((user) => ({ ...user, email: "" })),
    cycles: project.cycles.map((cycle) => ({
      ...cycle,
      userSnapshots: cycle.userSnapshots.map((user) => ({
        ...user,
        email: "",
      })),
    })),
  };
}

export function stringifyViewerSnapshot(snapshot: ViewerSnapshot): string {
  return JSON.stringify(snapshot)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function isViewerSnapshotStale(
  generatedAt: string,
  now: Date = new Date(),
): boolean {
  const generatedTime = Date.parse(generatedAt);
  if (!Number.isFinite(generatedTime) || !Number.isFinite(now.getTime())) {
    return false;
  }
  return now.getTime() - generatedTime > 7 * 24 * 60 * 60 * 1000;
}
