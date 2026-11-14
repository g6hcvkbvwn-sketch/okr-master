import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputDirectory = resolve("dist-viewer");
const htmlPath = resolve(outputDirectory, "viewer-template.html");
let html = await readFile(htmlPath, "utf8");

const cssLinks = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)];
const scriptTags = [
  ...html.matchAll(/<script\b([^>]*)src="([^"]+\.js)"([^>]*)><\/script>/g),
];
if (cssLinks.length !== 1 || scriptTags.length !== 1) {
  throw new Error(
    `Expected one viewer stylesheet and script; found ${cssLinks.length} stylesheet(s) and ${scriptTags.length} script(s).`,
  );
}

for (const match of cssLinks) {
  const assetPath = resolve(dirname(htmlPath), match[1]);
  const css = await readFile(assetPath, "utf8");
  html = html.replace(match[0], () => `<style>${css}</style>`);
}

const imageLinks = [
  ...html.matchAll(/<link\b[^>]*href="([^"]+\.(png|svg|ico))"[^>]*>/gi),
];
for (const match of imageLinks) {
  const assetPath = resolve(dirname(htmlPath), match[1]);
  const image = await readFile(assetPath);
  const mimeType =
    match[2].toLowerCase() === "svg"
      ? "image/svg+xml"
      : match[2].toLowerCase() === "ico"
        ? "image/x-icon"
        : "image/png";
  const link = match[0].replace(
    `href="${match[1]}"`,
    `href="data:${mimeType};base64,${image.toString("base64")}"`,
  );
  html = html.replace(match[0], () => link);
}

const scriptMatch = scriptTags[0];
if (!scriptMatch) throw new Error("The viewer script tag was not found.");
const scriptPath = resolve(dirname(htmlPath), scriptMatch[2]);
const script = (await readFile(scriptPath, "utf8")).replace(
  /<\/script/gi,
  "<\\/script",
);
const scriptHash = createHash("sha256").update(script).digest("base64");
const attributes = `${scriptMatch[1]}${scriptMatch[3]}`
  .replace(/\bcrossorigin(?:="[^"]*")?/g, "")
  .replace(/\s+/g, " ")
  .trim();
html = html.replace(
  scriptMatch[0],
  () => `<script ${attributes}>${script}</script>`,
);

const policy = [
  "default-src 'none'",
  `script-src 'sha256-${scriptHash}'`,
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "worker-src 'none'",
  "media-src 'none'",
].join("; ");
html = html.replace("__OKR_VIEWER_CSP__", () => policy);

if (!html.includes("default-src 'none'")) {
  throw new Error("The viewer Content Security Policy was not generated.");
}

await writeFile(htmlPath, html, "utf8");
