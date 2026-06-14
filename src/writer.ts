import fs from "node:fs/promises";
import path from "node:path";
import { canonicalizeUrl } from "./util/url.js";
import { ensureMarkdownPath, relativeMarkdownLink, toPosixPath, urlToOutputPath } from "./util/path.js";
import { descriptionFromMarkdown } from "./normalize.js";
import type { NormalizedDocument } from "./types.js";

export type WriteBundleOptions = {
  outDir: string;
  title?: string;
  sourceName?: string;
  force?: boolean;
  timestamp?: string;
};

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function frontmatter(doc: NormalizedDocument, timestamp: string): string {
  const lines = [
    "---",
    `type: ${yamlScalar(doc.type)}`,
    `title: ${yamlScalar(doc.title)}`,
    `description: ${yamlScalar(descriptionFromMarkdown(doc.markdown))}`,
    `resource: ${yamlScalar(doc.resource ?? doc.sourcePath ?? doc.sourceId)}`,
    "tags:",
    ...(doc.tags.length ? doc.tags.map((tag) => `  - ${yamlScalar(tag)}`) : ["  []"]),
    `timestamp: ${yamlScalar(timestamp)}`,
    "---",
    ""
  ];
  return lines.join("\n");
}

function withTitle(title: string, markdown: string): string {
  const trimmed = markdown.trim();
  if (trimmed.match(/^#\s+/)) return trimmed;
  return `# ${title}\n\n${trimmed}`;
}

function sourceKey(doc: NormalizedDocument): string {
  if (doc.resource) return canonicalizeUrl(doc.resource);
  return toPosixPath(doc.sourcePath ?? doc.sourceId);
}

function assignOutputPaths(docs: NormalizedDocument[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const doc of docs) {
    const base = doc.resource ? urlToOutputPath(doc.resource) : ensureMarkdownPath(doc.sourcePath ?? doc.sourceId);
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
      const parsed = path.posix.parse(base);
      candidate = path.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    }
    used.add(candidate);
    result.set(sourceKey(doc), candidate);
    doc.outputPath = candidate;
  }
  return result;
}

function rewriteLinks(doc: NormalizedDocument, sourceToOutput: Map<string, string>): string {
  return doc.markdown.replace(/\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (full, text, href, suffix) => {
    if (/^(https?:)?\/\//.test(href)) {
      try {
        const key = canonicalizeUrl(href);
        const target = sourceToOutput.get(key);
        if (target && doc.outputPath) {
          return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
        }
      } catch {
        return full;
      }
    }

    if (!href.startsWith("#") && doc.resource) {
      try {
        const key = canonicalizeUrl(href, doc.resource);
        const target = sourceToOutput.get(key);
        if (target && doc.outputPath) return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
        return `[${text}](${key}${suffix})`;
      } catch {
        return full;
      }
    }

    if (!href.startsWith("#") && doc.sourcePath) {
      const abs = toPosixPath(path.posix.normalize(path.posix.join(path.posix.dirname(doc.sourcePath), href)));
      const noHash = abs.split("#")[0] ?? abs;
      const target = sourceToOutput.get(noHash);
      if (target && doc.outputPath) return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
    }
    return full;
  });
}

async function ensureCleanOutDir(outDir: string, force?: boolean): Promise<void> {
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      if (!force) throw new Error(`Output directory is not empty: ${outDir}. Use --force to overwrite.`);
      await fs.rm(outDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(outDir, { recursive: true });
}

export async function writeOkfBundle(docs: NormalizedDocument[], options: WriteBundleOptions): Promise<string[]> {
  if (docs.length === 0) throw new Error("No documents to write.");
  await ensureCleanOutDir(options.outDir, options.force);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const sourceToOutput = assignOutputPaths(docs);
  const written: string[] = [];

  for (const doc of docs) {
    const relPath = doc.outputPath ?? "index.md";
    const absolute = path.join(options.outDir, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const body = withTitle(doc.title, rewriteLinks(doc, sourceToOutput));
    await fs.writeFile(absolute, `${frontmatter(doc, timestamp)}${body}\n`, "utf8");
    written.push(relPath);
  }

  if (!written.includes("index.md")) {
    const title = options.title ?? options.sourceName ?? "OKF Bundle";
    const list = written
      .sort()
      .map((file) => `- [${file.replace(/\.md$/, "")}](./${file})`)
      .join("\n");
    const indexDoc = [
      "---",
      'type: "Bundle Index"',
      `title: ${yamlScalar(title)}`,
      `description: ${yamlScalar(`Index for ${title}.`)}`,
      `resource: ${yamlScalar(options.sourceName ?? title)}`,
      "tags:",
      '  - "index"',
      `timestamp: ${yamlScalar(timestamp)}`,
      "---",
      "",
      `# ${title}`,
      "",
      list,
      ""
    ].join("\n");
    await fs.writeFile(path.join(options.outDir, "index.md"), indexDoc, "utf8");
    written.unshift("index.md");
  }

  const dirs = [...new Set(written.map((file) => path.posix.dirname(file)).filter((dir) => dir !== "."))].sort();
  for (const dir of dirs) {
    const indexPath = path.posix.join(dir, "index.md");
    if (written.includes(indexPath)) continue;
    const children = written
      .filter((file) => path.posix.dirname(file) === dir && path.posix.basename(file) !== "index.md")
      .sort();
    if (children.length === 0) continue;
    const title = `${dir
      .split("/")
      .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
      .join(" / ")} Index`;
    const list = children.map((file) => `- [${path.posix.basename(file, ".md")}](./${path.posix.basename(file)})`).join("\n");
    const folderIndex = [
      "---",
      'type: "Folder Index"',
      `title: ${yamlScalar(title)}`,
      `description: ${yamlScalar(`Index for ${dir}.`)}`,
      `resource: ${yamlScalar(options.sourceName ?? dir)}`,
      "tags:",
      '  - "index"',
      `timestamp: ${yamlScalar(timestamp)}`,
      "---",
      "",
      `# ${title}`,
      "",
      list,
      ""
    ].join("\n");
    await fs.mkdir(path.join(options.outDir, dir), { recursive: true });
    await fs.writeFile(path.join(options.outDir, indexPath), folderIndex, "utf8");
    written.push(indexPath);
  }

  return written.sort();
}
