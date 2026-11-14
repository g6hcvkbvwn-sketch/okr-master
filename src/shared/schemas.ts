import { z } from "zod";

export const UUIDSchema = z.guid();
export const CadenceSchema = z.enum(["monthly", "quarterly", "yearly"]);
export const MetricTypeSchema = z.enum([
  "number_target",
  "percentage_target",
  "yes_no",
]);

const RequiredTextSchema = z.string().trim().min(1, "This field is required.");
const DateTimeSchema = z.union([
  z.iso.datetime(),
  z.iso.datetime({ precision: -1 }),
]);

export const UserSchema = z
  .object({
    id: UUIDSchema,
    name: RequiredTextSchema,
    email: z.string().trim().email("Enter a valid email address."),
    active: z.boolean(),
  })
  .strict();

export const CompanyGoalSchema = z
  .object({
    id: UUIDSchema,
    cycleId: UUIDSchema,
    title: RequiredTextSchema,
    description: RequiredTextSchema,
    priority: z.number().int().min(1).max(3),
  })
  .strict();

export const CycleSchema = z
  .object({
    id: UUIDSchema,
    startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    endMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    status: z.enum(["planning", "active", "completed"]),
    cadence: CadenceSchema,
    planningFocus: RequiredTextSchema,
    companyGoalSnapshots: z.array(
      z
        .object({
          id: UUIDSchema,
          title: RequiredTextSchema,
          description: RequiredTextSchema,
          priority: z.number().int().min(1).max(3),
        })
        .strict(),
    ).default([]),
    userSnapshots: z.array(
      z
        .object({
          id: UUIDSchema,
          name: RequiredTextSchema,
          email: z.string().trim().email(),
        })
        .strict(),
    ),
  })
  .strict();

const ReviewResponsesSchema = z
  .object({
    successes: z.string(),
    failures: z.string(),
    lessonsLearned: z.string(),
    nextActions: z.string(),
  })
  .strict();

export const ReviewDraftSchema = ReviewResponsesSchema.extend({
  cycleId: UUIDSchema,
}).strict();

export const ReviewSubmissionSchema = z
  .object({
    cycleId: UUIDSchema,
    successes: RequiredTextSchema,
    failures: RequiredTextSchema,
    lessonsLearned: RequiredTextSchema,
    nextActions: RequiredTextSchema,
  })
  .strict();

export const ReviewSchema = z
  .object({
    id: UUIDSchema,
    cycleId: UUIDSchema,
    successes: RequiredTextSchema,
    failures: RequiredTextSchema,
    lessonsLearned: RequiredTextSchema,
    nextActions: RequiredTextSchema,
    overallProgress: z.number().int().min(0).max(100),
    completed: z.literal(true),
  })
  .strict();

const ObjectiveSchemaBase = z
  .object({
    id: UUIDSchema,
    cycleId: UUIDSchema,
    title: RequiredTextSchema,
    description: RequiredTextSchema,
    ownerId: UUIDSchema,
    companyGoalIds: z.array(UUIDSchema).min(1),
    keyResultIds: z.array(UUIDSchema).min(1),
  })
  .strict();

export const ObjectiveSchema = ObjectiveSchemaBase;

const KeyResultBaseSchema = z
  .object({
    id: UUIDSchema,
    objectiveId: UUIDSchema,
    title: RequiredTextSchema,
    description: z.string().trim().default(""),
    ownerId: UUIDSchema,
  })
  .strict();

const ActiveKeyResultBaseSchema = z
  .object({
    title: RequiredTextSchema,
    description: z.string().trim().default(""),
    ownerId: UUIDSchema,
  })
  .strict();

export const KeyResultSchema = z.discriminatedUnion("metricType", [
  KeyResultBaseSchema.extend({
    metricType: z.literal("number_target"),
    startValue: z.number().finite(),
    currentValue: z.number().finite(),
    targetValue: z.number().finite(),
  }),
  KeyResultBaseSchema.extend({
    metricType: z.literal("percentage_target"),
    startValue: z.number().min(0).max(100),
    currentValue: z.number().min(0).max(100),
    targetValue: z.number().min(0).max(100),
  }),
  KeyResultBaseSchema.extend({
    metricType: z.literal("yes_no"),
    value: z.boolean(),
  }),
]);

export const InitiativeTaskSchema = z
  .object({
    id: UUIDSchema,
    text: RequiredTextSchema,
    completed: z.boolean(),
  })
  .strict();

export const InitiativeSchema = z
  .object({
    id: UUIDSchema,
    keyResultId: UUIDSchema,
    title: RequiredTextSchema,
    description: z.string().trim().default(""),
    ownerId: UUIDSchema,
    collaboratorIds: z.array(UUIDSchema),
    priority: z.number().int().min(1).max(3),
    targetDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return (
          Number.isFinite(parsed.getTime()) &&
          parsed.toISOString().slice(0, 10) === value
        );
      }, "Enter a valid target date."),
    status: z.enum(["todo", "in_progress", "blocked", "done"]),
    progress: z.number().int().min(0).max(100),
    tasks: z.array(InitiativeTaskSchema).default([]),
    syncProgressToTasks: z.boolean().default(false),
  })
  .strict();

export const GoalDraftSchema = z
  .object({
    id: UUIDSchema,
    title: z.string(),
    description: z.string(),
  })
  .strict();

export const KeyResultDraftSchema = z
  .object({
    id: UUIDSchema,
    title: z.string(),
    description: z.string().trim().default(""),
    ownerId: z.union([UUIDSchema, z.literal("")]),
    metricType: MetricTypeSchema,
    startValue: z.number().finite(),
    currentValue: z.number().finite(),
    targetValue: z.number().finite().nullable(),
    yesNoValue: z.boolean(),
  })
  .strict();

export const ObjectiveDraftSchema = z
  .object({
    id: UUIDSchema,
    title: z.string(),
    description: z.string(),
    ownerId: z.union([UUIDSchema, z.literal("")]),
    companyGoalIds: z.array(UUIDSchema),
    keyResults: z.array(KeyResultDraftSchema),
  })
  .strict();

const LegacyPlanningDraftSchema = z
  .object({
    cadence: CadenceSchema,
    planningFocus: z.string(),
    companyGoals: z.array(GoalDraftSchema).max(3),
    objective: ObjectiveDraftSchema,
  })
  .strict();

const MultipleObjectivePlanningDraftSchema = z
  .object({
    cadence: CadenceSchema,
    planningFocus: z.string(),
    companyGoals: z.array(GoalDraftSchema).max(3),
    objectives: z.array(ObjectiveDraftSchema),
  })
  .strict();

export const PlanningDraftSchema = z
  .union([
    MultipleObjectivePlanningDraftSchema,
    LegacyPlanningDraftSchema,
  ])
  .transform((draft) =>
    "objectives" in draft
      ? draft
      : {
          cadence: draft.cadence,
          planningFocus: draft.planningFocus,
          companyGoals: draft.companyGoals,
          objectives: [draft.objective],
        },
  );
export const ProjectSchema = z
  .object({
    id: UUIDSchema,
    name: RequiredTextSchema,
    description: z.string().trim().default(""),
    schemaVersion: z.literal(1),
    cadence: CadenceSchema,
    currentCycleId: UUIDSchema.nullable(),
    users: z.array(UserSchema),
    companyGoals: z.array(CompanyGoalSchema),
    cycles: z.array(CycleSchema),
    objectives: z.array(ObjectiveSchema),
    keyResults: z.array(KeyResultSchema),
    initiatives: z.array(InitiativeSchema).default([]),
    reviews: z.array(ReviewSchema).default([]),
    reviewDraft: ReviewDraftSchema.nullable().default(null),
    planningDraft: PlanningDraftSchema.nullable(),
  })
  .strict();

const ViewerUserSchema = UserSchema.omit({ email: true });
const ViewerUserSnapshotSchema = CycleSchema.shape.userSnapshots.element.omit({
  email: true,
});
const ViewerCycleSchema = CycleSchema.extend({
  userSnapshots: z.array(ViewerUserSnapshotSchema),
});

export const ViewerProjectSchema = ProjectSchema.extend({
  users: z.array(ViewerUserSchema),
  cycles: z.array(ViewerCycleSchema),
  reviewDraft: z.null(),
  planningDraft: z.null(),
}).strict();

export const ViewerSnapshotSchema = z
  .object({
    snapshotVersion: z.literal(1),
    schemaVersion: z.literal(1),
    generatedAt: DateTimeSchema,
    projectName: RequiredTextSchema,
    project: ViewerProjectSchema,
  })
  .strict()
  .refine((snapshot) => snapshot.schemaVersion === snapshot.project.schemaVersion)
  .refine((snapshot) => snapshot.projectName === snapshot.project.name);

export const ViewerPublishSettingsSchema = z
  .object({
    directory: z.string(),
    publishOnClose: z.boolean(),
    lastPublishedFingerprint: z.string().nullable(),
    lastPublishedPath: z.string().nullable(),
    lastPublishedAt: DateTimeSchema.nullable(),
  })
  .strict();

export const ViewerPublishResultSchema = z
  .object({
    path: z.string(),
    publishedAt: DateTimeSchema.nullable(),
    published: z.boolean(),
    message: RequiredTextSchema,
  })
  .strict();

export const EditorSaveStateSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    saveStatus: z.enum(["saved", "pending", "saving", "failed"]),
  })
  .strict();

export const CreateProjectRequestSchema = z
  .object({
    name: RequiredTextSchema,
    description: z.string().trim().optional().default(""),
  })
  .strict();

export const UserInputSchema = z
  .object({
    name: RequiredTextSchema,
    email: z.string().trim().email("Enter a valid email address."),
    active: z.boolean(),
  })
  .strict();

export const ActiveObjectiveUpdateSchema = z
  .object({
    title: RequiredTextSchema,
    description: RequiredTextSchema,
    ownerId: UUIDSchema,
    companyGoalIds: z.array(UUIDSchema).min(1),
  })
  .strict();

export const ActiveKeyResultInputSchema = z
  .discriminatedUnion("metricType", [
    ActiveKeyResultBaseSchema.extend({
      metricType: z.literal("number_target"),
      startValue: z.number().finite(),
      currentValue: z.number().finite(),
      targetValue: z.number().finite(),
    }),
    ActiveKeyResultBaseSchema.extend({
      metricType: z.literal("percentage_target"),
      startValue: z.number().min(0).max(100),
      currentValue: z.number().min(0).max(100),
      targetValue: z.number().min(0).max(100),
    }),
    ActiveKeyResultBaseSchema.extend({
      metricType: z.literal("yes_no"),
      value: z.boolean(),
    }),
  ]);

export const ActiveObjectiveInputSchema = z
  .object({
    title: RequiredTextSchema,
    description: RequiredTextSchema,
    ownerId: UUIDSchema,
    companyGoalIds: z.array(UUIDSchema).min(1),
    keyResults: z.array(ActiveKeyResultInputSchema).min(1),
  })
  .strict();

export const InitiativeInputSchema = InitiativeSchema.omit({ id: true });

export const SessionStateSchema = z
  .object({
    project: ProjectSchema.nullable(),
    fileName: z.string().nullable(),
    recoveryMessage: z.string().nullable(),
  })
  .strict();

export type CreateProjectRequest = z.input<typeof CreateProjectRequestSchema>;
export type UserInput = z.infer<typeof UserInputSchema>;
export type ActiveObjectiveInput = z.infer<typeof ActiveObjectiveInputSchema>;
export type ActiveObjectiveUpdate = z.infer<typeof ActiveObjectiveUpdateSchema>;
export type ActiveKeyResultInput = z.infer<typeof ActiveKeyResultInputSchema>;
export type InitiativeInput = z.input<typeof InitiativeInputSchema>;
export type ValidatedInitiativeInput = z.output<typeof InitiativeInputSchema>;
export type ReviewSubmission = z.infer<typeof ReviewSubmissionSchema>;
