import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveClientDirectory, resolveServerPort } from "./runtime-config";

describe("server runtime configuration", () => {
  it("uses the default API port when PORT is unset", () => {
    expect(resolveServerPort(undefined)).toBe(4178);
  });

  it("accepts a valid configured API port", () => {
    expect(resolveServerPort("4179")).toBe(4179);
  });

  it.each(["0", "-1", "65536", "not-a-port"])(
    "rejects invalid port %s",
    (value) => {
      expect(() => resolveServerPort(value)).toThrow(
        "PORT must be an integer between 1 and 65535.",
      );
    },
  );

  it("resolves production assets relative to the server module", () => {
    const serverModulePath = join(tmpdir(), "app", "src", "server", "index.ts");
    const serverModuleUrl = pathToFileURL(serverModulePath).href;

    expect(resolveClientDirectory(serverModuleUrl)).toBe(
      resolve(tmpdir(), "app", "dist"),
    );
  });
});
