import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationServer } from "./application";

describe("application server lifecycle", () => {
  let directory: string | null = null;
  let closeServer: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = null;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("serves the app on an OS-assigned loopback port and shuts down", async () => {
    directory = await mkdtemp(join(tmpdir(), "okr-desktop-server-"));
    await writeFile(join(directory, "index.html"), "<!doctype html><title>OKR</title>");

    const application = createApplicationServer({
      clientDirectory: directory,
      port: 0,
    });
    const running = await application.start();
    closeServer = running.close;

    const address = new URL(running.url);
    expect(address.hostname).toBe("127.0.0.1");
    expect(Number(address.port)).toBeGreaterThan(0);

    const health = await fetch(new URL("/api/health", running.url));
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });

    const rejectedOrigin = await fetch(new URL("/api/health", running.url), {
      headers: { Origin: "https://example.com" },
    });
    expect(rejectedOrigin.status).toBe(403);

    const rejectedHost = await new Promise<number>((resolveStatus, reject) => {
      const request = httpRequest(
        new URL("/api/health", running.url),
        { headers: { Host: "example.com" } },
        (response) => {
          response.resume();
          resolveStatus(response.statusCode ?? 0);
        },
      );
      request.once("error", reject);
      request.end();
    });
    expect(rejectedHost).toBe(403);

    const page = await fetch(running.url);
    expect(await page.text()).toContain("<title>OKR</title>");

    await running.close();
    closeServer = null;
    await expect(fetch(new URL("/api/health", running.url))).rejects.toThrow();
  });

  it("tracks the latest renderer save state for safe close handling", async () => {
    directory = await mkdtemp(join(tmpdir(), "okr-desktop-save-state-"));
    await writeFile(join(directory, "index.html"), "<!doctype html>");
    const application = createApplicationServer({
      clientDirectory: directory,
      port: 0,
    });
    const running = await application.start();
    closeServer = running.close;

    expect(running.hasUnsavedChanges()).toBe(false);
    const pending = await fetch(new URL("/api/editor/save-state", running.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: 2, saveStatus: "pending" }),
    });
    expect(pending.status).toBe(200);
    expect(running.hasUnsavedChanges()).toBe(true);

    const staleSaved = await fetch(
      new URL("/api/editor/save-state", running.url),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence: 1, saveStatus: "saved" }),
      },
    );
    expect(staleSaved.status).toBe(200);
    expect(running.hasUnsavedChanges()).toBe(true);

    const saved = await fetch(new URL("/api/editor/save-state", running.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sequence: 3, saveStatus: "saved" }),
    });
    expect(saved.status).toBe(200);
    expect(running.hasUnsavedChanges()).toBe(false);
  });
});
