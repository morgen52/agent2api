import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("deployment hardening", () => {
  test("requires a bearer token when apiKey is configured", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      apiKey: "secret",
      runAgent: async () => ({ exitCode: 0, stdout: "", stderr: "" })
    });

    const unauthorized = await app.inject({ method: "POST", url: "/api/runs", payload: { task: { goal: "No token." } } });
    const authorized = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: { authorization: "Bearer secret" },
      payload: { task: { goal: "With token." } }
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    await app.close();
  });

  test("removes expired run directories on startup when retention is configured", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const runDir = path.join(baseDir, "run_old");
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "record.json"), JSON.stringify({ createdAt: "2020-01-01T00:00:00.000Z" }), "utf8");

    const app = await buildApp({ baseDir, retentionMs: 1, now: () => new Date("2020-01-01T00:00:01.000Z") });

    await expect(stat(runDir)).rejects.toThrow();
    await app.close();
  });

  test("writes structured audit log entries", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const auditLogPath = path.join(baseDir, "audit.jsonl");
    const app = await buildApp({
      baseDir,
      auditLogPath,
      runAgent: async () => ({ exitCode: 0, stdout: "", stderr: "" })
    });

    await app.inject({ method: "POST", url: "/api/runs", payload: { task: { goal: "Audit me." } } });
    const auditText = await readFile(auditLogPath, "utf8");

    expect(auditText).toContain('"type":"run.created"');
    expect(auditText).toContain('"type":"run.completed"');
    await app.close();
  });
});
