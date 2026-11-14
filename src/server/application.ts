import express from "express";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { JsonProjectRepository } from "./persistence/project-repository";
import {
  createProjectFilePicker,
  type ProjectFilePicker,
} from "./file-picker";
import { ProjectSession } from "./project-session";
import { RecentProjectStore } from "./recent-project";
import { createApiRouter } from "./routes";
import { resolveServerPort } from "./runtime-config";
import { ViewerPublisher } from "./viewer-publisher";
import type { EditorSaveState } from "../shared/types";

export interface ApplicationServerOptions {
  clientDirectory: string;
  filePicker?: ProjectFilePicker;
  port?: number;
  publishSettingsPath?: string;
  recentProjectSettingsPath?: string;
  viewerTemplatePath?: string;
  choosePublishDirectory?: () => Promise<string | null>;
}

export interface RunningApplicationServer {
  url: string;
  close(): Promise<void>;
  needsPublishOnClose(): Promise<boolean>;
  publishViewer(): Promise<void>;
  hasUnsavedChanges(): boolean;
}

export interface ApplicationServer {
  start(): Promise<RunningApplicationServer>;
}

export function createApplicationServer(
  options: ApplicationServerOptions,
): ApplicationServer {
  const host = "127.0.0.1";
  const port = options.port ?? resolveServerPort();
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Server port must be an integer between 0 and 65535.");
  }

  const app = express();
  const session = new ProjectSession(
    new JsonProjectRepository(),
    options.filePicker ?? createProjectFilePicker(),
    options.recentProjectSettingsPath
      ? new RecentProjectStore(options.recentProjectSettingsPath)
      : undefined,
  );
  const publisher =
    options.publishSettingsPath &&
    options.viewerTemplatePath &&
    options.choosePublishDirectory
      ? new ViewerPublisher(
          options.publishSettingsPath,
          options.viewerTemplatePath,
          () => session.getSession().project,
          options.choosePublishDirectory,
        )
      : null;
  let editorSaveState: EditorSaveState = {
    sequence: 0,
    saveStatus: "saved",
  };

  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", (request, response, next) => {
    const requestHost = request.get("host");
    const origin = request.get("origin");
    try {
      if (!requestHost || new URL(`http://${requestHost}`).hostname !== host) {
        response.status(403).json({ error: "The local API only accepts loopback requests." });
        return;
      }
      if (origin && new URL(origin).origin !== `http://${requestHost}`) {
        response.status(403).json({ error: "Cross-origin API requests are not allowed." });
        return;
      }
    } catch {
      response.status(403).json({ error: "The local API request origin is invalid." });
      return;
    }
    next();
  });
  app.use(
    "/api",
    createApiRouter(session, publisher, (state) => {
      if (state.sequence > editorSaveState.sequence) {
        editorSaveState = state;
      }
    }),
  );
  app.use(express.static(options.clientDirectory));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(resolve(options.clientDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      console.error("Request failed:", error);
      response.status(400).json({
        error: error instanceof Error ? error.message : "Invalid request.",
      });
    },
  );

  let startPromise: Promise<RunningApplicationServer> | null = null;

  return {
    start(): Promise<RunningApplicationServer> {
      if (startPromise) {
        return Promise.reject(new Error("The application server is already started."));
      }

      startPromise = (async () => {
        await session.restoreLastProject();
        const listener = createServer(app);
        return new Promise<RunningApplicationServer>((resolveStart, rejectStart) => {
          const onError = (error: Error) => {
            listener.off("listening", onListening);
            startPromise = null;
            rejectStart(error);
          };
          const onListening = () => {
            listener.off("error", onError);
            const address = listener.address();
            if (!address || typeof address === "string") {
              startPromise = null;
              rejectStart(new Error("The local server did not provide a TCP address."));
              return;
            }

            resolveStart({
              url: `http://${host}:${address.port}`,
              needsPublishOnClose: () =>
                publisher?.needsPublishOnClose() ?? Promise.resolve(false),
              publishViewer: async () => {
                if (!publisher) {
                  throw new Error("Viewer publishing is not configured.");
                }
                await publisher.publish();
              },
              hasUnsavedChanges: () => editorSaveState.saveStatus !== "saved",
              close: () =>
                new Promise<void>((resolveClose, rejectClose) => {
                  listener.close((error) => {
                    startPromise = null;
                    if (error) rejectClose(error);
                    else resolveClose();
                  });
                }),
            });
          };

          listener.once("error", onError);
          listener.once("listening", onListening);
          listener.listen(port, host);
        });
      })();

      return startPromise;
    },
  };
}
