# Agent Task Protocol

This API is intentionally one level above LLM APIs.

It does not model messages, tokens, function calling, or provider-specific tool formats. A caller describes the work an agent should do; each backend adapter decides how to translate that task into its own runtime.

## Core Objects

### `task`

The user-visible job definition.

- `goal`: what outcome the agent should produce.
- `mode`: broad work type, such as `execute`, `plan`, `review`, `research`, `transform`, or `question_answer`.
- `instructions`: extra operating guidance.
- `acceptanceCriteria`: how the caller will judge completion.
- `constraints`: scope, privacy, source, style, or safety limits.

### `context`

The external material the caller gives the agent.

- `files`: uploaded files as `text` or `contentBase64`.
- `urls`: references the agent may inspect if its runtime supports web access.
- `notes`: small inline context that is not worth creating a file for.

### `skills`

Requested agent capabilities or workflows. A skill is not an LLM function. It is closer to “use this known workflow or capability while doing the task.”

Examples:

- `document-editing`
- `code-review`
- `market-research`
- `image-generation`
- `spreadsheet-analysis`

Skill fields:

- `name`: portable skill identifier.
- `version`: optional version pin.
- `description`: caller-facing intent.
- `required`: whether failure to use the skill should fail the run.
- `inputs`: structured skill-specific configuration.
- `permissions`: coarse permission labels such as `read_context`, `write_artifacts`, or `use_network`.

### `deliverables`

Expected files or artifacts the agent should place under `result/artifacts/`.

- `name`: stable deliverable name.
- `type`: document, image, data, code, archive, or other artifact family.
- `description`: what the artifact should contain.
- `required`: whether the run should explain failure if missing.
- `mimeTypes`: acceptable output formats.

## Adapter Boundary

The public protocol should stay stable even if the backend changes.

- Codex CLI adapter maps `task/context/skills/deliverables` into `command.md`.
- A future Claude Code adapter can map the same request into its own CLI/session format.
- A future hosted agent adapter can map the same request into its job API.

Provider-specific knobs belong in `adapterOptions`, not in the top-level protocol.

## Public Schema

The canonical JSON Schema is published at:

```text
schemas/agent-task.schema.json
```

The TypeScript/Zod schema in `src/contract/requestSchema.ts` is the runtime validator. When protocol fields change, both the Zod schema and public JSON Schema must be updated in the same pull request.

## Non-Goals

The protocol does not standardize:

- chat message arrays,
- model token accounting,
- sampling parameters,
- LLM function-call schemas,
- hosted tool formats,
- provider-specific tracing envelopes.

Those belong in adapter implementations or `adapterOptions`.
