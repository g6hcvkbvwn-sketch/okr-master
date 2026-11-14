import {
  hasInitiativeFilter,
  type InitiativeFilter,
} from "../domain/initiative-filters";
import type { KeyResult, Objective, User } from "../shared/types";

export function InitiativeFiltersBar({
  filter,
  onFilterChange,
  onClear,
  objectives,
  keyResults,
  users,
  matchingCount,
}: {
  filter: InitiativeFilter;
  onFilterChange: (filter: InitiativeFilter) => void;
  onClear: () => void;
  objectives: Objective[];
  keyResults: KeyResult[];
  users: User[];
  matchingCount: number;
}) {
  const active = hasInitiativeFilter(filter);

  return (
    <div className="kanban-controls card">
      <div className="kanban-filter-grid">
        <label className="field filter-field">
          <span>Objective</span>
          <select
            onChange={(event) =>
              onFilterChange({
                ...filter,
                objectiveId: event.target.value,
                keyResultId: "",
              })
            }
            value={filter.objectiveId}
          >
            <option value="">All Objectives</option>
            {objectives.map((objective) => (
              <option key={objective.id} value={objective.id}>
                {objective.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field filter-field">
          <span>Key Result</span>
          <select
            onChange={(event) =>
              onFilterChange({ ...filter, keyResultId: event.target.value })
            }
            value={filter.keyResultId}
          >
            <option value="">All Key Results</option>
            {keyResults
              .filter(
                (result) =>
                  !filter.objectiveId ||
                  result.objectiveId === filter.objectiveId,
              )
              .map((result) => (
                <option key={result.id} value={result.id}>
                  {result.title}
                </option>
              ))}
          </select>
        </label>
        <label className="field filter-field">
          <span>Initiative owner</span>
          <select
            onChange={(event) =>
              onFilterChange({ ...filter, ownerId: event.target.value })
            }
            value={filter.ownerId}
          >
            <option value="">All owners</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field filter-field">
          <span>Priority (1 highest, 3 lowest)</span>
          <select
            onChange={(event) =>
              onFilterChange({ ...filter, priority: event.target.value })
            }
            value={filter.priority}
          >
            <option value="">All priorities</option>
            <option value="1">1 — Highest</option>
            <option value="2">2</option>
            <option value="3">3 — Lowest</option>
          </select>
        </label>
      </div>
      <div className="kanban-filter-summary">
        <span>{matchingCount} matching initiatives</span>
        {active && (
          <button
            className="button button-tertiary"
            onClick={onClear}
            type="button"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
