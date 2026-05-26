import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Agent2APIClient, buildApp } from "../src/index.js";

type RunningServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const workspaceRoot = await mkdtemp(path.join(tmpdir(), "agent2api-real-demo-"));
const runsDir = path.join(workspaceRoot, "runs");
const skillsDir = path.join(workspaceRoot, "skills");
const auditLogPath = path.join(workspaceRoot, "audit.jsonl");
const apiKey = "demo-secret";

await mkdir(skillsDir, { recursive: true });
await writeFile(
  path.join(skillsDir, "technical-writing.json"),
  JSON.stringify(
    {
      name: "technical-writing",
      version: "1.0.0",
      description: "Write clear technical documents from supplied context.",
      inputs: {},
      permissions: ["read_context", "write_artifacts"]
    },
    null,
    2
  ),
  "utf8"
);

const upstream = await startTextServer("Remote demo brief from an HTTP source.");
let server = await startAgent2API();
let client = createClient(server.baseUrl);

try {
  console.log(`Agent2API demo server: ${server.baseUrl}`);
  console.log(`Demo workspace: ${workspaceRoot}`);

  const syncRun = await demoSyncArtifact(client);
  await demoAsyncSse(client);
  await demoMultipart(client);
  await demoUrlContext(client, upstream.baseUrl);
  await demoCancel(client);
  await demoSkillsAndAudit(client);

  await server.close();
  server = await startAgent2API();
  client = createClient(server.baseUrl);
  await demoRestartPersistence(client, syncRun.runId);

  console.log("All real demos passed.");
} finally {
  await server.close();
  await upstream.close();
}

async function demoSyncArtifact(client: Agent2APIClient) {
  const run = await client.createRun({
    agent: "local-shell",
    task: { goal: "Generate a real local-shell artifact." },
    deliverables: [
      {
        name: "summary",
        type: "document",
        description: "Markdown summary.",
        required: true,
        mimeTypes: ["text/markdown"]
      }
    ],
    adapterOptions: nodeAgent(`
      const fs = require("node:fs");
      const path = require("node:path");
      fs.writeFileSync(path.join(process.env.AGENT2API_RESULT_DIR, "answer.md"), "Sync demo answer");
      fs.writeFileSync(path.join(process.env.AGENT2API_ARTIFACTS_DIR, "summary.md"), "# Sync Demo\\nArtifact content");
    `)
  });

  assert.equal(run.status, "completed");
  assert.equal(run.answer, "Sync demo answer");
  assert.equal(run.artifacts[0]?.name, "summary.md");

  const artifact = await client.downloadArtifactText(run.artifacts[0]!);
  assert.match(artifact, /Artifact content/);
  console.log("demo 1: sync run + artifact download passed");
  return run;
}

async function demoAsyncSse(client: Agent2APIClient) {
  const run = await client.createRun({
    agent: "local-shell",
    task: { goal: "Generate async answer and SSE events." },
    options: { mode: "async" },
    adapterOptions: nodeAgent(`
      const fs = require("node:fs");
      const path = require("node:path");
      console.log("async-demo-started");
      fs.writeFileSync(path.join(process.env.AGENT2API_RESULT_DIR, "answer.md"), "Async demo answer");
      fs.writeFileSync(path.join(process.env.AGENT2API_ARTIFACTS_DIR, "async.md"), "Async artifact");
    `)
  });

  const events: string[] = [];
  for await (const event of client.streamRunEvents(run.runId)) {
    events.push(event.type);
  }

  assert.ok(events.includes("run.started"));
  assert.ok(events.includes("stdout.delta"));
  assert.ok(events.includes("artifact.created"));
  assert.ok(events.includes("run.completed"));
  const completed = await client.getRun(run.runId);
  assert.equal(completed.status, "completed");
  console.log("demo 2: async run + SSE replay passed");
}

async function demoMultipart(client: Agent2APIClient) {
  const run = await client.createMultipartRun(
    {
      agent: "local-shell",
      task: { goal: "Read an uploaded markdown file." },
      adapterOptions: nodeAgent(`
        const fs = require("node:fs");
        const path = require("node:path");
        const note = fs.readFileSync(path.join(process.env.AGENT2API_WORKSPACE_DIR, "input", "files", "brief.md"), "utf8");
        fs.writeFileSync(path.join(process.env.AGENT2API_RESULT_DIR, "answer.md"), "Upload length: " + note.length);
      `)
    },
    [{ name: "brief.md", content: new Blob(["# Uploaded Brief"], { type: "text/markdown" }) }]
  );

  assert.equal(run.status, "completed");
  assert.match(run.answer, /Upload length/);
  console.log("demo 3: multipart upload passed");
}

async function demoUrlContext(client: Agent2APIClient, upstreamBaseUrl: string) {
  const run = await client.createRun({
    agent: "local-shell",
    task: { goal: "Read fetched URL context." },
    context: {
      urls: [{ url: `${upstreamBaseUrl}/brief.txt`, label: "remote-brief" }]
    },
    adapterOptions: nodeAgent(`
      const fs = require("node:fs");
      const path = require("node:path");
      const remote = fs.readFileSync(path.join(process.env.AGENT2API_WORKSPACE_DIR, "input", "files", "url-1.txt"), "utf8");
      fs.writeFileSync(path.join(process.env.AGENT2API_RESULT_DIR, "answer.md"), remote);
    `)
  });

  assert.equal(run.status, "completed");
  assert.match(run.answer, /Remote demo brief/);
  console.log("demo 4: guarded URL context fetch passed");
}

async function demoCancel(client: Agent2APIClient) {
  const run = await client.createRun({
    agent: "local-shell",
    task: { goal: "Start a long run and cancel it." },
    options: { mode: "async" },
    adapterOptions: nodeAgent("setTimeout(() => undefined, 10_000);")
  });

  await waitForStatus(client, run.runId, "running");
  const canceled = await client.cancelRun(run.runId);
  assert.equal(canceled.status, "canceled");
  console.log("demo 5: cancel running task passed");
}

async function demoSkillsAndAudit(client: Agent2APIClient) {
  const { skills } = await client.listSkills();
  assert.equal(skills[0]?.name, "technical-writing");
  const skill = await client.getSkill("technical-writing");
  assert.match(skill.description, /technical/i);

  const auditText = await readFile(auditLogPath, "utf8");
  assert.match(auditText, /"type":"run.created"/);
  assert.match(auditText, /"type":"run.completed"/);
  console.log("demo 6: skill registry + audit log passed");
}

async function demoRestartPersistence(client: Agent2APIClient, runId: string) {
  const reloaded = await client.getRun(runId);
  assert.equal(reloaded.status, "completed");
  const artifactText = await client.downloadArtifactText(reloaded.artifacts[0]!);
  assert.match(artifactText, /Artifact content/);

  const events: string[] = [];
  for await (const event of client.streamRunEvents(runId)) {
    events.push(event.type);
  }
  assert.ok(events.includes("run.completed"));
  console.log("demo 7: restart persistence + event replay passed");
}

async function waitForStatus(client: Agent2APIClient, runId: string, status: string): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const run = await client.getRun(runId);
    if (run.status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Run ${runId} did not reach ${status}`);
}

function createClient(baseUrl: string): Agent2APIClient {
  return new Agent2APIClient({
    baseUrl,
    headers: {
      authorization: `Bearer ${apiKey}`
    }
  });
}

async function startAgent2API(): Promise<RunningServer> {
  const app = await buildApp({
    baseDir: runsDir,
    skillsDir,
    auditLogPath,
    apiKey,
    allowedUrlHosts: ["127.0.0.1"],
    maxConcurrentRuns: 1
  });
  const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  return {
    baseUrl,
    close: () => app.close()
  };
}

async function startTextServer(text: string): Promise<RunningServer> {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "text/plain");
    response.end(text);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected HTTP server to listen on a TCP address.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server)
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function nodeAgent(script: string) {
  return {
    command: process.execPath,
    args: ["-e", script]
  };
}
