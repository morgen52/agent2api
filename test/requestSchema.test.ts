import { describe, expect, test } from "vitest";

import { parseAgentRunRequest } from "../src/contract/requestSchema.js";

describe("agent run request schema", () => {
  test("accepts an agent-level task contract with skills and deliverables", () => {
    const parsed = parseAgentRunRequest({
      apiVersion: "agent-service/v1",
      kind: "agent.task",
      agent: "codex",
      task: {
        goal: "Rewrite the uploaded brief into a launch memo.",
        mode: "execute",
        instructions: ["Keep the tone direct.", "Do not invent customer facts."],
        acceptanceCriteria: ["Final answer explains what changed.", "A markdown memo is saved as an artifact."],
        constraints: ["Only use supplied context unless web access is explicitly enabled."]
      },
      context: {
        files: [
          {
            name: "brief.md",
            mimeType: "text/markdown",
            contentBase64: Buffer.from("Original").toString("base64")
          }
        ],
        urls: [{ url: "https://example.com/brand-guide", label: "Brand guide" }],
        notes: ["Caller prefers concise prose."]
      },
      skills: [
        {
          name: "document-editing",
          description: "Use document editing workflow and preserve traceability.",
          required: true,
          inputs: { style: "concise" },
          permissions: ["read_context", "write_artifacts"]
        }
      ],
      deliverables: [
        {
          name: "launch-memo",
          type: "document",
          description: "Rewritten markdown launch memo.",
          required: true,
          mimeTypes: ["text/markdown"]
        }
      ],
      metadata: {
        userId: "user_123",
        traceId: "trace_abc"
      }
    });

    expect(parsed.kind).toBe("agent.task");
    expect(parsed.task.goal).toBe("Rewrite the uploaded brief into a launch memo.");
    expect(parsed.task.instructions).toContain("Do not invent customer facts.");
    expect(parsed.context.files[0]?.name).toBe("brief.md");
    expect(parsed.context.urls[0]?.url).toBe("https://example.com/brand-guide");
    expect(parsed.skills[0]?.name).toBe("document-editing");
    expect(parsed.deliverables[0]?.mimeTypes).toEqual(["text/markdown"]);
  });

  test("applies safe defaults for optional agent-level fields", () => {
    const parsed = parseAgentRunRequest({
      task: {
        goal: "Summarize the attached context."
      }
    });

    expect(parsed.agent).toBe("codex");
    expect(parsed.apiVersion).toBe("agent-service/v1");
    expect(parsed.kind).toBe("agent.task");
    expect(parsed.context.files).toEqual([]);
    expect(parsed.skills).toEqual([]);
    expect(parsed.deliverables).toEqual([]);
    expect(parsed.options.mode).toBe("sync");
    expect(parsed.options.timeoutMs).toBe(300_000);
    expect(parsed.options.sandbox).toBe("workspace-write");
  });

  test("rejects legacy request aliases and unsafe uploaded filenames", () => {
    expect(() => parseAgentRunRequest({ instruction: "Use the file." })).toThrow();
    expect(() =>
      parseAgentRunRequest({
        task: { goal: "Use the file." },
        materials: { files: [] }
      })
    ).toThrow();
    expect(() =>
      parseAgentRunRequest({
        task: { goal: "Use the file." },
        output: { artifacts: [] }
      })
    ).toThrow();
    expect(() =>
      parseAgentRunRequest({
        task: { goal: "Use the file." },
        context: {
          files: [
            {
              name: "../secret.txt",
              mimeType: "text/plain",
              contentBase64: Buffer.from("nope").toString("base64")
            }
          ]
        }
      })
    ).toThrow();
    expect(() =>
      parseAgentRunRequest({
        task: { goal: "Use the file." },
        context: {
          files: [
            {
              name: "broken.txt",
              mimeType: "text/plain",
              contentBase64: "not base64!"
            }
          ]
        }
      })
    ).toThrow();
  });
});
