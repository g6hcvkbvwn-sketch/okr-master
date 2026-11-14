import { parseProject } from "../domain/project";
import type { Project } from "../shared/types";

interface DatabaseResult {
  meta: { changes: number };
}

interface DatabaseStatement {
  bind(...values: (string | number)[]): DatabaseStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<DatabaseResult>;
}

export interface CloudDatabase {
  prepare(query: string): DatabaseStatement;
}

export interface StoredProject {
  project: Project;
  revision: number;
}

interface ProjectRow {
  data: string;
  revision: number;
}

export class CloudProjectConflictError extends Error {
  constructor() {
    super("This project changed elsewhere. Save your unsaved changes and reopen it before trying again.");
    this.name = "CloudProjectConflictError";
  }
}

export class CloudProjectExistsError extends Error {
  constructor() {
    super("A project with this ID already exists. Open it instead of importing it again.");
    this.name = "CloudProjectExistsError";
  }
}

export class CloudProjectStore {
  constructor(private readonly db: CloudDatabase) {}

  async list(): Promise<StoredProject[]> {
    const rows = await this.db.prepare(
      "SELECT data, revision FROM projects ORDER BY id",
    ).all<ProjectRow>();
    return rows.results.map(parseRow);
  }

  async load(id: string): Promise<StoredProject | null> {
    const row = await this.db.prepare(
      "SELECT data, revision FROM projects WHERE id = ?",
    ).bind(id).first<ProjectRow>();
    return row ? parseRow(row) : null;
  }

  async create(input: unknown): Promise<StoredProject> {
    const project = parseProject(input);
    const result = await this.db.prepare(
      "INSERT INTO projects (id, revision, data) VALUES (?, 1, ?) ON CONFLICT(id) DO NOTHING",
    ).bind(project.id, JSON.stringify(project)).run();
    if (result.meta.changes !== 1) throw new CloudProjectExistsError();
    return { project, revision: 1 };
  }

  async save(id: string, expectedRevision: number, input: unknown): Promise<StoredProject> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error("A valid project revision is required.");
    }
    const project = parseProject(input);
    if (project.id !== id) throw new Error("Cannot replace a project with a different project.");
    const result = await this.db.prepare(
      "UPDATE projects SET data = ?, revision = revision + 1 WHERE id = ? AND revision = ?",
    ).bind(JSON.stringify(project), id, expectedRevision).run();
    if (result.meta.changes !== 1) throw new CloudProjectConflictError();
    return { project, revision: expectedRevision + 1 };
  }
}

function parseRow(row: ProjectRow): StoredProject {
  const project = parseProject(JSON.parse(row.data) as unknown);
  return { project, revision: row.revision };
}
