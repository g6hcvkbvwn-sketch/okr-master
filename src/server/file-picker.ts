import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);

export interface ProjectFilePicker {
  chooseOpenProject(): Promise<string | null>;
  chooseNewProjectPath(): Promise<string | null>;
}

async function runDialog(
  command: string,
  args: string[],
  script: string,
  outputEncoding: "text" | "base64" = "text",
): Promise<string | null> {
  const { stdout } = await execFile(command, [...args, script]);
  const output = stdout.replace(/\r?\n$/, "");
  const selectedPath =
    outputEncoding === "base64"
      ? Buffer.from(output, "base64").toString("utf8")
      : output;
  return selectedPath === "" || selectedPath === "CANCELLED"
    ? null
    : selectedPath;
}

export class MacOsAppleScriptFilePicker implements ProjectFilePicker {
  async chooseOpenProject(): Promise<string | null> {
    const script = [
      "try",
      'set selectedFile to choose file with prompt "Open an OKR project" of type {"public.json"}',
      "return POSIX path of selectedFile",
      "on error number -128",
      'return "CANCELLED"',
      "end try",
    ].join("\n");
    return runDialog("osascript", ["-e"], script);
  }

  async chooseNewProjectPath(): Promise<string | null> {
    const script = [
      "try",
      'set selectedFile to choose file name with prompt "Create an OKR project" default name "project.json"',
      "return POSIX path of selectedFile",
      "on error number -128",
      'return "CANCELLED"',
      "end try",
    ].join("\n");
    return runDialog("osascript", ["-e"], script);
  }
}

export class WindowsPowerShellFilePicker implements ProjectFilePicker {
  async chooseOpenProject(): Promise<string | null> {
    return runDialog(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-STA", "-Command"],
      [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
        "$dialog.Title = 'Open an OKR project'",
        "$dialog.Filter = 'JSON project (*.json)|*.json'",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.FileName))) }",
      ].join("; "),
      "base64",
    );
  }

  async chooseNewProjectPath(): Promise<string | null> {
    return runDialog(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-STA", "-Command"],
      [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$dialog = New-Object System.Windows.Forms.SaveFileDialog",
        "$dialog.Title = 'Create an OKR project'",
        "$dialog.Filter = 'JSON project (*.json)|*.json'",
        "$dialog.DefaultExt = 'json'",
        "$dialog.AddExtension = $true",
        "$dialog.FileName = 'project.json'",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.FileName))) }",
      ].join("; "),
      "base64",
    );
  }
}

export function createProjectFilePicker(
  platform: NodeJS.Platform = process.platform,
): ProjectFilePicker {
  if (platform === "darwin") return new MacOsAppleScriptFilePicker();
  if (platform === "win32") return new WindowsPowerShellFilePicker();
  throw new Error(
    `No native project file picker is available on ${platform}. Supported operating systems are macOS and Windows.`,
  );
}
