import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ActiveKeyResultInputSchema,
  InitiativeInputSchema,
  KeyResultSchema,
  ViewerPublishSettingsSchema,
} from "./schemas";
import { createProject, parseProject } from "../domain/project";

describe("project compatibility", () => {
  it("continues to accept previously valid project identifiers", () => {
    const project = createProject({ name: "Existing project" });
    const legacyId = "12345678-1234-1234-1234-123456789abc";
    expect(parseProject({ ...project, id: legacyId }).id).toBe(legacyId);
  });

  it("continues to read publication settings with minute-precision timestamps", () => {
    const settings = {
      directory: "/viewer",
      publishOnClose: false,
      lastPublishedFingerprint: null,
      lastPublishedPath: null,
      lastPublishedAt: "2026-01-01T00:00Z",
    };
    expect(ViewerPublishSettingsSchema.parse(settings).lastPublishedAt).toBe(
      settings.lastPublishedAt,
    );
    expect(
      ViewerPublishSettingsSchema.safeParse({
        ...settings,
        lastPublishedAt: "not-a-timestamp",
      }).success,
    ).toBe(false);
  });
});

describe("optional OKR descriptions", () => {
  it("defaults an omitted Key Result description in active and persisted data", () => {
    const ownerId = randomUUID();
    const objectiveId = randomUUID();
    const input = {
      title: "Reduce time to resolution",
      ownerId,
      metricType: "number_target" as const,
      startValue: 10,
      currentValue: 8,
      targetValue: 5,
    };

    expect(ActiveKeyResultInputSchema.parse(input).description).toBe("");
    expect(
      KeyResultSchema.parse({
        ...input,
        id: randomUUID(),
        objectiveId,
      }).description,
    ).toBe("");
  });

  it("defaults an omitted Initiative description", () => {
    const parsed = InitiativeInputSchema.parse({
      keyResultId: randomUUID(),
      title: "Interview customers",
      ownerId: randomUUID(),
      collaboratorIds: [],
      priority: 1,
      targetDate: "2026-12-15",
      status: "todo",
      progress: 0,
    });

    expect(parsed.description).toBe("");
  });
});
