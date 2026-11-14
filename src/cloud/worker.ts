import { hasAccess } from "./access";
import { handleProjectApi } from "./api";
import { CloudProjectStore, type CloudDatabase } from "./project-store";
import { handleBackupApi, runPendingBackup, type BackupEnvironment } from "./onedrive";

export interface CloudEnvironment extends BackupEnvironment {
  DB: CloudDatabase;
  ASSETS: { fetch(request: Request): Promise<Response> };
  ACCESS_TEAM_URL?: string;
  ACCESS_AUD?: string;
}

export default {
  async fetch(request: Request, env: CloudEnvironment): Promise<Response> {
    if (!await hasAccess(request, env.ACCESS_TEAM_URL, env.ACCESS_AUD)) {
      return Response.json({ error: "Access denied or not configured." }, {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const path = new URL(request.url).pathname;
    if (path === "/api/projects" || path.startsWith("/api/projects/")) {
      return handleProjectApi(request, new CloudProjectStore(env.DB));
    }
    if (path.startsWith("/api/onedrive/")) return handleBackupApi(request, env);
    if (path.startsWith("/api/")) {
      return Response.json({ error: "Not found." }, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  },
  async scheduled(_controller: unknown, env: CloudEnvironment): Promise<void> {
    await runPendingBackup(env);
  },
};
