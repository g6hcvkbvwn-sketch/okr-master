import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createProject, UnsupportedSchemaVersionError } from "../../domain/project";
import { JsonProjectRepository } from "./project-repository";
import type { Project } from "../../shared/types";

const temporaryDirectories: string[] = [];

async function createTemporaryProjectFile(): Promise<{
  directory: string;
  filePath: string;
  project: Project;
  repository: JsonProjectRepository;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "local-okr-test-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "project.json");
  const repository = new JsonProjectRepository();
  const project = createProject({
    name: "Test project",
    description: "A project description.",
  });
  await repository.create(filePath, project);
  return { directory, filePath, project, repository };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("JSON project persistence", () => {
  it("loads the distributed sample project as a valid schema-v1 project", async () => {
    const samplePath = fileURLToPath(
      new URL("../../../examples/sample-project.json", import.meta.url),
    );
    const { project, recoveryMessage } = await new JsonProjectRepository().load(
      samplePath,
    );
    expect(recoveryMessage).toBeNull();
    expect(project.schemaVersion).toBe(1);
    expect(project.currentCycleId).toBe(project.cycles[0]?.id);
    expect(project.objectives).toHaveLength(1);
    expect(project.keyResults).toHaveLength(2);
    expect(project.initiatives).toHaveLength(1);
  });

  it("serializes and reloads a readable project JSON file", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    const contents = await readFile(filePath, "utf8");
    expect(contents).toContain('"schemaVersion": 1');
    expect(contents.endsWith("\n")).toBe(true);
    expect(await repository.load(filePath)).toEqual({
      project,
      recoveryMessage: null,
    });
  });

  it("preserves the prior valid file in a backup before replacing it", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    await repository.load(filePath);
    const updated = { ...project, name: "Updated name" };
    await repository.save(filePath, updated);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      name: "Updated name",
    });
    expect(JSON.parse(await readFile(`${filePath}.bak`, "utf8"))).toMatchObject({
      name: "Test project",
    });
  });

  it("recovers a damaged project after restart and preserves the damaged file", async () => {
    const { directory, filePath, project, repository } =
      await createTemporaryProjectFile();
    await repository.load(filePath);
    await repository.save(filePath, { ...project, name: "Latest version" });
    const damagedContents = '{"schemaVersion": 1,';
    await writeFile(filePath, damagedContents);
    await writeFile(`${filePath}.interrupted.tmp`, "incomplete replacement");

    const restartedRepository = new JsonProjectRepository();
    const recovered = await restartedRepository.load(filePath);
    const archivedName = (await readdir(directory)).find((name) =>
      name.startsWith("project.json.corrupt-"),
    );

    expect(recovered.project).toEqual(project);
    expect(recovered.recoveryMessage).toContain("last valid backup");
    expect(archivedName).toBeDefined();
    expect(await readFile(path.join(directory, archivedName!), "utf8")).toBe(
      damagedContents,
    );
    expect(await restartedRepository.load(filePath)).toMatchObject({
      project,
      recoveryMessage: null,
    });
  });

  it("keeps the committed project after an interrupted temporary write", async () => {
    const { filePath, project } = await createTemporaryProjectFile();
    await writeFile(`${filePath}.interrupted.tmp`, '{"incomplete":');

    const restartedRepository = new JsonProjectRepository();
    expect(await restartedRepository.load(filePath)).toMatchObject({
      project,
      recoveryMessage: null,
    });
    expect(await readFile(filePath, "utf8")).toContain('"schemaVersion": 1');
  });

  it("restores a missing project file from a valid backup", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    await repository.load(filePath);
    await repository.save(filePath, { ...project, name: "Newer version" });
    await rm(filePath);

    const recovered = await new JsonProjectRepository().load(filePath);
    expect(recovered.project).toEqual(project);
    expect(recovered.recoveryMessage).toContain("missing project file");
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(project);
  });

  it("does not recover over an unsupported newer schema", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    await repository.load(filePath);
    await repository.save(filePath, { ...project, name: "Backup version" });
    const unsupported = JSON.stringify({ ...project, schemaVersion: 2 });
    await writeFile(filePath, unsupported);

    await expect(new JsonProjectRepository().load(filePath)).rejects.toBeInstanceOf(
      UnsupportedSchemaVersionError,
    );
    expect(await readFile(filePath, "utf8")).toBe(unsupported);
  });

  it("leaves corrupted files untouched when no valid backup exists", async () => {
    const { filePath } = await createTemporaryProjectFile();
    const damagedContents = "{not json";
    await writeFile(filePath, damagedContents);

    await expect(new JsonProjectRepository().load(filePath)).rejects.toThrow(
      "no recovery backup was found",
    );
    expect(await readFile(filePath, "utf8")).toBe(damagedContents);
  });

  it("does not restore from an invalid backup or alter either source file", async () => {
    const { filePath } = await createTemporaryProjectFile();
    const damagedContents = "{not json";
    const invalidBackup = '{"schemaVersion": 1, "id":';
    await writeFile(filePath, damagedContents);
    await writeFile(`${filePath}.bak`, invalidBackup);

    await expect(new JsonProjectRepository().load(filePath)).rejects.toThrow(
      "The project file and its recovery backup are invalid",
    );
    expect(await readFile(filePath, "utf8")).toBe(damagedContents);
    expect(await readFile(`${filePath}.bak`, "utf8")).toBe(invalidBackup);
  });

  it("serializes concurrent saves without losing either write", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    await repository.load(filePath);
    await Promise.all([
      repository.save(filePath, { ...project, name: "First queued update" }),
      repository.save(filePath, { ...project, name: "Second queued update" }),
    ]);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      name: "Second queued update",
    });
    expect(JSON.parse(await readFile(`${filePath}.bak`, "utf8"))).toMatchObject({
      name: "First queued update",
    });
  });

  it("does not overwrite a newer unsupported schema version", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    await repository.load(filePath);
    const unsupported = JSON.stringify({ ...project, schemaVersion: 2 });
    await writeFile(filePath, unsupported);
    await expect(repository.save(filePath, project)).rejects.toBeInstanceOf(
      UnsupportedSchemaVersionError,
    );
    expect(await readFile(filePath, "utf8")).toBe(unsupported);
  });

  it("detects external changes rather than silently overwriting them", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    await repository.load(filePath);
    const external = { ...project, name: "External update" };
    await writeFile(filePath, JSON.stringify(external, null, 2));
    await expect(
      repository.save(filePath, { ...project, name: "Local update" }),
    ).rejects.toThrow("changed outside the application");
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      name: "External update",
    });
  });

  it("rejects invalid project data without changing the file", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    const before = await readFile(filePath, "utf8");
    await expect(
      repository.save(filePath, {
        ...project,
        name: "",
      }),
    ).rejects.toThrow();
    expect(await readFile(filePath, "utf8")).toBe(before);
  });

  it("refuses to create over an existing project file", async () => {
    const { filePath, project, repository } = await createTemporaryProjectFile();
    await expect(repository.create(filePath, { ...project, id: randomUUID() })).rejects.toThrow(
      "A file already exists",
    );
  });
});
