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
