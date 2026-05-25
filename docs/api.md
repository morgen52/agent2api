# Agent2API API

## `POST /api/runs`

Starts an agent task. `options.mode` controls whether the HTTP request waits for completion.

- `sync`: waits for the command-line agent to finish and returns answer/artifacts.
- `async`: returns `202` immediately, then poll `GET /api/runs/:id`.
- Event stream: clients can subscribe to `GET /api/runs/:id/events`.

### Request

| Field | Required | Notes |
| --- | --- | --- |
| `apiVersion` | No | Must be `agent-service/v1`; defaults to `agent-service/v1`. |
| `kind` | No | Must be `agent.task`; defaults to `agent.task`. |
| `agent` | No | Currently only `codex`; defaults to `codex`. |
| `task.goal` | Yes | The agent-level objective. |
| `task.mode` | No | `execute`, `plan`, `review`, `research`, `transform`, or `question_answer`; defaults to `execute`. |
| `task.instructions[]` | No | Extra operating instructions for the task. |
| `task.acceptanceCriteria[]` | No | Verifiable completion criteria. |
| `task.constraints[]` | No | Limits such as source boundaries, tone, privacy, or scope. |
| `context.files[]` | No | JSON file uploads. Use `contentBase64` for binary-safe input or `text` for plain text. |
| `context.urls[]` | No | URL references. The service records them in `input/urls.json`; it does not fetch them in v1. |
| `context.notes[]` | No | Extra caller notes. |
| `skills[]` | No | Requested agent skills/workflows, not LLM tools. |
| `deliverables[]` | No | Expected generated files so the agent knows what to place in `result/artifacts/`. |
| `options.timeoutMs` | No | Agent process timeout; defaults to `300000`. |
| `options.sandbox` | No | Passed to `codex exec`; defaults to `workspace-write`. |
| `options.webSearch` | No | Adds `--search` to Codex CLI when true. |
| `options.model` | No | Adds `--model <model>` to Codex CLI. |
| `options.profile` | No | Adds `--profile <profile>` to Codex CLI. |

Legacy aliases such as `instruction`, `materials`, and `output` are intentionally rejected while the API is still being designed.

The public JSON Schema is available at `schemas/agent-task.schema.json`.

### Response

```json
{
  "runId": "run_m4x9h8md_29dbb7fe",
  "status": "completed",
  "createdAt": "2026-05-25T14:00:00.000Z",
  "updatedAt": "2026-05-25T14:00:10.000Z",
  "pollUrl": "/api/runs/run_m4x9h8md_29dbb7fe",
  "eventsUrl": "/api/runs/run_m4x9h8md_29dbb7fe/events",
  "workspacePath": "/absolute/path/to/data/runs/run_m4x9h8md_29dbb7fe",
  "answer": "Agent answer text",
  "artifacts": [
    {
      "name": "draft.md",
      "path": "artifacts/draft.md",
      "sizeBytes": 1234,
      "mimeType": "text/markdown",
      "url": "/api/runs/run_m4x9h8md_29dbb7fe/artifacts/draft.md"
    }
  ],
  "process": {
    "exitCode": 0,
    "stdout": "",
    "stderr": ""
  }
}
```

## `GET /api/runs/:id`

Returns the in-memory status/result record for a run created since the current server process started.

This endpoint is the polling endpoint for async runs.

```bash
curl http://127.0.0.1:3030/api/runs/run_m4x9h8md_29dbb7fe
```

## `GET /api/runs/:id/events`

Streams run lifecycle and output events as Server-Sent Events.

```bash
curl -N http://127.0.0.1:3030/api/runs/run_m4x9h8md_29dbb7fe/events
```

Current event names:

| Event | Notes |
| --- | --- |
| `run.started` | Emitted when the run record is created. |
| `stdout.delta` | Runtime stdout chunk. |
| `stderr.delta` | Runtime stderr chunk. |
| `artifact.created` | Artifact metadata after result collection. |
| `run.completed` | Terminal success event. |
| `run.failed` | Terminal failure event. |

SSE support is intentionally minimal in v1: it streams current process events and replays events stored in memory for the current server process. Durable event replay after server restart is not implemented.

## `GET /api/runs/:id/artifacts/*`

Downloads an artifact collected from `result/artifacts/`.

```bash
curl -L -o draft.md \
  http://127.0.0.1:3030/api/runs/run_m4x9h8md_29dbb7fe/artifacts/draft.md
```

From a browser or Node client:

```ts
const response = await fetch("http://127.0.0.1:3030/api/runs/run_m4x9h8md_29dbb7fe/artifacts/draft.md");
const blob = await response.blob();
```

## JS/TS SDK

The package exposes a UI-facing SDK at `agent2api/sdk`.

```ts
import { Agent2APIClient } from "agent2api/sdk";

const client = new Agent2APIClient({ baseUrl: "http://127.0.0.1:3030" });

const run = await client.createRun({
  task: { goal: "Create a concise project summary." },
  options: { mode: "async" }
});

for await (const event of client.streamRunEvents(run.runId)) {
  console.log(event.type, event.data);
}

const completed = await client.getRun(run.runId);
const artifact = completed.artifacts[0];
if (artifact) {
  const text = await client.downloadArtifactText(artifact);
  console.log(text);
}
```

## CORS

CORS is disabled by default. For a separate local frontend, start the server with:

```bash
CORS_ORIGIN=http://127.0.0.1:5173 npm run dev
```

Do not use `CORS_ORIGIN=*` together with a network-exposed host unless authentication and CSRF protections are in place.

## Workspace Contract

Every run gets:

```text
data/runs/<runId>/
  command.md
  request.json
  input/
    files/
    files.json
    urls.json
  result/
    answer.md
    response.json
    artifacts/
```

The service writes `command.md`; the agent is instructed to write `result/answer.md` and generated files under `result/artifacts/`.

## Security Notes

- Keep this service bound to `127.0.0.1` unless you add authentication.
- Treat uploaded files as untrusted input.
- Do not enable `danger-full-access` for remote callers.
- Add quotas before allowing large files or concurrent runs.
- Add SSRF allowlists before implementing server-side URL fetching.
