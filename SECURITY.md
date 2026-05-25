# Security Policy

Agent2API executes local command-line agents, so security boundaries matter. Treat every request as untrusted unless you control the caller and the network.

## Supported Versions

Security fixes target the latest minor version on the `main` branch until formal releases begin.

## Reporting A Vulnerability

Do not open a public issue for sensitive vulnerabilities. Send a private report to the project maintainer listed in the repository settings. Include:

- affected version or commit,
- reproduction steps,
- expected and actual impact,
- whether the issue requires network exposure, untrusted files, or a specific adapter.

## Security Design Notes

- Bind to `127.0.0.1` by default.
- CORS is disabled unless `CORS_ORIGIN` is explicitly set.
- `danger-full-access` should not be exposed to untrusted callers.
- Server-side URL fetching is intentionally not implemented in v1.
- Uploaded files are written into an isolated run workspace.
- Artifacts are served only when they were collected from `result/artifacts/`.

Before running this as a shared service, add authentication, quotas, run isolation, audit logs, and stronger process sandboxing.
