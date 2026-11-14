import type { Initiative, KeyResult } from "../shared/types";

export interface InitiativeFilter {
  objectiveId: string;
  keyResultId: string;
  ownerId: string;
  priority: string;
}

export const EMPTY_INITIATIVE_FILTER: InitiativeFilter = {
  objectiveId: "",
  keyResultId: "",
  ownerId: "",
  priority: "",
};

export function hasInitiativeFilter(filter: InitiativeFilter): boolean {
  return Boolean(
    filter.objectiveId || filter.keyResultId || filter.ownerId || filter.priority,
  );
}

export function filterInitiatives<
  T extends Pick<Initiative, "keyResultId" | "ownerId" | "priority">,
>(
  initiatives: readonly T[],
  keyResults: readonly Pick<KeyResult, "id" | "objectiveId">[],
  filter: InitiativeFilter,
): T[] {
  const objectiveIdByKeyResultId = new Map(
    keyResults.map((keyResult) => [keyResult.id, keyResult.objectiveId]),
  );

  return initiatives.filter((initiative) => {
    const objectiveId = objectiveIdByKeyResultId.get(initiative.keyResultId);
    return (
      (!filter.objectiveId || objectiveId === filter.objectiveId) &&
      (!filter.keyResultId || initiative.keyResultId === filter.keyResultId) &&
      (!filter.ownerId || initiative.ownerId === filter.ownerId) &&
      (!filter.priority || String(initiative.priority) === filter.priority)
    );
  });
}
