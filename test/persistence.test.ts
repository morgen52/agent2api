import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("persistent run store", () => {
  test("reloads completed runs, events, and artifact downloads after restart", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const firstApp = await buildApp({
      baseDir,
      runAgent: async ({ workspace, events }) => {
        events.stdout("working\n");
        await mkdir(path.join(workspace.rootDir, "result", "artifacts"), { recursive: true });
        await writeFile(path.join(workspace.rootDir, "result", "answer.md"), "Persisted answer", "utf8");
        await writeFile(path.join(workspace.rootDir, "result", "artifacts", "memo.md"), "Persisted memo", "utf8");
        return { exitCode: 0, stdout: "working\n", stderr: "" };
      }
    });

    const runResponse = await firstApp.inject({
      method: "POST",
      url: "/api/runs",
      payload: { task: { goal: "Create persisted memo." } }
    });
    const run = runResponse.json();
    await firstApp.close();

    const secondApp = await buildApp({ baseDir });
    const statusResponse = await secondApp.inject({ method: "GET", url: `/api/runs/${run.runId}` });
    const eventsResponse = await secondApp.inject({ method: "GET", url: `/api/runs/${run.runId}/events` });
    const artifactResponse = await secondApp.inject({ method: "GET", url: `/api/runs/${run.runId}/artifacts/memo.md` });

    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().answer).toBe("Persisted answer");
    expect(eventsResponse.payload).toContain("event: run.completed");
    expect(eventsResponse.payload).toContain("event: stdout.delta");
    expect(artifactResponse.statusCode).toBe(200);
    expect(artifactResponse.payload).toBe("Persisted memo");

    await secondApp.close();
  });
});
