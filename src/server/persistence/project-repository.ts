import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Project } from "../../shared/types";
import {
  parseProject,
  ProjectValidationError,
  UnsupportedSchemaVersionError,
} from "../../domain/project";

export interface ProjectPersistenceAdapter {
  load(filePath: string): Promise<ProjectLoadResult>;
  create(filePath: string, project: Project): Promise<Project>;
  save(filePath: string, project: Project): Promise<Project>;
}

export interface ProjectLoadResult {
  project: Project;
  recoveryMessage: string | null;
}

export class ConcurrentProjectChangeError extends Error {
  constructor() {
    super(
      "The project file changed outside the application. Reopen it before saving to avoid overwriting those changes.",
    );
    this.name = "ConcurrentProjectChangeError";
  }
}

export class ProjectFileExistsError extends Error {
  constructor() {
    super("A file already exists at that location. Open it or choose a new file.");
    this.name = "ProjectFileExistsError";
  }
}

function digest(contents: Buffer | string): string {
  return createHash("sha256").update(contents).digest("hex");
}

export class JsonProjectRepository implements ProjectPersistenceAdapter {
  private readonly knownDigests = new Map<string, string>();
  private writeQueue: Promise<void> = Promise.resolve();

  async load(filePath: string): Promise<ProjectLoadResult> {
    return this.serialized(async () => {
      this.assertProjectFilePath(filePath);
      let raw: Buffer | null = null;
      let primaryError: unknown;
      try {
        raw = await readFile(filePath);
      } catch (error) {
        if (!this.isMissingFile(error)) throw error;
        primaryError = error;
      }

      if (raw) {
        try {
          const project = this.parseFileContents(raw);
          this.knownDigests.set(filePath, digest(raw));
          return { project, recoveryMessage: null };
        } catch (error) {
          if (error instanceof UnsupportedSchemaVersionError) throw error;
          primaryError = error;
        }
      }

      return this.recoverFromBackup(filePath, raw, primaryError);
    });
  }

  async create(filePath: string, project: Project): Promise<Project> {
    return this.serialized(async () => {
      this.assertProjectFilePath(filePath);
      if (await this.fileExists(filePath)) {
        throw new ProjectFileExistsError();
      }
      const validated = parseProject(project);
      const contents = this.serialize(validated);
      await this.writeAtomically(filePath, contents, false);
      this.knownDigests.set(filePath, digest(contents));
      return validated;
    });
  }

  async save(filePath: string, project: Project): Promise<Project> {
    return this.serialized(async () => {
      this.assertProjectFilePath(filePath);
      const validated = parseProject(project);
      const contents = this.serialize(validated);
      const existing = await readFile(filePath);
      this.parseFileContents(existing);

      const knownDigest = this.knownDigests.get(filePath);
      if (knownDigest === undefined || digest(existing) !== knownDigest) {
        throw new ConcurrentProjectChangeError();
      }

      await this.writeAtomically(filePath, contents, true, existing);
      this.knownDigests.set(filePath, digest(contents));
      return validated;
    });
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertProjectFilePath(filePath: string): void {
    if (path.extname(filePath).toLowerCase() !== ".json") {
      throw new ProjectValidationError("Choose a .json project file.");
    }
  }

  private parseFileContents(raw: Buffer): Project {
    let value: unknown;
    try {
      value = JSON.parse(raw.toString("utf8")) as unknown;
    } catch (error) {
      throw new ProjectValidationError(
        `The project file is not valid JSON: ${error instanceof Error ? error.message : "unknown parse error"}`,
      );
    }
    return parseProject(value);
  }

  private async recoverFromBackup(
    filePath: string,
    damagedContents: Buffer | null,
    primaryError: unknown,
  ): Promise<ProjectLoadResult> {
    const backupPath = `${filePath}.bak`;
    let backupContents: Buffer;
    try {
      backupContents = await readFile(backupPath);
    } catch (error) {
      if (!this.isMissingFile(error)) throw error;
      throw new ProjectValidationError(
        damagedContents
          ? `The project file is invalid and no recovery backup was found. The file was left unchanged. ${this.errorText(primaryError)}`
          : "The project file is missing and no recovery backup was found.",
      );
    }

    let project: Project;
    try {
      project = this.parseFileContents(backupContents);
    } catch (error) {
      if (error instanceof UnsupportedSchemaVersionError) throw error;
      throw new ProjectValidationError(
        `The project file and its recovery backup are invalid. Neither file was changed. Project: ${this.errorText(primaryError)} Backup: ${this.errorText(error)}`,
      );
    }

    let archivedPath: string | null = null;
    if (damagedContents) {
      archivedPath = await this.archiveDamagedFile(filePath, damagedContents);
    }
    await this.writeAtomically(filePath, backupContents.toString("utf8"), false);
    this.knownDigests.set(filePath, digest(backupContents));

    return {
      project,
      recoveryMessage: archivedPath
        ? `The project was restored from its last valid backup. The damaged file was preserved as ${path.basename(archivedPath)}.`
        : "The missing project file was restored from its last valid backup.",
    };
  }

  private async archiveDamagedFile(
    filePath: string,
    contents: Buffer,
  ): Promise<string> {
    const archivedPath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
    const temporaryPath = `${archivedPath}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(contents);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, archivedPath);
      return archivedPath;
    } catch (error) {
      if (handle) await handle.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private isMissingFile(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    );
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : "unknown error";
  }

  private serialize(project: Project): string {
    return `${JSON.stringify(parseProject(project), null, 2)}\n`;
  }

  private async writeAtomically(
    filePath: string,
    contents: string,
    preservePrevious: boolean,
    previousContents?: Buffer,
  ): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;

      if (preservePrevious) {
        if (!previousContents) {
          throw new Error("Previous project contents are required for a safe save.");
        }
        await this.writeBackup(filePath, previousContents);
      }

      await rename(temporaryPath, filePath);
    } catch (error) {
      if (handle) await handle.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async writeBackup(
    filePath: string,
    previousContents: Buffer,
  ): Promise<void> {
    const backupPath = `${filePath}.bak`;
    const temporaryBackupPath = `${backupPath}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryBackupPath, "wx", 0o600);
      await handle.writeFile(previousContents);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryBackupPath, backupPath);
    } catch (error) {
      if (handle) await handle.close();
      await rm(temporaryBackupPath, { force: true });
      throw error;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return false;
      }
      throw error;
    }
  }
}
