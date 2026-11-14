import { fileURLToPath } from "node:url";

export const DEFAULT_SERVER_PORT = 4178;

export function resolveServerPort(value = process.env.PORT): number {
  if (value === undefined || value === "") return DEFAULT_SERVER_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export function resolveClientDirectory(moduleUrl: string): string {
  return fileURLToPath(new URL("../../dist", moduleUrl));
}
