import { describe, expect, test } from "vitest";

import { Agent2APIClient } from "../src/sdk/client.js";
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
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
