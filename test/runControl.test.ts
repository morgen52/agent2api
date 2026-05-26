import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("run control", () => {
  test("cancels a running async run", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    let aborted = false;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const app = await buildApp({
      baseDir,
      runAgent: async ({ signal }) => {
        markStarted?.();
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
        });
        return { exitCode: 1, stdout: "", stderr: "canceled" };
      }
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { task: { goal: "Wait until canceled." }, options: { mode: "async" } }
    });
    const run = runResponse.json();

    await started;
    const cancelResponse = await app.inject({ method: "POST", url: `/api/runs/${run.runId}/cancel` });
    const statusResponse = await app.inject({ method: "GET", url: `/api/runs/${run.runId}` });

    expect(cancelResponse.statusCode).toBe(200);
    expect(cancelResponse.json().status).toBe("canceled");
    expect(statusResponse.json().status).toBe("canceled");
    expect(aborted).toBe(true);

    await app.close();
  });

  test("queues async runs over the configured concurrency limit", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    let releaseFirstRun: (() => void) | undefined;
    const app = await buildApp({
      baseDir,
      maxConcurrentRuns: 1,
      runAgent: async () => {
        await new Promise<void>((resolve) => {
          releaseFirstRun = resolve;
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { task: { goal: "First." }, options: { mode: "async" } }
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: { task: { goal: "Second." }, options: { mode: "async" } }
    });

    expect(first.json().status).toBe("running");
    expect(second.json().status).toBe("queued");

    releaseFirstRun?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const secondStatus = await app.inject({ method: "GET", url: `/api/runs/${second.json().runId}` });
    expect(["running", "completed"]).toContain(secondStatus.json().status);

    await app.close();
  });
});
