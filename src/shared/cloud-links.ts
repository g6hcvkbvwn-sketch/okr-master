import { z } from "zod";
import { UUIDSchema } from "./schemas";

const ReminderViewSchema = z.enum(["initiatives", "okr"]);
type ReminderView = z.infer<typeof ReminderViewSchema>;

export function reminderLink(baseUrl: string | undefined, projectId: string, view: ReminderView): string {
  let url: URL;
  try {
    url = new URL(baseUrl ?? "");
  } catch {
    throw new Error("APP_BASE_URL must be the HTTPS origin of the cloud app.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_BASE_URL must be the HTTPS origin of the cloud app.");
  }
  url.searchParams.set("project", UUIDSchema.parse(projectId));
  url.searchParams.set("view", view);
  return url.toString();
}

export function readReminderLink(url: URL): { projectId: string; view: ReminderView } | null {
  if (!url.searchParams.has("project")) return null;
  const projectId = UUIDSchema.safeParse(url.searchParams.get("project"));
  const view = ReminderViewSchema.safeParse(url.searchParams.get("view"));
  if (!projectId.success || !view.success || url.searchParams.getAll("project").length !== 1 || url.searchParams.getAll("view").length !== 1) {
    throw new Error("This project link is invalid.");
  }
  return { projectId: projectId.data, view: view.data };
}
