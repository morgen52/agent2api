import { describe, expect, test } from "vitest";

import { Agent2APIClient, Agent2APIError } from "../src/sdk/client.js";
import type { AgentRunRequestInput } from "../src/contract/requestSchema.js";

describe("Agent2APIClient", () => {
  test("creates a run with the Agent Task request body", async () => {
    const minimalRequest = { task: { goal: "Create a short memo." } } satisfies AgentRunRequestInput;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ runId: "run_1", status: "completed", answer: "Done", artifacts: [] });
      }
    });

    const response = await client.createRun(minimalRequest);

    expect(response.runId).toBe("run_1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://127.0.0.1:3030/api/runs");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ task: { goal: "Create a short memo." } });
  });

  test("polls a run by id", async () => {
    const calls: string[] = [];
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030/",
      fetch: async (url) => {
        calls.push(String(url));
        return jsonResponse({ runId: "run_1", status: "running", answer: "", artifacts: [] });
      }
    });

    const response = await client.getRun("run_1");

    expect(response.status).toBe("running");
    expect(calls).toEqual(["http://127.0.0.1:3030/api/runs/run_1"]);
  });

  test("cancels a run by id", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ runId: "run_1", status: "canceled", answer: "", artifacts: [] });
      }
    });

    const response = await client.cancelRun("run_1");

    expect(response.status).toBe("canceled");
    expect(calls[0]?.url).toBe("http://127.0.0.1:3030/api/runs/run_1/cancel");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  test("creates multipart runs with uploaded files", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ runId: "run_1", status: "completed", answer: "Done", artifacts: [] });
      }
    });

    const response = await client.createMultipartRun(
      { task: { goal: "Use upload." } },
      [{ name: "note.md", content: new Blob(["# Note"], { type: "text/markdown" }) }]
    );

    expect(response.runId).toBe("run_1");
    expect(calls[0]?.url).toBe("http://127.0.0.1:3030/api/runs/multipart");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
  });

  test("downloads artifact content from the artifact URL", async () => {
    const calls: string[] = [];
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async (url) => {
        calls.push(String(url));
        return new Response("Draft content", { status: 200, headers: { "content-type": "text/markdown" } });
      }
    });

    const text = await client.downloadArtifactText({
      name: "draft.md",
      path: "artifacts/draft.md",
      sizeBytes: 13,
      mimeType: "text/markdown",
      url: "/api/runs/run_1/artifacts/draft.md"
    });

    expect(text).toBe("Draft content");
    expect(calls).toEqual(["http://127.0.0.1:3030/api/runs/run_1/artifacts/draft.md"]);
  });

  test("lists and reads skill manifests", async () => {
    const calls: string[] = [];
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async (url) => {
        calls.push(String(url));
        if (String(url).endsWith("/api/skills")) {
          return jsonResponse({ skills: [{ name: "technical-writing", version: "1.0.0", description: "Write docs." }] });
        }
        return jsonResponse({ name: "technical-writing", version: "1.0.0", description: "Write docs." });
      }
    });

    const skills = await client.listSkills();
    const skill = await client.getSkill("technical-writing");

    expect(skills.skills[0]?.name).toBe("technical-writing");
    expect(skill.description).toBe("Write docs.");
    expect(calls).toEqual(["http://127.0.0.1:3030/api/skills", "http://127.0.0.1:3030/api/skills/technical-writing"]);
  });

  test("builds artifact download URLs from run id and artifact path", async () => {
    const calls: string[] = [];
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async (url) => {
        calls.push(String(url));
        return new Response("Nested content", { status: 200, headers: { "content-type": "text/markdown" } });
      }
    });

    const text = await client.downloadArtifactText(
      {
        name: "report 1.md",
        path: "artifacts/nested/report 1.md",
        sizeBytes: 14,
        mimeType: "text/markdown"
      },
      { runId: "run_1" }
    );

    expect(text).toBe("Nested content");
    expect(calls).toEqual(["http://127.0.0.1:3030/api/runs/run_1/artifacts/nested/report%201.md"]);
  });

  test("throws typed errors for non-2xx responses", async () => {
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: "not_found", message: "Run not found" } }), {
          status: 404,
          headers: { "content-type": "application/json" }
        })
    });

    await expect(client.getRun("missing")).rejects.toMatchObject({
      name: "Agent2APIError",
      status: 404,
      details: { error: { code: "not_found", message: "Run not found" } }
    } satisfies Partial<Agent2APIError>);
  });

  test("streams run events from the SSE endpoint", async () => {
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(
                encoder.encode(
                  'id: 1\nevent: run.started\ndata: {"runId":"run_1","status":"running"}\n\n' +
                    'id: 2\nevent: run.completed\ndata: {"runId":"run_1","status":"completed"}\n\n'
                )
              );
              controller.close();
            }
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
    });

    const events = [];
    for await (const event of client.streamRunEvents("run_1")) {
      events.push(event);
    }

    expect(events).toEqual([
      { id: "1", type: "run.started", data: { runId: "run_1", status: "running" } },
      { id: "2", type: "run.completed", data: { runId: "run_1", status: "completed" } }
    ]);
  });

  test("parses SSE frames split across response chunks", async () => {
    const client = new Agent2APIClient({
      baseUrl: "http://127.0.0.1:3030",
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              controller.enqueue(encoder.encode('id: 1\nevent: stdout.delta\ndata: {"text":"hel'));
              controller.enqueue(encoder.encode('lo"}\n\nid: 2\nevent: run.completed\ndata: {"status":"completed"}\n\n'));
              controller.close();
            }
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
    });

    const events = [];
    for await (const event of client.streamRunEvents("run_1")) {
      events.push(event);
    }

    expect(events).toEqual([
      { id: "1", type: "stdout.delta", data: { text: "hello" } },
      { id: "2", type: "run.completed", data: { status: "completed" } }
    ]);
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
