// Regenerates branding assets from logo.png. Run with: npm run icons
const { app, nativeImage } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const targets = [
  // Header logo and favicon for the editor and the team viewer.
  { path: "src/client/assets/logo-128.png", size: 128 },
  // Source for the Windows .ico, macOS .icns, and the Electron window icon.
  { path: "build/icon.png", size: 512 },
];

app.whenReady().then(() => {
  try {
    const source = nativeImage.createFromPath(resolve(root, "logo.png"));
    if (source.isEmpty()) throw new Error("logo.png could not be read.");

    for (const target of targets) {
      const output = resolve(root, target.path);
      mkdirSync(dirname(output), { recursive: true });
      const resized = source.resize({
        width: target.size,
        height: target.size,
        quality: "best",
      });
      writeFileSync(output, resized.toPNG());
      console.info(`Wrote ${target.path} (${target.size}px)`);
    }
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
