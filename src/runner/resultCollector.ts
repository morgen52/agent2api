import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type ArtifactInfo = {
  name: string;
  path: string;
  sizeBytes: number;
  mimeType: string;
  url?: string;
};

export type AgentRunResult = {
  runId: string;
  answer: string;
  artifacts: ArtifactInfo[];
  metadata?: unknown;
};

export async function collectRunResult(input: { runId: string; rootDir: string }): Promise<AgentRunResult> {
  const resultDir = path.join(input.rootDir, "result");
  const answer = await readOptionalText(path.join(resultDir, "answer.md"));
  const metadata = await readOptionalJson(path.join(resultDir, "response.json"));
  const artifacts = await collectArtifacts(path.join(resultDir, "artifacts"));

  return {
    runId: input.runId,
    answer,
    artifacts,
    ...(metadata === undefined ? {} : { metadata })
  };
}

async function collectArtifacts(artifactsDir: string): Promise<ArtifactInfo[]> {
  try {
    const files = await walkFiles(artifactsDir);
    const artifacts: ArtifactInfo[] = [];

    for (const filePath of files) {
      const fileStat = await stat(filePath);
      const relativePath = path.relative(artifactsDir, filePath).split(path.sep).join("/");
      artifacts.push({
        name: path.basename(filePath),
        path: `artifacts/${relativePath}`,
        sizeBytes: fileStat.size,
        mimeType: inferMimeType(filePath)
      });
    }

    return artifacts.sort((a, b) => a.path.localeCompare(b.path));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  }
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return "";
    }
    throw error;
  }
}

async function readOptionalJson(filePath: string): Promise<unknown | undefined> {
  const text = await readOptionalText(filePath);
  return text.trim() ? JSON.parse(text) : undefined;
}

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".html": "text/html",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  };
  return types[ext] ?? "application/octet-stream";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
