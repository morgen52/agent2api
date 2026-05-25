import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildApp } from "../src/server/app.js";

const baseDir = await mkdtemp(path.join(tmpdir(), "agent-gateway-smoke-"));
const app = await buildApp({
  baseDir,
  runAgent: async ({ workspace }) => {
    await mkdir(path.join(workspace.rootDir, "result", "artifacts"), { recursive: true });
    await writeFile(path.join(workspace.rootDir, "result", "answer.md"), "Smoke answer", "utf8");
    await writeFile(path.join(workspace.rootDir, "result", "artifacts", "smoke.md"), "Smoke artifact", "utf8");
    return { exitCode: 0, stdout: "", stderr: "" };
  }
});

const response = await app.inject({
  method: "POST",
  url: "/api/runs",
  payload: {
    task: { goal: "Smoke test" },
    deliverables: [{ name: "smoke", type: "document", description: "Smoke artifact" }]
  }
});

if (response.statusCode !== 200) {
  throw new Error(`Expected 200, got ${response.statusCode}: ${response.body}`);
}

const body = response.json();
if (body.status !== "completed" || body.answer !== "Smoke answer" || body.artifacts.length !== 1) {
  throw new Error(`Unexpected smoke response: ${response.body}`);
}

await app.close();
console.log(`Smoke check passed for ${body.runId}`);
