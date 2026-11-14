import { describe, expect, it } from "vitest";
import { getBrowserLaunchCommand } from "./browser-launcher";

describe("default browser launch commands", () => {
  const url = "http://127.0.0.1:4178";

  it("uses the macOS browser handler", () => {
    expect(getBrowserLaunchCommand("darwin", url)).toEqual({
      command: "open",
      args: [url],
    });
  });

  it("uses the Windows default browser handler", () => {
    expect(getBrowserLaunchCommand("win32", url)).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    });
  });

  it("uses xdg-open on Linux", () => {
    expect(getBrowserLaunchCommand("linux", url)).toEqual({
      command: "xdg-open",
      args: [url],
    });
  });
});
