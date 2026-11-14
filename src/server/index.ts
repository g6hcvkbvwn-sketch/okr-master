import { openDefaultBrowser } from "./browser-launcher";
import { createApplicationServer } from "./application";
import { resolveClientDirectory } from "./runtime-config";

const application = createApplicationServer({
  clientDirectory: resolveClientDirectory(import.meta.url),
});

void application
  .start()
  .then(({ url }) => {
    console.info(`OKR Master server listening at ${url}`);
    if (process.env.OPEN_BROWSER !== "0") {
      void openDefaultBrowser(url).catch((error: unknown) => {
        console.warn(
          `Could not open the default browser automatically. Open ${url} manually. ${
            error instanceof Error
              ? error.message
              : "Unknown browser launch error."
          }`,
        );
      });
    }
  })
  .catch((error: unknown) => {
    console.error(
      `Could not start the local server: ${
        error instanceof Error ? error.message : "Unknown server error."
      }`,
    );
    process.exitCode = 1;
  });
