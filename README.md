# OKR Master

A local desktop OKR planner. Project information is stored in one
human-readable `project.json` file selected by the user.

## Use a packaged app

### Windows

The Windows editor is distributed as an unpacked application folder. Run
`release/win-unpacked/OKR Master.exe`; no installer, separately installed
Node.js/npm, terminal, or separate browser is required. Keep the complete
`win-unpacked/` folder together. The first launch may show a Windows security
warning because the app is not necessarily code-signed. Follow your
organization's software approval process; do not bypass company security
controls.

The executable can be run from a folder that is not writable. Keep your
project JSON file and its adjacent `.bak` recovery file in a writable folder
and together when moving or backing them up.

### macOS

The Mac app is built separately from the same source repository on a Mac; the
Windows executable cannot run on macOS. Mac package availability, supported
macOS versions, processor architectures, signing, and notarization must be
confirmed for each Mac release. Unsigned or unnotarized apps may require
additional approval or first-launch steps.

## Build from source

### Requirements

- Node.js 22.12 or newer
- npm
- Windows to create the unpacked Windows application
- macOS to create and verify a Mac package

Install dependencies after obtaining the source:

```sh
npm install
```

Run the desktop application locally:

```sh
npm run desktop:dev
```

This builds the React frontend and Electron main process, then opens the
desktop app. The browser-based development workflow remains available through
`npm run dev`; it starts Vite and the local Express server for development
and testing.

### Package Windows MVP

On Windows, run:

```sh
npm run package:windows
```

The unpacked application is written to `release/win-unpacked/`. It is a
Windows-specific build, not a cross-platform executable. Share the complete
folder, not only `OKR Master.exe`. Test the executable on a clean supported
Windows machine, including launching from a path with spaces and a
non-writable application folder. Startup optimization is deferred.

### Build the team viewer

Build a viewer from a saved project file with:

```sh
npm run build:viewer -- "C:\path\to\project.json"
```

The command validates the project and writes the self-contained,
read-only `viewer/okr-viewer.html`. The viewer contains the project data in
plain text, with user email addresses and unsubmitted planning/review drafts
omitted. Store and share the generated file only in a location restricted to
its intended audience.

### Publish from the editor

In the editor, open **Publishing** and choose the folder containing the viewer
link:

- For SharePoint, choose the locally synced OneDrive folder. OneDrive syncs
  the generated file; no Git operation is needed.
- For GitHub, choose a folder inside a local clone of the repository. Use
  **Publish and push** to commit and push the viewer file using Git and your
  existing credentials. Git must be installed and available on `PATH`.

Both actions replace the same `okr-viewer.html` file. Publishing is disabled
until the project is saved. The editor stores publishing preferences under
its per-user application data, separately from `project.json`. Git publishing
stages and commits only the viewer file; it does not stage project data or
other files. If a push fails after a local commit, the viewer remains in place
and a later **Publish and push** retries pushing the pending branch commits.
The editor never force-pushes.

**Ask whether to publish when closing the editor** is optional and off by
default. When enabled, the editor asks Publish, Skip, or Cancel close if saved
project data differs from the last published snapshot. Unsaved editor changes
also trigger a native close warning so they are not silently discarded.

### Package for macOS

Transfer the source repository—not the Windows executable—to a Mac. Install
the required Node.js/npm toolchain there, then run:

```sh
npm install
npm run package:mac
```

The command creates Mac `.dmg` and `.zip` packages in `release/` for the
builder's host architecture. Build and test on actual Mac hardware. Configure
and verify additional CPU architectures explicitly if they are needed.
Signing and notarization require the appropriate Apple developer credentials
and a Mac-based release environment; do not put credentials in source control.

### Logo and icons

`logo.png` (1024 × 1024) is the source for all branding assets. After changing
it, regenerate the derived files and commit them:

```sh
npm run icons
```

This writes `src/client/assets/logo-128.png` (header and favicon) and
`build/icon.png` (512 px), from which electron-builder creates the Windows
`.ico` and macOS `.icns` icons during packaging.

## Project files and recovery

Choose **New project** to create a project file, or **Open project** to select
an existing JSON project. Project data remains in that selected file, and
autosave persists planning and review drafts as well as supported project
changes. Use the sample project at
[`examples/sample-project.json`](./examples/sample-project.json) to explore an
active cycle with Objectives, Key Results, users, and an Initiative.

Completed reviews lock their cycles and preserve Company Goal and assigned-user
snapshots. History is read-only. A review must be submitted before planning the
next cycle.

- Invalid planning and review inputs show validation feedback and cannot be
  submitted.
- Save failures are shown in the application.
- If a project file is corrupted and a valid `.bak` exists, the application
  offers recovery while preserving the damaged file under a `.corrupt-*` name.
- If both the project and backup are invalid, opening fails without replacing
  either file.
- A project with a schema version newer than this application supports is not
  opened or overwritten.
- Project writes use temporary files and an adjacent `.bak` file. Keep the
  project in a writable folder and avoid editing or moving it while the app is
  running. If another program temporarily locks a file, the save fails
  visibly and the previous valid project remains recoverable.

## Development checks

```sh
npm run typecheck
npm test
npm run build
npm run build:desktop
```

Tests cover domain calculations and lifecycle rules, JSON serialization,
recovery behavior, unsupported schema handling, the planning/review workflow,
desktop file-dialog adapter behavior, and local server startup/shutdown.
Windows packaging and Mac file dialogs, packaging, signing,
notarization, and restart persistence still require manual verification on
their respective operating systems.
