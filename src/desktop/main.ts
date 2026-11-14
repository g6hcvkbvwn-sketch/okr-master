import { app, BrowserWindow, dialog, type MessageBoxOptions } from "electron";
import { join, resolve } from "node:path";
import { createDesktopProjectFilePicker } from "./project-file-picker";
import { createApplicationServer } from "../server/application";
import type { RunningApplicationServer } from "../server/application";

let mainWindow: BrowserWindow | null = null;
let applicationServer: RunningApplicationServer | null = null;
let shutdownStarted = false;
let allowQuit = false;

function createMainWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: "OKR Master",
    icon: resolve(app.getAppPath(), "build", "icon.png"),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const appOrigin = new URL(url).origin;
  window.webContents.on("will-navigate", (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== appOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  void window.loadURL(url).catch((error: unknown) => {
    console.error("Could not load the desktop application:", error);
    dialog.showErrorBox(
      "OKR Master could not start",
      error instanceof Error ? error.message : "The application window failed to load.",
    );
    app.quit();
  });
  mainWindow = window;
  return window;
}

async function startDesktopApplication(): Promise<void> {
  const clientDirectory = resolve(app.getAppPath(), "dist");
  const projectFilePicker = createDesktopProjectFilePicker({
    openProject: async () => {
      const owner = mainWindow;
      const selection = owner
        ? await dialog.showOpenDialog(owner, {
            title: "Open an OKR project",
            properties: ["openFile"],
            filters: [{ name: "JSON project", extensions: ["json"] }],
          })
        : await dialog.showOpenDialog({
            title: "Open an OKR project",
            properties: ["openFile"],
            filters: [{ name: "JSON project", extensions: ["json"] }],
          });
      return selection;
    },
    saveProject: async () => {
      const owner = mainWindow;
      const options = {
        title: "Create an OKR project",
        defaultPath: "project.json",
        filters: [{ name: "JSON project", extensions: ["json"] }],
      };
      return owner
        ? dialog.showSaveDialog(owner, options)
        : dialog.showSaveDialog(options);
    },
  });

  const application = createApplicationServer({
    clientDirectory,
    filePicker: projectFilePicker,
    port: 0,
    publishSettingsPath: join(app.getPath("userData"), "viewer-publishing.json"),
    recentProjectSettingsPath: join(app.getPath("userData"), "recent-project.json"),
    viewerTemplatePath: resolve(
      app.getAppPath(),
      "dist-viewer",
      "viewer-template.html",
    ),
    choosePublishDirectory: async () => {
      const owner = mainWindow;
      const selection = owner
        ? await dialog.showOpenDialog(owner, {
            title: "Choose the team viewer publishing folder",
            properties: ["openDirectory", "createDirectory"],
          })
        : await dialog.showOpenDialog({
            title: "Choose the team viewer publishing folder",
            properties: ["openDirectory", "createDirectory"],
          });
      return selection.canceled ? null : (selection.filePaths[0] ?? null);
    },
  });
  applicationServer = await application.start();
  console.info(`OKR Master API listening at ${applicationServer.url}`);
  createMainWindow(applicationServer.url);
}

app.whenReady().then(() => startDesktopApplication()).catch((error: unknown) => {
  console.error("Could not start OKR Master:", error);
  dialog.showErrorBox(
    "OKR Master could not start",
    error instanceof Error ? error.message : "An unexpected startup error occurred.",
  );
  app.quit();
});

app.on("activate", () => {
  if (!mainWindow && applicationServer) createMainWindow(applicationServer.url);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (allowQuit || !applicationServer) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;

  void (async () => {
    try {
      const hasUnsavedChanges =
        applicationServer?.hasUnsavedChanges() ?? false;
      if (hasUnsavedChanges) {
        const unsavedOptions: MessageBoxOptions = {
          type: "warning",
          title: "Unsaved project changes",
          message:
            "The latest editor changes are not saved. Close without saving them?",
          buttons: ["Close without saving", "Cancel close"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        };
        const unsavedChoice = mainWindow
          ? await dialog.showMessageBox(mainWindow, unsavedOptions)
          : await dialog.showMessageBox(unsavedOptions);
        if (unsavedChoice.response === 1) {
          shutdownStarted = false;
          return;
        }
      }
      if (
        !hasUnsavedChanges &&
        (await applicationServer?.needsPublishOnClose())
      ) {
        const options: MessageBoxOptions = {
          type: "question",
          title: "Publish team viewer?",
          message: "Publish the changes to the team viewer now?",
          buttons: ["Publish", "Skip", "Cancel close"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        };
        const choice = mainWindow
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options);
        if (choice.response === 2) {
          shutdownStarted = false;
          return;
        }
        if (choice.response === 0) {
          try {
            await applicationServer?.publishViewer();
          } catch (error) {
            const errorOptions: MessageBoxOptions = {
              type: "error",
              title: "Viewer was not published",
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown publishing error.",
              buttons: ["Close anyway", "Cancel close"],
              defaultId: 1,
              cancelId: 1,
              noLink: true,
            };
            const publishFailure = mainWindow
              ? await dialog.showMessageBox(mainWindow, errorOptions)
              : await dialog.showMessageBox(errorOptions);
            if (publishFailure.response === 1) {
              shutdownStarted = false;
              return;
            }
          }
        }
      }
      await applicationServer?.close();
      applicationServer = null;
      allowQuit = true;
      app.quit();
    } catch (error) {
      console.error("Could not complete the close/publish flow:", error);
      dialog.showErrorBox(
        "OKR Master could not close safely",
        error instanceof Error ? error.message : "Unknown shutdown error.",
      );
      shutdownStarted = false;
    }
  })();
});
