import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";

import { CodexCliAdapter } from "../src/adapters/codex/CodexCliAdapter.js";
import { parseAgentRunRequest } from "../src/contract/requestSchema.js";
import { prepareRunWorkspace } from "../src/workspace/workspace.js";

describe("Codex CLI adapter", () => {
  test("advertises stable adapter capabilities", () => {
    const adapter = new CodexCliAdapter();

    expect(adapter.capabilities()).toMatchObject({
      id: "codex-cli",
      runtime: "codex",
      supports: expect.arrayContaining(["task", "context.files", "context.urls", "skills", "deliverables"])
    });
  });

  test("runs Codex through the injected executor with request options", async () => {
    const adapter = new CodexCliAdapter({
      executor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      readCommand: async () => "command"
    });
    const request = parseAgentRunRequest({
      task: { goal: "Create a note." },
      options: { timeoutMs: 10_000, sandbox: "read-only", webSearch: true, model: "gpt-5-codex" }
    });
    const workspace = await prepareRunWorkspace({
      baseDir: await mkdtemp(path.join(tmpdir(), "adapter-test-")),
      request
    });
    const spy = vi.spyOn(adapter, "run");

    const result = await adapter.run({ request, workspace });

    expect(result.exitCode).toBe(0);
    expect(spy).toHaveBeenCalledWith({ request, workspace });
  });
});
