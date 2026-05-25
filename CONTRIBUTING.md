# Contributing

Thanks for helping improve Agent2API. The project is intentionally small: keep the public protocol stable, keep adapters isolated, and add tests before behavior changes.

## Development Setup

```bash
npm ci
npm test
npm run build
npm run smoke
```

## Contribution Rules

- Keep public API changes at the Agent Task Protocol level. Do not add LLM-provider message or token concepts to the top-level request.
- Add or update tests before changing runtime behavior.
- Keep adapter-specific fields inside `adapterOptions` or adapter implementation files.
- Update `schemas/agent-task.schema.json` when request fields change.
- Update `README.md`, `docs/api.md`, and `docs/protocol.md` when behavior visible to users changes.
- Run `npm test`, `npm run build`, `npm run smoke`, and `npm audit --omit=dev` before opening a pull request.

## Pull Request Checklist

- Tests cover the changed behavior.
- Documentation describes any new user-facing behavior.
- Security implications are called out for file, network, shell, sandbox, and artifact changes.
- No generated run data, local secrets, or `data/` directory contents are committed.
