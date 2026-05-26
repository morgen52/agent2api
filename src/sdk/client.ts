import type { AgentRunRequestInput } from "../contract/requestSchema.js";
import type { ArtifactInfo } from "../runner/resultCollector.js";

export type AgentRunStatus = "queued" | "running" | "completed" | "failed" | "canceled" | "timed_out";

export type AgentRunArtifact = ArtifactInfo & {
  url?: string;
};

export type AgentRunResponse = {
  runId: string;
  status: AgentRunStatus;
  createdAt?: string;
  updatedAt?: string;
  pollUrl?: string;
  eventsUrl?: string;
  workspacePath?: string;
  answer: string;
  artifacts: AgentRunArtifact[];
  process?: {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut?: boolean;
  };
  error?: string;
};

export type AgentRunEvent = {
  id?: string;
  type: string;
  data: unknown;
};

export type Agent2APIUpload = {
  name: string;
  content: Blob;
};

export type SkillManifest = {
  name: string;
  version: string;
  description: string;
  inputs?: Record<string, unknown>;
  permissions?: string[];
};

export type Agent2APIClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export type Agent2APIRequestOptions = {
  signal?: AbortSignal;
};

export class Agent2APIError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, input: { status: number; details?: unknown }) {
    super(message);
    this.name = "Agent2APIError";
    this.status = input.status;
    this.details = input.details;
  }
}

export class Agent2APIClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: Agent2APIClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.headers = options.headers ?? {};

    if (!this.fetchFn) {
      throw new Error("Agent2APIClient requires a fetch implementation.");
    }
  }

  async createRun(request: AgentRunRequestInput, options: Agent2APIRequestOptions = {}): Promise<AgentRunResponse> {
    return this.requestJson<AgentRunResponse>("/api/runs", {
      method: "POST",
      headers: {
        ...this.headers,
        "content-type": "application/json"
      },
      body: JSON.stringify(request),
      signal: options.signal
    });
  }

  async getRun(runId: string, options: Agent2APIRequestOptions = {}): Promise<AgentRunResponse> {
    return this.requestJson<AgentRunResponse>(`/api/runs/${encodeURIComponent(runId)}`, {
      method: "GET",
      headers: this.headers,
      signal: options.signal
    });
  }

  async cancelRun(runId: string, options: Agent2APIRequestOptions = {}): Promise<AgentRunResponse> {
    return this.requestJson<AgentRunResponse>(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: "POST",
      headers: this.headers,
      signal: options.signal
    });
  }

  async createMultipartRun(
    request: AgentRunRequestInput,
    files: Agent2APIUpload[],
    options: Agent2APIRequestOptions = {}
  ): Promise<AgentRunResponse> {
    const form = new FormData();
    form.set("request", new Blob([JSON.stringify(request)], { type: "application/json" }));
    for (const file of files) {
      form.append("file", file.content, file.name);
    }

    return this.requestJson<AgentRunResponse>("/api/runs/multipart", {
      method: "POST",
      headers: this.headers,
      body: form,
      signal: options.signal
    });
  }

  async listSkills(options: Agent2APIRequestOptions = {}): Promise<{ skills: SkillManifest[] }> {
    return this.requestJson<{ skills: SkillManifest[] }>("/api/skills", {
      method: "GET",
      headers: this.headers,
      signal: options.signal
    });
  }

  async getSkill(name: string, options: Agent2APIRequestOptions = {}): Promise<SkillManifest> {
    return this.requestJson<SkillManifest>(`/api/skills/${encodeURIComponent(name)}`, {
      method: "GET",
      headers: this.headers,
      signal: options.signal
    });
  }

  async downloadArtifact(
    artifact: AgentRunArtifact | string,
    options: Agent2APIRequestOptions & { runId?: string } = {}
  ): Promise<Response> {
    const response = await this.fetchFn(this.resolveArtifactUrl(artifact, options.runId), {
      method: "GET",
      headers: this.headers,
      signal: options.signal
    });
    await assertOk(response);
    return response;
  }

  async downloadArtifactText(
    artifact: AgentRunArtifact | string,
    options: Agent2APIRequestOptions & { runId?: string } = {}
  ): Promise<string> {
    const response = await this.downloadArtifact(artifact, options);
    return response.text();
  }

  async *streamRunEvents(runId: string, options: Agent2APIRequestOptions = {}): AsyncGenerator<AgentRunEvent> {
    const response = await this.fetchFn(new URL(`/api/runs/${encodeURIComponent(runId)}/events`, `${this.baseUrl}/`).toString(), {
      method: "GET",
      headers: {
        ...this.headers,
        accept: "text/event-stream"
      },
      signal: options.signal
    });
    await assertOk(response);

    if (!response.body) {
      throw new Error("Agent2API event stream response has no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const event = parseSseFrame(frame);
        if (event) {
          yield event;
        }
        frameEnd = buffer.indexOf("\n\n");
      }

      if (done) {
        const event = parseSseFrame(buffer);
        if (event) {
          yield event;
        }
        return;
      }
    }
  }

  resolveArtifactUrl(artifact: AgentRunArtifact | string, runId?: string): string {
    const pathOrUrl = typeof artifact === "string" ? artifact : artifact.url ?? artifactDownloadPath(artifact, runId);
    return new URL(pathOrUrl, `${this.baseUrl}/`).toString();
  }

  private async requestJson<T>(pathOrUrl: string, init: RequestInit): Promise<T> {
    const response = await this.fetchFn(new URL(pathOrUrl, `${this.baseUrl}/`).toString(), init);
    await assertOk(response);
    return (await response.json()) as T;
  }
}

function artifactDownloadPath(artifact: AgentRunArtifact, runId?: string): string {
  if (!runId) {
    throw new Error("Artifact is missing url. Pass runId to build a download URL from artifact.path.");
  }

  const relativePath = artifact.path.replace(/^artifacts\//, "");
  const encodedPath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `/api/runs/${encodeURIComponent(runId)}/artifacts/${encodedPath}`;
}

function parseSseFrame(frame: string): AgentRunEvent | undefined {
  const trimmed = frame.trim();
  if (!trimmed) {
    return undefined;
  }

  let id: string | undefined;
  let type = "message";
  const dataLines: string[] = [];

  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice(3).trimStart();
    } else if (line.startsWith("event:")) {
      type = line.slice(6).trimStart();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const dataText = dataLines.join("\n");
  return {
    ...(id === undefined ? {} : { id }),
    type,
    data: dataText ? JSON.parse(dataText) : null
  };
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  const details = await readErrorDetails(response);
  const message =
    typeof details === "object" && details !== null && "error" in details
      ? JSON.stringify(details)
      : `Agent2API request failed with status ${response.status}`;
  throw new Agent2APIError(message, { status: response.status, details });
}

async function readErrorDetails(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}
