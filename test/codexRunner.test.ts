import path from "node:path";
import { describe, expect, test } from "vitest";

import { AgentRunTimeoutError, buildCodexExecArgs, runCodexAgent } from "../src/runner/codexRunner.js";

describe("codex runner", () => {
  test("builds non-interactive codex exec arguments with safe local defaults", () => {
    const args = buildCodexExecArgs({
      workspaceDir: "/tmp/run",
      commandPath: "/tmp/run/command.md",
      answerPath: "/tmp/run/result/answer.md",
      model: "gpt-5-codex",
      sandbox: "workspace-write",
      webSearch: true
    });

    expect(args).toEqual([
      "exec",
      "--cd",
      "/tmp/run",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "--model",
      "gpt-5-codex",
      "--search",
      "-o",
      "/tmp/run/result/answer.md",
      "-"
    ]);
  });

  test("passes command markdown through stdin and returns process output", async () => {
    const calls: Array<{ command: string; args: string[]; stdin: string }> = [];
    const result = await runCodexAgent({
      workspaceDir: path.resolve("/tmp/run"),
      commandPath: path.resolve("fixtures/command.md"),
      answerPath: path.resolve("/tmp/run/result/answer.md"),
      timeoutMs: 1_000,
      executor: async (command, args, options) => {
        calls.push({ command, args, stdin: options.stdin });
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
      readCommand: async () => "Do the work."
    });

    expect(result.exitCode).toBe(0);
    expect(calls[0]?.command).toBe("codex");
    expect(calls[0]?.args.at(-1)).toBe("-");
    expect(calls[0]?.stdin).toBe("Do the work.");
  });

  test("rejects with a timeout error when codex does not finish in time", async () => {
    await expect(
      runCodexAgent({
        workspaceDir: "/tmp/run",
        commandPath: "/tmp/run/command.md",
        answerPath: "/tmp/run/result/answer.md",
        timeoutMs: 5,
        executor: () => new Promise(() => undefined),
        readCommand: async () => "Slow task"
      })
    ).rejects.toBeInstanceOf(AgentRunTimeoutError);
  });
});
