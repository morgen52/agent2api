import path from "node:path";

import { buildApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3030", 10);
const host = process.env.HOST ?? "127.0.0.1";
const baseDir = path.resolve(process.env.AGENT_RUNS_DIR ?? "data/runs");

const app = await buildApp({ baseDir, corsOrigin: process.env.CORS_ORIGIN });

try {
  await app.listen({ port, host });
  app.log.info(`agent2api listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
