import { Router, type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import {
  ConcurrentProjectChangeError,
  ProjectFileExistsError,
} from "./persistence/project-repository";
import { EditorSaveStateSchema } from "../shared/schemas";
import type { EditorSaveState } from "../shared/types";
import {
  ProjectValidationError,
  UnsupportedSchemaVersionError,
} from "../domain/project";
import { ProjectSession } from "./project-session";
import { ViewerPublisher } from "./viewer-publisher";

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function errorStatus(error: unknown): number {
  if (
    error instanceof ZodError ||
    error instanceof ProjectValidationError
  ) {
    return 400;
  }

  if (
    error instanceof UnsupportedSchemaVersionError ||
    error instanceof ConcurrentProjectChangeError ||
    error instanceof ProjectFileExistsError
  ) {
    return 409;
  }
  if (error instanceof Error && error.message === "Create or open a project first.") {
    return 409;
  }
  return 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join(" ");
  }
  return error instanceof Error ? error.message : "An unexpected server error occurred.";
}

export function createApiRouter(
  session: ProjectSession,
  publisher: ViewerPublisher | null = null,
  reportSaveState: (state: EditorSaveState) => void = () => {},
): Router {
  const router = Router();
  const requirePublisher = (): ViewerPublisher => {
    if (!publisher) throw new Error("Viewer publishing is not configured.");
    return publisher;
  };

  router.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  router.get("/session", (_request, response) => {
    response.json(session.getSession());
  });

  router.post("/editor/save-state", (request, response, next) => {
    try {
      reportSaveState(EditorSaveStateSchema.parse(request.body));
      response.json({ accepted: true });
    } catch (error) {
      next(error);
    }
  });

  router.get("/publish/settings", async (_request, response, next) => {
    try {
      response.json(await requirePublisher().getSettings());
    } catch (error) {
      next(error);
    }
  });

  router.post("/publish/choose-folder", async (_request, response, next) => {
    try {
      const directory = await requirePublisher().choosePublishDirectory();
      response.json({ directory });
    } catch (error) {
      next(error);
    }
  });

  router.put("/publish/settings", async (request, response, next) => {
    try {
      response.json(await requirePublisher().saveSettings(request.body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/publish", async (_request, response, next) => {
    try {
      response.json(await requirePublisher().publish());
    } catch (error) {
      next(error);
    }
  });

  router.post("/publish/git", async (_request, response, next) => {
    try {
      response.json(await requirePublisher().publish(true));
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/project/create",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const project = await session.createProject(request.body);
        if (!project) {
          response.status(204).end();
          return;
        }
        response.status(201).json(project);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/objectives",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.status(201).json(await session.createObjective(request.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/objectives/:objectiveId",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await session.updateObjective(
            routeParam(request, "objectiveId"),
            request.body,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/objectives/:objectiveId/key-results",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.status(201).json(
          await session.createKeyResult(
            routeParam(request, "objectiveId"),
            request.body,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/key-results/:keyResultId",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await session.updateKeyResult(
            routeParam(request, "keyResultId"),
            request.body,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/initiatives",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.status(201).json(await session.createInitiative(request.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/initiatives/:initiativeId",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await session.updateInitiative(
            routeParam(request, "initiativeId"),
            request.body,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/project/open",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        const project = await session.openProject();
        if (!project) {
          response.status(204).end();
          return;
        }
        response.json(project);
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    "/project",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await session.saveProject(request.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/project/activate",
    async (_request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await session.activateFirstCycle());
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/review/submit",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(await session.submitReview(request.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/users",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.status(201).json(await session.addUser(request.body));
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    "/users/:userId",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await session.updateUser(routeParam(request, "userId"), request.body),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/users/:userId",
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        response.json(
          await session.deleteUser(routeParam(request, "userId")),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      response.status(errorStatus(error)).json({ error: errorMessage(error) });
    },
  );

  return router;
}
