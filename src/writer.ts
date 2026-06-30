import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isReservedOkfPath } from "./okf.js";
import { canonicalizeUrl } from "./util/url.js";
import {
  ensureMarkdownPath,
  relativeMarkdownLink,
  toPosixPath,
  urlToOutputPath
} from "./util/path.js";
import { descriptionFromMarkdown } from "./normalize.js";
import { resolveOkfyHome } from "./okfy-home.js";
import type { NormalizedDocument } from "./types.js";

export type WriteBundleOptions = {
  outDir: string;
  title?: string;
  sourceName?: string;
  force?: boolean;
  inputPath?: string;
  dangerouslyAllowUnsafeOutput?: boolean;
  timestamp?: string;
};

type WrittenConcept = {
  relPath: string;
  title: string;
  description: string;
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
    const base = safeConceptOutputPath(
      doc.resource
        ? urlToOutputPath(doc.resource)
        : ensureMarkdownPath(doc.sourcePath ?? doc.sourceId)
    );
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

function safeConceptOutputPath(candidate: string): string {
  if (!isReservedOkfPath(candidate)) return candidate;
  const parsed = path.posix.parse(candidate);
  const safeName =
    parsed.name.toLowerCase() === "log" ? "change-log" : parsed.dir ? "overview" : "home";
  return path.posix.join(parsed.dir, `${safeName}.md`);
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
        if (target && doc.outputPath)
          return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
        return `[${text}](${key}${suffix})`;
      } catch {
        return full;
      }
    }

    if (!href.startsWith("#") && doc.sourcePath) {
      const abs = toPosixPath(
        path.posix.normalize(path.posix.join(path.posix.dirname(doc.sourcePath), href))
      );
      const noHash = abs.split("#")[0] ?? abs;
      const target = sourceToOutput.get(noHash);
      if (target && doc.outputPath)
        return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
    }
    return full;
  });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function resolveForSafety(target: string): Promise<string> {
  const resolved = path.resolve(target);
  if (await pathExists(resolved)) return fs.realpath(resolved);
  const missingSegments = [path.basename(resolved)];
  let ancestor = path.dirname(resolved);
  while (!(await pathExists(ancestor))) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor)
      throw new Error(`Unable to resolve output path ancestor for ${target}.`);
    missingSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = await fs.realpath(ancestor);
  return path.join(realAncestor, ...missingSegments);
}

async function assertNoCwdSymlinkAncestor(target: string): Promise<void> {
  const cwd = path.resolve(process.cwd());
  const resolved = path.resolve(target);
  const relative = path.relative(cwd, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return;

  let current = cwd;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error: any) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ancestor ${current}.`);
    }
  }
}

async function findRepoRoot(start: string): Promise<string | undefined> {
  let current = path.resolve(start);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return fs.realpath(current);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function containsOrEquals(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function okfyHomeForSafety(): Promise<string> {
  return resolveForSafety(resolveOkfyHome());
}

export async function assertSafeForceOutDir(
  outDir: string,
  options: WriteBundleOptions
): Promise<void> {
  if (options.dangerouslyAllowUnsafeOutput) return;
  if (outDir.trim() === "") throw new Error("Unsafe output directory for --force: empty path.");
  const rawResolved = path.resolve(outDir);
  const existing = await pathExists(rawResolved);
  if (existing) {
    const stat = await fs.lstat(rawResolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ${outDir}.`);
    }
  }
  await assertNoCwdSymlinkAncestor(outDir);
  const realOutDir = await resolveForSafety(outDir);
  const forbidden = new Map<string, string>([
    [path.parse(realOutDir).root, "filesystem root"],
    [await fs.realpath(os.homedir()), "home directory"],
    [await fs.realpath(process.cwd()), "current working directory"],
    [await okfyHomeForSafety(), "OKFY_HOME"]
  ]);
  const addForbidden = (filePath: string, reason: string) => {
    if (!forbidden.has(filePath)) forbidden.set(filePath, reason);
  };
  const repoRoot = await findRepoRoot(process.cwd());
  if (repoRoot) addForbidden(repoRoot, "repository root");
  if (options.inputPath) {
    const inputReal = await resolveForSafety(options.inputPath);
    addForbidden(inputReal, "input path");
    addForbidden(path.dirname(inputReal), "parent of input path");
  }
  for (const [protectedPath, reason] of forbidden.entries()) {
    if (!containsOrEquals(realOutDir, protectedPath)) continue;
    const relation = realOutDir === protectedPath ? "delete" : "delete ancestor of";
    throw new Error(
      `Unsafe output directory for --force: refusing to ${relation} ${reason} (${protectedPath}) from ${realOutDir}.`
    );
  }
}

async function ensureCleanOutDir(outDir: string, options: WriteBundleOptions): Promise<void> {
  if (options.force) await assertSafeForceOutDir(outDir, options);
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(`Output directory is not empty: ${outDir}. Use --force to overwrite.`);
      await fs.rm(outDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(outDir, { recursive: true });
}

function titleForPath(relPath: string, fallback: string): string {
  const basename = path.posix.basename(relPath, ".md");
  return fallback || basename;
}

function markdownLink(fromDir: string, toPath: string): string {
  if (fromDir === ".") return toPath;
  return path.posix.relative(fromDir, toPath);
}

function indexTitle(dir: string, options: WriteBundleOptions): string {
  if (dir === ".") return options.title ?? options.sourceName ?? "OKF Bundle";
  const leaf = path.posix.basename(dir);
  return leaf
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

async function writePlainIndex(
  outDir: string,
  dir: string,
  concepts: WrittenConcept[],
  options: WriteBundleOptions
): Promise<string> {
  const indexPath = dir === "." ? "index.md" : path.posix.join(dir, "index.md");
  const entries = (
    dir === "."
      ? concepts
      : concepts.filter((concept) => path.posix.dirname(concept.relPath) === dir)
  )
    .slice()
    .sort((a, b) => a.relPath.localeCompare(b.relPath));
  const lines = [
    `# ${indexTitle(dir, options)}`,
    "",
    ...entries.map(
      (concept) =>
        `* [${concept.title}](${markdownLink(dir, concept.relPath)}) - ${concept.description}`
    )
  ];
  await fs.mkdir(path.dirname(path.join(outDir, indexPath)), { recursive: true });
  await fs.writeFile(path.join(outDir, indexPath), `${lines.join("\n").trimEnd()}\n`, "utf8");
  return indexPath;
}

export async function writeOkfBundle(
  docs: NormalizedDocument[],
  options: WriteBundleOptions
): Promise<string[]> {
  if (docs.length === 0) throw new Error("No documents to write.");
  await ensureCleanOutDir(options.outDir, options);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const orderedDocs = docs
    .slice()
    .sort((first, second) => sourceKey(first).localeCompare(sourceKey(second)));
  const sourceToOutput = assignOutputPaths(orderedDocs);
  const written: string[] = [];
  const concepts: WrittenConcept[] = [];

  for (const doc of orderedDocs) {
    const relPath = doc.outputPath ?? "index.md";
    const absolute = path.join(options.outDir, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const body = withTitle(doc.title, rewriteLinks(doc, sourceToOutput));
    await fs.writeFile(absolute, `${frontmatter(doc, timestamp)}${body}\n`, "utf8");
    written.push(relPath);
    concepts.push({
      relPath,
      title: titleForPath(relPath, doc.title),
      description: descriptionFromMarkdown(doc.markdown)
    });
  }

  written.push(await writePlainIndex(options.outDir, ".", concepts, options));
  const dirs = [
    ...new Set(
      concepts.map((concept) => path.posix.dirname(concept.relPath)).filter((dir) => dir !== ".")
    )
  ].sort();
  for (const dir of dirs) {
    written.push(await writePlainIndex(options.outDir, dir, concepts, options));
  }

  return written.sort();
}
