import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("HTTP API", () => {
  test("GET /api/health returns Agent2API service identity", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({ baseDir });

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "agent2api" });
    await app.close();
  });

  test("POST /api/runs executes a sync run and returns collected results", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      runAgent: async ({ workspace }) => {
        await mkdir(path.join(workspace.rootDir, "result", "artifacts"), { recursive: true });
        await writeFile(path.join(workspace.rootDir, "result", "answer.md"), "Agent answer", "utf8");
        await writeFile(path.join(workspace.rootDir, "result", "artifacts", "notes.md"), "Notes", "utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        task: { goal: "Create notes." },
        deliverables: [{ name: "notes", type: "document", description: "Markdown notes." }]
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("completed");
    expect(body.answer).toBe("Agent answer");
    expect(body.artifacts[0].url).toMatch(/^\/api\/runs\/run_/);

    const statusResponse = await app.inject({ method: "GET", url: `/api/runs/${body.runId}` });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().status).toBe("completed");

    await app.close();
  });

  test("GET /api/runs/:id/events returns SSE lifecycle and output events", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      runAgent: async ({ workspace, events }) => {
        events.stdout("working\n");
        await mkdir(path.join(workspace.rootDir, "result", "artifacts"), { recursive: true });
        await writeFile(path.join(workspace.rootDir, "result", "answer.md"), "Agent answer", "utf8");
        await writeFile(path.join(workspace.rootDir, "result", "artifacts", "notes.md"), "Notes", "utf8");
        return { exitCode: 0, stdout: "working\n", stderr: "" };
      }
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        task: { goal: "Create notes." },
        options: { mode: "sync" }
      }
    });
    const run = runResponse.json();

    const eventsResponse = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/events` });

    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.headers["content-type"]).toContain("text/event-stream");
    expect(eventsResponse.payload).toContain("event: run.started");
    expect(eventsResponse.payload).toContain("event: stdout.delta");
    expect(eventsResponse.payload).toContain("event: artifact.created");
    expect(eventsResponse.payload).toContain("event: run.completed");

    await app.close();
  });

  test("GET /api/runs/:id/events stays open for async runs and streams completion", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const releaseRun = deferred<void>();
    const app = await buildApp({
      baseDir,
      runAgent: async ({ workspace, events }) => {
        events.stdout("started\n");
        await releaseRun.promise;
        await mkdir(path.join(workspace.rootDir, "result", "artifacts"), { recursive: true });
        await writeFile(path.join(workspace.rootDir, "result", "answer.md"), "Async answer", "utf8");
        return { exitCode: 0, stdout: "started\n", stderr: "" };
      }
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        task: { goal: "Create async notes." },
        options: { mode: "async" }
      }
    });
    const run = runResponse.json();
    expect(runResponse.statusCode).toBe(202);
    expect(run.status).toBe("running");

    const eventsPromise = app.inject({ method: "GET", url: `/api/runs/${run.runId}/events` });
    await new Promise((resolve) => setImmediate(resolve));
    releaseRun.resolve();
    const eventsResponse = await eventsPromise;

    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.payload).toContain("event: run.started");
    expect(eventsResponse.payload).toContain("event: stdout.delta");
    expect(eventsResponse.payload).toContain("event: run.completed");

    await app.close();
  });

  test("GET /api/runs/:id/events returns failed lifecycle events", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      runAgent: async ({ events }) => {
        events.stderr("bad runtime\n");
        return { exitCode: 2, stdout: "", stderr: "bad runtime" };
      }
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        task: { goal: "Fail clearly." }
      }
    });
    const run = runResponse.json();
    expect(runResponse.statusCode).toBe(502);
    expect(run.status).toBe("failed");

    const eventsResponse = await app.inject({ method: "GET", url: `/api/runs/${run.runId}/events` });

    expect(eventsResponse.statusCode).toBe(200);
    expect(eventsResponse.payload).toContain("event: run.started");
    expect(eventsResponse.payload).toContain("event: stderr.delta");
    expect(eventsResponse.payload).toContain("event: run.failed");
    expect(eventsResponse.payload).toContain("bad runtime");

    await app.close();
  });

  test("GET /api/runs/:id/artifacts/* downloads artifact content", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      runAgent: async ({ workspace }) => {
        await mkdir(path.join(workspace.rootDir, "result", "artifacts"), { recursive: true });
        await writeFile(path.join(workspace.rootDir, "result", "answer.md"), "Agent answer", "utf8");
        await writeFile(path.join(workspace.rootDir, "result", "artifacts", "notes.md"), "Notes", "utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        task: { goal: "Create notes." }
      }
    });
    const run = runResponse.json();

    const artifactResponse = await app.inject({
      method: "GET",
      url: run.artifacts[0].url
    });

    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.headers["content-type"]).toContain("text/markdown");
    expect(artifactResponse.payload).toBe("Notes");

    await app.close();
  });

  test("artifact URLs preserve nested paths and URL-encoded file names", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      runAgent: async ({ workspace }) => {
        await mkdir(path.join(workspace.rootDir, "result", "artifacts", "nested"), { recursive: true });
        await writeFile(path.join(workspace.rootDir, "result", "answer.md"), "Agent answer", "utf8");
        await writeFile(path.join(workspace.rootDir, "result", "artifacts", "nested", "report 1.md"), "Nested notes", "utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        task: { goal: "Create nested artifact." }
      }
    });
    const run = runResponse.json();

    expect(run.artifacts[0].path).toBe("artifacts/nested/report 1.md");
    expect(run.artifacts[0].url).toMatch(/nested\/report%201\.md$/);

    const artifactResponse = await app.inject({
      method: "GET",
      url: run.artifacts[0].url
    });

    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.payload).toBe("Nested notes");

    await app.close();
  });

  test("POST /api/runs returns validation errors for bad requests", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({ baseDir });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { instruction: "" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("bad_request");
    await app.close();
  });

  test("supports configured CORS preflight for a custom frontend origin", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({ baseDir, corsOrigin: "http://127.0.0.1:5173" });

    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/runs",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "POST"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
    await app.close();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
