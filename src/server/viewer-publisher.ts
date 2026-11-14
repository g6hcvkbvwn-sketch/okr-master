import { createHash, randomUUID } from "node:crypto";
import {
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { ViewerSnapshotSchema } from "../shared/schemas";
import type { Project } from "../shared/types";
import {
  createViewerSnapshot,
  stringifyViewerSnapshot,
} from "../domain/viewer-snapshot";

const execFile = promisify(nodeExecFile);
const VIEWER_FILE_NAME = "okr-viewer.html";
const SNAPSHOT_BLOCK =
  /<script id="okr-viewer-snapshot" type="application\/json">([\s\S]*?)<\/script>/;

export interface ViewerPublishSettings {
  directory: string;
  publishOnClose: boolean;
  lastPublishedFingerprint: string | null;
  lastPublishedPath: string | null;
  lastPublishedAt: string | null;
}

export interface ViewerPublishResult {
  path: string;
  publishedAt: string | null;
  published: boolean;
  message: string;
}

const DEFAULT_SETTINGS: ViewerPublishSettings = {
  directory: "",
  publishOnClose: false,
  lastPublishedFingerprint: null,
  lastPublishedPath: null,
  lastPublishedAt: null,
};

export class ViewerPublisher {
  constructor(
    private readonly settingsPath: string,
    private readonly templatePath: string,
    private readonly getProject: () => Project | null,
    private readonly chooseDirectory: () => Promise<string | null>,
  ) {}

  async getSettings(): Promise<ViewerPublishSettings> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.settingsPath, "utf8"),
      );
      return parseSettings(parsed);
    } catch (error) {
      if (isMissingFile(error)) return { ...DEFAULT_SETTINGS };
      throw new Error(
        `Could not read publishing settings: ${errorText(error)}`,
      );
    }
  }

  async choosePublishDirectory(): Promise<string | null> {
    return this.chooseDirectory();
  }

  async saveSettings(input: unknown): Promise<ViewerPublishSettings> {
    if (!isRecord(input)) {
      throw new Error("Publishing settings must be an object.");
    }
    const directory =
      typeof input.directory === "string" ? input.directory.trim() : "";
    if (
      typeof input.publishOnClose !== "boolean" ||
      (directory !== "" && !isAbsolutePath(directory))
    ) {
      throw new Error("Choose a valid folder and publish-on-close setting.");
    }
    const current = await this.getSettings();
    const next: ViewerPublishSettings = {
      ...current,
      directory: directory ? resolve(directory) : "",
      publishOnClose: input.publishOnClose,
    };
    await this.writeSettings(next);
    return next;
  }

  async publish(pushToGit = false): Promise<ViewerPublishResult> {
    const settings = await this.getSettings();
    if (!settings.directory) {
      throw new Error("Choose a publishing folder first.");
    }
    const project = this.getProject();
    if (!project) throw new Error("Create or open a project first.");

    const outputPath = resolve(settings.directory, VIEWER_FILE_NAME);
    const snapshot = createViewerSnapshot(project);
    const fingerprint = snapshotFingerprint(snapshot);
    const existingSnapshot = await this.readPublishedSnapshot(outputPath);
    if (
      existingSnapshot &&
      snapshotFingerprint(existingSnapshot) === fingerprint
    ) {
      await this.writeSettings({
        ...settings,
        lastPublishedFingerprint: fingerprint,
        lastPublishedPath: outputPath,
        lastPublishedAt: existingSnapshot.generatedAt,
      });
      if (pushToGit) {
        const gitMessage = await this.commitAndPush(outputPath);
        return {
          path: outputPath,
          publishedAt: existingSnapshot.generatedAt,
          published: false,
          message: gitMessage,
        };
      }
      return {
        path: outputPath,
        publishedAt: existingSnapshot.generatedAt,
        published: false,
        message: "The viewer already matches the saved project; no file was rewritten.",
      };
    }

    const template = await readFile(this.templatePath, "utf8").catch(
      (error: unknown) => {
        throw new Error(`Could not read the viewer template: ${errorText(error)}`);
      },
    );
    if (!template.includes("__OKR_VIEWER_SNAPSHOT__")) {
      throw new Error("The built viewer template is missing its snapshot placeholder.");
    }
    const html = template.replace(
      "__OKR_VIEWER_SNAPSHOT__",
      stringifyViewerSnapshot(snapshot),
    );
    await atomicReplace(outputPath, html);

    const publishedAt = snapshot.generatedAt;
    await this.writeSettings({
      ...settings,
      lastPublishedFingerprint: fingerprint,
      lastPublishedPath: outputPath,
      lastPublishedAt: publishedAt,
    });

    const gitMessage = pushToGit ? await this.commitAndPush(outputPath) : "";
    return {
      path: outputPath,
      publishedAt,
      published: true,
      message: pushToGit
        ? `Published and pushed the viewer. ${gitMessage}`
        : "Published the viewer successfully.",
    };
  }

  async needsPublishOnClose(): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.publishOnClose || !settings.directory) return false;
    const project = this.getProject();
    if (!project) return false;
    const outputPath = resolve(settings.directory, VIEWER_FILE_NAME);
    const currentFingerprint = snapshotFingerprint(createViewerSnapshot(project));
    if (
      settings.lastPublishedPath !== outputPath ||
      settings.lastPublishedFingerprint !== currentFingerprint
    ) {
      return true;
    }
    const publishedSnapshot = await this.readPublishedSnapshot(outputPath);
    return (
      !publishedSnapshot ||
      snapshotFingerprint(publishedSnapshot) !== currentFingerprint
    );
  }

  private async readPublishedSnapshot(
    outputPath: string,
  ): Promise<ReturnType<typeof ViewerSnapshotSchema.parse> | null> {
    try {
      const html = await readFile(outputPath, "utf8");
      const match = SNAPSHOT_BLOCK.exec(html);
      if (!match?.[1]) return null;
      const parsed: unknown = JSON.parse(match[1]);
      const snapshot = ViewerSnapshotSchema.safeParse(parsed);
      return snapshot.success ? snapshot.data : null;
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw new Error(`Could not check the existing viewer: ${errorText(error)}`);
    }
  }

  private async writeSettings(settings: ViewerPublishSettings): Promise<void> {
    await atomicReplace(
      this.settingsPath,
      `${JSON.stringify(settings, null, 2)}\n`,
    );
  }

  private async commitAndPush(outputPath: string): Promise<string> {
    let repositoryRoot: string;
    try {
      ({ stdout: repositoryRoot } = await execFile(
        "git",
        ["-C", dirname(outputPath), "rev-parse", "--show-toplevel"],
        { windowsHide: true },
      ));
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new Error("Git is not installed or could not be found on PATH.");
      }
      throw new Error(
        `The publishing folder is not inside a Git repository: ${errorText(error)}`,
      );
    }
    repositoryRoot = repositoryRoot.trim();
    const relativePath = relativeGitPath(
      await realpath(repositoryRoot),
      await realpath(outputPath),
    );
    if (!relativePath) {
      throw new Error("The viewer file must be inside the Git repository.");
    }

    let branch: string;
    try {
      ({ stdout: branch } = await execFile(
        "git",
        ["-C", repositoryRoot, "branch", "--show-current"],
        { windowsHide: true },
      ));
    } catch (error) {
      throw new Error(`Could not determine the current Git branch: ${errorText(error)}`);
    }
    branch = branch.trim();
    if (!branch) {
      throw new Error("Cannot publish from a detached Git HEAD; check out a branch first.");
    }

    const gitArgs = ["-C", repositoryRoot];
    let viewerChanged = false;
    try {
      await execFile("git", [...gitArgs, "add", "--", relativePath], {
        windowsHide: true,
      });
      const status = await execFile(
        "git",
        [...gitArgs, "diff", "--cached", "--quiet", "--", relativePath],
        { windowsHide: true },
      ).then(
        () => "unchanged",
        (error: unknown) => {
          if (isGitExitCode(error, 1)) return "changed";
          throw error;
        },
      );
      viewerChanged = status === "changed";
      if (viewerChanged) {
        const commitMessage = `Publish OKR viewer snapshot (${new Date()
          .toISOString()
          .replace(/\.\d{3}Z$/, "Z")})`;
        await execFile(
          "git",
          [
            ...gitArgs,
            "commit",
            "--only",
            "-m",
            commitMessage,
            "--",
            relativePath,
          ],
          { windowsHide: true },
        );
      }
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new Error("Git is not installed or could not be found on PATH.");
      }
      throw new Error(`Could not commit the viewer file: ${errorText(error)}`);
    }

    try {
      await execFile("git", [...gitArgs, "push", "origin", branch], {
        windowsHide: true,
      });
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new Error("Git is not installed or could not be found on PATH.");
      }
      throw new Error(
        `Could not push branch "${branch}" to origin: ${errorText(error)}`,
      );
    }
    return viewerChanged
      ? `Pushed the viewer commit to origin/${branch}.`
      : `Pushed pending commits to origin/${branch}; there were no new viewer changes to commit.`;
  }
}

function parseSettings(value: unknown): ViewerPublishSettings {
  if (
    !isRecord(value) ||
    typeof value.directory !== "string" ||
    typeof value.publishOnClose !== "boolean" ||
    (value.lastPublishedFingerprint !== null &&
      typeof value.lastPublishedFingerprint !== "string") ||
    (value.lastPublishedPath !== null &&
      typeof value.lastPublishedPath !== "string") ||
    (value.lastPublishedAt !== null &&
      typeof value.lastPublishedAt !== "string")
  ) {
    throw new Error("Publishing settings file is invalid.");
  }
  return {
    directory: value.directory,
    publishOnClose: value.publishOnClose,
    lastPublishedFingerprint: value.lastPublishedFingerprint,
    lastPublishedPath: value.lastPublishedPath,
    lastPublishedAt: value.lastPublishedAt,
  };
}

function snapshotFingerprint(
  snapshot: ReturnType<typeof createViewerSnapshot>,
): string {
  const { generatedAt: _generatedAt, ...stableSnapshot } = snapshot;
  return createHash("sha256")
    .update(JSON.stringify(stableSnapshot))
    .digest("hex");
}

async function atomicReplace(filePath: string, contents: string): Promise<void> {
  const directory = dirname(filePath);
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) {
      throw new Error("The selected publishing path is not a folder.");
    }
  } catch (error) {
    if (isMissingFile(error)) {
      throw new Error(`The publishing folder does not exist: ${directory}`);
    }
    throw new Error(`The publishing folder is unavailable: ${errorText(error)}`);
  }

  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } catch (error) {
    if (handle) await handle.close();
    await rm(temporaryPath, { force: true });
    throw new Error(
      `Could not write the viewer to ${filePath}: ${errorText(error)}`,
    );
  }
}

function relativeGitPath(repositoryRoot: string, outputPath: string): string | null {
  const root = resolve(repositoryRoot);
  const filePath = resolve(outputPath);
  const relativePath = relative(root, filePath);
  if (
    !relativePath ||
    filePath === root ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.split(sep).join("/");
}

function isAbsolutePath(value: string): boolean {
  return (
    /^[a-zA-Z]:[\\/]/.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("/")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isGitExitCode(error: unknown, code: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
