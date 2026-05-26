import { Agent2APIClient } from "agent2api/sdk";

const client = new Agent2APIClient({
  baseUrl: process.env.AGENT2API_BASE_URL ?? "http://127.0.0.1:3030"
});

const run = await client.createRun({
  task: {
    goal: "Summarize the provided note and create a short action plan."
  },
  context: {
    files: [
      {
        name: "note.md",
        mimeType: "text/markdown",
        text: "# Note\nShip a tiny SDK example for frontend developers."
      }
    ],
    urls: [],
    notes: []
  },
  deliverables: [
    {
      name: "action-plan",
      type: "document",
      description: "A markdown action plan.",
      required: true,
      mimeTypes: ["text/markdown"]
    }
  ],
  options: {
    mode: "async"
  }
});

for await (const event of client.streamRunEvents(run.runId)) {
  console.log(`[${event.type}]`, event.data);
}

const completed = await client.getRun(run.runId);
const artifact = completed.artifacts[0];
if (artifact) {
  console.log(await client.downloadArtifactText(artifact));
} else {
  console.log(completed.answer);
}

const { skills } = await client.listSkills();
console.log(`available skills: ${skills.map((skill) => skill.name).join(", ") || "none"}`);
