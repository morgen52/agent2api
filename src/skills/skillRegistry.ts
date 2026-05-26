import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const SkillManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1).default("0.1.0"),
    description: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()).default({}),
    permissions: z.array(z.string()).default([])
  })
  .strict();

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export async function loadSkillManifests(skillsDir: string | undefined): Promise<SkillManifest[]> {
  if (!skillsDir) {
    return [];
  }

  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const manifests: SkillManifest[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const manifest = JSON.parse(await readFile(path.join(skillsDir, entry.name), "utf8"));
    manifests.push(SkillManifestSchema.parse(manifest));
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}
