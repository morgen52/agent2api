import fastify, { type FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";

import { CodexCliAdapter } from "../adapters/codex/CodexCliAdapter.js";
import type { AgentAdapter } from "../adapters/types.js";
import { type AgentRunRequest, parseAgentRunRequest } from "../contract/requestSchema.js";
import { type ProcessResult } from "../runner/codexRunner.js";
import { collectRunResult, type AgentRunResult } from "../runner/resultCollector.js";
import { prepareRunWorkspace, type RunWorkspace } from "../workspace/workspace.js";

type RunStatus = "running" | "completed" | "failed";

type RunRecord = {
  runId: string;
  status: RunStatus;
  request: AgentRunRequest;
  workspace: RunWorkspace;
  createdAt: string;
  updatedAt: string;
  process?: ProcessResult;
  result?: AgentRunResult;
  error?: string;
};

export type AgentRunner = (context: { request: AgentRunRequest; workspace: RunWorkspace }) => Promise<ProcessResult>;

export type BuildAppOptions = {
  baseDir: string;
  runAgent?: AgentRunner;
  adapter?: AgentAdapter;
  corsOrigin?: string;
};

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = fastify({ logger: false });
  const records = new Map<string, RunRecord>();
  const adapter = options.adapter ?? new CodexCliAdapter();
  const runAgent = options.runAgent ?? ((context) => adapter.run(context));
  const corsOrigin = options.corsOrigin;

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

  app.get("/api/health", async () => ({
    ok: true,
    service: "agent2api"
  }));

  app.post("/api/runs", async (request, reply) => {
    let parsed: AgentRunRequest;
    try {
      parsed = parseAgentRunRequest(request.body);
    } catch (error) {
      return reply.code(400).send(formatValidationError(error));
    }

    const workspace = await prepareRunWorkspace({ baseDir: options.baseDir, request: parsed });
    const record: RunRecord = {
      runId: workspace.runId,
      status: "running",
      request: parsed,
      workspace,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    records.set(record.runId, record);

    if (parsed.options.mode === "async") {
      void executeRun(record, runAgent);
      return reply.code(202).send(toRunResponse(record));
    }

    await executeRun(record, runAgent);
    return reply.code(record.status === "completed" ? 200 : 502).send(toRunResponse(record));
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const record = records.get(request.params.id);
    if (!record) {
      return reply.code(404).send({ error: { code: "not_found", message: "Run not found" } });
    }
    return toRunResponse(record);
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
    return reply.type(artifact.mimeType).send(createReadStream(absolutePath));
  });

  return app;
}

async function executeRun(record: RunRecord, runAgent: AgentRunner): Promise<void> {
  try {
    const process = await runAgent({ request: record.request, workspace: record.workspace });
    record.process = process;

    if (process.exitCode !== 0) {
      record.status = "failed";
      record.error = process.stderr || `Agent process exited with code ${process.exitCode}`;
      return;
    }

    record.result = addArtifactUrls(await collectRunResult({ runId: record.runId, rootDir: record.workspace.rootDir }), record.runId);
    record.status = "completed";
  } catch (error) {
    record.status = "failed";
    record.error = error instanceof Error ? error.message : String(error);
  } finally {
    record.updatedAt = new Date().toISOString();
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
    workspacePath: record.workspace.rootDir,
    answer: record.result?.answer ?? "",
    artifacts: record.result?.artifacts ?? [],
    process: record.process,
    error: record.error
  };
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
