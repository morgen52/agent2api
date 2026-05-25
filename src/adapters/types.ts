import type { AgentRunRequest } from "../contract/requestSchema.js";
import type { ProcessResult } from "../runner/codexRunner.js";
import type { RunWorkspace } from "../workspace/workspace.js";

export type AgentAdapterCapabilities = {
  id: string;
  runtime: string;
  supports: string[];
};

export type AgentAdapterRunInput = {
  request: AgentRunRequest;
  workspace: RunWorkspace;
};

export interface AgentAdapter {
  capabilities(): AgentAdapterCapabilities;
  run(input: AgentAdapterRunInput): Promise<ProcessResult>;
}
