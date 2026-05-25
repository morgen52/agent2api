import { z } from "zod";

const fileNameSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !value.includes("/") && !value.includes("\\") && value !== "." && value !== "..", {
    message: "file name must be a safe basename"
  });

const base64Schema = z
  .string()
  .min(1)
  .refine((value) => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), {
    message: "contentBase64 must be valid base64"
  });

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const MaterialFileSchema = z
  .object({
    name: fileNameSchema,
    mimeType: z.string().min(1).default("application/octet-stream"),
    contentBase64: base64Schema.optional(),
    text: z.string().optional()
  })
  .strict()
  .refine((value) => Boolean(value.contentBase64 || value.text), {
    message: "file material must include contentBase64 or text"
  });

export const MaterialUrlSchema = z.object({
  url: z.string().url(),
  label: z.string().min(1).max(120).optional()
}).strict();

export const MaterialsSchema = z
  .object({
    files: z.array(MaterialFileSchema).default([]),
    urls: z.array(MaterialUrlSchema).default([]),
    notes: z.array(z.string().min(1)).default([])
  })
  .strict()
  .default({ files: [], urls: [], notes: [] });

export const TaskSpecSchema = z.object({
  goal: z.string().trim().min(1, "task.goal is required"),
  mode: z.enum(["execute", "plan", "review", "research", "transform", "question_answer"]).default("execute"),
  instructions: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  constraints: z.array(z.string().min(1)).default([])
}).strict();

export const SkillSpecSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "skill name must be portable and file safe"),
  version: z.string().min(1).max(80).optional(),
  description: z.string().min(1).max(1_000).optional(),
  required: z.boolean().default(false),
  inputs: jsonObjectSchema.default({}),
  permissions: z.array(z.string().min(1)).default([])
}).strict();

export const ArtifactSpecSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "artifact name must be URL and file safe"),
  type: z.enum(["document", "image", "audio", "video", "archive", "data", "code", "other"]).default("other"),
  description: z.string().min(1).max(1_000),
  required: z.boolean().default(false),
  mimeTypes: z.array(z.string().min(1)).default([])
}).strict();

export const AgentDescriptorSchema = z.union([
  z.string().min(1),
  z.object({
    id: z.string().min(1),
    runtime: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    capabilities: z.array(z.string().min(1)).default([])
  }).strict()
]);

export const AgentRunOptionsSchema = z
  .object({
    mode: z.enum(["sync", "async"]).default("sync"),
    timeoutMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
    sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("workspace-write"),
    webSearch: z.boolean().default(false),
    model: z.string().min(1).max(120).optional(),
    profile: z.string().min(1).max(120).optional()
  })
  .strict()
  .default({ mode: "sync", timeoutMs: 300_000, sandbox: "workspace-write", webSearch: false });

const AgentTaskRequestSchema = z
  .object({
    apiVersion: z.literal("agent-service/v1").default("agent-service/v1"),
    kind: z.literal("agent.task").default("agent.task"),
    agent: AgentDescriptorSchema.default("codex"),
    task: TaskSpecSchema,
    context: MaterialsSchema,
    skills: z.array(SkillSpecSchema).default([]),
    deliverables: z.array(ArtifactSpecSchema).default([]),
    options: AgentRunOptionsSchema,
    metadata: jsonObjectSchema.default({}),
    adapterOptions: jsonObjectSchema.default({})
  })
  .strict();

export const AgentRunRequestSchema = AgentTaskRequestSchema;

export type MaterialFile = z.infer<typeof MaterialFileSchema>;
export type MaterialUrl = z.infer<typeof MaterialUrlSchema>;
export type ArtifactSpec = z.infer<typeof ArtifactSpecSchema>;
export type TaskSpec = z.infer<typeof TaskSpecSchema>;
export type SkillSpec = z.infer<typeof SkillSpecSchema>;
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export function parseAgentRunRequest(input: unknown): AgentRunRequest {
  return AgentRunRequestSchema.parse(input);
}
