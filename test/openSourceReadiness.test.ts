import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { parseAgentRunRequest } from "../src/contract/requestSchema.js";

const root = path.resolve(".");
const previousProjectName = ["Agent", "Service", "Gateway"].join(" ");
const removedProcessPaths = [
  ["app", "state"].join("_") + ".json",
  path.join("docs", ["super", "powers"].join("")),
  path.join("docs", ["open", "source", "readiness"].join("-") + ".md"),
  "output",
  "sections",
  "ux",
  "visual"
];

async function readText(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}

async function readJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readText(relativePath));
}

describe("open-source readiness", () => {
  test("public project identity is Agent2API", async () => {
    const readme = await readText("README.md");
    const pkg = (await readJson("package.json")) as {
      name?: string;
      repository?: { url?: string };
      bugs?: { url?: string };
      homepage?: string;
    };
    const schema = (await readJson("schemas/agent-task.schema.json")) as { $id?: string };

    expect(readme).toContain("# Agent2API");
    expect(readme).toContain("Agent2API turns agent runtimes into a clean HTTP API");
    expect(readme).not.toContain(previousProjectName);
    expect(pkg.name).toBe("agent2api");
    expect(pkg.repository?.url).toBe("https://github.com/morgen52/agent2api.git");
    expect(pkg.bugs?.url).toBe("https://github.com/morgen52/agent2api/issues");
    expect(pkg.homepage).toBe("https://github.com/morgen52/agent2api#readme");
    expect(schema.$id).toBe("https://agent2api.dev/schemas/agent-task.schema.json");
  });

  test("README explains the project with motivation, design, usage, diagrams, and roadmap", async () => {
    const readme = await readText("README.md");

    for (const heading of [
      "## Summary",
      "## Motivation",
      "## Feature Support Matrix",
      "## Design",
      "## Quick Start",
      "## Usage",
      "## Adapter Model",
      "## Security Model",
      "## Roadmap",
      "## Contributing"
    ]) {
      expect(readme).toContain(heading);
    }

    expect(readme).toContain("```mermaid");
    expect(readme).toContain("Agent Task Protocol");
    expect(readme).toContain("task");
    expect(readme).toContain("context");
    expect(readme).toContain("skills");
    expect(readme).toContain("deliverables");
    expect(readme).toContain("Implemented");
    expect(readme).toContain("Partial");
    expect(readme).toContain("Planned");
    expect(readme).toContain("Not implemented");
    expect(readme).toContain("Artifact download");
    expect(readme).toContain("SSE progress streaming");
    expect(readme).toContain("Persistent run store");
    expect(readme).toContain("Roadmap items are planned work, not current features.");
  });

  test("repository includes standard open-source governance and CI files", async () => {
    const requiredFiles = [
      "LICENSE",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "CODE_OF_CONDUCT.md",
      "CHANGELOG.md",
      ".env.example",
      ".github/workflows/ci.yml",
      ".github/pull_request_template.md",
      ".github/ISSUE_TEMPLATE/bug_report.md",
      ".github/ISSUE_TEMPLATE/feature_request.md",
      "examples/sdk-client.ts"
    ];

    for (const file of requiredFiles) {
      const content = await readText(file);
      expect(content.trim().length, `${file} should not be empty`).toBeGreaterThan(80);
    }

    const ci = await readText(".github/workflows/ci.yml");
    expect(ci).toContain("npm test");
    expect(ci).toContain("npm run build");
    expect(ci).toContain("npm run check:examples");
    expect(ci).toContain("npm run smoke");
    expect(ci).toContain("npm audit --omit=dev");
  });

  test("package metadata is publishable as an open-source package", async () => {
    const pkg = (await readJson("package.json")) as Record<string, unknown>;
    const tsconfig = (await readJson("tsconfig.json")) as { compilerOptions?: Record<string, unknown> };

    expect(pkg.private).toBe(false);
    expect(pkg.license).toBe("MIT");
    expect(pkg.description).toEqual(expect.stringContaining("Agent Task"));
    expect(pkg.repository).toMatchObject({ type: "git" });
    expect(pkg.keywords).toEqual(expect.arrayContaining(["agent", "gateway", "codex"]));
    expect(pkg.main).toBe("./dist/src/index.js");
    expect(pkg.types).toBe("./dist/src/index.d.ts");
    expect(pkg.scripts).toMatchObject({
      start: "node dist/src/server/index.js",
      "check:examples": "tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext examples/sdk-client.ts"
    });
    expect(pkg.exports).toMatchObject({
      ".": {
        types: "./dist/src/index.d.ts",
        import: "./dist/src/index.js"
      },
      "./sdk": {
        types: "./dist/src/sdk/client.d.ts",
        import: "./dist/src/sdk/client.js"
      }
    });
    expect(tsconfig.compilerOptions?.declaration).toBe(true);
  });

  test("repository does not include workspace process artifacts", async () => {
    for (const pathToRemove of removedProcessPaths) {
      await expect(access(path.join(root, pathToRemove))).rejects.toThrow();
    }
  });

  test("public JSON Schema and example request match the Agent Task Protocol", async () => {
    const schema = (await readJson("schemas/agent-task.schema.json")) as {
      $schema?: string;
      title?: string;
      required?: string[];
      properties?: Record<string, unknown>;
      additionalProperties?: boolean;
    };
    const example = await readJson("examples/create-run.json");
    const parsed = parseAgentRunRequest(example);

    expect(schema.$schema).toContain("json-schema.org");
    expect(schema.title).toBe("Agent Task Request");
    expect(schema.required).toEqual(expect.arrayContaining(["task"]));
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["apiVersion", "kind", "agent", "task", "context", "skills", "deliverables", "options"])
    );
    expect(parsed.kind).toBe("agent.task");
    expect(parsed.task.goal).toContain("Summarize");
    expect(parsed.deliverables[0]?.name).toBe("action-plan");
  });
});
