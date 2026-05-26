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
| `agent` | No | `codex` or `local-shell`; defaults to `codex`. |
| `task.goal` | Yes | The agent-level objective. |
| `task.mode` | No | `execute`, `plan`, `review`, `research`, `transform`, or `question_answer`; defaults to `execute`. |
| `task.instructions[]` | No | Extra operating instructions for the task. |
| `task.acceptanceCriteria[]` | No | Verifiable completion criteria. |
| `task.constraints[]` | No | Limits such as source boundaries, tone, privacy, or scope. |
| `context.files[]` | No | JSON file uploads. Use `contentBase64` for binary-safe input or `text` for plain text. |
| `context.urls[]` | No | URL references. The service records them in `input/urls.json` and fetches allowed remote content into workspace files. Private hosts require an allowlist. |
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

Returns the status/result record for a run. Records are stored under the run workspace and loaded again when the server restarts.

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
| `run.created` | Emitted when the run record is persisted. |
| `run.queued` | Emitted when async concurrency limits defer the run. |
| `run.started` | Emitted when the run record is created. |
| `stdout.delta` | Runtime stdout chunk. |
| `stderr.delta` | Runtime stderr chunk. |
| `artifact.created` | Artifact metadata after result collection. |
| `run.completed` | Terminal success event. |
| `run.failed` | Terminal failure event. |
| `run.canceled` | Terminal cancellation event. |
| `run.timed_out` | Terminal timeout event. |

Events are persisted with the run record and replayed for later subscribers, including after server restart.

## `POST /api/runs/:id/cancel`

Cancels a queued or running task.

```bash
curl -X POST http://127.0.0.1:3030/api/runs/run_m4x9h8md_29dbb7fe/cancel
```

The response is the normal run response with `status: "canceled"` when cancellation succeeds.

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

## `POST /api/runs/multipart`

Creates a run from a multipart request. The `request` field must contain the JSON Agent Task request. File parts named `file` are appended to `context.files`.

```bash
curl -s http://127.0.0.1:3030/api/runs/multipart \
  -F 'request={"task":{"goal":"Summarize the uploaded brief."}};type=application/json' \
  -F 'file=@brief.md;type=text/markdown'
```

## `GET /api/skills`

Lists local skill manifests loaded from `skillsDir`.

```json
{
  "skills": [
    {
      "name": "technical-writing",
      "version": "1.0.0",
      "description": "Write clear technical documents.",
      "inputs": {},
      "permissions": ["read_context", "write_artifacts"]
    }
  ]
}
```

## `GET /api/skills/:name`

Returns one local skill manifest by name.

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
await client.cancelRun(run.runId);

const artifact = completed.artifacts[0];
if (artifact) {
  const text = await client.downloadArtifactText(artifact);
  console.log(text);
}

await client.createMultipartRun(
  { task: { goal: "Review the uploaded brief." }, options: { mode: "async" } },
  [{ name: "brief.md", content: new Blob(["# Brief"], { type: "text/markdown" }) }]
);

const { skills } = await client.listSkills();
```

## Local Shell Adapter

Use `agent: "local-shell"` for local scripts or custom prototype runtimes. The command is explicit; Agent2API does not infer shell commands from the task prompt.

```json
{
  "agent": "local-shell",
  "task": { "goal": "Run a local script against the prepared workspace." },
  "adapterOptions": {
    "command": "node",
    "args": ["scripts/my-agent.js"]
  }
}
```

The process receives `AGENT2API_WORKSPACE_DIR`, `AGENT2API_COMMAND_PATH`, `AGENT2API_RESULT_DIR`, and `AGENT2API_ARTIFACTS_DIR`.

## CORS

CORS is disabled by default. For a separate local frontend, start the server with:

```bash
CORS_ORIGIN=http://127.0.0.1:5173 npm run dev
```

Do not use `CORS_ORIGIN=*` together with a network-exposed host unless authentication and CSRF protections are in place.

## Authentication

When `apiKey` is configured, every API route except health checks and CORS preflight requires:

```http
Authorization: Bearer <apiKey>
```

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
  record.json
```

The service writes `command.md`; the agent is instructed to write `result/answer.md` and generated files under `result/artifacts/`.

## Security Notes

- Keep this service bound to `127.0.0.1` unless you add authentication.
- Treat uploaded files as untrusted input.
- Do not enable `danger-full-access` for remote callers.
- Configure `apiKey` for non-local use.
- Configure `maxConcurrentRuns` to queue work instead of overloading the machine.
- Configure `retentionMs` to remove expired run directories.
- Configure `auditLogPath` for JSONL audit logs.
- Private and loopback URL hosts must be explicitly allowlisted before server-side URL fetching can reach them.
