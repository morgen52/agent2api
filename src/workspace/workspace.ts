import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type { AgentRunRequest, MaterialFile } from "../contract/requestSchema.js";

export type RunWorkspace = {
  runId: string;
  rootDir: string;
  inputDir: string;
  filesDir: string;
  resultDir: string;
  artifactsDir: string;
  commandPath: string;
  answerPath: string;
};

type PrepareWorkspaceInput = {
  baseDir: string;
  request: AgentRunRequest;
  runId?: string;
};

type FileManifestEntry = {
  name: string;
  mimeType: string;
  path: string;
};

export async function prepareRunWorkspace(input: PrepareWorkspaceInput): Promise<RunWorkspace> {
  const runId = input.runId ?? createRunId();
  const rootDir = path.join(input.baseDir, runId);
  const inputDir = path.join(rootDir, "input");
  const filesDir = path.join(inputDir, "files");
  const resultDir = path.join(rootDir, "result");
  const artifactsDir = path.join(resultDir, "artifacts");
  const commandPath = path.join(rootDir, "command.md");
  const answerPath = path.join(resultDir, "answer.md");

  await mkdir(filesDir, { recursive: true });
  await mkdir(artifactsDir, { recursive: true });

  const fileManifest = await writeMaterialFiles(filesDir, input.request.context.files);
  await writeJson(path.join(inputDir, "files.json"), fileManifest);
  await writeJson(path.join(inputDir, "urls.json"), input.request.context.urls);
  await writeJson(path.join(rootDir, "request.json"), input.request);
  await writeFile(commandPath, renderCommand(input.request, fileManifest), "utf8");

  return {
    runId,
    rootDir,
    inputDir,
    filesDir,
    resultDir,
    artifactsDir,
    commandPath,
    answerPath
  };
}

function createRunId(): string {
  return `run_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

async function writeMaterialFiles(filesDir: string, files: MaterialFile[]): Promise<FileManifestEntry[]> {
  const seen = new Set<string>();
  const manifest: FileManifestEntry[] = [];

  for (const file of files) {
    if (seen.has(file.name)) {
      throw new Error(`duplicate input file name: ${file.name}`);
    }

    seen.add(file.name);
    const destination = path.join(filesDir, file.name);
    const content = file.text !== undefined ? Buffer.from(file.text, "utf8") : Buffer.from(file.contentBase64 ?? "", "base64");
    await writeFile(destination, content);
    manifest.push({
      name: file.name,
      mimeType: file.mimeType,
      path: `input/files/${file.name}`
    });
  }

  return manifest;
}

function renderCommand(request: AgentRunRequest, fileManifest: FileManifestEntry[]): string {
  const fileLines =
    fileManifest.length === 0
      ? "- No uploaded files."
      : fileManifest.map((file) => `- ${file.path} (${file.mimeType})`).join("\n");
  const urlLines =
    request.context.urls.length === 0
      ? "- No URL references."
      : request.context.urls.map((item) => `- ${item.label ? `${item.label}: ` : ""}${item.url}`).join("\n");
  const noteLines =
    request.context.notes.length === 0
      ? "- No extra notes."
      : request.context.notes.map((note) => `- ${note}`).join("\n");
  const instructionLines =
    request.task.instructions.length === 0 ? "- No additional instructions." : request.task.instructions.map((item) => `- ${item}`).join("\n");
  const acceptanceLines =
    request.task.acceptanceCriteria.length === 0
      ? "- No explicit acceptance criteria."
      : request.task.acceptanceCriteria.map((item) => `- ${item}`).join("\n");
  const constraintLines =
    request.task.constraints.length === 0 ? "- No explicit constraints." : request.task.constraints.map((item) => `- ${item}`).join("\n");
  const skillLines =
    request.skills.length === 0
      ? "- No requested skills."
      : request.skills
          .map((skill) => {
            const inputs = Object.keys(skill.inputs).length > 0 ? ` inputs=${JSON.stringify(skill.inputs)}` : "";
            const permissions = skill.permissions.length > 0 ? ` permissions=${skill.permissions.join(",")}` : "";
            return `- ${skill.name}${skill.version ? `@${skill.version}` : ""}${skill.required ? " (required)" : ""}: ${
              skill.description ?? "No description."
            }${inputs}${permissions}`;
          })
          .join("\n");
  const artifactLines =
    request.deliverables.length === 0
      ? "- No required artifacts. Only write the final response."
      : request.deliverables
          .map(
            (artifact) =>
              `- ${artifact.name} (${artifact.type}, ${artifact.required ? "required" : "optional"}${
                artifact.mimeTypes.length > 0 ? `, ${artifact.mimeTypes.join("|")}` : ""
              }): ${artifact.description}`
          )
          .join("\n");

  return `# Agent Run Command

You are running inside a per-request workspace. Treat files in this directory as the complete task context unless the user explicitly supplied URLs.

## Required Output Contract

- Write the final human-readable answer to \`result/answer.md\`.
- Put generated files under \`result/artifacts/\`.
- If an expected artifact cannot be produced, explain why in \`result/answer.md\`.
- Do not write output files outside this workspace.

## Task

Goal: ${request.task.goal}

Mode: ${request.task.mode}

### Instructions

${instructionLines}

### Acceptance Criteria

${acceptanceLines}

### Constraints

${constraintLines}

## Skills

${skillLines}

## Uploaded Files

${fileLines}

## URL References

${urlLines}

## Notes

${noteLines}

## Expected Artifacts

${artifactLines}
`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
