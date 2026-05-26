import multipart from "@fastify/multipart";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { ZodError } from "zod";

import { CodexCliAdapter } from "../adapters/codex/CodexCliAdapter.js";
import { LocalShellAdapter } from "../adapters/localShell/LocalShellAdapter.js";
import type { AgentAdapter } from "../adapters/types.js";
import { type AgentRunRequest, type AgentRunRequestInput, type MaterialFile, parseAgentRunRequest } from "../contract/requestSchema.js";
import { enrichUrlContext, type UrlContextOptions } from "../context/urlContext.js";
import { AgentRunTimeoutError, type ProcessEvents, type ProcessResult } from "../runner/codexRunner.js";
import { collectRunResult, type AgentRunResult } from "../runner/resultCollector.js";
import { cleanupExpiredRuns, loadRunRecords, saveRunRecord, type RunEvent, type RunEventType, type RunStatus, type StoredRunRecord } from "../store/runStore.js";
import { writeAuditEvent } from "../audit/auditLog.js";
import { loadSkillManifests } from "../skills/skillRegistry.js";
import { prepareRunWorkspace, type RunWorkspace } from "../workspace/workspace.js";

type RunRecord = StoredRunRecord & {
  events: RunEvent[];
  eventListeners: Set<(event: RunEvent) => void>;
  nextEventId: number;
  controller?: AbortController;
};

export type AgentRunner = (context: {
  request: AgentRunRequest;
  workspace: RunWorkspace;
  events: Required<ProcessEvents>;
  signal: AbortSignal;
}) => Promise<ProcessResult>;

export type BuildAppOptions = {
  baseDir: string;
  runAgent?: AgentRunner;
  adapter?: AgentAdapter;
  adapters?: AgentAdapter[];
  corsOrigin?: string;
  maxConcurrentRuns?: number;
  apiKey?: string;
  skillsDir?: string;
  auditLogPath?: string;
  retentionMs?: number;
  now?: () => Date;
} & UrlContextOptions;

type MultipartRunInput = {
  request: AgentRunRequestInput;
  files: MaterialFile[];
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({ logger: false });
  const records = new Map<string, RunRecord>();
  await cleanupExpiredRuns({ baseDir: options.baseDir, retentionMs: options.retentionMs, now: options.now?.() ?? new Date() });
  const adapters = [options.adapter ?? new CodexCliAdapter(), new LocalShellAdapter(), ...(options.adapters ?? [])];
  const selectAdapter = (request: AgentRunRequest): AgentAdapter => {
    const requested = typeof request.agent === "string" ? request.agent : request.agent.id;
    const runtime = typeof request.agent === "string" ? request.agent : request.agent.runtime;
    const adapter = adapters.find((item) => {
      const capabilities = item.capabilities();
      return capabilities.id === requested || capabilities.runtime === requested || (runtime ? capabilities.runtime === runtime : false);
    });
    if (!adapter) {
      throw new Error(`No adapter registered for agent: ${requested}`);
    }
    return adapter;
  };
  const runAgent = options.runAgent ?? ((context) => selectAdapter(context.request).run(context));
  const corsOrigin = options.corsOrigin;
  const maxConcurrentRuns = options.maxConcurrentRuns ?? Number.POSITIVE_INFINITY;
  const queue: RunRecord[] = [];
  const skills = await loadSkillManifests(options.skillsDir);
  let activeRuns = 0;

  for (const stored of await loadRunRecords(options.baseDir)) {
    const record = hydrateRunRecord(stored);
    if (record.status === "running" || record.status === "queued") {
      record.status = "failed";
      record.error = "Server restarted before this run reached a terminal state.";
      record.updatedAt = new Date().toISOString();
      await emitRunEvent(record, "run.failed", { status: record.status, error: record.error });
    }
    records.set(record.runId, record);
  }

  await app.register(multipart);

  if (corsOrigin) {
    app.addHook("onRequest", (request, reply, done) => {
      reply.header("access-control-allow-origin", corsOrigin);
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "content-type,authorization");
      reply.header("vary", "Origin");

      if (request.method === "OPTIONS") {
        reply.code(204).send();
        return;
      }

      done();
    });
  }

  if (options.apiKey) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.method === "OPTIONS" || request.url === "/api/health") {
        return;
      }
      const expected = `Bearer ${options.apiKey}`;
      if (request.headers.authorization !== expected) {
        await writeAuditEvent(options.auditLogPath, { type: "auth.failed", data: { url: request.url, method: request.method } });
        return reply.code(401).send({ error: { code: "unauthorized", message: "Missing or invalid bearer token" } });
      }
    });
  }

  app.get("/api/health", async () => ({
    ok: true,
    service: "agent2api"
  }));

  app.post("/api/runs", async (request, reply) => {
    let parsed: AgentRunRequest;
    try {
      parsed = parseAgentRunRequest(request.body);
      parsed = await enrichUrlContext(parsed, options);
    } catch (error) {
      return reply.code(400).send(formatValidationError(error));
    }

    return createRun(parsed, reply);
  });

  app.post("/api/runs/multipart", async (request, reply) => {
    let input: MultipartRunInput;
    try {
      input = await parseMultipartRunRequest(request);
      const requestInput = {
        ...input.request,
        context: {
          ...(typeof input.request.context === "object" && input.request.context !== null ? input.request.context : {}),
          files: [...((input.request.context as { files?: MaterialFile[] } | undefined)?.files ?? []), ...input.files]
        }
      };
      const parsed = await enrichUrlContext(parseAgentRunRequest(requestInput), options);
      return createRun(parsed, reply);
    } catch (error) {
      return reply.code(400).send(formatValidationError(error));
    }
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) {
      return reply.code(404).send({ error: { code: "not_found", message: "Run not found" } });
    }
    return toRunResponse(record);
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/cancel", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) {
      return reply.code(404).send({ error: { code: "not_found", message: "Run not found" } });
    }

    if (isTerminal(record.status)) {
      return toRunResponse(record);
    }

    if (record.status === "queued") {
      const index = queue.findIndex((item) => item.runId === record.runId);
      if (index >= 0) {
        queue.splice(index, 1);
      }
    }

    record.status = "canceled";
    record.updatedAt = new Date().toISOString();
    record.error = "Run canceled by caller.";
    record.controller?.abort();
    await emitRunEvent(record, "run.canceled", { status: record.status });
    await writeAuditEvent(options.auditLogPath, { type: "run.canceled", runId: record.runId });
    return toRunResponse(record);
  });

  app.get("/api/skills", async () => ({
    skills
  }));

  app.get<{ Params: { name: string } }>("/api/skills/:name", async (request, reply) => {
    const skill = skills.find((item) => item.name === request.params.name);
    if (!skill) {
      return reply.code(404).send({ error: { code: "not_found", message: "Skill not found" } });
    }
    return skill;
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id/events", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) {
      return reply.code(404).send({ error: { code: "not_found", message: "Run not found" } });
    }

    const stream = new PassThrough();
    reply.header("content-type", "text/event-stream; charset=utf-8");
    reply.header("cache-control", "no-cache, no-transform");
    reply.header("connection", "keep-alive");

    for (const event of record.events) {
      stream.write(formatSseEvent(event));
    }

    if (record.status !== "running") {
      stream.end();
      return reply.send(stream);
    }

    const listener = (event: RunEvent) => {
      stream.write(formatSseEvent(event));
      if (event.type === "run.completed" || event.type === "run.failed") {
        record.eventListeners.delete(listener);
        stream.end();
      }
    };

    record.eventListeners.add(listener);
    request.raw.on("close", () => {
      record.eventListeners.delete(listener);
      stream.end();
    });

    return reply.send(stream);
  });

  app.get<{ Params: { id: string; "*": string } }>("/api/runs/:id/artifacts/*", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) {
      return reply.code(404).send({ error: { code: "not_found", message: "Run not found" } });
    }

    const requestedPath = request.params["*"];
    const artifact = record.result?.artifacts.find((item) => item.path === `artifacts/${requestedPath}`);
    if (!artifact) {
      return reply.code(404).send({ error: { code: "not_found", message: "Artifact not found" } });
    }

    const absolutePath = path.join(record.workspace.resultDir, artifact.path);
    await writeAuditEvent(options.auditLogPath, { type: "artifact.downloaded", runId: record.runId, data: { path: artifact.path } });
    return reply.type(artifact.mimeType).send(createReadStream(absolutePath));
  });

  async function createRun(parsed: AgentRunRequest, reply: FastifyReply) {
    const workspace = await prepareRunWorkspace({ baseDir: options.baseDir, request: parsed });
    const now = new Date().toISOString();
    const record: RunRecord = {
      runId: workspace.runId,
      status: "queued",
      request: parsed,
      workspace,
      createdAt: now,
      updatedAt: now,
      events: [],
      eventListeners: new Set(),
      nextEventId: 1
    };
    records.set(record.runId, record);
    await emitRunEvent(record, "run.created", { status: record.status });
    await writeAuditEvent(options.auditLogPath, { type: "run.created", runId: record.runId });

    if (parsed.options.mode === "async") {
      enqueueOrStart(record);
      return reply.code(202).send(toRunResponse(record));
    }

    await startRun(record);
    return reply.code(record.status === "completed" ? 200 : 502).send(toRunResponse(record));
  }

  function enqueueOrStart(record: RunRecord): void {
    if (activeRuns >= maxConcurrentRuns) {
      queue.push(record);
      void emitRunEvent(record, "run.queued", { status: record.status });
      return;
    }

    void startRun(record);
  }

  async function startRun(record: RunRecord): Promise<void> {
    activeRuns += 1;
    record.controller = new AbortController();
    record.status = "running";
    record.updatedAt = new Date().toISOString();
    await emitRunEvent(record, "run.started", { status: record.status });

    try {
      await executeRun(record, runAgent, options.auditLogPath);
    } finally {
      activeRuns -= 1;
      drainQueue();
    }
  }

  function drainQueue(): void {
    while (activeRuns < maxConcurrentRuns) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      if (next.status === "queued") {
        void startRun(next);
      }
    }
  }

  return app;
}

async function executeRun(record: RunRecord, runAgent: AgentRunner, auditLogPath?: string): Promise<void> {
  try {
    const process = await runAgent({
      request: record.request,
      workspace: record.workspace,
      events: {
        stdout: (chunk) => void emitRunEvent(record, "stdout.delta", { text: chunk }),
        stderr: (chunk) => void emitRunEvent(record, "stderr.delta", { text: chunk })
      },
      signal: record.controller?.signal ?? new AbortController().signal
    });
    record.process = process;

    if (record.status === "canceled") {
      await saveRunRecord(record);
      return;
    }

    if (process.exitCode !== 0) {
      record.status = "failed";
      record.error = process.stderr || `Agent process exited with code ${process.exitCode}`;
      await emitRunEvent(record, "run.failed", { status: record.status, error: record.error });
      await writeAuditEvent(auditLogPath, { type: "run.failed", runId: record.runId, data: { error: record.error } });
      return;
    }

    record.result = addArtifactUrls(await collectRunResult({ runId: record.runId, rootDir: record.workspace.rootDir }), record.runId);
    for (const artifact of record.result.artifacts) {
      await emitRunEvent(record, "artifact.created", artifact);
    }
    record.status = "completed";
    await emitRunEvent(record, "run.completed", {
      status: record.status,
      artifactCount: record.result.artifacts.length
    });
    await writeAuditEvent(auditLogPath, { type: "run.completed", runId: record.runId });
  } catch (error) {
    if (record.status === "canceled") {
      await saveRunRecord(record);
      return;
    }
    record.status = "failed";
    record.error = error instanceof Error ? error.message : String(error);
    if (error instanceof AgentRunTimeoutError) {
      record.status = "timed_out";
      await emitRunEvent(record, "run.timed_out", { status: record.status, error: record.error });
      await writeAuditEvent(auditLogPath, { type: "run.timed_out", runId: record.runId });
      return;
    }
    await emitRunEvent(record, "run.failed", { status: record.status, error: record.error });
    await writeAuditEvent(auditLogPath, { type: "run.failed", runId: record.runId, data: { error: record.error } });
  } finally {
    record.updatedAt = new Date().toISOString();
    await saveRunRecord(record);
  }
}

function addArtifactUrls(result: AgentRunResult, runId: string): AgentRunResult {
  return {
    ...result,
    artifacts: result.artifacts.map((artifact) => ({
      ...artifact,
      url: `/api/runs/${runId}/artifacts/${artifact.path.replace(/^artifacts\//, "").split("/").map(encodeURIComponent).join("/")}`
    }))
  };
}

function toRunResponse(record: RunRecord) {
  return {
    runId: record.runId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pollUrl: `/api/runs/${record.runId}`,
    eventsUrl: `/api/runs/${record.runId}/events`,
    workspacePath: record.workspace.rootDir,
    answer: record.result?.answer ?? "",
    artifacts: record.result?.artifacts ?? [],
    process: record.process,
    error: record.error
  };
}

async function emitRunEvent(record: RunRecord, type: RunEventType, data: unknown): Promise<void> {
  const event: RunEvent = {
    id: record.nextEventId,
    type,
    createdAt: new Date().toISOString(),
    data: {
      runId: record.runId,
      ...toObject(data)
    }
  };
  record.nextEventId += 1;
  record.events.push(event);
  record.updatedAt = event.createdAt;
  await saveRunRecord(record);
  for (const listener of record.eventListeners) {
    listener(event);
  }
}

function formatSseEvent(event: RunEvent): string {
  return [`id: ${event.id}`, `event: ${event.type}`, `data: ${JSON.stringify(event.data)}`, ""].join("\n") + "\n";
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : { value };
}

function hydrateRunRecord(record: StoredRunRecord): RunRecord {
  return {
    ...record,
    eventListeners: new Set(),
    nextEventId: record.nextEventId ?? record.events.length + 1
  };
}

function isTerminal(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled" || status === "timed_out";
}

async function parseMultipartRunRequest(request: FastifyRequest): Promise<MultipartRunInput> {
  const files: MaterialFile[] = [];
  let requestInput: AgentRunRequestInput | undefined;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      files.push({
        name: part.filename,
        mimeType: part.mimetype || "application/octet-stream",
        contentBase64: buffer.toString("base64")
      });
      continue;
    }

    if (part.fieldname === "request") {
      requestInput = (typeof part.value === "string" ? JSON.parse(part.value) : part.value) as AgentRunRequestInput;
    }
  }

  if (!requestInput) {
    throw new Error("multipart request must include a JSON `request` field");
  }

  return { request: requestInput, files };
}

function formatValidationError(error: unknown) {
  if (error instanceof ZodError) {
    return {
      error: {
        code: "bad_request",
        message: "Invalid agent run request",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      }
    };
  }

  return {
    error: {
      code: "bad_request",
      message: error instanceof Error ? error.message : String(error)
    }
  };
}
