import { readFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { Agent2APIClient, buildApp } from "../src/index.js";

describe("SDK integration", () => {
  test("createMultipartRun works against the real HTTP server", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      runAgent: async ({ workspace }) => {
        const uploaded = await readFile(path.join(workspace.filesDir, "note.md"), "utf8");
        expect(uploaded).toBe("# Note");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    const client = new Agent2APIClient({ baseUrl });

    try {
      const response = await client.createMultipartRun(
        { task: { goal: "Use the SDK multipart helper." } },
        [{ name: "note.md", content: new Blob(["# Note"], { type: "text/markdown" }) }]
      );

      expect(response.status).toBe("completed");
    } finally {
      await app.close();
    }
  });
});
