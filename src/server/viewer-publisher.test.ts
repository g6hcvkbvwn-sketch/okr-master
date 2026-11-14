import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createProject } from "../domain/project";
import type { Project } from "../shared/types";
import { ViewerPublisher } from "./viewer-publisher";

const execFile = promisify(nodeExecFile);

describe("viewer publishing", () => {
  let directory: string | null = null;
  const previousGitPrompt = process.env.GIT_TERMINAL_PROMPT;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
    if (previousGitPrompt === undefined) delete process.env.GIT_TERMINAL_PROMPT;
    else process.env.GIT_TERMINAL_PROMPT = previousGitPrompt;
  });

  async function createPublisher(
    getProject: () => Project,
    targetDirectory?: string,
  ) {
    directory = await mkdtemp(join(tmpdir(), "okr-viewer-publisher-"));
    const outputDirectory = targetDirectory ?? join(directory, "published");
    await mkdir(outputDirectory, { recursive: true });
    const templatePath = join(directory, "viewer-template.html");
    await writeFile(
      templatePath,
      '<!doctype html><script id="okr-viewer-snapshot" type="application/json">__OKR_VIEWER_SNAPSHOT__</script>',
    );
    const publisher = new ViewerPublisher(
      join(directory, "settings.json"),
      templatePath,
      getProject,
      async () => outputDirectory,
    );
    await publisher.saveSettings({
      directory: outputDirectory,
      publishOnClose: false,
    });
    return { directory, outputDirectory, publisher };
  }

  it("writes a stable viewer file, avoids identical rewrites, and tracks publish-on-close", async () => {
    let project = createProject({ name: "First project" });
    const { directory: root, outputDirectory, publisher } =
      await createPublisher(() => project);
    const outputPath = join(outputDirectory, "okr-viewer.html");
    const projectFile = join(root, "project.json");
    const originalProjectFile = JSON.stringify(project);
    await writeFile(projectFile, originalProjectFile);

    expect(await publisher.needsPublishOnClose()).toBe(false);
    await publisher.saveSettings({
      directory: outputDirectory,
      publishOnClose: true,
    });
    expect(await publisher.needsPublishOnClose()).toBe(true);

    const firstPublish = await publisher.publish();
    const firstHtml = await readFile(outputPath, "utf8");
    expect(firstPublish.published).toBe(true);
    expect(firstPublish.path).toBe(outputPath);
    expect(firstHtml).not.toContain("__OKR_VIEWER_SNAPSHOT__");
    expect(firstHtml).toContain("First project");
    expect(await publisher.needsPublishOnClose()).toBe(false);

    const unchangedPublish = await publisher.publish();
    expect(unchangedPublish.published).toBe(false);
    expect(await readFile(outputPath, "utf8")).toBe(firstHtml);

    project = { ...project, name: "Updated project" };
    expect(await publisher.needsPublishOnClose()).toBe(true);
    const updatedPublish = await publisher.publish();
    expect(updatedPublish.published).toBe(true);
    expect(await readFile(outputPath, "utf8")).toContain("Updated project");

    expect(await readFile(projectFile, "utf8")).toBe(originalProjectFile);
  });

  it("rejects missing publishing folders without silently creating them", async () => {
    directory = await mkdtemp(join(tmpdir(), "okr-viewer-publisher-"));
    const missingDirectory = join(directory, "missing");
    const templatePath = join(directory, "template.html");
    await writeFile(templatePath, "__OKR_VIEWER_SNAPSHOT__");
    const publisher = new ViewerPublisher(
      join(directory, "settings.json"),
      templatePath,
      () => createProject({ name: "A project" }),
      async () => null,
    );
    await publisher.saveSettings({
      directory: missingDirectory,
      publishOnClose: true,
    });

    await expect(publisher.publish()).rejects.toThrow(
      `The publishing folder does not exist: ${missingDirectory}`,
    );
    expect(await publisher.needsPublishOnClose()).toBe(true);
  });

  it("commits only the viewer and pushes a pending local viewer commit after a failed push", async () => {
    process.env.GIT_TERMINAL_PROMPT = "0";
    directory = await mkdtemp(join(tmpdir(), "okr-viewer-git-"));
    const repository = join(directory, "repo");
    const remote = join(directory, "remote.git");
    const publishedRepository = process.platform === "win32" ? repository : join(directory, "repo-link");
    const outputDirectory = join(publishedRepository, "viewer");
    await mkdir(repository);
    if (publishedRepository !== repository) await symlink(repository, publishedRepository, "dir");
    await mkdir(outputDirectory);
    await execFile("git", ["init", "--bare", remote], { windowsHide: true });
    await execFile("git", ["init", "--initial-branch=main"], {
      cwd: repository,
      windowsHide: true,
    });
    await execFile("git", ["config", "user.name", "OKR test"], {
      cwd: repository,
      windowsHide: true,
    });
    await execFile("git", ["config", "user.email", "okr-test@example.com"], {
      cwd: repository,
      windowsHide: true,
    });
    await writeFile(join(repository, "README.md"), "initial\n");
    await execFile("git", ["add", "README.md"], {
      cwd: repository,
      windowsHide: true,
    });
    await execFile("git", ["commit", "-m", "Initial commit"], {
      cwd: repository,
      windowsHide: true,
    });
    await writeFile(join(repository, "unrelated.txt"), "keep staged\n");
    await execFile("git", ["add", "unrelated.txt"], {
      cwd: repository,
      windowsHide: true,
    });
    await execFile(
      "git",
      ["remote", "add", "origin", join(directory, "not-created.git")],
      { cwd: repository, windowsHide: true },
    );

    const project = createProject({ name: "Git project" });
    const templatePath = join(directory, "viewer-template.html");
    await writeFile(
      templatePath,
      '<script id="okr-viewer-snapshot" type="application/json">__OKR_VIEWER_SNAPSHOT__</script>',
    );
    const publisher = new ViewerPublisher(
      join(directory, "settings.json"),
      templatePath,
      () => project,
      async () => outputDirectory,
    );
    await publisher.saveSettings({
      directory: outputDirectory,
      publishOnClose: false,
    });

    await expect(publisher.publish(true)).rejects.toThrow(
      "Could not push branch",
    );
    const localCommitFiles = await execFile(
      "git",
      ["show", "--pretty=format:", "--name-only", "HEAD"],
      { cwd: repository, windowsHide: true },
    );
    expect(localCommitFiles.stdout.trim()).toBe("viewer/okr-viewer.html");
    expect(
      (await execFile("git", ["diff", "--cached", "--name-only"], {
        cwd: repository,
        windowsHide: true,
      })).stdout.trim(),
    ).toBe("unrelated.txt");

    await execFile("git", ["remote", "set-url", "origin", remote], {
      cwd: repository,
      windowsHide: true,
    });
    const retry = await publisher.publish(true);
    expect(retry.message).toContain("Pushed pending commits");

    const localHead = await execFile("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      windowsHide: true,
    });
    const remoteHead = await execFile(
      "git",
      ["--git-dir", remote, "rev-parse", "refs/heads/main"],
      { windowsHide: true },
    );
    expect(remoteHead.stdout.trim()).toBe(localHead.stdout.trim());
  }, 20_000);
});
