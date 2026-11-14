import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

export interface BrowserLaunchCommand {
  command: string;
  args: string[];
}

export function getBrowserLaunchCommand(
  platform: NodeJS.Platform,
  url: string,
): BrowserLaunchCommand {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", url],
    };
  }
  return { command: "xdg-open", args: [url] };
}

export async function openDefaultBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const { command, args } = getBrowserLaunchCommand(platform, url);
  await execFile(command, args);
}
