import type { AgentAdapter, AgentAdapterCapabilities, AgentAdapterRunInput } from "../types.js";
import { type ProcessExecutor, type ProcessResult, runCodexAgent } from "../../runner/codexRunner.js";

export type CodexCliAdapterOptions = {
  executor?: ProcessExecutor;
  readCommand?: (commandPath: string) => Promise<string>;
};

export class CodexCliAdapter implements AgentAdapter {
  private readonly executor?: ProcessExecutor;
  private readonly readCommand?: (commandPath: string) => Promise<string>;

  constructor(options: CodexCliAdapterOptions = {}) {
    this.executor = options.executor;
    this.readCommand = options.readCommand;
  }

  capabilities(): AgentAdapterCapabilities {
    return {
      id: "codex-cli",
      runtime: "codex",
      supports: ["task", "context.files", "context.urls", "skills", "deliverables", "sync", "async"]
    };
  }

  run({ request, workspace, events }: AgentAdapterRunInput): Promise<ProcessResult> {
    return runCodexAgent({
      workspaceDir: workspace.rootDir,
      commandPath: workspace.commandPath,
      answerPath: workspace.answerPath,
      timeoutMs: request.options.timeoutMs,
      model: request.options.model,
      profile: request.options.profile,
      sandbox: request.options.sandbox,
      webSearch: request.options.webSearch,
      executor: this.executor,
      events,
      readCommand: this.readCommand
    });
  }
}
