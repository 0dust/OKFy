import fs from "node:fs/promises";
import path from "node:path";
import { normalizeDocument } from "./normalize.js";
import { writeOkfBundle } from "./writer.js";
import { matchesAnyPattern } from "./util/match.js";
import type { ContentType, NormalizedDocument, RawDocument } from "./types.js";

export type ImportOptions = {
  inputPath: string;
  outDir: string;
  sourceName?: string;
  include?: string[];
  exclude?: string[];
  force?: boolean;
  dangerouslyAllowUnsafeOutput?: boolean;
  timestamp?: string;
};

function contentTypeFor(file: string): ContentType | undefined {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".mdx") return "mdx";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".txt") return "text";
  return undefined;
}

async function listFiles(root: string): Promise<string[]> {
  const stat = await fs.stat(root);
  if (stat.isFile()) return [root];
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (![".git", "node_modules", "dist"].includes(entry.name)) await walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  await walk(root);
  return files.sort();
}

export async function importLocal(options: ImportOptions): Promise<{ written: string[]; documents: NormalizedDocument[] }> {
  const root = path.resolve(options.inputPath);
  const files = await listFiles(root);
  const docs: NormalizedDocument[] = [];
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    if (options.include?.length && !matchesAnyPattern(rel, options.include)) continue;
    if (matchesAnyPattern(rel, options.exclude)) continue;
    const contentType = contentTypeFor(file);
    if (!contentType) continue;
    const raw: RawDocument = {
      sourceId: rel,
      filePath: rel,
      contentType,
      raw: await fs.readFile(file, "utf8"),
      discoveredAt: options.timestamp ?? new Date().toISOString()
    };
    docs.push(normalizeDocument(raw));
  }
  if (docs.length === 0) throw new Error("No supported Markdown, MDX, HTML, or text files found.");
  const written = await writeOkfBundle(docs, {
    outDir: options.outDir,
    title: options.sourceName,
    sourceName: options.sourceName ?? options.inputPath,
    force: options.force,
    inputPath: root,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
  return { written, documents: docs };
}
