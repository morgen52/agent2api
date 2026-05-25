import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type CodexExecArgsInput = {
  workspaceDir: string;
  commandPath: string;
  answerPath: string;
  model?: string;
  profile?: string;
  sandbox?: SandboxMode;
  webSearch?: boolean;
};

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ProcessEvents = {
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
};

export type ProcessExecutor = (
  command: string,
  args: string[],
  options: { cwd: string; stdin: string; signal: AbortSignal; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void }
) => Promise<ProcessResult>;

export class AgentRunTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Agent run timed out after ${timeoutMs}ms`);
    this.name = "AgentRunTimeoutError";
  }
}

export function buildCodexExecArgs(input: CodexExecArgsInput): string[] {
  const args = [
    "exec",
    "--cd",
    input.workspaceDir,
    "--skip-git-repo-check",
    "--sandbox",
    input.sandbox ?? "workspace-write",
    "--ask-for-approval",
    "never"
  ];

  if (input.model) {
    args.push("--model", input.model);
  }

  if (input.profile) {
    args.push("--profile", input.profile);
  }

  if (input.webSearch) {
    args.push("--search");
  }

  args.push("-o", input.answerPath, "-");
  return args;
}

export async function runCodexAgent(input: CodexExecArgsInput & {
  timeoutMs: number;
  executor?: ProcessExecutor;
  events?: ProcessEvents;
  readCommand?: (commandPath: string) => Promise<string>;
}): Promise<ProcessResult> {
  const commandMarkdown = await (input.readCommand ?? readCommandFile)(input.commandPath);
  const args = buildCodexExecArgs(input);
  const executor = input.executor ?? spawnExecutor;
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      executor("codex", args, {
        cwd: input.workspaceDir,
        stdin: commandMarkdown,
        signal: controller.signal,
        onStdout: input.events?.stdout,
        onStderr: input.events?.stderr
      }),
      new Promise<ProcessResult>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new AgentRunTimeoutError(input.timeoutMs));
        }, input.timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readCommandFile(commandPath: string): Promise<string> {
  return readFile(commandPath, "utf8");
}

const spawnExecutor: ProcessExecutor = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      options.onStdout?.(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      options.onStderr?.(chunk.toString("utf8"));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
    child.stdin.end(options.stdin);
  });
