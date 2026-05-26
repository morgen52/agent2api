import { spawn } from "node:child_process";

import type { AgentAdapter, AgentAdapterCapabilities, AgentAdapterRunInput } from "../types.js";
import type { ProcessResult } from "../../runner/codexRunner.js";

type LocalShellOptions = {
  command?: unknown;
  args?: unknown;
};

export class LocalShellAdapter implements AgentAdapter {
  capabilities(): AgentAdapterCapabilities {
    return {
      id: "local-shell",
      runtime: "local-shell",
      supports: ["task", "context.files", "context.urls", "skills", "deliverables", "sync", "async", "sse", "cancel"]
    };
  }

  run({ request, workspace, events, signal }: AgentAdapterRunInput): Promise<ProcessResult> {
    const options = request.adapterOptions as LocalShellOptions;
    if (typeof options.command !== "string" || options.command.length === 0) {
      throw new Error("local-shell adapter requires adapterOptions.command");
    }

    const args = Array.isArray(options.args) ? options.args.map(String) : [];
    return new Promise((resolve, reject) => {
      const child = spawn(options.command as string, args, {
        cwd: workspace.rootDir,
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        env: {
          ...process.env,
          AGENT2API_WORKSPACE_DIR: workspace.rootDir,
          AGENT2API_COMMAND_PATH: workspace.commandPath,
          AGENT2API_RESULT_DIR: workspace.resultDir,
          AGENT2API_ARTIFACTS_DIR: workspace.artifactsDir
        }
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
        events?.stdout?.(chunk.toString("utf8"));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
        events?.stderr?.(chunk.toString("utf8"));
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
      });
    });
  }
}
