import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { collectRunResult } from "../src/runner/resultCollector.js";

describe("result collector", () => {
  test("collects answer text and generated artifact files", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "agent-result-"));
    await mkdir(path.join(rootDir, "result", "artifacts"), { recursive: true });
    await writeFile(path.join(rootDir, "result", "answer.md"), "Finished.", "utf8");
    await writeFile(path.join(rootDir, "result", "artifacts", "draft.md"), "# Draft", "utf8");

    const result = await collectRunResult({ runId: "run_test", rootDir });

    expect(result.answer).toBe("Finished.");
    expect(result.artifacts).toEqual([
      {
        name: "draft.md",
        path: "artifacts/draft.md",
        sizeBytes: 7,
        mimeType: "text/markdown"
      }
    ]);
  });
});
