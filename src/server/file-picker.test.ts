import { describe, expect, it } from "vitest";
import {
  createProjectFilePicker,
  MacOsAppleScriptFilePicker,
  WindowsPowerShellFilePicker,
} from "./file-picker";

describe("platform project file picker", () => {
  it("selects the macOS native dialog adapter", () => {
    expect(createProjectFilePicker("darwin")).toBeInstanceOf(
      MacOsAppleScriptFilePicker,
    );
  });

  it("selects the Windows native dialog adapter", () => {
    expect(createProjectFilePicker("win32")).toBeInstanceOf(
      WindowsPowerShellFilePicker,
    );
  });

  it("reports unsupported platforms explicitly", () => {
    expect(() => createProjectFilePicker("linux")).toThrow(
      "Supported operating systems are macOS and Windows.",
    );
  });
});
