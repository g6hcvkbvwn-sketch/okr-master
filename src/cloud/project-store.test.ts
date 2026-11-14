import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../domain/project";
import { handleProjectApi } from "./api";
import { handleBackupApi, runPendingBackup, type BackupEnvironment } from "./onedrive";
import worker from "./worker";
import {
  CloudProjectConflictError,
  CloudProjectExistsError,
  CloudProjectStore,
  type CloudDatabase,
} from "./project-store";

const databases: DatabaseSync[] = [];

function createStore() {
  const sqlite = new DatabaseSync(":memory:");
  databases.push(sqlite);
  sqlite.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const db: CloudDatabase = {
    prepare(query) {
      let values: (string | number)[] = [];
      const statement = sqlite.prepare(query);
      return {
        bind(...input) {
          values = input;
          return this;
        },
        async first<T>() {
          return (statement.get(...values) ?? null) as T | null;
        },
        async all<T>() {
          return { results: statement.all(...values) as T[] };
        },
        async run() {
          const before = Number(sqlite.prepare("SELECT total_changes() AS count").get()?.count);
          statement.run(...values);
          const after = Number(sqlite.prepare("SELECT total_changes() AS count").get()?.count);
          return { meta: { changes: after - before } };
        },
      };
    },
  };
  return { store: new CloudProjectStore(db), sqlite, db };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.close();
});

describe("cloud project API", () => {
  it("serves project operations only after verifying Access on the Worker", async () => {
    const { db } = createStore();
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const key = await exportJWK(publicKey);
    key.kid = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [key] })));
    const team = "https://integration-okr.cloudflareaccess.com";
    const token = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(team).setAudience("okr").setSubject("test-user").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const env = {
      DB: db, ASSETS: { fetch: async () => new Response("app") },
      ACCESS_TEAM_URL: team, ACCESS_AUD: "okr",
    };
    const url = "https://okr.example/api/projects";
    expect((await worker.fetch(new Request(url), env)).status).toBe(403);
    const created = await worker.fetch(new Request(url, {
      method: "POST",
      headers: { Origin: "https://okr.example", "Cf-Access-Jwt-Assertion": token },
      body: JSON.stringify({ kind: "create", project: { name: "Integration" } }),
    }), env);
    expect(created.status).toBe(201);
    const saved = await created.json();
    expect(saved.project.name).toBe("Integration");
    const list = await worker.fetch(new Request(url, { headers: { "Cf-Access-Jwt-Assertion": token } }), env);
    expect((await list.json()).map((item: { name: string }) => item.name)).toEqual(["Integration"]);
  });

  it("isolates projects and rejects stale or cross-origin mutations", async () => {
    const { store } = createStore();
    const url = "https://okr.example/api/projects";
    const create = (name: string) => handleProjectApi(new Request(url, {
      method: "POST",
      headers: { Origin: "https://okr.example" },
      body: JSON.stringify({ kind: "create", project: { name } }),
    }), store);
    const first = await (await create("First")).json();
    const second = await (await create("Second")).json();
    const endpoint = `${url}/${first.project.id}`;
    const action = (origin: string, revision: number, name: string) =>
      handleProjectApi(new Request(`${endpoint}/actions`, {
        method: "POST",
        headers: { Origin: origin, "If-Match": `"${revision}"` },
        body: JSON.stringify({ action: "add-user", input: { name, email: "test@example.com", active: true } }),
      }), store);
    expect((await action("https://evil.example", 1, "Alice")).status).toBe(403);
    expect((await action("https://okr.example", 1, "Alice")).status).toBe(200);
    expect((await action("https://okr.example", 1, "Bob")).status).toBe(409);
    expect((await store.load(first.project.id))?.project.users.map((user) => user.name)).toEqual(["Alice"]);
    expect((await store.load(second.project.id))?.project.users).toEqual([]);
  });

  describe("OneDrive backup", () => {
    it("connects using state and PKCE, backs up all projects, and tracks edits made during backup", async () => {
      const { store, db } = createStore();
      const first = createProject({ name: "First" });
      const second = createProject({ name: "Second" });
      await store.create(first);
      await store.create(second);
      const env: BackupEnvironment = {
        DB: db,
        ONEDRIVE_CLIENT_ID: "client",
        ONEDRIVE_CLIENT_SECRET: "test-secret",
        ONEDRIVE_REDIRECT_URI: "https://okr.example/api/onedrive/callback",
        BACKUP_ENCRYPTION_KEY: btoa("x".repeat(32)),
      };
      let uploaded: unknown;
      vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/token")) return Response.json({ access_token: "access", refresh_token: "refresh" });
        if (url.endsWith(":/content")) {
          uploaded = JSON.parse(String(options?.body)) as unknown;
          await store.save(first.id, 1, { ...first, description: "Changed during backup" });
        }
        return new Response(null, { status: 200 });
      }));
      const start = await handleBackupApi(new Request("https://okr.example/api/onedrive/connect"), env);
      expect(start.status).toBe(302);
      const authorization = new URL(start.headers.get("Location") ?? "");
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      const cookie = (start.headers.get("Set-Cookie") ?? "").split(";")[0];
      const callback = new URL(env.ONEDRIVE_REDIRECT_URI!);
      callback.searchParams.set("state", authorization.searchParams.get("state") ?? "");
      callback.searchParams.set("code", "test-code");
      expect((await handleBackupApi(new Request(callback, { headers: { Cookie: cookie! } }), env)).status).toBe(303);
      expect(await runPendingBackup(env)).toBe(true);
      expect(uploaded).toEqual({ type: "okr-master-backup", version: 1, projects: expect.arrayContaining([first, second]) });
      const status = await (await handleBackupApi(new Request("https://okr.example/api/onedrive/status"), env)).json();
      expect(status.connected).toBe(true);
      expect(status.pending).toBe(true);
      expect(status.lastSuccess).toBeTruthy();
    });

    it("rejects forged callbacks and cross-origin manual backups", async () => {
      const { db } = createStore();
      const env: BackupEnvironment = {
        DB: db, ONEDRIVE_CLIENT_ID: "client", ONEDRIVE_CLIENT_SECRET: "secret",
        ONEDRIVE_REDIRECT_URI: "https://okr.example/api/onedrive/callback",
        BACKUP_ENCRYPTION_KEY: btoa("x".repeat(32)),
      };
      const response = await handleBackupApi(new Request("https://okr.example/api/onedrive/callback?state=bad&code=bad"), env);
      expect(response.status).toBe(400);
      const backup = await handleBackupApi(new Request("https://okr.example/api/onedrive/backup", {
        method: "POST", headers: { Origin: "https://other.example" },
      }), env);
      expect(backup.status).toBe(403);
    });
  });

  it("prevents autosave from bypassing workflow and rejects duplicate imports", async () => {
    const { store } = createStore();
    const project = createProject({ name: "First", description: "" });
    await store.create(project);
    const url = `https://okr.example/api/projects/${project.id}`;
    const response = await handleProjectApi(new Request(url, {
      method: "PUT",
      headers: { Origin: "https://okr.example", "If-Match": '"1"' },
      body: JSON.stringify({ ...project, name: "Replaced" }),
    }), store);
    expect(response.status).toBe(400);
    const duplicate = await handleProjectApi(new Request("https://okr.example/api/projects", {
      method: "POST",
      headers: { Origin: "https://okr.example" },
      body: JSON.stringify({ kind: "import", project }),
    }), store);
    expect(duplicate.status).toBe(409);
    expect(await store.load(project.id)).toEqual({ project, revision: 1 });
  });

  it("restores only the matching project at the revision the user opened", async () => {
    const { store } = createStore();
    const project = createProject({ name: "First" });
    await store.create(project);
    await store.save(project.id, 1, { ...project, description: "Newer" });
    const url = `https://okr.example/api/projects/${project.id}/restore`;
    const restore = (revision: number) => handleProjectApi(new Request(url, {
      method: "POST",
      headers: { Origin: "https://okr.example", "If-Match": `"${revision}"` },
      body: JSON.stringify(project),
    }), store);
    expect((await restore(1)).status).toBe(409);
    expect((await restore(2)).status).toBe(200);
    expect(await store.load(project.id)).toEqual({ project, revision: 3 });
  });
});

describe("CloudProjectStore", () => {
  it("creates and loads separate projects and rejects duplicate imports", async () => {
    const { store, sqlite } = createStore();
    const first = createProject({ name: "First", description: "" });
    const second = createProject({ name: "Second", description: "" });
    await store.create(first);
    await store.create(second);
    expect(await store.load(first.id)).toEqual({ project: first, revision: 1 });
    expect(await store.load(crypto.randomUUID())).toBeNull();
    expect(await store.list()).toHaveLength(2);
    await expect(store.create(first)).rejects.toBeInstanceOf(CloudProjectExistsError);
    expect(sqlite.prepare("SELECT revision FROM project_changes WHERE id = 1").get()?.revision).toBe(2);
  });

  it("prevents stale writes and counts only successful changes", async () => {
    const { store, sqlite } = createStore();
    const project = createProject({ name: "First", description: "" });
    await store.create(project);
    const updated = { ...project, description: "Updated" };
    expect(await store.save(project.id, 1, updated)).toEqual({ project: updated, revision: 2 });
    await expect(store.save(project.id, 1, project)).rejects.toBeInstanceOf(CloudProjectConflictError);
    expect(await store.load(project.id)).toEqual({ project: updated, revision: 2 });
    expect(sqlite.prepare("SELECT revision FROM project_changes WHERE id = 1").get()?.revision).toBe(2);
  });

  it("rejects invalid data, mismatched IDs, and missing revisions without writing", async () => {
    const { store } = createStore();
    const project = createProject({ name: "First", description: "" });
    await store.create(project);
    await expect(store.create({})).rejects.toThrow();
    await expect(store.save(project.id, 0, project)).rejects.toThrow("revision");
    await expect(store.save(crypto.randomUUID(), 1, project)).rejects.toThrow("different project");
    expect(await store.load(project.id)).toEqual({ project, revision: 1 });
  });
});
