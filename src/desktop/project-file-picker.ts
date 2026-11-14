import { extname } from "node:path";
import type { ProjectFilePicker } from "../server/file-picker";

export interface NativeProjectDialogs {
  openProject(): Promise<{ canceled: boolean; filePaths: string[] }>;
  saveProject(): Promise<{ canceled: boolean; filePath?: string }>;
}

export function createDesktopProjectFilePicker(
  dialogs: NativeProjectDialogs,
): ProjectFilePicker {
  return {
    async chooseOpenProject(): Promise<string | null> {
      const selection = await dialogs.openProject();
      return selection.canceled ? null : (selection.filePaths[0] ?? null);
    },
    async chooseNewProjectPath(): Promise<string | null> {
      const selection = await dialogs.saveProject();
      if (selection.canceled || !selection.filePath) return null;
      return extname(selection.filePath) ? selection.filePath : `${selection.filePath}.json`;
    },
  };
}
