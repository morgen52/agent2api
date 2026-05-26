import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";

import { buildApp } from "../src/server/app.js";

describe("input channels", () => {
  test("fetches allowed URL context into workspace files", async () => {
    const upstream = createServer((_request, response) => {
      response.setHeader("content-type", "text/plain");
      response.end("Remote context");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      allowedUrlHosts: ["127.0.0.1"],
      runAgent: async ({ workspace }) => {
        const text = await readFile(path.join(workspace.filesDir, "url-1.txt"), "utf8");
        expect(text).toBe("Remote context");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/runs",
      payload: {
        task: { goal: "Use remote context." },
        context: { urls: [{ url: `http://127.0.0.1:${port}/brief.txt` }] }
      }
    });

    expect(response.statusCode).toBe(200);
    await app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  test("creates runs from multipart request JSON and uploaded files", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-api-"));
    const app = await buildApp({
      baseDir,
      runAgent: async ({ workspace }) => {
        const text = await readFile(path.join(workspace.filesDir, "note.md"), "utf8");
        expect(text).toBe("# Note");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });
    const boundary = "agent2api-test-boundary";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="request"',
      "Content-Type: application/json",
      "",
      JSON.stringify({ task: { goal: "Use upload." } }),
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="note.md"',
      "Content-Type: text/markdown",
      "",
      "# Note",
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/runs/multipart",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("completed");
    await app.close();
  });
});
