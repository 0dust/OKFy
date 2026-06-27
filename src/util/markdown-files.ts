import fs from "node:fs/promises";
import path from "node:path";

export async function listMarkdownFiles(dir: string): Promise<string[]> {
  const result: string[] = [];

  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(absolute);
    }
  }

  await walk(dir);
  return result.sort();
}
