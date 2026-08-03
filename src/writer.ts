import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { dump } from "js-yaml";
import { needsGeneratedTitle, slugGeneratedTitle } from "./markdown-title.js";
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
import { isRecord } from "./util/object.js";
import type { NormalizedDocument, SemanticLink, SourceRange } from "./types.js";

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

const OWNED_FRONTMATTER_KEYS = new Set([
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "aliases",
  "timestamp"
]);

const UNSAFE_PROPERTY_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_FRONTMATTER_VALUE_DEPTH = 100;
const MAX_FRONTMATTER_EXPANDED_VALUES = 10_000;

function stableYamlValue(value: unknown, propertyKey: string): unknown {
  const ancestors = new WeakSet<object>();
  let visited = 0;

  const visit = (current: unknown, currentPath: string, depth: number): unknown => {
    visited += 1;
    if (visited > MAX_FRONTMATTER_EXPANDED_VALUES) {
      throw new Error(
        `Cannot serialize frontmatter property ${JSON.stringify(propertyKey)}: expansion exceeds ${MAX_FRONTMATTER_EXPANDED_VALUES} values; reduce nested collections or YAML aliases.`
      );
    }
    if (current instanceof Date) return new Date(current.getTime());
    const isArray = Array.isArray(current);
    if (!isArray && !isRecord(current)) return current;
    if (depth >= MAX_FRONTMATTER_VALUE_DEPTH) {
      throw new Error(
        `Cannot serialize frontmatter property ${JSON.stringify(propertyKey)}: nesting exceeds ${MAX_FRONTMATTER_VALUE_DEPTH} levels.`
      );
    }
    if (ancestors.has(current)) {
      throw new Error(
        `Cannot serialize frontmatter property ${JSON.stringify(propertyKey)}: cyclic value at ${currentPath}.`
      );
    }

    ancestors.add(current);
    try {
      if (isArray) {
        return current.map((item, index) => visit(item, `${currentPath}[${index}]`, depth + 1));
      }

      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(current).sort()) {
        if (UNSAFE_PROPERTY_KEYS.has(key)) continue;
        sorted[key] = visit(current[key], `${currentPath}.${key}`, depth + 1);
      }
      return sorted;
    } finally {
      ancestors.delete(current);
    }
  };

  return visit(value, propertyKey, 0);
}

function yamlProperty(key: string, value: unknown): string {
  return dump(
    { [key]: stableYamlValue(value, key) },
    {
      forceQuotes: true,
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      sortKeys: false
    }
  ).trimEnd();
}

function frontmatter(doc: NormalizedDocument, timestamp: string): string {
  const description = doc.properties?.description ?? descriptionFromMarkdown(doc.markdown);
  const lines: string[] = [
    "---",
    `type: ${yamlScalar(doc.type)}`,
    `title: ${yamlScalar(doc.title)}`,
    `description: ${yamlScalar(description)}`,
    `resource: ${yamlScalar(doc.resource ?? doc.sourcePath ?? doc.sourceId)}`,
    "tags:",
    ...(doc.tags.length ? doc.tags.map((tag) => `  - ${yamlScalar(tag)}`) : ["  []"]),
    ...(doc.aliases?.length
      ? ["aliases:", ...doc.aliases.map((alias) => `  - ${yamlScalar(alias)}`)]
      : []),
    `timestamp: ${yamlScalar(timestamp)}`
  ];

  for (const key of Object.keys(doc.properties?.data ?? {}).sort()) {
    if (OWNED_FRONTMATTER_KEYS.has(key) || UNSAFE_PROPERTY_KEYS.has(key)) continue;
    lines.push(yamlProperty(key, doc.properties!.data[key]));
  }

  lines.push("---", "");
  return lines.join("\n");
}

function markdownPlainText(value: string): string {
  return value.replace(/[\x21-\x2C\x2E-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/g, "\\$&");
}

function withTitle(title: string, markdown: string): string {
  const trimmed = markdown.trimEnd();
  if (!needsGeneratedTitle(trimmed)) return trimmed;
  return `# ${markdownPlainText(title)}\n\n${trimmed}`;
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

type TextEdit = SourceRange & { replacement: string };

function addEdit(edits: Map<string, TextEdit>, edit: TextEdit): void {
  const key = `${edit.start}:${edit.end}`;
  const existing = edits.get(key);
  if (existing && existing.replacement !== edit.replacement) {
    throw new Error(`Conflicting Markdown edits at ${key}.`);
  }
  edits.set(key, edit);
}

function applyEdits(markdown: string, editMap: Map<string, TextEdit>): string {
  const edits = [...editMap.values()].sort(
    (first, second) => first.start - second.start || first.end - second.end
  );
  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1]!;
    const current = edits[index]!;
    if (current.start < previous.end) {
      throw new Error(
        `Overlapping Markdown edits at ${previous.start}:${previous.end} and ${current.start}:${current.end}.`
      );
    }
  }

  const rendered: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    rendered.push(markdown.slice(cursor, edit.start), edit.replacement);
    cursor = edit.end;
  }
  rendered.push(markdown.slice(cursor));
  return rendered.join("");
}

function rewriteMarkdownDestination(
  doc: NormalizedDocument,
  href: string,
  sourceToOutput: Map<string, string>
): string | undefined {
  if (/^(https?:)?\/\//.test(href)) {
    try {
      const target = sourceToOutput.get(canonicalizeUrl(href));
      if (target && doc.outputPath) return relativeMarkdownLink(doc.outputPath, target);
    } catch {
      return undefined;
    }
    return undefined;
  }

  if (!href.startsWith("#") && doc.resource) {
    try {
      const key = canonicalizeUrl(href, doc.resource);
      const target = sourceToOutput.get(key);
      if (target && doc.outputPath) return relativeMarkdownLink(doc.outputPath, target);
      return key;
    } catch {
      return undefined;
    }
  }

  if (!href.startsWith("#") && doc.sourcePath) {
    const absolute = toPosixPath(
      path.posix.normalize(path.posix.join(path.posix.dirname(doc.sourcePath), href))
    );
    const target = sourceToOutput.get(absolute.split("#")[0] ?? absolute);
    if (target && doc.outputPath) return relativeMarkdownLink(doc.outputPath, target);
  }
  return undefined;
}

type HeadingFragments = Map<string, string>;

function emittedHeadingFragments(document: NormalizedDocument): HeadingFragments {
  const fragments = new Map<string, string>();
  const slugger = new GithubSlugger();
  if (needsGeneratedTitle(document.markdown)) slugGeneratedTitle(slugger, document.title);
  for (const heading of document.headings) {
    const fragment = slugger.slug(heading.text);
    for (const key of [heading.text.normalize("NFC"), heading.slug.normalize("NFC")]) {
      if (!fragments.has(key)) fragments.set(key, fragment);
    }
  }
  return fragments;
}

function headingFragment(link: SemanticLink, target: HeadingFragments | undefined): string {
  if (link.blockId) return link.blockId.normalize("NFC");
  const requested = link.heading?.trim().normalize("NFC");
  if (!requested) return "";
  return target?.get(requested) ?? new GithubSlugger().slug(requested);
}

function rewriteLinks(
  doc: NormalizedDocument,
  sourceToOutput: Map<string, string>,
  sourceToHeadingFragments: Map<string, HeadingFragments>
): string {
  const edits = new Map<string, TextEdit>();

  for (const block of doc.blockIds ?? []) {
    addEdit(edits, {
      ...block.range,
      replacement: `<a id="${block.id}"></a>`
    });
  }

  for (const link of doc.semanticLinks ?? []) {
    if (link.kind === "markdown") {
      if (!link.destinationRange) continue;
      const replacement = rewriteMarkdownDestination(doc, link.target, sourceToOutput);
      if (replacement === undefined || replacement === link.target) continue;
      addEdit(edits, { ...link.destinationRange, replacement });
      continue;
    }

    if (
      (link.kind !== "wikilink" && link.kind !== "note_embed") ||
      link.resolution !== "resolved" ||
      !link.resolvedSourceKey ||
      !doc.outputPath
    ) {
      continue;
    }

    const targetOutput = sourceToOutput.get(link.resolvedSourceKey);
    if (!targetOutput) continue;
    const fragment = headingFragment(link, sourceToHeadingFragments.get(link.resolvedSourceKey));
    const destination = `${relativeMarkdownLink(doc.outputPath, targetOutput)}${
      fragment ? `#${fragment}` : ""
    }`;
    addEdit(edits, {
      ...link.range,
      replacement: `[${markdownPlainText(link.text)}](${destination})`
    });
  }

  return applyEdits(doc.markdown, edits);
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
        `* [${markdownPlainText(concept.title)}](${markdownLink(dir, concept.relPath)}) - ${concept.description}`
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
  const sourceToHeadingFragments = new Map(
    orderedDocs.map((doc) => [sourceKey(doc), emittedHeadingFragments(doc)])
  );
  const written: string[] = [];
  const concepts: WrittenConcept[] = [];

  for (const doc of orderedDocs) {
    const relPath = doc.outputPath ?? "index.md";
    const absolute = path.join(options.outDir, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const body = withTitle(doc.title, rewriteLinks(doc, sourceToOutput, sourceToHeadingFragments));
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
