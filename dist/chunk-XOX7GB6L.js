// src/graph.ts
import path2 from "path";

// src/util/path.ts
import path from "path";
function toPosixPath(input) {
  return input.split(path.sep).join("/");
}
function stripMdExtension(input) {
  return input.replace(/\.md$/i, "");
}
function safeSegment(input) {
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = input;
  }
  const cleaned = decoded.normalize("NFKD").replace(/[^\w.\-~]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").toLowerCase();
  return cleaned || "index";
}
function ensureMarkdownPath(input) {
  if (!input || input === "/") return "index.md";
  const trimmed = input.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "index.md";
  const parts = trimmed.split("/").map(safeSegment);
  const last = parts[parts.length - 1] ?? "index";
  if (/\.(md|mdx|html?|txt)$/i.test(last)) {
    parts[parts.length - 1] = last.replace(/\.(mdx|html?|txt)$/i, ".md");
  } else {
    parts[parts.length - 1] = `${last}.md`;
  }
  return parts.join("/");
}
function urlToOutputPath(url) {
  const parsed = new URL(url);
  if (parsed.pathname === "/" || parsed.pathname === "") return "index.md";
  const trailingSlash = parsed.pathname.endsWith("/");
  if (trailingSlash) {
    const trimmed = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return `${trimmed.split("/").map(safeSegment).join("/")}/index.md`;
  }
  return ensureMarkdownPath(parsed.pathname);
}
function relativeMarkdownLink(fromPath, toPath) {
  const fromDir = path.posix.dirname(toPosixPath(fromPath));
  let rel = path.posix.relative(fromDir, toPosixPath(toPath));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

// src/graph.ts
function extractInternalLinks(concept) {
  const links = /* @__PURE__ */ new Set();
  for (const match of concept.body.matchAll(/\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1] ?? "";
    const noHash = href.split("#")[0] ?? href;
    if (!noHash) continue;
    if (/^(https?:)?\/\//i.test(noHash) || /^mailto:/i.test(noHash)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(noHash)) continue;
    const resolved = noHash.startsWith("/") ? path2.posix.normalize(noHash.slice(1)) : path2.posix.normalize(path2.posix.join(path2.posix.dirname(concept.path), noHash));
    if (!resolved || resolved === ".") continue;
    links.add(stripMdExtension(resolved));
  }
  return [...links].sort();
}
function buildGraph(conceptsByAnyKey) {
  const concepts = /* @__PURE__ */ new Map();
  for (const concept of conceptsByAnyKey.values()) concepts.set(concept.id, concept);
  const outbound = /* @__PURE__ */ new Map();
  const backlinks = /* @__PURE__ */ new Map();
  for (const concept of concepts.values()) {
    const targets = extractInternalLinks(concept).filter((id) => concepts.has(id));
    outbound.set(concept.id, targets);
    for (const target of targets) {
      backlinks.set(target, [...backlinks.get(target) ?? [], concept.id].sort());
    }
  }
  for (const concept of concepts.values()) {
    if (!backlinks.has(concept.id)) backlinks.set(concept.id, []);
    if (!outbound.has(concept.id)) outbound.set(concept.id, []);
  }
  return { concepts, outbound, backlinks };
}

// src/reader.ts
import fs from "fs/promises";
import path4 from "path";

// src/frontmatter.ts
import { load } from "js-yaml";
var FRONTMATTER_PATTERN = /^---[ \t]*\r?\n(?:---[ \t]*(?:\r?\n|$)|([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$))/;
var UTF8_BOM = "\uFEFF";
function stripLeadingBom(raw) {
  return raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
}
function hasFrontmatter(raw) {
  return stripLeadingBom(raw).startsWith("---");
}
function parseFrontmatter(raw) {
  const normalized = stripLeadingBom(raw);
  if (!normalized.startsWith("---")) return { data: {}, content: normalized };
  const match = normalized.match(FRONTMATTER_PATTERN);
  if (!match) throw new Error("Malformed YAML frontmatter.");
  const loaded = load(match[1] ?? "");
  return {
    data: isRecord(loaded) ? loaded : {},
    content: normalized.slice(match[0].length)
  };
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/okf.ts
import path3 from "path";
var RESERVED_FILENAMES = /* @__PURE__ */ new Set(["index.md", "log.md"]);
function toOkfPath(input) {
  return input.split(path3.sep).join("/");
}
function isReservedOkfPath(input) {
  return RESERVED_FILENAMES.has(path3.posix.basename(toOkfPath(input)).toLowerCase());
}
function isConceptMarkdownPath(input) {
  return input.toLowerCase().endsWith(".md") && !isReservedOkfPath(input);
}

// src/reader.ts
async function listMarkdownFiles(dir) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path4.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(absolute);
    }
  }
  await walk(dir);
  return result.sort();
}
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}
async function readConceptFile(bundleDir, absolutePath) {
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = parseFrontmatter(raw);
  const relPath = toPosixPath(path4.relative(bundleDir, absolutePath));
  if (isReservedOkfPath(relPath)) throw new Error(`Reserved OKF file is not a concept: ${relPath}`);
  const id = stripMdExtension(relPath);
  const frontmatter2 = parsed.data;
  return {
    id,
    path: relPath,
    frontmatter: frontmatter2,
    type: typeof frontmatter2.type === "string" ? frontmatter2.type : "",
    title: typeof frontmatter2.title === "string" ? frontmatter2.title : void 0,
    description: typeof frontmatter2.description === "string" ? frontmatter2.description : void 0,
    resource: typeof frontmatter2.resource === "string" ? frontmatter2.resource : void 0,
    tags: stringArray(frontmatter2.tags),
    body: parsed.content.trim()
  };
}
async function readBundle(bundleDir) {
  const files = await listMarkdownFiles(bundleDir);
  const concepts = /* @__PURE__ */ new Map();
  for (const file of files) {
    const relPath = toPosixPath(path4.relative(bundleDir, file));
    if (!isConceptMarkdownPath(relPath)) continue;
    const concept = await readConceptFile(bundleDir, file);
    concepts.set(concept.id, concept);
    concepts.set(concept.path, concept);
  }
  return concepts;
}

// src/search.ts
import MiniSearch from "minisearch";
function snippet(concept, query, max = 240) {
  const text = `${concept.description ?? ""} ${concept.body}`.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const term = query.toLowerCase().split(/\s+/).find(Boolean) ?? "";
  const index = term ? lower.indexOf(term) : -1;
  const start = Math.max(0, index - 80);
  return text.slice(start, start + max);
}
var STOPWORDS = /* @__PURE__ */ new Set([
  "about",
  "after",
  "and",
  "are",
  "can",
  "could",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "onto",
  "should",
  "that",
  "the",
  "their",
  "there",
  "this",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your"
]);
function meaningfulQueryTerms(query) {
  const terms = /* @__PURE__ */ new Set();
  for (const token of query.match(/[A-Za-z0-9]+/g) ?? []) {
    const normalized = token.toLowerCase();
    const isAcronym = normalized.length >= 2 && ["api", "cli", "mcp", "okf", "sdk"].includes(normalized);
    if ((normalized.length >= 4 || isAcronym) && !STOPWORDS.has(normalized)) {
      terms.add(normalized);
    }
  }
  return terms;
}
function matchesMeaningfulQueryTerm(hit, terms) {
  if (terms.size === 0) return false;
  return (hit.queryTerms ?? []).some((term) => terms.has(term.toLowerCase()));
}
var BundleSearch = class _BundleSearch {
  graph;
  index;
  constructor(conceptsByAnyKey) {
    this.graph = buildGraph(conceptsByAnyKey);
    this.index = new MiniSearch({
      fields: ["title", "description", "tags", "type", "body"],
      storeFields: ["id"],
      searchOptions: {
        boost: { title: 4, tags: 3, type: 2, description: 2 },
        fuzzy: 0.2,
        prefix: true
      }
    });
    this.index.addAll(
      [...this.graph.concepts.values()].map((concept) => ({
        id: concept.id,
        title: concept.title ?? concept.id,
        type: concept.type,
        description: concept.description ?? "",
        tags: concept.tags.join(" "),
        body: concept.body
      }))
    );
  }
  static async fromBundle(bundleDir) {
    return new _BundleSearch(await readBundle(bundleDir));
  }
  search(query, options = {}) {
    const limit = options.limit ?? 10;
    const trimmedQuery = query.trim();
    const strict = this.resultsForHits(
      this.index.search(trimmedQuery || MiniSearch.wildcard, { combineWith: "AND" }).slice(0, 100),
      query,
      options
    );
    if (!trimmedQuery || strict.length > 0 || trimmedQuery.split(/\s+/).length < 2)
      return strict.slice(0, limit);
    const fallbackTerms = meaningfulQueryTerms(trimmedQuery);
    const fallback = this.resultsForHits(
      this.index.search(trimmedQuery, { combineWith: "OR" }).filter((hit) => matchesMeaningfulQueryTerm(hit, fallbackTerms)).slice(0, 100),
      query,
      options
    );
    return fallback.slice(0, limit);
  }
  resultsForHits(hits, query, options) {
    const tagFilter = new Set(options.tags ?? []);
    return hits.map((hit) => ({ hit, concept: this.graph.concepts.get(hit.id) })).filter(
      (row) => Boolean(row.concept)
    ).filter(({ concept }) => !options.type || concept.type === options.type).filter(
      ({ concept }) => tagFilter.size === 0 || concept.tags.some((tag) => tagFilter.has(tag))
    ).map(({ hit, concept }) => ({
      id: concept.id,
      title: concept.title,
      type: concept.type,
      description: concept.description,
      tags: concept.tags,
      resource: concept.resource,
      snippet: snippet(concept, query),
      score: hit.score
    }));
  }
  getConcept(idOrPath) {
    const id = idOrPath.replace(/\.md$/i, "");
    return this.graph.concepts.get(id) ?? [...this.graph.concepts.values()].find((concept) => concept.path === idOrPath);
  }
};

// src/metadata.ts
import fs2 from "fs";
import path5 from "path";
import { fileURLToPath } from "url";
var FALLBACK_NAME = "okfy-ai";
var FALLBACK_VERSION = "0.0.0";
var cachedMetadata;
function runtimePackageRoot() {
  return path5.resolve(path5.dirname(fileURLToPath(import.meta.url)), "..");
}
function packageMetadata() {
  cachedMetadata ??= readPackageMetadata();
  return cachedMetadata;
}
function packageVersion() {
  return packageMetadata().version;
}
function okfyUserAgent() {
  return `okfy/${packageVersion()} (+https://github.com/0dust/OKFy)`;
}
function readPackageMetadata() {
  const root = runtimePackageRoot();
  try {
    const raw = fs2.readFileSync(path5.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name ?? FALLBACK_NAME,
      version: parsed.version ?? FALLBACK_VERSION,
      root
    };
  } catch {
    return {
      name: FALLBACK_NAME,
      version: FALLBACK_VERSION,
      root
    };
  }
}

// src/validate.ts
import fs3 from "fs/promises";
import path6 from "path";
async function listMarkdownFiles2(dir) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs3.readdir(current, { withFileTypes: true })) {
      const absolute = path6.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(absolute);
    }
  }
  await walk(dir);
  return result.sort();
}
function issue(severity, code, message, file) {
  return { severity, code, message, path: file };
}
function firstContentLine(content) {
  return content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}
function validateIndexFile(raw, rel, issues) {
  let body = raw;
  if (hasFrontmatter(raw)) {
    if (rel !== "index.md") {
      issues.push(
        issue(
          "error",
          "reserved_index_frontmatter",
          "Only bundle-root index.md may contain okf_version frontmatter.",
          rel
        )
      );
      return;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      issues.push(
        issue(
          "error",
          "malformed_frontmatter",
          error?.message ?? "Malformed YAML frontmatter.",
          rel
        )
      );
      return;
    }
    const keys = Object.keys(parsed.data);
    if (keys.length !== 1 || keys[0] !== "okf_version" || typeof parsed.data.okf_version !== "string") {
      issues.push(
        issue(
          "error",
          "reserved_index_frontmatter",
          "Root index.md frontmatter may contain only string okf_version.",
          rel
        )
      );
    }
    body = parsed.content;
  }
  const firstLine = firstContentLine(body);
  if (!firstLine.startsWith("# ")) {
    issues.push(
      issue(
        "error",
        "invalid_index_structure",
        "index.md must be a markdown directory listing headed by a section title.",
        rel
      )
    );
  }
}
function validateLogFile(raw, rel, issues) {
  if (hasFrontmatter(raw)) {
    issues.push(
      issue("error", "reserved_log_frontmatter", "log.md must not contain YAML frontmatter.", rel)
    );
    return;
  }
  const firstLine = firstContentLine(raw);
  if (!firstLine.startsWith("# ")) {
    issues.push(
      issue(
        "error",
        "invalid_log_structure",
        "log.md must be a markdown update log headed by a title.",
        rel
      )
    );
  }
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading && !/^\d{4}-\d{2}-\d{2}\b/.test(heading[1] ?? "")) {
      issues.push(
        issue("error", "invalid_log_date", "log.md date headings must use YYYY-MM-DD.", rel)
      );
    }
  }
}
function validateReservedFile(raw, rel, issues) {
  const name = path6.posix.basename(rel).toLowerCase();
  if (name === "index.md") validateIndexFile(raw, rel, issues);
  if (name === "log.md") validateLogFile(raw, rel, issues);
}
async function validateBundle(bundleDir) {
  const issues = [];
  let files = [];
  try {
    files = await listMarkdownFiles2(bundleDir);
  } catch (error) {
    return {
      valid: false,
      issues: [issue("error", "bundle_unreadable", error?.message ?? "Bundle cannot be read.")],
      conceptCount: 0,
      reservedFileCount: 0,
      warningCount: 0
    };
  }
  const conceptFiles = files.filter(
    (file) => isConceptMarkdownPath(path6.relative(bundleDir, file).split(path6.sep).join("/"))
  );
  const reservedFiles = files.filter(
    (file) => isReservedOkfPath(path6.relative(bundleDir, file).split(path6.sep).join("/"))
  );
  for (const file of reservedFiles) {
    const rel = path6.relative(bundleDir, file).split(path6.sep).join("/");
    const raw = await fs3.readFile(file, "utf8");
    validateReservedFile(raw, rel, issues);
  }
  for (const file of files) {
    const rel = path6.relative(bundleDir, file).split(path6.sep).join("/");
    if (!isConceptMarkdownPath(rel)) continue;
    if (rel.includes("..") || path6.isAbsolute(rel)) {
      issues.push(issue("error", "unsafe_path", "Concept path is unsafe.", rel));
    }
    const raw = await fs3.readFile(file, "utf8");
    if (!hasFrontmatter(raw)) {
      issues.push(
        issue("error", "missing_frontmatter", "Concept file must start with YAML frontmatter.", rel)
      );
      continue;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      issues.push(
        issue(
          "error",
          "malformed_frontmatter",
          error?.message ?? "Malformed YAML frontmatter.",
          rel
        )
      );
      continue;
    }
    const data = parsed.data;
    if (typeof data.type !== "string" || data.type.trim() === "") {
      issues.push(
        issue("error", "missing_type", "Frontmatter type must be a non-empty string.", rel)
      );
    }
    for (const key of ["title", "description", "resource", "timestamp"]) {
      if (data[key] !== void 0 && typeof data[key] !== "string") {
        issues.push(
          issue("warning", "bad_field_shape", `${key} should be a string when present.`, rel)
        );
      }
    }
    if (data.tags !== void 0 && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string"))) {
      issues.push(
        issue("warning", "bad_field_shape", "tags should be an array of strings when present.", rel)
      );
    }
  }
  const concepts = await readBundle(bundleDir).catch(() => /* @__PURE__ */ new Map());
  const canonicalIds = new Set([...concepts.values()].map((concept) => concept.id));
  for (const concept of new Map(
    [...concepts.values()].map((concept2) => [concept2.id, concept2])
  ).values()) {
    for (const target of extractInternalLinks(concept)) {
      if (!canonicalIds.has(target)) {
        issues.push(
          issue(
            "warning",
            "broken_internal_link",
            `Broken internal link to ${target}.`,
            concept.path
          )
        );
      }
    }
  }
  const dirs = new Set(conceptFiles.map((file) => path6.dirname(file)));
  for (const dir of dirs) {
    const index = path6.join(dir, "index.md");
    if (!files.includes(index)) {
      issues.push(
        issue(
          "warning",
          "missing_folder_index",
          "Folder has concepts but no index.md.",
          path6.relative(bundleDir, dir).split(path6.sep).join("/") || "."
        )
      );
    }
  }
  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
    conceptCount: conceptFiles.length,
    reservedFileCount: reservedFiles.length,
    warningCount: issues.filter((item) => item.severity === "warning").length
  };
}
async function inspectBundle(bundleDir) {
  const conceptsByAnyKey = await readBundle(bundleDir);
  const graph = buildGraph(conceptsByAnyKey);
  const concepts = [...graph.concepts.values()];
  const typeDistribution = {};
  const tagDistribution = {};
  const sourceDomains = {};
  for (const concept of concepts) {
    typeDistribution[concept.type] = (typeDistribution[concept.type] ?? 0) + 1;
    for (const tag of concept.tags) tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
    if (concept.resource?.startsWith("http")) {
      const domain = new URL(concept.resource).hostname;
      sourceDomains[domain] = (sourceDomains[domain] ?? 0) + 1;
    }
  }
  const topLinkedConcepts = concepts.map((concept) => ({
    id: concept.id,
    title: concept.title,
    count: (graph.backlinks.get(concept.id) ?? []).length
  })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, 10);
  const linkCount = [...graph.outbound.values()].reduce((sum2, links) => sum2 + links.length, 0);
  const validation = await validateBundle(bundleDir);
  return {
    title: path6.basename(bundleDir),
    conceptCount: concepts.length,
    reservedFileCount: validation.reservedFileCount,
    warningCount: validation.warningCount,
    typeDistribution,
    tagDistribution,
    linkCount,
    brokenLinks: validation.issues.filter((item) => item.code === "broken_internal_link").length,
    orphanConcepts: concepts.filter((concept) => concept.id !== "index").filter((concept) => (graph.backlinks.get(concept.id) ?? []).length === 0).map((concept) => concept.id).sort(),
    topLinkedConcepts,
    sourceDomains
  };
}

// src/source-store.ts
import fs4 from "fs/promises";
import os from "os";
import path7 from "path";
var SOURCE_NAME_PATTERN = /^[a-z0-9._-]+$/;
var MANIFEST_KEYS = [
  "schemaVersion",
  "okfyVersion",
  "name",
  "kind",
  "createdAt",
  "updatedAt",
  "source",
  "crawl",
  "refresh",
  "bundle"
];
var CRAWL_KEYS = [
  "maxPages",
  "maxDepth",
  "include",
  "exclude",
  "sameOrigin",
  "respectRobots",
  "concurrency",
  "allowPrivateNetwork"
];
var REFRESH_KEYS = ["mode", "maxAgeSeconds", "minIntervalSeconds"];
var STATE_KEYS = [
  "schemaVersion",
  "status",
  "lastCheckedAt",
  "lastRefreshStartedAt",
  "lastRefreshCompletedAt",
  "lastSuccessfulRefreshAt",
  "nextRefreshAllowedAt",
  "refreshInProgress",
  "lastError",
  "bundle"
];
var STATE_BUNDLE_KEYS = ["conceptCount", "warningCount", "valid", "contentHash"];
function resolveOkfyHome(options = {}) {
  const configured = options.okfyHome ?? options.env?.OKFY_HOME ?? process.env.OKFY_HOME;
  if (configured && configured.trim() !== "") return path7.resolve(configured);
  return path7.join(os.homedir(), ".okfy");
}
function validateSourceName(name) {
  if (!name || name === "." || name === ".." || !SOURCE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid source name "${name}". Use lowercase letters, numbers, dash, underscore, or dot without path separators.`
    );
  }
  return name;
}
function resolveSourceDir(name, options = {}) {
  const safeName = validateSourceName(name);
  const sourcesRoot = resolveSourcesRoot(options);
  const sourceDir = path7.resolve(sourcesRoot, safeName);
  if (!isInsideOrEqual(sourcesRoot, sourceDir)) {
    throw new Error(`Invalid source name "${name}". Source directory escapes OKFY_HOME.`);
  }
  return sourceDir;
}
function resolveBundleDir(manifest, options = {}) {
  const sourceDir = resolveSourceDir(manifest.name, options);
  const bundleDir = manifest.bundle.dir;
  if (!bundleDir || bundleDir.trim() === "") {
    throw new Error(`Invalid bundle directory for source "${manifest.name}".`);
  }
  if (path7.isAbsolute(bundleDir)) return path7.normalize(bundleDir);
  const resolved = path7.resolve(sourceDir, bundleDir);
  if (resolved === sourceDir || !isInsideOrEqual(sourceDir, resolved)) {
    throw new Error(
      `Invalid bundle directory for source "${manifest.name}". Relative bundle paths must stay inside the source directory.`
    );
  }
  return resolved;
}
async function writeSourceManifest(manifest, options = {}) {
  const sourceDir = resolveSourceDir(manifest.name, options);
  await writeStableJson(path7.join(sourceDir, "source.json"), manifest);
}
async function readSourceManifest(name, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  const manifest = validateSourceManifest(
    await readJson(path7.join(sourceDir, "source.json")),
    name
  );
  if (manifest.name !== name) {
    throw new Error(`Source manifest name mismatch: expected "${name}", found "${manifest.name}".`);
  }
  return manifest;
}
async function writeRefreshState(name, state, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  await writeStableJson(path7.join(sourceDir, "state.json"), state);
}
async function readRefreshState(name, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  return validateRefreshState(await readJson(path7.join(sourceDir, "state.json")), name);
}
async function listSources(options = {}) {
  const sourcesRoot = resolveSourcesRoot(options);
  let entries;
  try {
    entries = await fs4.readdir(sourcesRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = await readSourceManifest(entry.name, options);
    } catch (error) {
      records.push(invalidSourceRecord(sourcesRoot, entry.name, error));
      continue;
    }
    const dir = resolveSourceDir(manifest.name, options);
    let state;
    let loadError;
    try {
      state = await readRefreshStateIfExists(entry.name, options);
    } catch (error) {
      loadError = errorDetails(error);
    }
    let bundleDir;
    try {
      bundleDir = resolveBundleDir(manifest, options);
    } catch (error) {
      bundleDir = path7.join(dir, "bundle");
      loadError ??= errorDetails(error);
    }
    records.push({
      name: manifest.name,
      dir,
      manifest,
      state,
      bundleDir,
      loadError
    });
  }
  return records.sort((first, second) => first.name.localeCompare(second.name));
}
async function removeSource(name, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  await fs4.rm(sourceDir, { recursive: true, force: true });
}
function resolveSourcesRoot(options) {
  return path7.join(resolveOkfyHome(options), "sources");
}
function invalidSourceRecord(sourcesRoot, name, error) {
  const dir = path7.join(sourcesRoot, name);
  const sourceName = fallbackSourceName(name);
  return {
    name: sourceName,
    dir,
    manifest: fallbackSourceManifest(sourceName),
    bundleDir: path7.join(dir, "bundle"),
    loadError: errorDetails(error, name)
  };
}
function fallbackSourceManifest(name) {
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    okfyVersion: "unknown",
    name,
    kind: "website",
    createdAt: timestamp,
    updatedAt: timestamp,
    source: {
      seedUrl: ""
    },
    crawl: {
      maxPages: 0,
      maxDepth: 0,
      include: [],
      exclude: [],
      sameOrigin: true,
      respectRobots: true,
      concurrency: 1,
      allowPrivateNetwork: false
    },
    refresh: {
      mode: "off",
      maxAgeSeconds: 0,
      minIntervalSeconds: 0
    },
    bundle: {
      dir: "bundle"
    }
  };
}
function fallbackSourceName(name) {
  try {
    return validateSourceName(name);
  } catch {
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return `invalid-${shortHash(name)}${slug ? `-${slug}` : ""}`;
  }
}
function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function errorDetails(error, sourceDirName) {
  const withSourceDir = (details) => ({
    ...details,
    ...sourceDirName && sourceDirName !== fallbackSourceName(sourceDirName) ? { sourceDirName } : {}
  });
  if (error instanceof Error) {
    const details = { message: error.message };
    if (isNodeError(error) && error.code) details.code = error.code;
    return withSourceDir(details);
  }
  return withSourceDir({ message: String(error) });
}
function validateSourceManifest(value, expectedName) {
  if (!isPlainObject(value))
    throw new Error(`Invalid source manifest for "${expectedName}": expected object.`);
  const name = requiredString(value, "name", expectedName);
  validateSourceName(name);
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid source manifest for "${expectedName}": schemaVersion must be 1.`);
  }
  if (value.kind !== "website") {
    throw new Error(`Invalid source manifest for "${expectedName}": kind must be "website".`);
  }
  const source = requiredObject(value, "source", expectedName);
  const crawl = requiredObject(value, "crawl", expectedName);
  const refresh = requiredObject(value, "refresh", expectedName);
  const bundle = requiredObject(value, "bundle", expectedName);
  const mode = requiredString(refresh, "mode", expectedName, "refresh");
  if (!["off", "stale-while-refresh", "blocking"].includes(mode)) {
    throw new Error(`Invalid source manifest for "${expectedName}": refresh.mode is invalid.`);
  }
  return {
    schemaVersion: 1,
    okfyVersion: requiredString(value, "okfyVersion", expectedName),
    name,
    kind: "website",
    createdAt: requiredString(value, "createdAt", expectedName),
    updatedAt: requiredString(value, "updatedAt", expectedName),
    source: {
      seedUrl: requiredString(source, "seedUrl", expectedName, "source")
    },
    crawl: {
      maxPages: requiredNumber(crawl, "maxPages", expectedName, "crawl"),
      maxDepth: requiredNumber(crawl, "maxDepth", expectedName, "crawl"),
      include: requiredStringArray(crawl, "include", expectedName, "crawl"),
      exclude: requiredStringArray(crawl, "exclude", expectedName, "crawl"),
      sameOrigin: requiredBoolean(crawl, "sameOrigin", expectedName, "crawl"),
      respectRobots: requiredBoolean(crawl, "respectRobots", expectedName, "crawl"),
      concurrency: requiredNumber(crawl, "concurrency", expectedName, "crawl"),
      allowPrivateNetwork: requiredBoolean(crawl, "allowPrivateNetwork", expectedName, "crawl")
    },
    refresh: {
      mode,
      maxAgeSeconds: requiredNumber(refresh, "maxAgeSeconds", expectedName, "refresh"),
      minIntervalSeconds: requiredNumber(refresh, "minIntervalSeconds", expectedName, "refresh")
    },
    bundle: {
      dir: requiredString(bundle, "dir", expectedName, "bundle")
    }
  };
}
function validateRefreshState(value, sourceName) {
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": expected object.`);
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid refresh state for "${sourceName}": schemaVersion must be 1.`);
  }
  const status = stateString(value, "status", sourceName);
  if (!["missing", "fresh", "stale", "refreshing", "failed"].includes(status)) {
    throw new Error(`Invalid refresh state for "${sourceName}": status is invalid.`);
  }
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: stateNullableString(value, "lastCheckedAt", sourceName),
    lastRefreshStartedAt: stateNullableString(value, "lastRefreshStartedAt", sourceName),
    lastRefreshCompletedAt: stateNullableString(value, "lastRefreshCompletedAt", sourceName),
    lastSuccessfulRefreshAt: stateNullableString(value, "lastSuccessfulRefreshAt", sourceName),
    nextRefreshAllowedAt: stateNullableString(value, "nextRefreshAllowedAt", sourceName),
    refreshInProgress: stateBoolean(value, "refreshInProgress", sourceName),
    lastError: validateRefreshError(value.lastError, sourceName),
    bundle: validateRefreshBundle(value.bundle, sourceName)
  };
}
function validateRefreshError(value, sourceName) {
  if (value === null) return null;
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": lastError must be object or null.`);
  const details = {
    ...value,
    message: stateString(value, "message", sourceName, "lastError")
  };
  for (const key of ["code", "sourceName", "seedUrl", "occurredAt"]) {
    const found = value[key];
    if (found !== void 0 && typeof found !== "string") {
      throw invalidStateField(sourceName, key, "string", "lastError");
    }
  }
  return details;
}
function validateRefreshBundle(value, sourceName) {
  if (value === null) return null;
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": bundle must be object or null.`);
  return {
    conceptCount: stateNumber(value, "conceptCount", sourceName, "bundle"),
    warningCount: stateNumber(value, "warningCount", sourceName, "bundle"),
    valid: stateBoolean(value, "valid", sourceName, "bundle"),
    contentHash: stateString(value, "contentHash", sourceName, "bundle")
  };
}
function requiredObject(value, key, sourceName, prefix) {
  const found = value[key];
  if (!isPlainObject(found)) throw invalidManifestField(sourceName, key, "object", prefix);
  return found;
}
function requiredString(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidManifestField(sourceName, key, "non-empty string", prefix);
  }
  return found;
}
function requiredNumber(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "number" || !Number.isFinite(found)) {
    throw invalidManifestField(sourceName, key, "number", prefix);
  }
  return found;
}
function requiredBoolean(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "boolean") throw invalidManifestField(sourceName, key, "boolean", prefix);
  return found;
}
function requiredStringArray(value, key, sourceName, prefix) {
  const found = value[key];
  if (!Array.isArray(found) || !found.every((item) => typeof item === "string")) {
    throw invalidManifestField(sourceName, key, "string array", prefix);
  }
  return found;
}
function invalidManifestField(sourceName, key, expected, prefix) {
  return new Error(
    `Invalid source manifest for "${sourceName}": ${prefix ? `${prefix}.` : ""}${key} must be ${expected}.`
  );
}
function stateString(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidStateField(sourceName, key, "non-empty string", prefix);
  }
  return found;
}
function stateNullableString(value, key, sourceName) {
  const found = value[key];
  if (found === null) return null;
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidStateField(sourceName, key, "string or null");
  }
  return found;
}
function stateNumber(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "number" || !Number.isFinite(found)) {
    throw invalidStateField(sourceName, key, "number", prefix);
  }
  return found;
}
function stateBoolean(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "boolean") throw invalidStateField(sourceName, key, "boolean", prefix);
  return found;
}
function invalidStateField(sourceName, key, expected, prefix) {
  return new Error(
    `Invalid refresh state for "${sourceName}": ${prefix ? `${prefix}.` : ""}${key} must be ${expected}.`
  );
}
async function readRefreshStateIfExists(name, options) {
  try {
    return await readRefreshState(name, options);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function readJson(filePath) {
  return JSON.parse(await fs4.readFile(filePath, "utf8"));
}
async function writeStableJson(filePath, value) {
  await fs4.mkdir(path7.dirname(filePath), { recursive: true });
  await fs4.writeFile(filePath, `${JSON.stringify(orderJson(value), null, 2)}
`, "utf8");
}
function orderJson(value) {
  if (Array.isArray(value)) return value.map(orderJson);
  if (!isPlainObject(value)) return value;
  const ordered = {};
  for (const key of orderKeys(value)) {
    ordered[key] = orderJson(value[key]);
  }
  return ordered;
}
function orderKeys(value) {
  if ("status" in value) return sortByPreferredOrder(Object.keys(value), STATE_KEYS);
  if ("okfyVersion" in value) return sortByPreferredOrder(Object.keys(value), MANIFEST_KEYS);
  if (hasKeys(value, CRAWL_KEYS)) return sortByPreferredOrder(Object.keys(value), CRAWL_KEYS);
  if (hasKeys(value, REFRESH_KEYS)) return sortByPreferredOrder(Object.keys(value), REFRESH_KEYS);
  if (hasKeys(value, STATE_BUNDLE_KEYS))
    return sortByPreferredOrder(Object.keys(value), STATE_BUNDLE_KEYS);
  if ("seedUrl" in value) return sortByPreferredOrder(Object.keys(value), ["seedUrl"]);
  if ("dir" in value) return sortByPreferredOrder(Object.keys(value), ["dir"]);
  return Object.keys(value).sort((first, second) => first.localeCompare(second));
}
function hasKeys(value, keys) {
  return keys.some((key) => key in value);
}
function sortByPreferredOrder(keys, preferredOrder) {
  return keys.sort((first, second) => {
    const firstIndex = preferredOrder.indexOf(first);
    const secondIndex = preferredOrder.indexOf(second);
    if (firstIndex === -1 && secondIndex === -1) return first.localeCompare(second);
    if (firstIndex === -1) return 1;
    if (secondIndex === -1) return -1;
    return firstIndex - secondIndex;
  });
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isInsideOrEqual(parent, child) {
  const relative = path7.relative(parent, child);
  return relative === "" || !relative.startsWith("..") && !path7.isAbsolute(relative);
}
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

// src/workspace.ts
import fs5 from "fs/promises";
import path8 from "path";
import { pathToFileURL } from "url";
function bundleSourceName(bundleDir) {
  const baseName = path8.basename(path8.resolve(bundleDir));
  const candidate = baseName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  return validateSourceName(candidate || "bundle");
}
function localBundleRecord(bundleDir) {
  const resolved = path8.resolve(bundleDir);
  const name = bundleSourceName(resolved);
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    name,
    dir: resolved,
    bundleDir: resolved,
    manifest: {
      schemaVersion: 1,
      okfyVersion: packageVersion(),
      name,
      kind: "local",
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        seedUrl: pathToFileURL(resolved).href
      },
      crawl: {
        maxPages: 0,
        maxDepth: 0,
        include: [],
        exclude: [],
        sameOrigin: true,
        respectRobots: true,
        concurrency: 1,
        allowPrivateNetwork: false
      },
      refresh: {
        mode: "off",
        maxAgeSeconds: 0,
        minIntervalSeconds: 0
      },
      bundle: {
        dir: resolved
      }
    }
  };
}
function assertUniqueWorkspaceRecordNames(records) {
  const seen = /* @__PURE__ */ new Set();
  for (const record of records) {
    if (seen.has(record.name))
      throw new Error(
        `Duplicate workspace source "${record.name}". Rename one bundle directory or source.`
      );
    seen.add(record.name);
  }
}
function isRegisteredWorkspaceRecord(record) {
  return record.manifest.kind === "website";
}
var WorkspaceError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
  code;
  details;
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...this.details
    };
  }
};
function workspaceProfilePath(name, options = {}) {
  return path8.join(resolveOkfyHome(options), "workspaces", `${validateSourceName(name)}.json`);
}
async function readWorkspaceProfile(name, options = {}) {
  const profile = JSON.parse(
    await fs5.readFile(workspaceProfilePath(name, options), "utf8")
  );
  validateWorkspaceProfile(profile, name);
  return profile;
}
async function writeWorkspaceProfile(profile, options = {}) {
  validateWorkspaceProfile(profile);
  const filePath = workspaceProfilePath(profile.name, options);
  await fs5.mkdir(path8.dirname(filePath), { recursive: true });
  await fs5.writeFile(filePath, `${JSON.stringify(profile, null, 2)}
`, "utf8");
}
async function resolveWorkspaceSources(selection, options = {}) {
  const hasNames = Boolean(selection.names?.length);
  const modeCount = Number(hasNames) + Number(Boolean(selection.all)) + Number(Boolean(selection.profile)) + Number(Boolean(selection.profileName));
  if (modeCount > 1) {
    throw new Error(
      "Choose one workspace source selection: explicit source names, --all, or one workspace profile."
    );
  }
  let names = selection.names ?? [];
  let workspaceName;
  if (selection.profileName) {
    const profile = await readWorkspaceProfile(selection.profileName, options);
    names = profile.sources;
    workspaceName = profile.name;
  } else if (selection.profile) {
    validateWorkspaceProfile(selection.profile);
    names = selection.profile.sources;
    workspaceName = selection.profile.name;
  }
  if (selection.all) {
    const records2 = await listSources(options);
    if (!records2.length)
      throw new WorkspaceError("no_sources", "No registered sources found for --all.");
    return { records: records2, sourceNames: records2.map((record) => record.name) };
  }
  if (!names.length)
    throw new WorkspaceError("no_sources", "Select at least one registered source.");
  assertUniqueSourceNames(names);
  const records = await Promise.all(names.map((name) => readSourceRecord(name, options)));
  return { records, sourceNames: records.map((record) => record.name), workspaceName };
}
var WorkspaceSearch = class _WorkspaceSearch {
  sources;
  selectedNames;
  availableNames;
  constructor(sources, options = {}) {
    if (!sources.length) throw new WorkspaceError("no_sources", "Workspace contains no sources.");
    assertUniqueSourceNames(sources.map((source) => source.record.name));
    this.sources = [...sources];
    this.selectedNames = new Set(sources.map((source) => source.record.name));
    this.availableNames = /* @__PURE__ */ new Set([...options.availableSourceNames ?? [], ...this.selectedNames]);
  }
  static async fromSourceRecords(records, options = {}) {
    const sources = await Promise.all(
      records.map(async (record) => ({
        record,
        bundleDir: record.bundleDir,
        search: await BundleSearch.fromBundle(record.bundleDir)
      }))
    );
    return new _WorkspaceSearch(sources, options);
  }
  search(query, options = {}) {
    const limit = options.limit ?? 10;
    const sources = this.usableSources(options.source);
    return sources.flatMap(
      (source) => source.search.search(query, { type: options.type, tags: options.tags, limit: Math.max(limit, 50) }).map((result) => this.withSourceResult(source, result))
    ).sort(
      (first, second) => second.score - first.score || first.sourceName.localeCompare(second.sourceName) || first.id.localeCompare(second.id)
    ).slice(0, limit);
  }
  getConcept(input) {
    const sources = input.source ? this.usableSources(input.source) : this.sourcesWithSearch();
    const matches = sources.map((source) => ({ source, concept: source.search.getConcept(input.id) })).filter(
      (row) => Boolean(row.concept)
    );
    if (matches.length === 0) {
      throw new WorkspaceError("unknown_concept", `No concept found for ${input.id}`, {
        id: input.id,
        source: input.source
      });
    }
    if (!input.source && matches.length > 1) {
      throw new WorkspaceError(
        "ambiguous_concept",
        `Concept id "${input.id}" exists in multiple workspace sources.`,
        {
          id: input.id,
          candidates: matches.map(({ source, concept }) => this.conceptCandidate(source, concept))
        }
      );
    }
    return matches[0];
  }
  listTypes(source) {
    return this.distribution(source, (concept) => [concept.type]);
  }
  listTags(source) {
    return this.distribution(source, (concept) => concept.tags);
  }
  sourceNames() {
    return this.sources.map((source) => source.record.name);
  }
  usableSourceNames() {
    return this.sourcesWithSearch().map((source) => source.record.name);
  }
  distribution(sourceName, values) {
    const distribution = {};
    for (const source of this.usableSources(sourceName)) {
      for (const concept of source.search.graph.concepts.values()) {
        for (const value of values(concept)) distribution[value] = (distribution[value] ?? 0) + 1;
      }
    }
    return Object.fromEntries(
      Object.entries(distribution).sort(([first], [second]) => first.localeCompare(second))
    );
  }
  usableSources(sourceName) {
    const sources = sourceName ? [this.sourceByName(sourceName)] : this.sources;
    const usable = sources.filter(
      (source) => Boolean(source.search)
    );
    if (!usable.length) {
      throw new WorkspaceError(
        "no_usable_sources",
        "No usable OKF bundle is available in this workspace.",
        {
          source: sourceName,
          sources: sources.map((source) => source.record.name)
        }
      );
    }
    return usable;
  }
  sourcesWithSearch() {
    return this.sources.filter((source) => Boolean(source.search));
  }
  sourceByName(sourceName) {
    if (this.selectedNames.has(sourceName)) {
      return this.sources.find((source) => source.record.name === sourceName);
    }
    if (this.availableNames.has(sourceName)) {
      throw new WorkspaceError(
        "source_not_in_workspace",
        `Source "${sourceName}" is not selected in this workspace.`,
        {
          source: sourceName,
          workspaceSources: [...this.selectedNames]
        }
      );
    }
    throw new WorkspaceError("unknown_source", `Unknown source "${sourceName}".`, {
      source: sourceName
    });
  }
  withSourceResult(source, result) {
    return {
      ...result,
      sourceName: source.record.name,
      sourceKind: source.record.manifest.kind,
      seedUrl: source.record.manifest.source.seedUrl,
      ref: `${source.record.name}:${result.id}`
    };
  }
  conceptCandidate(source, concept) {
    return {
      sourceName: source.record.name,
      sourceKind: source.record.manifest.kind,
      seedUrl: source.record.manifest.source.seedUrl,
      id: concept.id,
      ref: `${source.record.name}:${concept.id}`,
      title: concept.title,
      type: concept.type,
      resource: concept.resource
    };
  }
};
function validateWorkspaceProfile(profile, expectedName) {
  if (profile.schemaVersion !== 1) throw new Error("Workspace profile schemaVersion must be 1.");
  validateSourceName(profile.name);
  if (expectedName && profile.name !== expectedName) {
    throw new Error(
      `Workspace profile name mismatch: expected "${expectedName}", found "${profile.name}".`
    );
  }
  if (!Array.isArray(profile.sources) || profile.sources.length === 0) {
    throw new Error(`Workspace profile "${profile.name}" must list at least one source.`);
  }
  for (const source of profile.sources) validateSourceName(source);
  assertUniqueSourceNames(profile.sources);
}
function assertUniqueSourceNames(names) {
  const seen = /* @__PURE__ */ new Set();
  for (const name of names) {
    validateSourceName(name);
    if (seen.has(name))
      throw new WorkspaceError("duplicate_source", `Duplicate workspace source "${name}".`, {
        source: name
      });
    seen.add(name);
  }
}
async function readSourceRecord(name, options) {
  const manifest = await readSourceManifest(name, options);
  return {
    name: manifest.name,
    dir: resolveSourceDir(manifest.name, options),
    manifest,
    state: await readRefreshStateIfExists2(manifest.name, options),
    bundleDir: resolveBundleDir(manifest, options)
  };
}
async function readRefreshStateIfExists2(name, options) {
  try {
    return await readRefreshState(name, options);
  } catch (error) {
    if (isNodeError2(error) && error.code === "ENOENT") return void 0;
    throw error;
  }
}
function isNodeError2(error) {
  return error instanceof Error && "code" in error;
}

// src/mcp.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
var MCP_TOOL_NAMES = [
  "search_concepts",
  "read_concept",
  "get_neighbors",
  "list_types",
  "list_tags",
  "bundle_summary"
];
var [
  SEARCH_CONCEPTS_TOOL,
  READ_CONCEPT_TOOL,
  GET_NEIGHBORS_TOOL,
  LIST_TYPES_TOOL,
  LIST_TAGS_TOOL,
  BUNDLE_SUMMARY_TOOL
] = MCP_TOOL_NAMES;
var REFRESHABLE_TOOL_NAMES = new Set(
  MCP_TOOL_NAMES.filter((tool) => tool !== BUNDLE_SUMMARY_TOOL)
);
function json(value, maxChars = 12e3) {
  let text = JSON.stringify(value, null, 2);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}
...truncated`;
  return { content: [{ type: "text", text }] };
}
var searchSchema = z.object({
  query: z.string(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional()
});
var readSchema = z.object({ id: z.string(), max_chars: z.number().int().positive().optional() });
var neighborsSchema = z.object({
  id: z.string(),
  depth: z.number().int().min(1).max(2).optional()
});
var sourceFilterSchema = z.object({ source: z.string().optional() });
var workspaceSearchSchema = searchSchema.extend({ source: z.string().optional() });
var workspaceReadSchema = readSchema.extend({ source: z.string().optional() });
var workspaceNeighborsSchema = neighborsSchema.extend({ source: z.string().optional() });
function errorDetails2(error) {
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const record = error;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Refresh failed."
    };
  }
  return { message: "Refresh failed." };
}
function nullableErrorDetails(error) {
  if (error === void 0 || error === null) return null;
  return errorDetails2(error);
}
function normalizeFreshness(state) {
  return {
    freshnessStatus: state?.freshnessStatus ?? state?.status,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastRefreshError: nullableErrorDetails(state?.lastRefreshError ?? state?.lastError),
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null
  };
}
function shouldRefresh(status, hasSearch) {
  if (!hasSearch) return status !== "fresh";
  return status === "stale" || status === "missing" || status === "failed";
}
function refreshableTool(name) {
  return REFRESHABLE_TOOL_NAMES.has(name);
}
async function createMcpServer(options) {
  let activeBundleDir = options.bundleDir;
  let search = options.search;
  let observedFreshness;
  let lastRefreshError = null;
  let inFlightRefresh;
  if (!search) {
    try {
      search = await BundleSearch.fromBundle(activeBundleDir);
    } catch (error) {
      if (!options.source) throw error;
      lastRefreshError = errorDetails2(error);
    }
  }
  const server = new Server(
    { name: options.name ?? "okfy", version: packageVersion() },
    { capabilities: { tools: {} } }
  );
  const maxResultChars = options.maxResultChars ?? 12e3;
  const refreshMode = () => options.refresh?.mode ?? (options.source ? "stale-while-refresh" : "off");
  async function getFreshness() {
    if (options.refresh?.getFreshness) {
      observedFreshness = await options.refresh.getFreshness();
      return observedFreshness;
    }
    observedFreshness ??= {
      freshnessStatus: search ? "fresh" : "missing",
      refreshInProgress: false,
      lastRefreshError: null
    };
    return observedFreshness;
  }
  function sourceSummaryFields() {
    if (!options.source) return {};
    const normalized = normalizeFreshness(observedFreshness);
    const lastError = lastRefreshError ?? normalized.lastRefreshError;
    const status = lastError ? "failed" : normalized.freshnessStatus ?? (search ? "fresh" : "missing");
    return {
      sourceName: options.source.name,
      sourceKind: options.source.kind,
      seedUrl: options.source.seedUrl,
      freshnessStatus: status,
      lastSuccessfulRefreshAt: normalized.lastSuccessfulRefreshAt,
      refreshInProgress: Boolean(inFlightRefresh) || normalized.refreshInProgress,
      lastRefreshError: lastError,
      nextRefreshAllowedAt: normalized.nextRefreshAllowedAt
    };
  }
  function bundleUnavailable() {
    const details = lastRefreshError ?? errorDetails2("No OKF bundle is available.");
    return json(
      {
        error: {
          code: "bundle_unavailable",
          message: details.message,
          sourceName: options.source?.name,
          seedUrl: options.source?.seedUrl,
          lastRefreshError: details
        }
      },
      maxResultChars
    );
  }
  function startRefresh(mode, freshness) {
    if (!options.refresh?.refreshIfNeeded) return void 0;
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = (async () => {
      try {
        const result = await options.refresh?.refreshIfNeeded?.({
          mode,
          bundleDir: activeBundleDir,
          source: options.source,
          freshness
        });
        if (result?.freshness) observedFreshness = result.freshness;
        const nextBundleDir = result?.bundleDir ?? activeBundleDir;
        const nextSearch = await BundleSearch.fromBundle(nextBundleDir);
        activeBundleDir = nextBundleDir;
        search = nextSearch;
        lastRefreshError = null;
      } catch (error) {
        lastRefreshError = errorDetails2(error);
      } finally {
        inFlightRefresh = void 0;
      }
    })();
    return inFlightRefresh;
  }
  async function prepareBundleForTool(toolName) {
    const mode = refreshMode();
    if (mode === "off" || !refreshableTool(toolName)) return;
    const freshness = await getFreshness();
    const normalized = normalizeFreshness(freshness);
    if (!shouldRefresh(normalized.freshnessStatus, Boolean(search))) return;
    const refresh = startRefresh(mode, freshness);
    if (!refresh) return;
    if (mode === "blocking" || !search) await refresh;
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: SEARCH_CONCEPTS_TOOL,
        description: "Search OKF concepts by query, type, and tags.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "number", default: 10 }
          },
          required: ["query"]
        }
      },
      {
        name: READ_CONCEPT_TOOL,
        description: "Read one OKF concept by id or path.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, max_chars: { type: "number" } },
          required: ["id"]
        }
      },
      {
        name: GET_NEIGHBORS_TOOL,
        description: "Return outbound links and backlinks for a concept.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, depth: { type: "number", default: 1 } },
          required: ["id"]
        }
      },
      {
        name: LIST_TYPES_TOOL,
        description: "List concept types and counts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: LIST_TAGS_TOOL,
        description: "List concept tags and counts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: BUNDLE_SUMMARY_TOOL,
        description: "Return bundle stats and validation status.",
        inputSchema: { type: "object", properties: {} }
      }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      if (request.params.name === BUNDLE_SUMMARY_TOOL && options.source) await getFreshness();
      await prepareBundleForTool(request.params.name);
      if (request.params.name === SEARCH_CONCEPTS_TOOL) {
        if (!search) return bundleUnavailable();
        const parsed = searchSchema.parse(args);
        return json(search.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === READ_CONCEPT_TOOL) {
        if (!search) return bundleUnavailable();
        const parsed = readSchema.parse(args);
        const concept = search.getConcept(parsed.id);
        if (!concept)
          return json({
            error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` }
          });
        const max = parsed.max_chars ?? maxResultChars;
        return json(
          {
            frontmatter: concept.frontmatter,
            markdown_body: concept.body.slice(0, max),
            outbound_links: search.graph.outbound.get(concept.id) ?? [],
            backlinks: search.graph.backlinks.get(concept.id) ?? [],
            source_resource: concept.resource
          },
          maxResultChars
        );
      }
      if (request.params.name === GET_NEIGHBORS_TOOL) {
        if (!search) return bundleUnavailable();
        const currentSearch = search;
        const parsed = neighborsSchema.parse(args);
        const root = currentSearch.getConcept(parsed.id);
        if (!root)
          return json({
            error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` }
          });
        const depth = parsed.depth ?? 1;
        const seen = /* @__PURE__ */ new Set([root.id]);
        let frontier = [root.id];
        const edges = [];
        for (let level = 0; level < depth; level += 1) {
          const next = [];
          for (const id of frontier) {
            for (const to of currentSearch.graph.outbound.get(id) ?? []) {
              edges.push({
                from: id,
                to,
                direction: "outbound",
                relationship_text: "Markdown link"
              });
              if (!seen.has(to)) next.push(to);
              seen.add(to);
            }
            for (const from of currentSearch.graph.backlinks.get(id) ?? []) {
              edges.push({ from, to: id, direction: "backlink", relationship_text: "Backlink" });
              if (!seen.has(from)) next.push(from);
              seen.add(from);
            }
          }
          frontier = next;
        }
        return json({
          root: root.id,
          concepts: [...seen].map((id) => {
            const concept = currentSearch.graph.concepts.get(id);
            return { id, title: concept?.title, type: concept?.type, resource: concept?.resource };
          }),
          edges
        });
      }
      if (request.params.name === LIST_TYPES_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.typeDistribution);
      }
      if (request.params.name === LIST_TAGS_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.tagDistribution);
      }
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        if (!search) return bundleUnavailable();
        const [stats, validation] = await Promise.all([
          inspectBundle(activeBundleDir),
          validateBundle(activeBundleDir)
        ]);
        return json({
          ...stats,
          reservedFileCount: validation.reservedFileCount,
          warningCount: validation.warningCount,
          validationStatus: validation.valid ? "valid" : "invalid",
          validationIssues: validation.issues,
          ...sourceSummaryFields()
        });
      }
      return json({
        error: { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` }
      });
    } catch (error) {
      return json({ error: { code: "tool_error", message: error?.message ?? "Tool failed." } });
    }
  });
  return server;
}
async function createWorkspaceMcpServer(options) {
  const maxResultChars = options.maxResultChars ?? 12e3;
  const runtimes = await Promise.all(
    options.sources.map(async (source) => {
      const runtime = {
        record: source.record,
        activeBundleDir: source.record.bundleDir,
        search: source.search,
        lastRefreshError: source.record.loadError ? errorDetails2(source.record.loadError) : null,
        refresh: source.refresh
      };
      if (!runtime.search) {
        try {
          runtime.search = await BundleSearch.fromBundle(runtime.activeBundleDir);
        } catch (error) {
          runtime.lastRefreshError ??= errorDetails2(error);
        }
      }
      return runtime;
    })
  );
  const selectedNames = new Set(runtimes.map((runtime) => runtime.record.name));
  const availableNames = /* @__PURE__ */ new Set([...options.availableSourceNames ?? [], ...selectedNames]);
  const server = new Server(
    { name: options.name ?? "okfy", version: packageVersion() },
    { capabilities: { tools: {} } }
  );
  function runtimeForSource(sourceName) {
    if (selectedNames.has(sourceName))
      return runtimes.find((runtime) => runtime.record.name === sourceName);
    if (availableNames.has(sourceName)) {
      throw new WorkspaceError(
        "source_not_in_workspace",
        `Source "${sourceName}" is not selected in this workspace.`,
        {
          source: sourceName,
          workspaceSources: [...selectedNames]
        }
      );
    }
    throw new WorkspaceError("unknown_source", `Unknown source "${sourceName}".`, {
      source: sourceName
    });
  }
  function workspaceSearch() {
    return new WorkspaceSearch(
      runtimes.map(
        (runtime) => ({
          record: runtime.record,
          bundleDir: runtime.activeBundleDir,
          search: runtime.search,
          loadError: runtime.lastRefreshError
        })
      ),
      { availableSourceNames: [...availableNames] }
    );
  }
  async function getRuntimeFreshness(runtime) {
    if (runtime.record.loadError) {
      const freshness = runtime.observedFreshness ?? {
        freshnessStatus: "failed",
        refreshInProgress: false,
        lastRefreshError: errorDetails2(runtime.record.loadError)
      };
      runtime.observedFreshness = freshness;
      return freshness;
    }
    if (runtime.refresh?.getFreshness) {
      runtime.observedFreshness = await runtime.refresh.getFreshness();
      return runtime.observedFreshness;
    }
    runtime.observedFreshness ??= {
      freshnessStatus: runtime.search ? "fresh" : "missing",
      refreshInProgress: false,
      lastRefreshError: null
    };
    return runtime.observedFreshness;
  }
  function runtimeRefreshMode(runtime) {
    return runtime.refresh?.mode ?? "stale-while-refresh";
  }
  function sourceSummaryFields(runtime) {
    const normalized = normalizeFreshness(runtime.observedFreshness);
    const lastError = runtime.lastRefreshError ?? normalized.lastRefreshError;
    const refreshing = Boolean(runtime.inFlightRefresh) || normalized.refreshInProgress;
    const status = refreshing ? "refreshing" : lastError ? "failed" : normalized.freshnessStatus ?? (runtime.search ? "fresh" : "missing");
    return {
      sourceName: runtime.record.name,
      sourceKind: runtime.record.manifest.kind,
      seedUrl: runtime.record.manifest.source.seedUrl,
      freshnessStatus: status,
      lastSuccessfulRefreshAt: normalized.lastSuccessfulRefreshAt,
      refreshInProgress: refreshing,
      lastRefreshError: lastError,
      nextRefreshAllowedAt: normalized.nextRefreshAllowedAt
    };
  }
  function startRuntimeRefresh(runtime, mode, freshness) {
    if (!runtime.refresh?.refreshIfNeeded) return void 0;
    if (runtime.inFlightRefresh) return runtime.inFlightRefresh;
    runtime.inFlightRefresh = (async () => {
      try {
        const result = await runtime.refresh?.refreshIfNeeded?.({
          mode,
          bundleDir: runtime.activeBundleDir,
          source: {
            name: runtime.record.name,
            kind: runtime.record.manifest.kind,
            seedUrl: runtime.record.manifest.source.seedUrl
          },
          freshness
        });
        if (result?.freshness) runtime.observedFreshness = result.freshness;
        const nextBundleDir = result?.bundleDir ?? runtime.activeBundleDir;
        runtime.search = await BundleSearch.fromBundle(nextBundleDir);
        runtime.activeBundleDir = nextBundleDir;
        runtime.lastRefreshError = null;
      } catch (error) {
        runtime.lastRefreshError = errorDetails2(error);
      } finally {
        runtime.inFlightRefresh = void 0;
      }
    })();
    return runtime.inFlightRefresh;
  }
  async function prepareRuntime(runtime, toolName, sourceFiltered, workspaceHadUsableSource) {
    try {
      const mode = runtimeRefreshMode(runtime);
      if (mode === "off" || !refreshableTool(toolName)) return;
      const freshness = await getRuntimeFreshness(runtime);
      const normalized = normalizeFreshness(freshness);
      if (!shouldRefresh(normalized.freshnessStatus, Boolean(runtime.search))) return;
      const refresh = startRuntimeRefresh(runtime, mode, freshness);
      if (!refresh) return;
      const shouldAwait = sourceFiltered ? mode === "blocking" || !runtime.search : !workspaceHadUsableSource && !runtime.search;
      if (shouldAwait) await refresh;
    } catch (error) {
      runtime.lastRefreshError = errorDetails2(error);
    }
  }
  async function prepareWorkspaceForTool(toolName, sourceName) {
    if (!refreshableTool(toolName)) return;
    const selected = sourceName ? [runtimeForSource(sourceName)] : runtimes;
    const workspaceHadUsableSource = selected.some((runtime) => runtime.search);
    await Promise.all(
      selected.map(
        (runtime) => prepareRuntime(runtime, toolName, Boolean(sourceName), workspaceHadUsableSource)
      )
    );
  }
  function workspaceUnavailable() {
    return json(
      {
        error: {
          code: "bundle_unavailable",
          message: "No usable OKF bundle is available in this workspace.",
          sources: runtimes.map((runtime) => ({
            sourceName: runtime.record.name,
            seedUrl: runtime.record.manifest.source.seedUrl,
            lastRefreshError: runtime.lastRefreshError
          }))
        }
      },
      maxResultChars
    );
  }
  function sourceUnavailable(runtime) {
    const details = runtime.lastRefreshError ?? errorDetails2("No OKF bundle is available for this source.");
    return json(
      {
        error: {
          code: "bundle_unavailable",
          message: details.message,
          sourceName: runtime.record.name,
          seedUrl: runtime.record.manifest.source.seedUrl,
          lastRefreshError: details
        }
      },
      maxResultChars
    );
  }
  async function sourceSummary(runtime) {
    try {
      await getRuntimeFreshness(runtime);
    } catch (error) {
      runtime.lastRefreshError = errorDetails2(error);
    }
    const freshness = sourceSummaryFields(runtime);
    if (!runtime.search) {
      return unavailableSourceSummary(runtime);
    }
    let stats;
    let validation;
    try {
      [stats, validation] = await Promise.all([
        inspectBundle(runtime.activeBundleDir),
        validateBundle(runtime.activeBundleDir)
      ]);
    } catch (error) {
      runtime.lastRefreshError = errorDetails2(error);
      return unavailableSourceSummary(runtime);
    }
    return {
      ...freshness,
      bundleDir: runtime.activeBundleDir,
      conceptCount: stats.conceptCount,
      reservedFileCount: validation.reservedFileCount,
      warningCount: validation.warningCount,
      validationStatus: validation.valid ? "valid" : "invalid",
      validationIssues: validation.issues,
      typeDistribution: stats.typeDistribution,
      tagDistribution: stats.tagDistribution,
      linkCount: stats.linkCount,
      brokenLinks: stats.brokenLinks,
      orphanConcepts: stats.orphanConcepts,
      sourceDomains: stats.sourceDomains
    };
  }
  function unavailableSourceSummary(runtime) {
    return {
      ...sourceSummaryFields(runtime),
      bundleDir: runtime.activeBundleDir,
      conceptCount: runtime.search?.graph.concepts.size ?? runtime.record.state?.bundle?.conceptCount ?? 0,
      reservedFileCount: 0,
      warningCount: runtime.record.state?.bundle?.warningCount ?? 0,
      validationStatus: "unavailable",
      validationIssues: []
    };
  }
  async function workspaceSummary(sourceName) {
    const selected = sourceName ? [runtimeForSource(sourceName)] : runtimes;
    const sources = await Promise.all(selected.map(sourceSummary));
    const usableSourceCount = selected.filter((runtime) => runtime.search).length;
    const conceptCount = sources.reduce((sum2, source) => sum2 + numberField(source.conceptCount), 0);
    const reservedFileCount = sources.reduce(
      (sum2, source) => sum2 + numberField(source.reservedFileCount),
      0
    );
    const warningCount = sources.reduce((sum2, source) => sum2 + numberField(source.warningCount), 0);
    let typeDistribution = {};
    let tagDistribution = {};
    try {
      const workspace = workspaceSearch();
      typeDistribution = workspace.listTypes(sourceName);
      tagDistribution = workspace.listTags(sourceName);
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "no_usable_sources") throw error;
    }
    return {
      workspace: true,
      sourceCount: selected.length,
      usableSourceCount,
      conceptCount,
      reservedFileCount,
      warningCount,
      validationStatus: sources.some((source) => source.validationStatus !== "valid") ? "invalid" : "valid",
      typeDistribution,
      tagDistribution,
      sources
    };
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: SEARCH_CONCEPTS_TOOL,
        description: "Search workspace OKF concepts by query, source, type, and tags.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            source: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "number", default: 10 }
          },
          required: ["query"]
        }
      },
      {
        name: READ_CONCEPT_TOOL,
        description: "Read one workspace OKF concept by source and id. Id-only reads work when the id is unique.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string" },
            id: { type: "string" },
            max_chars: { type: "number" }
          },
          required: ["id"]
        }
      },
      {
        name: GET_NEIGHBORS_TOOL,
        description: "Return outbound links and backlinks for a workspace concept.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string" },
            id: { type: "string" },
            depth: { type: "number", default: 1 }
          },
          required: ["id"]
        }
      },
      {
        name: LIST_TYPES_TOOL,
        description: "List workspace concept types and counts.",
        inputSchema: { type: "object", properties: { source: { type: "string" } } }
      },
      {
        name: LIST_TAGS_TOOL,
        description: "List workspace concept tags and counts.",
        inputSchema: { type: "object", properties: { source: { type: "string" } } }
      },
      {
        name: BUNDLE_SUMMARY_TOOL,
        description: "Return workspace stats, per-source validation, and freshness status.",
        inputSchema: { type: "object", properties: { source: { type: "string" } } }
      }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      const sourceName = sourceFilterSchema.partial().parse(args).source;
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        return json(await workspaceSummary(sourceName), maxResultChars);
      }
      await prepareWorkspaceForTool(request.params.name, sourceName);
      if (sourceName) {
        const runtime = runtimeForSource(sourceName);
        if (!runtime.search) return sourceUnavailable(runtime);
      }
      const workspace = workspaceSearch();
      if (workspace.usableSourceNames().length === 0) return workspaceUnavailable();
      if (request.params.name === SEARCH_CONCEPTS_TOOL) {
        const parsed = workspaceSearchSchema.parse(args);
        return json(workspace.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === READ_CONCEPT_TOOL) {
        const parsed = workspaceReadSchema.parse(args);
        const { source, concept } = workspace.getConcept(parsed);
        const max = parsed.max_chars ?? maxResultChars;
        return json(
          {
            sourceName: source.record.name,
            sourceKind: source.record.manifest.kind,
            seedUrl: source.record.manifest.source.seedUrl,
            ref: `${source.record.name}:${concept.id}`,
            frontmatter: concept.frontmatter,
            markdown_body: concept.body.slice(0, max),
            outbound_links: source.search.graph.outbound.get(concept.id) ?? [],
            backlinks: source.search.graph.backlinks.get(concept.id) ?? [],
            source_resource: concept.resource
          },
          maxResultChars
        );
      }
      if (request.params.name === GET_NEIGHBORS_TOOL) {
        const parsed = workspaceNeighborsSchema.parse(args);
        const { source, concept: root } = workspace.getConcept(parsed);
        const currentSearch = source.search;
        const depth = parsed.depth ?? 1;
        const seen = /* @__PURE__ */ new Set([root.id]);
        let frontier = [root.id];
        const edges = [];
        for (let level = 0; level < depth; level += 1) {
          const next = [];
          for (const id of frontier) {
            for (const to of currentSearch.graph.outbound.get(id) ?? []) {
              edges.push({
                from: id,
                to,
                direction: "outbound",
                relationship_text: "Markdown link",
                sourceName: source.record.name
              });
              if (!seen.has(to)) next.push(to);
              seen.add(to);
            }
            for (const from of currentSearch.graph.backlinks.get(id) ?? []) {
              edges.push({
                from,
                to: id,
                direction: "backlink",
                relationship_text: "Backlink",
                sourceName: source.record.name
              });
              if (!seen.has(from)) next.push(from);
              seen.add(from);
            }
          }
          frontier = next;
        }
        return json({
          sourceName: source.record.name,
          sourceKind: source.record.manifest.kind,
          seedUrl: source.record.manifest.source.seedUrl,
          root: root.id,
          ref: `${source.record.name}:${root.id}`,
          concepts: [...seen].map((id) => {
            const concept = currentSearch.graph.concepts.get(id);
            return {
              sourceName: source.record.name,
              id,
              ref: `${source.record.name}:${id}`,
              title: concept?.title,
              type: concept?.type,
              resource: concept?.resource
            };
          }),
          edges
        });
      }
      if (request.params.name === LIST_TYPES_TOOL) {
        const parsed = sourceFilterSchema.parse(args);
        return json(workspace.listTypes(parsed.source), maxResultChars);
      }
      if (request.params.name === LIST_TAGS_TOOL) {
        const parsed = sourceFilterSchema.parse(args);
        return json(workspace.listTags(parsed.source), maxResultChars);
      }
      return json({
        error: { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` }
      });
    } catch (error) {
      if (error instanceof WorkspaceError) return json({ error: error.toJSON() }, maxResultChars);
      return json(
        { error: { code: "tool_error", message: error?.message ?? "Tool failed." } },
        maxResultChars
      );
    }
  });
  return server;
}
function numberField(value) {
  return typeof value === "number" ? value : 0;
}
async function serveMcpStdio(options) {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
async function serveWorkspaceMcpStdio(options) {
  const server = await createWorkspaceMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// src/setup.ts
import fs6 from "fs/promises";
import path9 from "path";
import { spawn } from "child_process";
var EXPECTED_MCP_TOOLS = [...MCP_TOOL_NAMES];
var MAX_CAPTURE_CHARS = 64e3;
var MAX_DIAGNOSTIC_CHARS = 1e3;
var MAX_MESSAGES = 100;
function parseSetupClient(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude-code" || normalized === "claude") return "claude-code";
  if (normalized === "claude-desktop" || normalized === "cursor" || normalized === "mcp-json" || normalized === "desktop") {
    return "mcp-json";
  }
  if (normalized === "codex") return "codex";
  if (normalized === "generic" || normalized === "json") return "generic";
  throw new Error(
    `Invalid setup client "${value}". Use claude-code, claude-desktop, cursor, codex, or generic.`
  );
}
function defaultOkfyHome() {
  return resolveOkfyHome({ env: { OKFY_HOME: "" } });
}
function setupStatus(checks) {
  if (checks.some((check) => check.severity === "fail")) return "failed";
  if (checks.some((check) => check.severity === "warn")) return "warning";
  return "ready";
}
function createSetupReport(input) {
  const okfyHome = path9.resolve(input.okfyHome ?? resolveOkfyHome());
  const defaultHome = defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const workspace = Boolean(input.workspaceAll) || sourceNames.length > 1;
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true } : sourceNames;
  const serverName = mcpServerName(serverIdentity);
  const codexServerName = codexMcpServerName(serverIdentity);
  const command = serveCommand(commandTarget, okfyHome, defaultHome);
  return {
    sourceName: input.workspaceAll && sourceNames.length === 0 ? "--all" : sourceNames.join(", "),
    sourceNames,
    workspace,
    workspaceAll: Boolean(input.workspaceAll),
    client: input.client,
    serverName,
    codexServerName,
    okfyHome,
    defaultOkfyHome: defaultHome,
    command,
    artifacts: renderClientArtifacts({
      client: input.client,
      sourceNames,
      workspaceAll: input.workspaceAll,
      okfyHome,
      defaultOkfyHome: defaultHome
    }),
    firstPrompt: firstAgentPrompt(input.client === "codex" ? codexServerName : serverName, {
      workspace
    }),
    checks: input.checks,
    status: setupStatus(input.checks)
  };
}
function renderClientArtifacts(input) {
  const okfyHome = path9.resolve(input.okfyHome ?? resolveOkfyHome());
  const defaultHome = input.defaultOkfyHome ?? defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true } : sourceNames;
  const serverName = mcpServerName(serverIdentity);
  const codexName = codexMcpServerName(serverIdentity);
  const command = serveCommand(commandTarget, okfyHome, defaultHome);
  return renderMcpClientArtifacts({
    client: input.client,
    serverName,
    codexServerName: codexName,
    command
  });
}
function renderMcpClientArtifacts(input) {
  const env = Object.keys(input.command.env).length ? input.command.env : void 0;
  if (input.client === "claude-code") {
    return [
      {
        client: input.client,
        label: "Claude Code",
        format: "shell",
        body: `claude mcp add --transport stdio${shellEnvArgs(input.command.env, "-e")} ${input.serverName} -- ${input.command.display}`
      }
    ];
  }
  if (input.client === "codex") {
    return [
      {
        client: input.client,
        label: "Codex config.toml",
        format: "toml",
        body: codexToml(input.codexServerName, input.command, env)
      },
      {
        client: input.client,
        label: "Codex CLI",
        format: "shell",
        body: `codex mcp add${shellEnvArgs(input.command.env, "--env")} ${input.codexServerName} -- ${input.command.display}`
      }
    ];
  }
  const label = input.client === "mcp-json" ? "Claude Desktop / Cursor mcpServers JSON" : "Generic mcpServers JSON";
  return [
    {
      client: input.client,
      label,
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [input.serverName]: {
              command: input.command.command,
              args: input.command.args,
              ...env ? { env } : {}
            }
          }
        },
        null,
        2
      )
    }
  ];
}
function firstAgentPrompt(serverName, options = {}) {
  if (options.workspace) {
    return `Use the ${serverName} MCP server. Start with bundle_summary to understand the workspace sources and freshness. Filter by source when you know which docs apply, search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
  }
  return `Use the ${serverName} MCP server. Start with bundle_summary to understand the bundle and freshness. Search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
}
function serveCommand(sourceNameOrNames, okfyHome, defaultHome = defaultOkfyHome(), options = {}) {
  const args = ["-y", "okfy-ai", ...serveCommandArgs(sourceNameOrNames, options)];
  const env = needsOkfyHomeEnv(okfyHome, defaultHome) ? { OKFY_HOME: path9.resolve(okfyHome) } : {};
  return {
    command: "npx",
    args,
    env,
    display: ["npx", ...args].join(" ")
  };
}
function serveCommandArgs(sourceNameOrNames, options = {}) {
  const autoRefresh = options.autoRefresh ?? true;
  if (isAllCommandTarget(sourceNameOrNames)) {
    return autoRefresh ? ["serve", "--all", "--mcp", "--auto-refresh"] : ["serve", "--all", "--mcp"];
  }
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  if (sourceNames.some((sourceName) => sourceName.startsWith("-"))) {
    return autoRefresh ? ["serve", "--mcp", "--auto-refresh", "--", ...sourceNames] : ["serve", "--mcp", "--", ...sourceNames];
  }
  return autoRefresh ? ["serve", ...sourceNames, "--mcp", "--auto-refresh"] : ["serve", ...sourceNames, "--mcp"];
}
function isAllCommandTarget(sourceNameOrNames) {
  return typeof sourceNameOrNames === "object" && !Array.isArray(sourceNameOrNames) && sourceNameOrNames.all;
}
function setupCheck(id, label, severity, message, fix) {
  return { id, label, severity, message, ...fix ? { fix } : {} };
}
async function executableOnPath(command, env = process.env) {
  const searchPath = env.PATH ?? "";
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const directory of searchPath.split(path9.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path9.join(directory, `${command}${extension}`);
      try {
        await fs6.access(candidate, fs6.constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}
function evaluateMcpProbeMessages(messages) {
  const toolsResponse = messages.find((message) => message.id === 2);
  const tools = toolsResponse?.result?.tools?.map((tool) => tool.name).filter((name) => Boolean(name)) ?? [];
  const missingTools = EXPECTED_MCP_TOOLS.filter((tool) => !tools.includes(tool));
  return { ok: missingTools.length === 0, tools, missingTools };
}
async function probeMcpStdio(options) {
  const child = spawn(options.command, options.args, {
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  return probeChildProcess(child, options.timeoutMs ?? 5e3);
}
async function probeChildProcess(child, timeoutMs) {
  const messages = [];
  let stdoutBuffer = "";
  let stderr = "";
  let contamination;
  let spawnError;
  let exit;
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdin.on("error", (error) => {
    spawnError ??= error;
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer = appendBounded(stdoutBuffer, chunk.toString("utf8"));
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          if (messages.length >= MAX_MESSAGES)
            contamination = `MCP stdout exceeded ${MAX_MESSAGES} JSON-RPC messages.`;
          else messages.push(JSON.parse(line));
        } catch {
          contamination = line;
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
    if (stdoutBuffer.length >= MAX_CAPTURE_CHARS)
      contamination = `MCP stdout line exceeded ${MAX_CAPTURE_CHARS} characters.`;
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString("utf8"));
  });
  const send = (id, method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}
`);
  };
  try {
    send(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "okfy-doctor", version: packageVersion() }
    });
    await waitForMessage(
      1,
      messages,
      () => contamination,
      () => spawnError,
      () => exit,
      () => stderr,
      timeoutMs
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}
`
    );
    send(2, "tools/list");
    await waitForMessage(
      2,
      messages,
      () => contamination,
      () => spawnError,
      () => exit,
      () => stderr,
      timeoutMs
    );
    const result = evaluateMcpProbeMessages(messages);
    if (!result.ok) {
      return {
        ok: false,
        tools: result.tools,
        stderr,
        error: {
          code: "missing_tools",
          message: `MCP server did not expose expected tools: ${result.missingTools.join(", ")}.`
        }
      };
    }
    return { ok: true, tools: result.tools, stderr };
  } catch (error) {
    if (error instanceof ProbeFailure) {
      return { ok: false, tools: [], stderr, error: { code: error.code, message: error.message } };
    }
    return {
      ok: false,
      tools: [],
      stderr,
      error: {
        code: "protocol_error",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    await stopChild(child, closed, () => exit);
  }
}
var ProbeFailure = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
async function waitForMessage(id, messages, contamination, spawnError, childExit, capturedStderr, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const badLine = contamination();
    if (badLine)
      throw new ProbeFailure(
        "stdout_contamination",
        `MCP stdout contained non-JSON output: ${badLine}`
      );
    const error = spawnError();
    if (error) throw new ProbeFailure("startup_failed", error.message);
    const message = messages.find((candidate) => candidate.id === id);
    if (message) return message;
    const exit = childExit();
    if (exit) {
      const details = capturedStderr() ? ` stderr: ${truncate(capturedStderr())}` : "";
      throw new ProbeFailure(
        "startup_failed",
        `MCP subprocess exited before response ${id} (${formatExit(exit)}).${details}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new ProbeFailure("timeout", `Timed out waiting for MCP response ${id}.`);
}
async function stopChild(child, closed, childExit) {
  try {
    if (!child.stdin.destroyed) child.stdin.end();
  } catch {
  }
  if (childExit()) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 500))
  ]);
  if (!exited && !childExit()) child.kill("SIGKILL");
}
function appendBounded(current, addition) {
  const next = current + addition;
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}
function truncate(value) {
  const normalized = value.trim();
  if (normalized.length <= MAX_DIAGNOSTIC_CHARS) return normalized;
  return `${normalized.slice(0, MAX_DIAGNOSTIC_CHARS)}...truncated`;
}
function formatExit(exit) {
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit code ${exit.code ?? "unknown"}`;
}
function needsOkfyHomeEnv(okfyHome, defaultHome) {
  return path9.resolve(okfyHome) !== path9.resolve(defaultHome);
}
function mcpServerName(sourceNameOrNames) {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames.map((sourceName) => sourceName.replace(/[._]+/g, "-").replace(/^-+/, "")).filter(Boolean).join("-");
  return `${safeName || "source"}-okf`;
}
function codexMcpServerName(sourceNameOrNames) {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames.map((sourceName) => sourceName.replace(/[^a-z0-9]+/g, "_").replace(/^_+/, "")).filter(Boolean).join("_");
  return `${safeName || "source"}_okf`;
}
function setupSourceNames(input) {
  const names = input.sourceNames ?? (input.sourceName ? [input.sourceName] : []);
  if (input.workspaceAll) return [...names];
  if (!names.length) throw new Error("Setup report requires at least one source name.");
  return [...names];
}
function shellEnvArgs(env, flag) {
  const entries = Object.entries(env);
  if (!entries.length) return "";
  return entries.map(([key, value]) => ` ${flag} ${shellQuote(`${key}=${value}`)}`).join("");
}
function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function codexToml(serverName, command, env) {
  const lines = [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(command.command)}`,
    `args = [${command.args.map((arg) => JSON.stringify(arg)).join(", ")}]`
  ];
  if (env?.OKFY_HOME) lines.push(`env = { OKFY_HOME = ${JSON.stringify(env.OKFY_HOME)} }`);
  lines.push("startup_timeout_sec = 20", "tool_timeout_sec = 60", "enabled = true");
  return lines.join("\n");
}

// src/normalize.ts
import * as cheerio from "cheerio";
import TurndownService from "turndown";
var turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  bulletListMarker: "-"
});
turndown.keep(["table"]);
function extractHeadings(markdown) {
  return [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    depth: match[1]?.length ?? 1,
    text: (match[2] ?? "").trim(),
    slug: safeSegment(match[2] ?? "")
  }));
}
function extractMarkdownLinks(markdown) {
  return [...markdown.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => ({
    text: match[1] ?? "",
    href: match[2] ?? ""
  }));
}
function inferType(title, sourceId, markdown) {
  const haystack = `${title} ${sourceId} ${markdown.slice(0, 2e3)}`.toLowerCase();
  if (/\breadme\b/.test(haystack)) return "README";
  if (/\b(api|reference|sdk|endpoint|parameter|request|response)\b/.test(haystack)) return "API Reference";
  if (/\b(quickstart|guide|tutorial|walkthrough|get started)\b/.test(haystack)) return "Guide";
  if (/\bdocs?\b/.test(haystack)) return "Documentation Page";
  return "Concept";
}
function inferTags(title, sourceId, headings) {
  const raw = `${sourceId} ${title} ${headings.slice(0, 3).map((h) => h.text).join(" ")}`;
  const words = raw.toLowerCase().replace(/https?:\/\/[^/]+/g, "").split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && word.length <= 24).filter((word) => !["html", "markdown", "index", "docs", "page", "guide"].includes(word));
  return [...new Set(words)].slice(0, 6);
}
function titleFromMarkdown(markdown, fallback) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return plainTitle(heading);
  return fallback;
}
function plainTitle(title) {
  return title.replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/[`*_#]/g, "").replace(/\s+/g, " ").trim();
}
function fallbackTitle(sourceId) {
  const leaf = sourceId.split(/[/?#]/).filter(Boolean).pop() ?? "Index";
  return leaf.replace(/\.[a-z0-9]+$/i, "").split(/[-_\s]+/).filter(Boolean).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}
function normalizeDocument(raw) {
  let markdown = raw.raw;
  let title = fallbackTitle(raw.url ?? raw.filePath ?? raw.sourceId);
  if (raw.contentType === "html") {
    const $ = cheerio.load(raw.raw);
    $("script,style,noscript,svg,header,footer,nav,aside").remove();
    title = $("h1").first().text().trim() || $("title").first().text().trim() || title;
    const main = $("main, article, [role='main'], .markdown-body, .docs-content").first();
    const html = (main.length ? main : $("body")).html() ?? raw.raw;
    markdown = turndown.turndown(html).trim();
  } else if (raw.contentType === "text") {
    markdown = `# ${title}

\`\`\`text
${raw.raw.trim()}
\`\`\``;
  }
  markdown = markdown.replace(/\r\n/g, "\n").trim();
  title = titleFromMarkdown(markdown, plainTitle(title)).replace(/\s+/g, " ").trim();
  const headings = extractHeadings(markdown);
  const links = extractMarkdownLinks(markdown);
  const sourceId = raw.url ?? raw.filePath ?? raw.sourceId;
  return {
    sourceId,
    title,
    markdown,
    resource: raw.url,
    sourcePath: raw.filePath,
    headings,
    links,
    tags: inferTags(title, sourceId, headings),
    type: inferType(title, sourceId, markdown)
  };
}
function descriptionFromMarkdown(markdown) {
  const text = markdown.replace(/^---[\s\S]*?---\s*/m, "").replace(/^#{1,6}\s+.+$/gm, "").replace(/```[\s\S]*?```/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*_>#-]/g, "").replace(/\s+/g, " ").trim();
  return text.slice(0, 180) || "Generated OKF concept.";
}

// src/writer.ts
import fs7 from "fs/promises";
import os2 from "os";
import path10 from "path";

// src/util/url.ts
import dns from "dns/promises";
import net from "net";
var TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_/i];
function canonicalizeUrl(input, base) {
  const url = new URL(input, base);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/" && url.pathname.endsWith("/") && !input.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}
function sameOrigin(a, b) {
  const left = new URL(a);
  const right = new URL(b);
  return left.origin === right.origin;
}
function isHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function isPrivateIpv4Parts(parts) {
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a >= 224;
}
function mappedIpv4PartsFromIpv6(host) {
  const dotted = host.match(/^(?:::|0:0:0:0:0:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (dotted) {
    const parts = dotted.split(".").map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return parts;
  }
  const hex = host.match(/^(?:::|0:0:0:0:0:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return void 0;
  const high = Number.parseInt(hex[1] ?? "", 16);
  const low = Number.parseInt(hex[2] ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 65535 || low < 0 || low > 65535) {
    return void 0;
  }
  return [high >> 8, high & 255, low >> 8, low & 255];
}
function isPrivateNetworkUrl(input) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::" || host === "::1" || host.startsWith("fe80:")) return true;
  const ipKind = net.isIP(host);
  if (ipKind === 4) {
    const parts = host.split(".").map(Number);
    return isPrivateIpv4Parts(parts);
  }
  if (ipKind === 6) {
    const mappedIpv4Parts = mappedIpv4PartsFromIpv6(host);
    if (mappedIpv4Parts) return isPrivateIpv4Parts(mappedIpv4Parts);
    return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  return false;
}
async function resolvesToPrivateNetwork(input) {
  if (isPrivateNetworkUrl(input)) return true;
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host)) return false;
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  return records.some((record) => {
    const host2 = record.address.includes(":") ? `[${record.address}]` : record.address;
    return isPrivateNetworkUrl(`${url.protocol}//${host2}`);
  });
}
async function assertPublicNetworkUrl(input) {
  if (await resolvesToPrivateNetwork(input)) {
    throw new Error("Private network crawl target rejected. Use --allow-private-network for trusted local fixtures.");
  }
}

// src/writer.ts
function yamlScalar(value) {
  return JSON.stringify(value);
}
function frontmatter(doc, timestamp) {
  const lines = [
    "---",
    `type: ${yamlScalar(doc.type)}`,
    `title: ${yamlScalar(doc.title)}`,
    `description: ${yamlScalar(descriptionFromMarkdown(doc.markdown))}`,
    `resource: ${yamlScalar(doc.resource ?? doc.sourcePath ?? doc.sourceId)}`,
    "tags:",
    ...doc.tags.length ? doc.tags.map((tag) => `  - ${yamlScalar(tag)}`) : ["  []"],
    `timestamp: ${yamlScalar(timestamp)}`,
    "---",
    ""
  ];
  return lines.join("\n");
}
function withTitle(title, markdown) {
  const trimmed = markdown.trim();
  if (trimmed.match(/^#\s+/)) return trimmed;
  return `# ${title}

${trimmed}`;
}
function sourceKey(doc) {
  if (doc.resource) return canonicalizeUrl(doc.resource);
  return toPosixPath(doc.sourcePath ?? doc.sourceId);
}
function assignOutputPaths(docs) {
  const used = /* @__PURE__ */ new Set();
  const result = /* @__PURE__ */ new Map();
  for (const doc of docs) {
    const base = safeConceptOutputPath(
      doc.resource ? urlToOutputPath(doc.resource) : ensureMarkdownPath(doc.sourcePath ?? doc.sourceId)
    );
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
      const parsed = path10.posix.parse(base);
      candidate = path10.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    }
    used.add(candidate);
    result.set(sourceKey(doc), candidate);
    doc.outputPath = candidate;
  }
  return result;
}
function safeConceptOutputPath(candidate) {
  if (!isReservedOkfPath(candidate)) return candidate;
  const parsed = path10.posix.parse(candidate);
  const safeName = parsed.name.toLowerCase() === "log" ? "change-log" : parsed.dir ? "overview" : "home";
  return path10.posix.join(parsed.dir, `${safeName}.md`);
}
function rewriteLinks(doc, sourceToOutput) {
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
        path10.posix.normalize(path10.posix.join(path10.posix.dirname(doc.sourcePath), href))
      );
      const noHash = abs.split("#")[0] ?? abs;
      const target = sourceToOutput.get(noHash);
      if (target && doc.outputPath)
        return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
    }
    return full;
  });
}
async function pathExists(target) {
  try {
    await fs7.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function resolveForSafety(target) {
  const resolved = path10.resolve(target);
  if (await pathExists(resolved)) return fs7.realpath(resolved);
  const missingSegments = [path10.basename(resolved)];
  let ancestor = path10.dirname(resolved);
  while (!await pathExists(ancestor)) {
    const parent = path10.dirname(ancestor);
    if (parent === ancestor)
      throw new Error(`Unable to resolve output path ancestor for ${target}.`);
    missingSegments.unshift(path10.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = await fs7.realpath(ancestor);
  return path10.join(realAncestor, ...missingSegments);
}
async function assertNoCwdSymlinkAncestor(target) {
  const cwd = path10.resolve(process.cwd());
  const resolved = path10.resolve(target);
  const relative = path10.relative(cwd, resolved);
  if (relative === "" || relative.startsWith("..") || path10.isAbsolute(relative)) return;
  let current = cwd;
  for (const segment of relative.split(path10.sep).filter(Boolean)) {
    current = path10.join(current, segment);
    let stat;
    try {
      stat = await fs7.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ancestor ${current}.`);
    }
  }
}
async function findRepoRoot(start) {
  let current = path10.resolve(start);
  while (true) {
    if (await pathExists(path10.join(current, ".git"))) return fs7.realpath(current);
    const parent = path10.dirname(current);
    if (parent === current) return void 0;
    current = parent;
  }
}
async function assertSafeForceOutDir(outDir, options) {
  if (options.dangerouslyAllowUnsafeOutput) return;
  if (outDir.trim() === "") throw new Error("Unsafe output directory for --force: empty path.");
  const rawResolved = path10.resolve(outDir);
  const existing = await pathExists(rawResolved);
  if (existing) {
    const stat = await fs7.lstat(rawResolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ${outDir}.`);
    }
  }
  await assertNoCwdSymlinkAncestor(outDir);
  const realOutDir = await resolveForSafety(outDir);
  const forbidden = /* @__PURE__ */ new Map([
    [path10.parse(realOutDir).root, "filesystem root"],
    [await fs7.realpath(os2.homedir()), "home directory"],
    [await fs7.realpath(process.cwd()), "current working directory"]
  ]);
  const repoRoot = await findRepoRoot(process.cwd());
  if (repoRoot) forbidden.set(repoRoot, "repository root");
  if (options.inputPath) {
    const inputReal = await resolveForSafety(options.inputPath);
    forbidden.set(inputReal, "input path");
    forbidden.set(path10.dirname(inputReal), "parent of input path");
  }
  const reason = forbidden.get(realOutDir);
  if (reason)
    throw new Error(
      `Unsafe output directory for --force: refusing to delete ${reason} (${realOutDir}).`
    );
}
async function ensureCleanOutDir(outDir, options) {
  if (options.force) await assertSafeForceOutDir(outDir, options);
  try {
    const entries = await fs7.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(`Output directory is not empty: ${outDir}. Use --force to overwrite.`);
      await fs7.rm(outDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs7.mkdir(outDir, { recursive: true });
}
function titleForPath(relPath, fallback) {
  const basename = path10.posix.basename(relPath, ".md");
  return fallback || basename;
}
function markdownLink(fromDir, toPath) {
  if (fromDir === ".") return toPath;
  return path10.posix.relative(fromDir, toPath);
}
function indexTitle(dir, options) {
  if (dir === ".") return options.title ?? options.sourceName ?? "OKF Bundle";
  const leaf = path10.posix.basename(dir);
  return leaf.split(/[-_\s]+/).filter(Boolean).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}
async function writePlainIndex(outDir, dir, concepts, options) {
  const indexPath = dir === "." ? "index.md" : path10.posix.join(dir, "index.md");
  const entries = (dir === "." ? concepts : concepts.filter((concept) => path10.posix.dirname(concept.relPath) === dir)).slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
  const lines = [
    `# ${indexTitle(dir, options)}`,
    "",
    ...entries.map(
      (concept) => `* [${concept.title}](${markdownLink(dir, concept.relPath)}) - ${concept.description}`
    )
  ];
  await fs7.mkdir(path10.dirname(path10.join(outDir, indexPath)), { recursive: true });
  await fs7.writeFile(path10.join(outDir, indexPath), `${lines.join("\n").trimEnd()}
`, "utf8");
  return indexPath;
}
async function writeOkfBundle(docs, options) {
  if (docs.length === 0) throw new Error("No documents to write.");
  await ensureCleanOutDir(options.outDir, options);
  const timestamp = options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const orderedDocs = docs.slice().sort((first, second) => sourceKey(first).localeCompare(sourceKey(second)));
  const sourceToOutput = assignOutputPaths(orderedDocs);
  const written = [];
  const concepts = [];
  for (const doc of orderedDocs) {
    const relPath = doc.outputPath ?? "index.md";
    const absolute = path10.join(options.outDir, relPath);
    await fs7.mkdir(path10.dirname(absolute), { recursive: true });
    const body = withTitle(doc.title, rewriteLinks(doc, sourceToOutput));
    await fs7.writeFile(absolute, `${frontmatter(doc, timestamp)}${body}
`, "utf8");
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
      concepts.map((concept) => path10.posix.dirname(concept.relPath)).filter((dir) => dir !== ".")
    )
  ].sort();
  for (const dir of dirs) {
    written.push(await writePlainIndex(options.outDir, dir, concepts, options));
  }
  return written.sort();
}

// src/activation.ts
import fs8 from "fs/promises";
import path11 from "path";
var PACKET_FILES = [
  { label: "Inspector HTML", fileName: "okfy-inspector.html" },
  { label: "Setup Markdown", fileName: "okfy-setup.md" },
  { label: "Proof JSON", fileName: "okfy-proof.json" }
];
async function buildActivationPacket(options) {
  const outDir = path11.resolve(options.outDir);
  const files = PACKET_FILES.map((file) => ({ ...file, path: path11.join(outDir, file.fileName) }));
  const usesRegistered = options.records.some(isRegisteredWorkspaceRecord) || isAllTarget(options.commandTarget);
  const okfyHome = usesRegistered ? options.okfyHome ?? process.env.OKFY_HOME ?? defaultOkfyHome() : defaultOkfyHome();
  const serverIdentity = options.serverIdentity ?? options.records.map((record) => record.name);
  const serverName = mcpServerName(serverIdentity);
  const codexServerName = codexMcpServerName(serverIdentity);
  const command = serveCommand(options.commandTarget, okfyHome, defaultOkfyHome(), {
    autoRefresh: options.autoRefresh ?? usesRegistered
  });
  const artifacts = renderMcpClientArtifacts({
    client: options.client,
    serverName,
    codexServerName,
    command
  });
  const workspace = options.report.target.kind !== "bundle";
  const firstPrompt = firstAgentPrompt(options.client === "codex" ? codexServerName : serverName, {
    workspace
  });
  const setup = {
    client: options.client,
    serverName,
    codexServerName,
    command,
    artifacts,
    firstPrompt
  };
  const proof = await buildActivationProof({
    records: options.records,
    report: options.report,
    generatedAt: options.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  });
  return {
    schemaVersion: 1,
    generatedBy: "okfy",
    outDir,
    setup,
    proof,
    files
  };
}
function withActivationMetadata(report, packet) {
  return {
    ...report,
    activation: {
      client: packet.setup.client,
      serverName: packet.setup.serverName,
      codexServerName: packet.setup.codexServerName,
      command: {
        display: packet.setup.command.display,
        env: packet.setup.command.env
      },
      firstPrompt: packet.setup.firstPrompt,
      artifacts: packet.setup.artifacts.map((artifact) => ({
        label: artifact.label,
        format: artifact.format,
        body: artifact.body
      })),
      files: packet.files.map((file) => ({ label: file.label, path: file.path }))
    }
  };
}
function renderActivationSetupMarkdown(packet) {
  const lines = [
    "# OKFY Activation Packet",
    "",
    `Status: ${packet.proof.summary.result.readiness.validationStatus}`,
    `Client: ${packet.setup.client}`,
    `Server: ${packet.setup.serverName}`,
    "",
    "## MCP Launch Command",
    "",
    "```bash",
    packet.setup.command.display,
    "```",
    ""
  ];
  if (Object.keys(packet.setup.command.env).length) {
    lines.push("Environment:", "");
    lines.push("```json", JSON.stringify(packet.setup.command.env, null, 2), "```", "");
  }
  lines.push("## Client Setup", "");
  for (const artifact of packet.setup.artifacts) {
    lines.push(`### ${artifact.label}`, "", codeFence(artifact.format), artifact.body, "```", "");
  }
  lines.push(
    "## First Prompt",
    "",
    "```text",
    packet.setup.firstPrompt,
    "```",
    "",
    "## Proof",
    "",
    `Query: ${packet.proof.search.input.query}`,
    `Search results: ${packet.proof.search.results.length}`,
    `Read concept: ${packet.proof.read?.result.ref ?? "none"}`,
    `Citation: ${packet.proof.read?.result.citation.sourceResource ?? "none"}`,
    "",
    "## Packet Files",
    ""
  );
  for (const file of packet.files) lines.push(`- ${file.label}: \`${file.path}\``);
  return `${lines.join("\n").trimEnd()}
`;
}
async function writeActivationPacketFiles(packet, contents, options = {}) {
  await ensureActivationOutDir(packet.outDir, { force: Boolean(options.force) });
  await Promise.all([
    writeFileAtomically(packet.files[0].path, contents.inspectorHtml),
    writeFileAtomically(packet.files[1].path, contents.setupMarkdown),
    writeFileAtomically(packet.files[2].path, `${JSON.stringify(packet.proof, null, 2)}
`)
  ]);
}
async function buildActivationProof(options) {
  const loaded = await loadSources(options.records);
  const primary = firstReadableConcept(loaded, options.report);
  const query = primary ? queryForConcept(primary.concept) : "documentation";
  const searchResults = primary ? searchProofResults(loaded, query, options.report) : [];
  const readTarget = primary ? conceptForSearchResult(loaded, searchResults[0], options.report) ?? primary : void 0;
  return {
    schemaVersion: 1,
    generatedBy: "okfy",
    generatedAt: options.generatedAt,
    target: options.report.target,
    summary: {
      tool: "bundle_summary",
      result: {
        title: options.report.title,
        readiness: options.report.readiness,
        sources: options.report.sources
      }
    },
    search: {
      tool: "search_concepts",
      input: {
        query,
        limit: 5,
        ...primary && options.report.target.kind !== "bundle" ? { source: primary.record.name } : {}
      },
      results: searchResults
    },
    read: readTarget ? readProof(readTarget, options.report) : null,
    neighbors: readTarget ? neighborProof(readTarget, options.report) : null
  };
}
async function loadSources(records) {
  const loaded = [];
  for (const record of records) {
    if (record.loadError) continue;
    loaded.push({ record, search: await BundleSearch.fromBundle(record.bundleDir) });
  }
  return loaded;
}
function firstReadableConcept(loaded, report) {
  for (const source of loaded) {
    const concept = [...source.search.graph.concepts.values()].sort(
      (first, second) => first.id.localeCompare(second.id)
    )[0];
    if (concept) return proofConcept(source, concept, report);
  }
  return void 0;
}
function searchProofResults(loaded, query, report) {
  return loaded.flatMap(
    (source) => source.search.search(query, { limit: 5 }).map((result) => proofSearchResult(source, result, report))
  ).sort(
    (first, second) => second.score - first.score || (first.sourceName ?? "").localeCompare(second.sourceName ?? "") || first.id.localeCompare(second.id)
  ).slice(0, 5);
}
function conceptForSearchResult(loaded, result, report) {
  if (!result) return void 0;
  const source = result.sourceName ? loaded.find((candidate) => candidate.record.name === result.sourceName) : loaded[0];
  const concept = source?.search.getConcept(result.id);
  return source && concept ? proofConcept(source, concept, report) : void 0;
}
function readProof(target, report) {
  return {
    tool: "read_concept",
    input: {
      id: target.concept.id,
      ...report.target.kind !== "bundle" ? { source: target.record.name } : {},
      max_chars: 4e3
    },
    result: {
      id: target.concept.id,
      ref: target.ref,
      title: target.concept.title,
      type: target.concept.type,
      resource: target.concept.resource,
      bodyPreview: target.concept.body.replace(/\s+/g, " ").trim().slice(0, 500),
      citation: {
        ref: target.ref,
        sourceResource: target.concept.resource,
        ...report.target.kind !== "bundle" ? { sourceName: target.record.name } : {}
      }
    }
  };
}
function neighborProof(target, report) {
  return {
    tool: "get_neighbors",
    input: {
      id: target.concept.id,
      ...report.target.kind !== "bundle" ? { source: target.record.name } : {},
      depth: 1
    },
    result: {
      outbound: (target.search.graph.outbound.get(target.concept.id) ?? []).map((id) => refFor(target.record, id, report)).sort(),
      backlinks: (target.search.graph.backlinks.get(target.concept.id) ?? []).map((id) => refFor(target.record, id, report)).sort()
    }
  };
}
function proofSearchResult(source, result, report) {
  return {
    ...report.target.kind !== "bundle" ? { sourceName: source.record.name } : {},
    id: result.id,
    ref: refFor(source.record, result.id, report),
    title: result.title,
    type: result.type,
    resource: result.resource,
    snippet: result.snippet,
    score: result.score
  };
}
function proofConcept(source, concept, report) {
  return {
    record: source.record,
    search: source.search,
    concept,
    ref: refFor(source.record, concept.id, report)
  };
}
function refFor(record, id, report) {
  return report.concepts.find((concept) => concept.sourceName === record.name && concept.id === id)?.ref ?? report.concepts.find((concept) => concept.id === id)?.ref ?? (report.target.kind === "bundle" ? id : `${record.name}:${id}`);
}
function queryForConcept(concept) {
  const candidate = concept.title ?? concept.description ?? concept.id;
  return candidate.replace(/[^A-Za-z0-9\s._-]+/g, " ").replace(/\s+/g, " ").trim() || concept.id;
}
async function ensureActivationOutDir(outDir, options) {
  if (options.force) await assertSafeForceOutDir(outDir, { outDir, force: true });
  try {
    const entries = await fs8.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(
          `Activation output directory is not empty: ${outDir}. Use --force to overwrite.`
        );
      await fs8.rm(outDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs8.mkdir(outDir, { recursive: true });
}
async function writeFileAtomically(filePath, contents) {
  const resolved = path11.resolve(filePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fs8.mkdir(path11.dirname(resolved), { recursive: true });
  try {
    await fs8.writeFile(tempPath, contents, "utf8");
    await fs8.rename(tempPath, resolved);
  } catch (error) {
    await fs8.rm(tempPath, { force: true });
    throw error;
  }
}
function codeFence(format) {
  if (format === "toml") return "```toml";
  if (format === "json") return "```json";
  return "```bash";
}
function isAllTarget(target) {
  return typeof target === "object" && !Array.isArray(target) && target.all;
}

// src/crawler.ts
import robotsParser from "robots-parser";
import pLimit from "p-limit";
import * as cheerio2 from "cheerio";

// src/util/match.ts
import { minimatch } from "minimatch";
function matchesPattern(value, pattern) {
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(value);
    } catch {
      return false;
    }
  }
  try {
    return minimatch(value, pattern, { dot: true });
  } catch {
    return false;
  }
}
function matchesAnyPattern(value, patterns) {
  return Boolean(patterns?.some((pattern) => matchesPattern(value, pattern)));
}

// src/crawler.ts
var USER_AGENT = okfyUserAgent();
var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
function isRedirect(status) {
  return status >= 300 && status < 400;
}
function isSecurityRejection(error) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Private network crawl target rejected") || message.includes("Cross-origin redirect rejected");
}
async function fetchWithRedirects(url, options, signal) {
  let current = url;
  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(current);
    if (options.sameOriginSeed && !sameOrigin(current, options.sameOriginSeed)) {
      throw new Error(`Cross-origin redirect rejected: ${current}`);
    }
    const response = await fetch(current, {
      signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/markdown,text/plain,*/*" },
      redirect: "manual"
    });
    if (!isRedirect(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect missing location for ${current}`);
    current = canonicalizeUrl(location, current);
  }
  throw new Error(`Too many redirects for ${url}`);
}
async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15e3);
  try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchWithRedirects(url, options, controller.signal);
        if (!response.ok) {
          if ((response.status >= 500 || response.status === 429) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            continue;
          }
          throw new Error(`Fetch failed ${response.status} for ${url}`);
        }
        const length = Number(response.headers.get("content-length") ?? "0");
        if (length > MAX_RESPONSE_BYTES) throw new Error(`Response too large for ${url}`);
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
          throw new Error(`Response too large for ${url}`);
        return { text, contentType: response.headers.get("content-type") ?? "" };
      } catch (error) {
        lastError = error;
        if (isSecurityRejection(error)) throw error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError ?? new Error(`Fetch failed for ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}
async function loadRobots(seedUrl, enabled) {
  if (!enabled) return void 0;
  const origin = new URL(seedUrl).origin;
  try {
    const fetched = await fetchText(`${origin}/robots.txt`, { sameOriginSeed: seedUrl });
    const text = fetched.text;
    return robotsParser(`${origin}/robots.txt`, text);
  } catch {
    return robotsParser(`${origin}/robots.txt`, "");
  }
}
function shouldVisit(url, seed, options, robots) {
  if (!isHttpUrl(url)) return false;
  if ((options.sameOrigin ?? true) && !sameOrigin(url, seed)) return false;
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(url)) return false;
  if (options.include?.length && !matchesAnyPattern(url, options.include)) return false;
  if (matchesAnyPattern(url, options.exclude)) return false;
  if (robots && !robots.isAllowed(url, USER_AGENT)) return false;
  return true;
}
function contentTypeFromHeader(header) {
  const lower = header.toLowerCase();
  if (lower.includes("text/html")) return "html";
  if (lower.includes("markdown")) return "markdown";
  if (lower.includes("text/plain")) return "text";
  if (!lower) return "html";
  return void 0;
}
function extractRawHtmlLinks(raw) {
  const $ = cheerio2.load(raw);
  return $("a[href]").map((_, element) => ({
    href: String($(element).attr("href") ?? ""),
    text: $(element).text().trim()
  })).get().filter((link) => link.href.length > 0);
}
async function crawlWebsite(options) {
  const seed = canonicalizeUrl(options.seedUrl);
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(seed)) {
    throw new Error(
      "Private network crawl target rejected. Use --allow-private-network for trusted local fixtures."
    );
  }
  if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(seed);
  const maxPages = options.maxPages ?? 100;
  const maxDepth = options.maxDepth ?? 4;
  const robots = await loadRobots(seed, options.respectRobots ?? true);
  const queue = [{ url: seed, depth: 0 }];
  const queued = /* @__PURE__ */ new Set([seed]);
  const visited = /* @__PURE__ */ new Set();
  const planned = [];
  const documents = [];
  let skipped = 0;
  let failed = 0;
  const limit = pLimit(options.concurrency ?? 4);
  options.onProgress?.({ type: "start", seed, maxPages, maxDepth });
  while (queue.length > 0 && visited.size < maxPages) {
    const batch = queue.splice(0, Math.min(queue.length, maxPages - visited.size));
    const results = await Promise.all(
      batch.map(
        (item) => limit(async () => {
          if (visited.has(item.url)) return;
          visited.add(item.url);
          if (!shouldVisit(item.url, seed, options, robots)) {
            skipped += 1;
            options.onProgress?.({
              type: "skipped",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
            return;
          }
          planned.push(item.url);
          options.onProgress?.({
            type: "fetch",
            url: item.url,
            fetched: documents.length,
            queued: queue.length,
            maxPages
          });
          try {
            const fetched = await fetchText(item.url, {
              allowPrivateNetwork: options.allowPrivateNetwork,
              sameOriginSeed: options.sameOrigin ?? true ? seed : void 0
            });
            const contentType = contentTypeFromHeader(fetched.contentType);
            if (!contentType) {
              skipped += 1;
              return;
            }
            const raw = {
              sourceId: item.url,
              url: item.url,
              contentType,
              raw: fetched.text,
              discoveredAt: options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
            };
            const doc = normalizeDocument(raw);
            if (!options.dryRun) documents.push(doc);
            let discovered = 0;
            if (item.depth < maxDepth) {
              const links = options.dryRun && contentType === "html" ? extractRawHtmlLinks(fetched.text) : doc.links;
              for (const link of links) {
                try {
                  const next = canonicalizeUrl(link.href, item.url);
                  if (!queued.has(next) && shouldVisit(next, seed, options, robots) && (options.allowPrivateNetwork || !await resolvesToPrivateNetwork(next)) && queued.size < maxPages * 4) {
                    queued.add(next);
                    queue.push({ url: next, depth: item.depth + 1 });
                    discovered += 1;
                  }
                } catch {
                  skipped += 1;
                }
              }
            }
            options.onProgress?.({
              type: "fetched",
              url: item.url,
              fetched: options.dryRun ? planned.length : documents.length,
              queued: queue.length,
              discovered,
              maxPages
            });
          } catch (error) {
            if (isSecurityRejection(error)) throw error;
            failed += 1;
            options.onProgress?.({
              type: "failed",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
          }
        })
      )
    );
    void results;
  }
  if (options.dryRun) {
    return {
      pagesFetched: planned.length,
      skipped,
      failed,
      written: [],
      documents: [],
      dryRunPages: planned.slice(0, maxPages)
    };
  }
  if (documents.length === 0) throw new Error("Crawl generated zero concepts.");
  options.onProgress?.({ type: "writing", concepts: documents.length, outDir: options.outDir });
  const written = await writeOkfBundle(documents, {
    outDir: options.outDir,
    title: options.title,
    sourceName: seed,
    force: options.force,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
  return { pagesFetched: documents.length, skipped, failed, written, documents };
}

// src/duration.ts
var DURATION_UNITS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60
};
function parseDurationSeconds(input) {
  const value = input.trim();
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use a number followed by s, m, h, or d.`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  const multiplier = DURATION_UNITS[unit];
  const seconds = amount * multiplier;
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`Invalid duration "${input}". Duration is too large.`);
  }
  return seconds;
}

// src/hash.ts
import crypto from "crypto";
import fs9 from "fs/promises";
import path12 from "path";
async function listBundleFiles(bundleDir) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs9.readdir(current, { withFileTypes: true })) {
      const absolutePath = path12.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: toPosixPath(path12.relative(bundleDir, absolutePath))
        });
      }
    }
  }
  await walk(bundleDir);
  return files.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
}
async function hashBundleContents(bundleDir) {
  const hash = crypto.createHash("sha256");
  const files = await listBundleFiles(bundleDir);
  for (const file of files) {
    const contents = await fs9.readFile(file.absolutePath);
    hash.update(`${file.relativePath.length}:${file.relativePath}\0${contents.byteLength}:`);
    hash.update(contents);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

// src/importer.ts
import fs10 from "fs/promises";
import path13 from "path";
function contentTypeFor(file) {
  const ext = path13.extname(file).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".mdx") return "mdx";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".txt") return "text";
  return void 0;
}
async function listFiles(root) {
  const stat = await fs10.stat(root);
  if (stat.isFile()) return [root];
  const files = [];
  async function walk(dir) {
    for (const entry of await fs10.readdir(dir, { withFileTypes: true })) {
      const absolute = path13.join(dir, entry.name);
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
async function importLocal(options) {
  const root = path13.resolve(options.inputPath);
  const files = await listFiles(root);
  const docs = [];
  for (const file of files) {
    const rel = path13.relative(root, file).split(path13.sep).join("/");
    if (options.include?.length && !matchesAnyPattern(rel, options.include)) continue;
    if (matchesAnyPattern(rel, options.exclude)) continue;
    const contentType = contentTypeFor(file);
    if (!contentType) continue;
    const raw = {
      sourceId: rel,
      filePath: rel,
      contentType,
      raw: await fs10.readFile(file, "utf8"),
      discoveredAt: options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
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

// src/inspector.ts
import path14 from "path";
async function buildBundleInspectorReport(bundleDir, options = {}) {
  const resolved = path14.resolve(bundleDir);
  const record = localBundleRecord(resolved);
  return buildInspectorReport([record], {
    target: { kind: "bundle", bundleDir: resolved },
    title: options.title ?? `${path14.basename(resolved)} OKFY Inspector`,
    prefixSingleSourceRefs: false
  });
}
async function buildWorkspaceInspectorReport(records, options = {}) {
  return buildInspectorReport(records, {
    target: {
      kind: "workspace",
      workspaceName: options.workspaceName,
      sourceNames: records.map((record) => record.name)
    },
    title: options.title ?? `${options.workspaceName ?? "Workspace"} OKFY Inspector`,
    prefixSingleSourceRefs: true
  });
}
async function buildInspectorReport(records, options) {
  const sourceReports = await Promise.all(
    records.map(
      (record) => sourceReport(record, {
        prefixRefs: options.prefixSingleSourceRefs || records.length > 1
      })
    )
  );
  const sources = sourceReports.map((report) => report.source);
  const concepts = sourceReports.flatMap((report) => report.concepts);
  const edges = sourceReports.flatMap((report) => report.edges);
  const readiness = summarizeReadiness(sources);
  return {
    schemaVersion: 1,
    title: options.title,
    generatedBy: "okfy",
    target: options.target,
    readiness,
    sources,
    concepts,
    edges,
    agentPreview: agentPreview(sources, concepts)
  };
}
async function sourceReport(record, options) {
  const baseSource = sourceBase(record);
  if (record.loadError) {
    return {
      source: unavailableSource(baseSource, record.loadError, record.state),
      concepts: [],
      edges: []
    };
  }
  let search;
  try {
    search = await BundleSearch.fromBundle(record.bundleDir);
  } catch (error) {
    return {
      source: unavailableSource(baseSource, error, record.state),
      concepts: [],
      edges: []
    };
  }
  const [validation, stats] = await Promise.all([
    validateBundle(record.bundleDir),
    inspectBundle(record.bundleDir)
  ]);
  const refFor2 = (id) => options.prefixRefs ? `${record.name}:${id}` : id;
  const concepts = [...search.graph.concepts.values()].sort((first, second) => first.id.localeCompare(second.id)).map((concept) => inspectorConcept(concept, search, record, refFor2, options.prefixRefs));
  return {
    source: {
      ...baseSource,
      availabilityStatus: "available",
      validationStatus: validation.valid ? "valid" : "invalid",
      conceptCount: stats.conceptCount,
      warningCount: validation.warningCount,
      brokenLinkCount: brokenLinkCount(validation.issues),
      orphanConcepts: stats.orphanConcepts.map(refFor2),
      freshnessStatus: record.state?.status ?? "fresh",
      refreshInProgress: Boolean(record.state?.refreshInProgress),
      lastSuccessfulRefreshAt: record.state?.lastSuccessfulRefreshAt ?? null,
      nextRefreshAllowedAt: record.state?.nextRefreshAllowedAt ?? null,
      lastRefreshError: normalizeError(record.state?.lastError ?? null)
    },
    concepts,
    edges: collapsedEdges(search, record.name, refFor2, options.prefixRefs)
  };
}
function inspectorConcept(concept, search, record, refFor2, includeSource) {
  const ref = refFor2(concept.id);
  return {
    id: concept.id,
    ref,
    path: concept.path,
    title: concept.title,
    type: concept.type,
    tags: [...concept.tags],
    description: concept.description,
    resource: concept.resource,
    resourceUrl: concept.resource,
    ...includeSource ? {
      sourceName: record.name,
      sourceKind: record.manifest.kind,
      seedUrl: record.manifest.source.seedUrl
    } : {},
    outbound: (search.graph.outbound.get(concept.id) ?? []).map(refFor2).sort(),
    outboundLinks: (search.graph.outbound.get(concept.id) ?? []).map(refFor2).sort(),
    backlinks: (search.graph.backlinks.get(concept.id) ?? []).map(refFor2).sort(),
    citation: {
      ref,
      conceptPath: concept.path,
      sourceResource: concept.resource,
      ...includeSource ? { sourceName: record.name } : {}
    }
  };
}
function collapsedEdges(search, sourceName, refFor2, includeSource) {
  const seen = /* @__PURE__ */ new Set();
  const edges = [];
  for (const concept of [...search.graph.concepts.values()].sort(
    (a, b) => a.id.localeCompare(b.id)
  )) {
    for (const target of search.graph.outbound.get(concept.id) ?? []) {
      const from = refFor2(concept.id);
      const to = refFor2(target);
      const key = [from, to].sort().join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from,
        to,
        kind: "internal_link",
        label: "Markdown link",
        ...includeSource ? { sourceName } : {}
      });
    }
  }
  return edges.sort(
    (first, second) => (first.sourceName ?? "").localeCompare(second.sourceName ?? "") || first.from.localeCompare(second.from) || first.to.localeCompare(second.to)
  );
}
function sourceBase(record) {
  return {
    sourceName: record.name,
    name: record.name,
    label: record.name,
    kind: record.manifest.kind,
    seedUrl: record.manifest.source.seedUrl,
    bundleDir: record.bundleDir
  };
}
function unavailableSource(baseSource, error, state) {
  return {
    ...baseSource,
    availabilityStatus: "unavailable",
    validationStatus: "unavailable",
    conceptCount: state?.bundle?.conceptCount ?? 0,
    warningCount: state?.bundle?.warningCount ?? 0,
    brokenLinkCount: 0,
    orphanConcepts: [],
    freshnessStatus: state?.status ?? "failed",
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    lastRefreshError: normalizeError(error)
  };
}
function summarizeReadiness(sources) {
  const sourceCount = sources.length;
  const usableSourceCount = sources.filter(
    (source) => source.availabilityStatus === "available"
  ).length;
  const conceptCount = sum(sources, "conceptCount");
  const warningCount = sum(sources, "warningCount");
  const brokenLinkCount2 = sum(sources, "brokenLinkCount");
  const orphanConcepts = sources.flatMap((source) => source.orphanConcepts).sort();
  const freshnessStatuses = {};
  for (const source of sources) {
    if (source.freshnessStatus) {
      freshnessStatuses[source.freshnessStatus] = (freshnessStatuses[source.freshnessStatus] ?? 0) + 1;
    }
  }
  const failedSource = sources.find((source) => source.lastRefreshError);
  return {
    availabilityStatus: usableSourceCount > 0 ? "available" : "unavailable",
    validationStatus: sources.some((source) => source.validationStatus !== "valid") ? "invalid" : "valid",
    sourceCount,
    usableSourceCount,
    conceptCount,
    warningCount,
    brokenLinkCount: brokenLinkCount2,
    brokenLinks: brokenLinkCount2,
    orphanConcepts,
    refreshInProgress: sources.some((source) => source.refreshInProgress),
    freshnessStatus: aggregateFreshnessStatus(sources),
    freshnessStatuses: Object.fromEntries(
      Object.entries(freshnessStatuses).sort(([first], [second]) => first.localeCompare(second))
    ),
    lastSuccessfulRefreshAt: latest(
      sources.map((source) => source.lastSuccessfulRefreshAt).filter(isString)
    ),
    nextRefreshAllowedAt: earliest(
      sources.map((source) => source.nextRefreshAllowedAt).filter(isString)
    ),
    lastRefreshError: failedSource?.lastRefreshError ?? null,
    sources
  };
}
function aggregateFreshnessStatus(sources) {
  const statuses = new Set(sources.map((source) => source.freshnessStatus).filter(isString));
  for (const status of ["failed", "missing", "refreshing", "stale", "fresh"]) {
    if (statuses.has(status)) return status;
  }
  return void 0;
}
function agentPreview(sources, concepts) {
  const firstConcept = concepts[0];
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const sourceHint = sources.length > 1 && firstSource ? `, "source": "${firstSource.name}"` : "";
  const readId = firstConcept?.id ?? "concept-id";
  const sequence = [
    {
      tool: "bundle_summary",
      name: "bundle_summary",
      purpose: "Start with validation, source freshness, and available concept counts.",
      example: "bundle_summary({})"
    },
    {
      tool: "search_concepts",
      name: "search_concepts",
      purpose: "Search for the docs concept that matches the task before reading.",
      example: `search_concepts({ "query": "setup"${sourceHint}, "limit": 5 })`
    },
    {
      tool: "read_concept",
      name: "read_concept",
      purpose: "Read only the selected concept and cite its source resource.",
      example: `read_concept({ "id": "${readId}"${sourceHint} })`
    },
    {
      tool: "get_neighbors",
      name: "get_neighbors",
      purpose: "Traverse outbound links and backlinks when adjacent docs matter.",
      example: `get_neighbors({ "id": "${readId}"${sourceHint}, "depth": 1 })`
    }
  ];
  return {
    sequence,
    tools: sequence.map((step) => ({ name: step.tool, purpose: step.purpose })),
    citationGuidance: sources.length > 1 ? "Use source filters when the library is known, then cite source_resource URLs from read_concept results." : "Cite source_resource URLs from read_concept results when available.",
    suggestedQuestions: suggestedQuestions(sources, concepts)
  };
}
function suggestedQuestions(sources, concepts) {
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const firstConcept = concepts[0];
  const questions = [
    firstSource ? `In ${firstSource.name}, what should I read first to get started?` : "What concepts are available in this OKF bundle?",
    firstConcept ? `Read ${firstConcept.ref} and cite the source URL.` : "Search the OKF bundle and cite the most relevant source URL.",
    "What related concepts should I inspect next with get_neighbors?"
  ];
  return [...new Set(questions)];
}
function brokenLinkCount(issues) {
  return issues.filter((issue2) => issue2.code === "broken_internal_link").length;
}
function normalizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    const details = { message: error.message };
    if ("code" in error && typeof error.code === "string") details.code = error.code;
    return details;
  }
  if (typeof error === "object") {
    const record = error;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Inspector source failed."
    };
  }
  return { message: String(error) };
}
function sum(sources, key) {
  return sources.reduce((total, source) => total + source[key], 0);
}
function latest(values) {
  return values.sort().at(-1) ?? null;
}
function earliest(values) {
  return values.sort()[0] ?? null;
}
function isString(value) {
  return typeof value === "string" && value.length > 0;
}

// src/refresh.ts
import fs11 from "fs/promises";
import path15 from "path";
import { randomUUID } from "crypto";
var DEFAULT_STALE_LOCK_TIMEOUT_MS = 30 * 60 * 1e3;
async function pathExists2(target) {
  try {
    await fs11.access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
function secondsBetween(startIso, end) {
  return (end.getTime() - new Date(startIso).getTime()) / 1e3;
}
function iso(date) {
  return date.toISOString();
}
function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1e3).toISOString();
}
function isBeforeNextRefreshAllowed(state, now) {
  if (!state?.nextRefreshAllowedAt) return false;
  return new Date(state.nextRefreshAllowedAt).getTime() > now.getTime();
}
function tempBundleDir(sourceDir) {
  return path15.join(sourceDir, `bundle.tmp-${process.pid}-${randomUUID()}`);
}
function lockfilePath(sourceDir) {
  return path15.join(sourceDir, ".refresh.lock");
}
async function isLockStale(lockPath, now, staleLockTimeoutMs) {
  try {
    const raw = await fs11.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt)) return now.getTime() - createdAt > staleLockTimeoutMs;
  } catch {
  }
  const stat = await fs11.stat(lockPath);
  return now.getTime() - stat.mtimeMs > staleLockTimeoutMs;
}
async function acquireRefreshLock(sourceDir, now, staleLockTimeoutMs) {
  const lockPath = lockfilePath(sourceDir);
  await fs11.mkdir(sourceDir, { recursive: true });
  try {
    const handle = await fs11.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: iso(now) }, null, 2));
    await handle.close();
    return {
      acquired: true,
      release: async () => {
        await fs11.rm(lockPath, { force: true });
      }
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (await isLockStale(lockPath, now, staleLockTimeoutMs)) {
    await fs11.rm(lockPath, { force: true });
    return acquireRefreshLock(sourceDir, now, staleLockTimeoutMs);
  }
  return { acquired: false };
}
function stateForRefreshStart(state, freshness, startedAt) {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? (freshness.validation ? bundleStateFromValidation(freshness.validation, state?.bundle?.contentHash ?? "") : null)
  };
}
function stateForLockedRefresh(state, checkedAt) {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}
function stateForCheckedRefresh(state, status, checkedAt) {
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: false,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}
function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}
function errorState(manifest, error, occurredAt) {
  return {
    message: messageFromError(error),
    sourceName: manifest.name,
    seedUrl: manifest.source.seedUrl,
    occurredAt: iso(occurredAt)
  };
}
function stateForRefreshFailure(state, manifest, error, startedAt) {
  return {
    schemaVersion: 1,
    status: "failed",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: iso(startedAt),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: addSeconds(startedAt, manifest.refresh.minIntervalSeconds),
    refreshInProgress: false,
    lastError: errorState(manifest, error, startedAt),
    bundle: state?.bundle ?? null
  };
}
function bundleStateFromValidation(validation, contentHash) {
  return {
    conceptCount: validation.conceptCount,
    warningCount: validation.warningCount,
    valid: validation.valid,
    contentHash
  };
}
async function replaceActiveBundle(tempDir, bundleDir) {
  await assertSafeForceOutDir(bundleDir, { outDir: bundleDir, force: true });
  const backupDir = `${bundleDir}.backup-${process.pid}-${randomUUID()}`;
  let movedActiveToBackup = false;
  try {
    await fs11.mkdir(path15.dirname(bundleDir), { recursive: true });
    if (await pathExists2(bundleDir)) {
      await fs11.rename(bundleDir, backupDir);
      movedActiveToBackup = true;
    }
    await fs11.rename(tempDir, bundleDir);
    if (movedActiveToBackup) await fs11.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (movedActiveToBackup && !await pathExists2(bundleDir) && await pathExists2(backupDir)) {
      await fs11.rename(backupDir, bundleDir);
    }
    throw error;
  }
}
async function evaluateFreshness(options) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const validateBundle2 = options.validateBundle ?? validateBundle;
  if (!await pathExists2(options.bundleDir)) {
    return { status: "missing", reason: "bundle_missing" };
  }
  if (options.state?.refreshInProgress) {
    return { status: "refreshing", reason: "refresh_in_progress" };
  }
  if ((options.state?.status === "failed" || options.state?.lastError) && isBeforeNextRefreshAllowed(options.state, now)) {
    return { status: "failed", reason: "latest_refresh_failed" };
  }
  const validation = await validateBundle2(options.bundleDir);
  if (!validation.valid) {
    return { status: "failed", reason: "bundle_invalid", validation };
  }
  if (options.state?.status === "failed" || options.state?.lastError) {
    return {
      status: isBeforeNextRefreshAllowed(options.state, now) ? "failed" : "stale",
      reason: "latest_refresh_failed",
      validation
    };
  }
  const lastSuccessfulRefreshAt = options.state?.lastSuccessfulRefreshAt;
  if (!lastSuccessfulRefreshAt) {
    return { status: "stale", reason: "never_refreshed", validation };
  }
  const maxAgeSeconds = options.maxAgeSeconds ?? options.manifest.refresh.maxAgeSeconds;
  if (secondsBetween(lastSuccessfulRefreshAt, now) > maxAgeSeconds) {
    return { status: "stale", reason: "exceeded_max_age", validation };
  }
  return { status: "fresh", reason: "within_max_age", validation };
}
async function refreshSource(options) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const crawlRunner = options.crawlRunner ?? crawlWebsite;
  const inspectBundle2 = options.inspectBundle ?? inspectBundle;
  const hashBundleContent = options.hashBundleContent ?? hashBundleContents;
  const freshness = await evaluateFreshness({
    manifest: options.manifest,
    state: options.state,
    bundleDir: options.bundleDir,
    now,
    validateBundle: options.validateBundle
  });
  if (!options.force && freshness.status === "fresh") {
    const nextState = stateForCheckedRefresh(options.state, "fresh", now);
    await options.writeState(nextState);
    return { status: "fresh", reason: "fresh", skipped: true, state: nextState };
  }
  if (!options.force && isBeforeNextRefreshAllowed(options.state, now)) {
    const nextState = stateForCheckedRefresh(options.state, freshness.status, now);
    await options.writeState(nextState);
    return { status: freshness.status, reason: "min_interval", skipped: true, state: nextState };
  }
  const tempDir = tempBundleDir(options.sourceDir);
  if (options.dryRun) {
    try {
      const crawlResult = await crawlRunner({
        ...options.manifest.crawl,
        seedUrl: options.manifest.source.seedUrl,
        outDir: tempDir,
        dryRun: true,
        timestamp: iso(now)
      });
      return { status: freshness.status, skipped: false, dryRun: true, crawlResult };
    } finally {
      await fs11.rm(tempDir, { recursive: true, force: true });
    }
  }
  const lock = await acquireRefreshLock(
    options.sourceDir,
    now,
    options.staleLockTimeoutMs ?? DEFAULT_STALE_LOCK_TIMEOUT_MS
  );
  if (!lock.acquired) {
    const lockedState = stateForLockedRefresh(options.state, now);
    await options.writeState(lockedState);
    return { status: "refreshing", reason: "locked", skipped: true, state: lockedState };
  }
  const startedState = stateForRefreshStart(options.state, freshness, now);
  await options.writeState(startedState);
  try {
    const crawlResult = await crawlRunner({
      ...options.manifest.crawl,
      seedUrl: options.manifest.source.seedUrl,
      outDir: tempDir,
      force: true,
      dryRun: false,
      timestamp: iso(now)
    });
    const validation = await (options.validateBundle ?? validateBundle)(tempDir);
    if (!validation.valid) {
      throw new Error(`Refresh generated invalid bundle for ${options.manifest.name}.`);
    }
    const inspection = await inspectBundle2(tempDir);
    const contentHash = await hashBundleContent(tempDir);
    await replaceActiveBundle(tempDir, options.bundleDir);
    const nextState = {
      schemaVersion: 1,
      status: "fresh",
      lastCheckedAt: iso(now),
      lastRefreshStartedAt: iso(now),
      lastRefreshCompletedAt: iso(now),
      lastSuccessfulRefreshAt: iso(now),
      nextRefreshAllowedAt: addSeconds(now, options.manifest.refresh.minIntervalSeconds),
      refreshInProgress: false,
      lastError: null,
      bundle: {
        conceptCount: inspection.conceptCount,
        warningCount: inspection.warningCount,
        valid: validation.valid,
        contentHash
      }
    };
    await options.writeState(nextState);
    return { status: "fresh", skipped: false, state: nextState, crawlResult };
  } catch (error) {
    await fs11.rm(tempDir, { recursive: true, force: true });
    const failedState = stateForRefreshFailure(options.state, options.manifest, error, now);
    await options.writeState(failedState);
    return {
      status: "failed",
      skipped: false,
      state: failedState,
      error: failedState.lastError ?? void 0
    };
  } finally {
    await lock.release();
  }
}

export {
  extractInternalLinks,
  buildGraph,
  readConceptFile,
  readBundle,
  BundleSearch,
  runtimePackageRoot,
  packageMetadata,
  packageVersion,
  okfyUserAgent,
  validateBundle,
  inspectBundle,
  resolveOkfyHome,
  validateSourceName,
  resolveSourceDir,
  resolveBundleDir,
  writeSourceManifest,
  readSourceManifest,
  writeRefreshState,
  readRefreshState,
  listSources,
  removeSource,
  bundleSourceName,
  localBundleRecord,
  assertUniqueWorkspaceRecordNames,
  isRegisteredWorkspaceRecord,
  WorkspaceError,
  workspaceProfilePath,
  readWorkspaceProfile,
  writeWorkspaceProfile,
  resolveWorkspaceSources,
  WorkspaceSearch,
  MCP_TOOL_NAMES,
  createMcpServer,
  createWorkspaceMcpServer,
  serveMcpStdio,
  serveWorkspaceMcpStdio,
  parseSetupClient,
  defaultOkfyHome,
  createSetupReport,
  serveCommand,
  serveCommandArgs,
  setupCheck,
  executableOnPath,
  probeMcpStdio,
  extractHeadings,
  extractMarkdownLinks,
  inferType,
  inferTags,
  normalizeDocument,
  descriptionFromMarkdown,
  assertSafeForceOutDir,
  writeOkfBundle,
  buildActivationPacket,
  withActivationMetadata,
  renderActivationSetupMarkdown,
  writeActivationPacketFiles,
  crawlWebsite,
  parseDurationSeconds,
  hashBundleContents,
  importLocal,
  buildBundleInspectorReport,
  buildWorkspaceInspectorReport,
  evaluateFreshness,
  refreshSource
};
