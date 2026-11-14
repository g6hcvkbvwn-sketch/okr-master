import { describe, expect, it, vi } from "vitest";
import { createDesktopProjectFilePicker } from "./project-file-picker";

describe("desktop project file picker", () => {
  it("returns the selected project path and reports cancellation", async () => {
    const dialogs = {
      openProject: vi
        .fn()
        .mockResolvedValueOnce({
          canceled: false,
          filePaths: ["C:\\Projects\\okr.json"],
        })
        .mockResolvedValueOnce({ canceled: true, filePaths: [] }),
      saveProject: vi.fn(),
    };
    const picker = createDesktopProjectFilePicker(dialogs);

    await expect(picker.chooseOpenProject()).resolves.toBe(
      "C:\\Projects\\okr.json",
    );
    await expect(picker.chooseOpenProject()).resolves.toBeNull();
  });

  it("adds the JSON extension when creating a project without one", async () => {
    const picker = createDesktopProjectFilePicker({
      openProject: vi.fn(),
      saveProject: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: "C:\\Projects\\company plan",
      }),
    });

    await expect(picker.chooseNewProjectPath()).resolves.toBe(
      "C:\\Projects\\company plan.json",
    );
  });

  it("preserves an existing extension and cancelled creation", async () => {
    const saveProject = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        filePath: "C:\\Projects\\plan.json",
      })
      .mockResolvedValueOnce({ canceled: true });
    const picker = createDesktopProjectFilePicker({
      openProject: vi.fn(),
      saveProject,
    });

    await expect(picker.chooseNewProjectPath()).resolves.toBe(
      "C:\\Projects\\plan.json",
    );
    await expect(picker.chooseNewProjectPath()).resolves.toBeNull();
  });
});
