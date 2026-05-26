import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("adapters and skills", () => {
  test("runs the local-shell adapter as a second runtime adapter", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({ baseDir });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        agent: "local-shell",
        task: { goal: "Write answer with shell." },
        adapterOptions: {
          command: process.execPath,
          args: [
            "-e",
            "require('node:fs').writeFileSync('result/answer.md', 'Shell answer'); process.exit(0);"
          ]
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().answer).toBe("Shell answer");
    await app.close();
  });

  test("serves local skill manifests", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const skillsDir = path.join(baseDir, "skills");
    await mkdir(skillsDir, { recursive: true });
    await writeFile(
      path.join(skillsDir, "technical-writing.json"),
      JSON.stringify({
        name: "technical-writing",
        version: "1.0.0",
        description: "Write clear technical documents.",
        inputs: {},
        permissions: ["read_context", "write_artifacts"]
      }),
      "utf8"
    );
    const app = await buildApp({ baseDir, skillsDir });

    const listResponse = await app.inject({ method: "GET", url: "/api/skills" });
    const detailResponse = await app.inject({ method: "GET", url: "/api/skills/technical-writing" });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().skills[0].name).toBe("technical-writing");
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json().description).toContain("technical");
    await app.close();
  });
});
