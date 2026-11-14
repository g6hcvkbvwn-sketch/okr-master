import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseProject } from "../src/domain/project";
import {
  createViewerSnapshot,
  stringifyViewerSnapshot,
} from "../src/domain/viewer-snapshot";

const projectPath = process.argv[2];
if (!projectPath) {
  throw new Error(
    "Provide the source project JSON path. Usage: npm run build:viewer -- <project.json>",
  );
}

const templatePath = resolve("dist-viewer", "viewer-template.html");
const outputPath = resolve("viewer", "okr-viewer.html");
const project = parseProject(
  JSON.parse(await readFile(resolve(projectPath), "utf8")) as unknown,
);
const snapshot = createViewerSnapshot(project);
const template = await readFile(templatePath, "utf8");
if (!template.includes("__OKR_VIEWER_SNAPSHOT__")) {
  throw new Error("The viewer template does not contain its snapshot placeholder.");
}

const html = template.replace(
  "__OKR_VIEWER_SNAPSHOT__",
  stringifyViewerSnapshot(snapshot),
);
await mkdir(resolve("viewer"), { recursive: true });
await writeFile(outputPath, html, "utf8");
console.info(`Created read-only viewer: ${outputPath}`);
