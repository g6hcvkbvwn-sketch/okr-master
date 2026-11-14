import { describe, expect, it } from "vitest";
import { createProject } from "./project";
import {
  createViewerSnapshot,
  isViewerSnapshotStale,
  stringifyViewerSnapshot,
  viewerProjectForDisplay,
} from "./viewer-snapshot";
import type { Project } from "../shared/types";

function projectWithSensitiveDrafts(): Project {
  const project = createProject({
    name: "Example </script><!--\u2028 snapshot",
    description: "Snapshot test",
  });
  const user = {
    id: "90c34b9d-bb10-4a70-a12a-0f6e970e577a",
    name: "Alex Example",
    email: "private@example.com",
    active: true,
  };
  return {
    ...project,
    users: [user],
    reviewDraft: {
      cycleId: "90c34b9d-bb10-4a70-a12a-0f6e970e577b",
      successes: "Unsubmitted review",
      failures: "",
      lessonsLearned: "",
      nextActions: "",
    },
    planningDraft: {
      ...project.planningDraft!,
      planningFocus: "Unsubmitted planning draft",
    },
  };
}

describe("viewer snapshots", () => {
  it("embeds metadata and excludes emails and draft content", () => {
    const snapshot = createViewerSnapshot(
      projectWithSensitiveDrafts(),
      new Date("2026-10-16T00:00:00.000Z"),
    );
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toMatchObject({
      snapshotVersion: 1,
      schemaVersion: 1,
      generatedAt: "2026-10-16T00:00:00.000Z",
      projectName: "Example </script><!--\u2028 snapshot",
      project: {
        planningDraft: null,
        reviewDraft: null,
      },
    });
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Unsubmitted review");
    expect(serialized).not.toContain("Unsubmitted planning draft");
  });

  it("escapes content that could terminate or confuse the JSON script block", () => {
    const snapshot = createViewerSnapshot(projectWithSensitiveDrafts());
    const serialized = stringifyViewerSnapshot(snapshot);

    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<!--");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).toContain("\\u003c/script\\u003e");
    expect(serialized).toContain("\\u2028");
    expect(JSON.parse(serialized)).toEqual(snapshot);
  });

  it("rejects invalid or unsupported project data", () => {
    expect(() =>
      createViewerSnapshot({ ...projectWithSensitiveDrafts(), schemaVersion: 2 }),
    ).toThrow();
    expect(() => createViewerSnapshot({ name: "invalid" })).toThrow();
  });

  it("restores email-free display records without changing the embedded snapshot", () => {
    const snapshot = createViewerSnapshot(projectWithSensitiveDrafts());
    const displayProject = viewerProjectForDisplay(snapshot.project);

    expect(displayProject.users[0]?.email).toBe("");
    expect(snapshot.project.users[0]).not.toHaveProperty("email");
  });

  it("shows the stale state only after seven full days", () => {
    const generatedAt = "2026-10-01T12:00:00.000Z";
    const now = new Date("2026-10-08T12:00:00.000Z");
    expect(isViewerSnapshotStale(generatedAt, now)).toBe(false);
    expect(
      isViewerSnapshotStale(generatedAt, new Date(now.getTime() + 1)),
    ).toBe(true);
  });
});
