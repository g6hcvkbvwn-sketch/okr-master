import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ActiveKeyResultInputSchema,
  InitiativeInputSchema,
  KeyResultSchema,
} from "./schemas";

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
