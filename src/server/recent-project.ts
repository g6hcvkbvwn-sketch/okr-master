import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

export class RecentProjectStore {
  constructor(private readonly settingsPath: string) {}

  async read(): Promise<string | null> {
    let contents: string;
    try {
      contents = await readFile(this.settingsPath, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }

    const parsed: unknown = JSON.parse(contents);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("projectPath" in parsed) ||
      typeof parsed.projectPath !== "string" ||
      parsed.projectPath.trim() === ""
    ) {
      throw new Error("The remembered project setting is invalid.");
    }
    return parsed.projectPath;
  }

  async write(projectPath: string): Promise<void> {
    const directory = path.dirname(this.settingsPath);
    const temporaryPath = `${this.settingsPath}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true });
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ projectPath }), "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.settingsPath);
    } catch (error) {
      if (handle) await handle.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
