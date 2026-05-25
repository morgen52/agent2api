import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { parseAgentRunRequest } from "../src/contract/requestSchema.js";
import { prepareRunWorkspace } from "../src/workspace/workspace.js";

describe("run workspace preparation", () => {
  test("creates a run folder with input files, URL manifest, command, and result folders", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-runs-"));
    const request = parseAgentRunRequest({
      task: {
        goal: "Rewrite the brief and return the edited document.",
        instructions: ["Preserve headings."]
      },
      context: {
        files: [
          {
            name: "brief.md",
            mimeType: "text/markdown",
            contentBase64: Buffer.from("Original brief").toString("base64")
          }
        ],
        urls: [{ url: "https://example.com/context", label: "Context" }]
      },
      deliverables: [
        {
          name: "edited-brief",
          type: "document",
          description: "Markdown rewrite.",
          required: true
        }
      ]
    });

    const workspace = await prepareRunWorkspace({ baseDir, request });

    expect(workspace.runId).toMatch(/^run_[0-9a-z]+_[0-9a-f]{8}$/);
    await expect(stat(path.join(workspace.rootDir, "result", "artifacts"))).resolves.toBeTruthy();
    await expect(readFile(path.join(workspace.rootDir, "input", "files", "brief.md"), "utf8")).resolves.toBe(
      "Original brief"
    );

    const urls = JSON.parse(await readFile(path.join(workspace.rootDir, "input", "urls.json"), "utf8"));
    expect(urls).toEqual([{ url: "https://example.com/context", label: "Context" }]);

    const command = await readFile(workspace.commandPath, "utf8");
    expect(command).toContain("Rewrite the brief");
    expect(command).toContain("result/answer.md");
    expect(command).toContain("edited-brief");
    expect(command).toContain("input/files/brief.md");
  });

  test("renders agent task, skills, and deliverables into command markdown", async () => {
    const baseDir = await mkdtemp(path.join(tmpdir(), "agent-runs-"));
    const request = parseAgentRunRequest({
      task: {
        goal: "Create a structured handoff memo.",
        instructions: ["Use the provided project context only."],
        acceptanceCriteria: ["Memo is saved under result/artifacts/."]
      },
      skills: [
        {
          name: "handoff-writing",
          description: "Turn project notes into a handoff document.",
          required: true,
          inputs: { audience: "engineering" }
        }
      ],
      deliverables: [
        {
          name: "handoff",
          type: "document",
          description: "Markdown handoff memo.",
          required: true,
          mimeTypes: ["text/markdown"]
        }
      ]
    });

    const workspace = await prepareRunWorkspace({ baseDir, request });

    const command = await readFile(workspace.commandPath, "utf8");
    expect(command).toContain("## Task");
    expect(command).toContain("Create a structured handoff memo.");
    expect(command).toContain("## Skills");
    expect(command).toContain("handoff-writing");
    expect(command).toContain("Use the provided project context only.");
    expect(command).toContain("## Expected Artifacts");
    expect(command).toContain("text/markdown");
  });
});
