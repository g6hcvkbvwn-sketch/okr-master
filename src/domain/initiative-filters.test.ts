import { describe, expect, it } from "vitest";
import {
  EMPTY_INITIATIVE_FILTER,
  filterInitiatives,
  hasInitiativeFilter,
} from "./initiative-filters";
import type { Initiative, KeyResult } from "../shared/types";

const keyResults = [
  { id: "kr-a", objectiveId: "objective-a" },
  { id: "kr-b", objectiveId: "objective-b" },
] satisfies Pick<KeyResult, "id" | "objectiveId">[];

const initiatives = [
  { id: "i-1", keyResultId: "kr-a", ownerId: "owner-a", priority: 1 },
  { id: "i-2", keyResultId: "kr-a", ownerId: "owner-b", priority: 2 },
  { id: "i-3", keyResultId: "kr-b", ownerId: "owner-a", priority: 1 },
] satisfies Pick<Initiative, "id" | "keyResultId" | "ownerId" | "priority">[];

describe("Initiative filters", () => {
  it("returns all initiatives when no filters are selected", () => {
    expect(filterInitiatives(initiatives, keyResults, EMPTY_INITIATIVE_FILTER)).toEqual(
      initiatives,
    );
  });

  it("combines objective, Key Result, owner, and priority filters", () => {
    expect(
      filterInitiatives(initiatives, keyResults, {
        objectiveId: "objective-a",
        keyResultId: "kr-a",
        ownerId: "owner-a",
        priority: "1",
      }),
    ).toEqual([initiatives[0]]);
  });

  it("reports whether any filter is active", () => {
    expect(hasInitiativeFilter(EMPTY_INITIATIVE_FILTER)).toBe(false);
    expect(
      hasInitiativeFilter({ ...EMPTY_INITIATIVE_FILTER, priority: "2" }),
    ).toBe(true);
  });
});
