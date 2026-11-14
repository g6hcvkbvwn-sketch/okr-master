import type { z } from "zod";
import type {
  CompanyGoalSchema,
  CycleSchema,
  InitiativeSchema,
  InitiativeTaskSchema,
  KeyResultSchema,
  KeyResultDraftSchema,
  ObjectiveSchema,
  PlanningDraftSchema,
  ProjectSchema,
  ReviewSchema,
  ReviewDraftSchema,
  UserSchema,
  ViewerPublishResultSchema,
  ViewerPublishSettingsSchema,
  EditorSaveStateSchema,
} from "./schemas";

export type Cadence = "monthly" | "quarterly" | "yearly";
export type MetricType = "number_target" | "percentage_target" | "yes_no";
export type User = z.infer<typeof UserSchema>;
export type CompanyGoal = z.infer<typeof CompanyGoalSchema>;
export type Cycle = z.infer<typeof CycleSchema>;
export type Objective = z.infer<typeof ObjectiveSchema>;
export type KeyResult = z.infer<typeof KeyResultSchema>;
export type Initiative = z.infer<typeof InitiativeSchema>;
export type InitiativeTask = z.infer<typeof InitiativeTaskSchema>;
export type KeyResultDraft = z.infer<typeof KeyResultDraftSchema>;
export type PlanningDraft = z.infer<typeof PlanningDraftSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type ReviewDraft = z.infer<typeof ReviewDraftSchema>;
export type ViewerPublishSettings = z.infer<typeof ViewerPublishSettingsSchema>;
export type EditorSaveState = z.infer<typeof EditorSaveStateSchema>;
export type ViewerPublishResult = z.infer<typeof ViewerPublishResultSchema>;

export interface ApiError {
  error: string;
}

export interface SessionState {
  project: Project | null;
  fileName: string | null;
  recoveryMessage: string | null;
}
