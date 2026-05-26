import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentRunRequest } from "../contract/requestSchema.js";
import type { ProcessResult } from "../runner/codexRunner.js";
import type { AgentRunResult } from "../runner/resultCollector.js";
import type { RunWorkspace } from "../workspace/workspace.js";

export type RunStatus = "queued" | "running" | "completed" | "failed" | "canceled" | "timed_out";

export type RunEventType =
  | "run.created"
  | "run.queued"
  | "run.started"
  | "stdout.delta"
  | "stderr.delta"
  | "artifact.created"
  | "run.completed"
  | "run.failed"
  | "run.canceled"
  | "run.timed_out";

export type RunEvent = {
  id: number;
  type: RunEventType;
  createdAt: string;
  data: unknown;
};

export type StoredRunRecord = {
  runId: string;
  status: RunStatus;
  request: AgentRunRequest;
  workspace: RunWorkspace;
  createdAt: string;
  updatedAt: string;
  process?: ProcessResult;
  result?: AgentRunResult;
  error?: string;
  events: RunEvent[];
  nextEventId: number;
};

export async function loadRunRecords(baseDir: string): Promise<StoredRunRecord[]> {
  await mkdir(baseDir, { recursive: true });
  const entries = await readdir(baseDir, { withFileTypes: true });
  const records: StoredRunRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("run_")) {
      continue;
    }

    const recordPath = path.join(baseDir, entry.name, "record.json");
    try {
      records.push(JSON.parse(await readFile(recordPath, "utf8")) as StoredRunRecord);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  return records;
}

export async function saveRunRecord(record: StoredRunRecord): Promise<void> {
  await mkdir(record.workspace.rootDir, { recursive: true });
  const stored: StoredRunRecord = {
    runId: record.runId,
    status: record.status,
    request: record.request,
    workspace: record.workspace,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.process === undefined ? {} : { process: record.process }),
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.error === undefined ? {} : { error: record.error }),
    events: record.events,
    nextEventId: record.nextEventId
  };
  await writeFile(path.join(record.workspace.rootDir, "record.json"), `${JSON.stringify(stored, null, 2)}\n`, "utf8");
}

export async function cleanupExpiredRuns(input: { baseDir: string; retentionMs?: number; now: Date }): Promise<void> {
  if (!input.retentionMs) {
    await mkdir(input.baseDir, { recursive: true });
    return;
  }

  await mkdir(input.baseDir, { recursive: true });
  const entries = await readdir(input.baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("run_")) {
      continue;
    }
    const rootDir = path.join(input.baseDir, entry.name);
    let record: Partial<StoredRunRecord>;
    try {
      record = JSON.parse(await readFile(path.join(rootDir, "record.json"), "utf8")) as Partial<StoredRunRecord>;
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
    const updatedAt = Date.parse(record.updatedAt ?? record.createdAt ?? "");
    if (Number.isFinite(updatedAt) && input.now.getTime() - updatedAt > input.retentionMs) {
      await rm(rootDir, { recursive: true, force: true });
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
