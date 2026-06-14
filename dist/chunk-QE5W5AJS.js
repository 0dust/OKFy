// src/normalize.ts
import * as cheerio from "cheerio";
import TurndownService from "turndown";

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

// src/normalize.ts
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
import fs from "fs/promises";
import os from "os";
import path3 from "path";

// src/okf.ts
import path2 from "path";
var RESERVED_FILENAMES = /* @__PURE__ */ new Set(["index.md", "log.md"]);
function toOkfPath(input) {
  return input.split(path2.sep).join("/");
}
function isReservedOkfPath(input) {
  return RESERVED_FILENAMES.has(path2.posix.basename(toOkfPath(input)).toLowerCase());
}
function isConceptMarkdownPath(input) {
  return input.toLowerCase().endsWith(".md") && !isReservedOkfPath(input);
}

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
    const base = safeConceptOutputPath(doc.resource ? urlToOutputPath(doc.resource) : ensureMarkdownPath(doc.sourcePath ?? doc.sourceId));
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
      const parsed = path3.posix.parse(base);
      candidate = path3.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
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
  const parsed = path3.posix.parse(candidate);
  const safeName = parsed.name.toLowerCase() === "log" ? "change-log" : parsed.dir ? "overview" : "home";
  return path3.posix.join(parsed.dir, `${safeName}.md`);
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
        if (target && doc.outputPath) return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
        return `[${text}](${key}${suffix})`;
      } catch {
        return full;
      }
    }
    if (!href.startsWith("#") && doc.sourcePath) {
      const abs = toPosixPath(path3.posix.normalize(path3.posix.join(path3.posix.dirname(doc.sourcePath), href)));
      const noHash = abs.split("#")[0] ?? abs;
      const target = sourceToOutput.get(noHash);
      if (target && doc.outputPath) return `[${text}](${relativeMarkdownLink(doc.outputPath, target)}${suffix})`;
    }
    return full;
  });
}
async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function resolveForSafety(target) {
  const resolved = path3.resolve(target);
  if (await pathExists(resolved)) return fs.realpath(resolved);
  const parent = path3.dirname(resolved);
  const realParent = await fs.realpath(parent);
  return path3.join(realParent, path3.basename(resolved));
}
async function findRepoRoot(start) {
  let current = path3.resolve(start);
  while (true) {
    if (await pathExists(path3.join(current, ".git"))) return fs.realpath(current);
    const parent = path3.dirname(current);
    if (parent === current) return void 0;
    current = parent;
  }
}
async function assertSafeForceOutDir(outDir, options) {
  if (options.dangerouslyAllowUnsafeOutput) return;
  if (outDir.trim() === "") throw new Error("Unsafe output directory for --force: empty path.");
  const rawResolved = path3.resolve(outDir);
  const existing = await pathExists(rawResolved);
  if (existing) {
    const stat = await fs.lstat(rawResolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ${outDir}.`);
    }
  }
  const realOutDir = await resolveForSafety(outDir);
  const forbidden = /* @__PURE__ */ new Map([
    [path3.parse(realOutDir).root, "filesystem root"],
    [await fs.realpath(os.homedir()), "home directory"],
    [await fs.realpath(process.cwd()), "current working directory"]
  ]);
  const repoRoot = await findRepoRoot(process.cwd());
  if (repoRoot) forbidden.set(repoRoot, "repository root");
  if (options.inputPath) {
    const inputReal = await resolveForSafety(options.inputPath);
    forbidden.set(inputReal, "input path");
    forbidden.set(path3.dirname(inputReal), "parent of input path");
  }
  const reason = forbidden.get(realOutDir);
  if (reason) throw new Error(`Unsafe output directory for --force: refusing to delete ${reason} (${realOutDir}).`);
}
async function ensureCleanOutDir(outDir, options) {
  if (options.force) await assertSafeForceOutDir(outDir, options);
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force) throw new Error(`Output directory is not empty: ${outDir}. Use --force to overwrite.`);
      await fs.rm(outDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(outDir, { recursive: true });
}
function titleForPath(relPath, fallback) {
  const basename = path3.posix.basename(relPath, ".md");
  return fallback || basename;
}
function markdownLink(fromDir, toPath) {
  if (fromDir === ".") return toPath;
  return path3.posix.relative(fromDir, toPath);
}
function indexTitle(dir, options) {
  if (dir === ".") return options.title ?? options.sourceName ?? "OKF Bundle";
  const leaf = path3.posix.basename(dir);
  return leaf.split(/[-_\s]+/).filter(Boolean).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}
async function writePlainIndex(outDir, dir, concepts, options) {
  const indexPath = dir === "." ? "index.md" : path3.posix.join(dir, "index.md");
  const entries = (dir === "." ? concepts : concepts.filter((concept) => path3.posix.dirname(concept.relPath) === dir)).slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
  const lines = [
    `# ${indexTitle(dir, options)}`,
    "",
    ...entries.map((concept) => `* [${concept.title}](${markdownLink(dir, concept.relPath)}) - ${concept.description}`)
  ];
  await fs.mkdir(path3.dirname(path3.join(outDir, indexPath)), { recursive: true });
  await fs.writeFile(path3.join(outDir, indexPath), `${lines.join("\n").trimEnd()}
`, "utf8");
  return indexPath;
}
async function writeOkfBundle(docs, options) {
  if (docs.length === 0) throw new Error("No documents to write.");
  await ensureCleanOutDir(options.outDir, options);
  const timestamp = options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const sourceToOutput = assignOutputPaths(docs);
  const written = [];
  const concepts = [];
  for (const doc of docs) {
    const relPath = doc.outputPath ?? "index.md";
    const absolute = path3.join(options.outDir, relPath);
    await fs.mkdir(path3.dirname(absolute), { recursive: true });
    const body = withTitle(doc.title, rewriteLinks(doc, sourceToOutput));
    await fs.writeFile(absolute, `${frontmatter(doc, timestamp)}${body}
`, "utf8");
    written.push(relPath);
    concepts.push({
      relPath,
      title: titleForPath(relPath, doc.title),
      description: descriptionFromMarkdown(doc.markdown)
    });
  }
  written.push(await writePlainIndex(options.outDir, ".", concepts, options));
  const dirs = [...new Set(concepts.map((concept) => path3.posix.dirname(concept.relPath)).filter((dir) => dir !== "."))].sort();
  for (const dir of dirs) {
    written.push(await writePlainIndex(options.outDir, dir, concepts, options));
  }
  return written.sort();
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
var USER_AGENT = "okfy/0.1 (+https://github.com/0dust/OKFy)";
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
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`Response too large for ${url}`);
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
    throw new Error("Private network crawl target rejected. Use --allow-private-network for trusted local fixtures.");
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
            options.onProgress?.({ type: "skipped", url: item.url, fetched: documents.length, queued: queue.length, maxPages });
            return;
          }
          planned.push(item.url);
          options.onProgress?.({ type: "fetch", url: item.url, fetched: documents.length, queued: queue.length, maxPages });
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
            options.onProgress?.({ type: "failed", url: item.url, fetched: documents.length, queued: queue.length, maxPages });
          }
        })
      )
    );
    void results;
  }
  if (options.dryRun) {
    return { pagesFetched: planned.length, skipped, failed, written: [], documents: [], dryRunPages: planned.slice(0, maxPages) };
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

// src/importer.ts
import fs2 from "fs/promises";
import path4 from "path";
function contentTypeFor(file) {
  const ext = path4.extname(file).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".mdx") return "mdx";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".txt") return "text";
  return void 0;
}
async function listFiles(root) {
  const stat = await fs2.stat(root);
  if (stat.isFile()) return [root];
  const files = [];
  async function walk(dir) {
    for (const entry of await fs2.readdir(dir, { withFileTypes: true })) {
      const absolute = path4.join(dir, entry.name);
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
  const root = path4.resolve(options.inputPath);
  const files = await listFiles(root);
  const docs = [];
  for (const file of files) {
    const rel = path4.relative(root, file).split(path4.sep).join("/");
    if (options.include?.length && !matchesAnyPattern(rel, options.include)) continue;
    if (matchesAnyPattern(rel, options.exclude)) continue;
    const contentType = contentTypeFor(file);
    if (!contentType) continue;
    const raw = {
      sourceId: rel,
      filePath: rel,
      contentType,
      raw: await fs2.readFile(file, "utf8"),
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

// src/graph.ts
import path5 from "path";
function extractInternalLinks(concept) {
  const links = /* @__PURE__ */ new Set();
  for (const match of concept.body.matchAll(/\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1] ?? "";
    const noHash = href.split("#")[0] ?? href;
    if (!noHash) continue;
    if (/^(https?:)?\/\//i.test(noHash) || /^mailto:/i.test(noHash)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(noHash)) continue;
    const resolved = noHash.startsWith("/") ? path5.posix.normalize(noHash.slice(1)) : path5.posix.normalize(path5.posix.join(path5.posix.dirname(concept.path), noHash));
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
import fs3 from "fs/promises";
import path6 from "path";
import matter from "gray-matter";
async function listMarkdownFiles(dir) {
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
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}
async function readConceptFile(bundleDir, absolutePath) {
  const raw = await fs3.readFile(absolutePath, "utf8");
  const parsed = matter(raw);
  const relPath = toPosixPath(path6.relative(bundleDir, absolutePath));
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
    const relPath = toPosixPath(path6.relative(bundleDir, file));
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
var BundleSearch = class _BundleSearch {
  graph;
  index;
  constructor(conceptsByAnyKey) {
    this.graph = buildGraph(conceptsByAnyKey);
    this.index = new MiniSearch({
      fields: ["title", "description", "tags", "type", "body"],
      storeFields: ["id"],
      searchOptions: { boost: { title: 4, tags: 3, type: 2, description: 2 }, fuzzy: 0.2, prefix: true }
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
    const hits = this.index.search(query || MiniSearch.wildcard, { combineWith: "AND" }).slice(0, 100);
    const tagFilter = new Set(options.tags ?? []);
    return hits.map((hit) => ({ hit, concept: this.graph.concepts.get(hit.id) })).filter((row) => Boolean(row.concept)).filter(({ concept }) => !options.type || concept.type === options.type).filter(({ concept }) => tagFilter.size === 0 || concept.tags.some((tag) => tagFilter.has(tag))).slice(0, options.limit ?? 10).map(({ hit, concept }) => ({
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

// src/validate.ts
import fs4 from "fs/promises";
import path7 from "path";
import matter2 from "gray-matter";
async function listMarkdownFiles2(dir) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs4.readdir(current, { withFileTypes: true })) {
      const absolute = path7.join(current, entry.name);
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
function parseFrontmatter(raw) {
  const parsed = matter2(raw);
  return { data: parsed.data, content: parsed.content };
}
function validateIndexFile(raw, rel, issues) {
  let body = raw;
  if (raw.startsWith("---")) {
    if (rel !== "index.md") {
      issues.push(issue("error", "reserved_index_frontmatter", "Only bundle-root index.md may contain okf_version frontmatter.", rel));
      return;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      issues.push(issue("error", "malformed_frontmatter", error?.message ?? "Malformed YAML frontmatter.", rel));
      return;
    }
    const keys = Object.keys(parsed.data);
    if (keys.length !== 1 || keys[0] !== "okf_version" || typeof parsed.data.okf_version !== "string") {
      issues.push(issue("error", "reserved_index_frontmatter", "Root index.md frontmatter may contain only string okf_version.", rel));
    }
    body = parsed.content;
  }
  const firstLine = firstContentLine(body);
  if (!firstLine.startsWith("# ")) {
    issues.push(issue("error", "invalid_index_structure", "index.md must be a markdown directory listing headed by a section title.", rel));
  }
}
function validateLogFile(raw, rel, issues) {
  if (raw.startsWith("---")) {
    issues.push(issue("error", "reserved_log_frontmatter", "log.md must not contain YAML frontmatter.", rel));
    return;
  }
  const firstLine = firstContentLine(raw);
  if (!firstLine.startsWith("# ")) {
    issues.push(issue("error", "invalid_log_structure", "log.md must be a markdown update log headed by a title.", rel));
  }
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading && !/^\d{4}-\d{2}-\d{2}\b/.test(heading[1] ?? "")) {
      issues.push(issue("error", "invalid_log_date", "log.md date headings must use YYYY-MM-DD.", rel));
    }
  }
}
function validateReservedFile(raw, rel, issues) {
  const name = path7.posix.basename(rel).toLowerCase();
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
  const conceptFiles = files.filter((file) => isConceptMarkdownPath(path7.relative(bundleDir, file).split(path7.sep).join("/")));
  const reservedFiles = files.filter((file) => isReservedOkfPath(path7.relative(bundleDir, file).split(path7.sep).join("/")));
  for (const file of reservedFiles) {
    const rel = path7.relative(bundleDir, file).split(path7.sep).join("/");
    const raw = await fs4.readFile(file, "utf8");
    validateReservedFile(raw, rel, issues);
  }
  for (const file of files) {
    const rel = path7.relative(bundleDir, file).split(path7.sep).join("/");
    if (!isConceptMarkdownPath(rel)) continue;
    if (rel.includes("..") || path7.isAbsolute(rel)) {
      issues.push(issue("error", "unsafe_path", "Concept path is unsafe.", rel));
    }
    const raw = await fs4.readFile(file, "utf8");
    if (!raw.startsWith("---")) {
      issues.push(issue("error", "missing_frontmatter", "Concept file must start with YAML frontmatter.", rel));
      continue;
    }
    let parsed;
    try {
      parsed = matter2(raw);
    } catch (error) {
      issues.push(issue("error", "malformed_frontmatter", error?.message ?? "Malformed YAML frontmatter.", rel));
      continue;
    }
    const data = parsed.data;
    if (typeof data.type !== "string" || data.type.trim() === "") {
      issues.push(issue("error", "missing_type", "Frontmatter type must be a non-empty string.", rel));
    }
    for (const key of ["title", "description", "resource", "timestamp"]) {
      if (data[key] !== void 0 && typeof data[key] !== "string") {
        issues.push(issue("warning", "bad_field_shape", `${key} should be a string when present.`, rel));
      }
    }
    if (data.tags !== void 0 && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string"))) {
      issues.push(issue("warning", "bad_field_shape", "tags should be an array of strings when present.", rel));
    }
  }
  const concepts = await readBundle(bundleDir).catch(() => /* @__PURE__ */ new Map());
  const canonicalIds = new Set([...concepts.values()].map((concept) => concept.id));
  for (const concept of new Map([...concepts.values()].map((concept2) => [concept2.id, concept2])).values()) {
    for (const target of extractInternalLinks(concept)) {
      if (!canonicalIds.has(target)) {
        issues.push(issue("warning", "broken_internal_link", `Broken internal link to ${target}.`, concept.path));
      }
    }
  }
  const dirs = new Set(conceptFiles.map((file) => path7.dirname(file)));
  for (const dir of dirs) {
    const index = path7.join(dir, "index.md");
    if (!files.includes(index)) {
      issues.push(
        issue(
          "warning",
          "missing_folder_index",
          "Folder has concepts but no index.md.",
          path7.relative(bundleDir, dir).split(path7.sep).join("/") || "."
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
  const linkCount = [...graph.outbound.values()].reduce((sum, links) => sum + links.length, 0);
  const validation = await validateBundle(bundleDir);
  return {
    title: path7.basename(bundleDir),
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

// src/mcp.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
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
var neighborsSchema = z.object({ id: z.string(), depth: z.number().int().min(1).max(2).optional() });
async function createMcpServer(options) {
  const search = await BundleSearch.fromBundle(options.bundleDir);
  const server = new Server(
    { name: options.name ?? "okfy", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  const maxResultChars = options.maxResultChars ?? 12e3;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_concepts",
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
        name: "read_concept",
        description: "Read one OKF concept by id or path.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, max_chars: { type: "number" } },
          required: ["id"]
        }
      },
      {
        name: "get_neighbors",
        description: "Return outbound links and backlinks for a concept.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, depth: { type: "number", default: 1 } },
          required: ["id"]
        }
      },
      { name: "list_types", description: "List concept types and counts.", inputSchema: { type: "object", properties: {} } },
      { name: "list_tags", description: "List concept tags and counts.", inputSchema: { type: "object", properties: {} } },
      { name: "bundle_summary", description: "Return bundle stats and validation status.", inputSchema: { type: "object", properties: {} } }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      if (request.params.name === "search_concepts") {
        const parsed = searchSchema.parse(args);
        return json(search.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === "read_concept") {
        const parsed = readSchema.parse(args);
        const concept = search.getConcept(parsed.id);
        if (!concept) return json({ error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` } });
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
      if (request.params.name === "get_neighbors") {
        const parsed = neighborsSchema.parse(args);
        const root = search.getConcept(parsed.id);
        if (!root) return json({ error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` } });
        const depth = parsed.depth ?? 1;
        const seen = /* @__PURE__ */ new Set([root.id]);
        let frontier = [root.id];
        const edges = [];
        for (let level = 0; level < depth; level += 1) {
          const next = [];
          for (const id of frontier) {
            for (const to of search.graph.outbound.get(id) ?? []) {
              edges.push({ from: id, to, direction: "outbound", relationship_text: "Markdown link" });
              if (!seen.has(to)) next.push(to);
              seen.add(to);
            }
            for (const from of search.graph.backlinks.get(id) ?? []) {
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
            const concept = search.graph.concepts.get(id);
            return { id, title: concept?.title, type: concept?.type, resource: concept?.resource };
          }),
          edges
        });
      }
      if (request.params.name === "list_types") {
        const stats = await inspectBundle(options.bundleDir);
        return json(stats.typeDistribution);
      }
      if (request.params.name === "list_tags") {
        const stats = await inspectBundle(options.bundleDir);
        return json(stats.tagDistribution);
      }
      if (request.params.name === "bundle_summary") {
        const [stats, validation] = await Promise.all([inspectBundle(options.bundleDir), validateBundle(options.bundleDir)]);
        return json({
          ...stats,
          reservedFileCount: validation.reservedFileCount,
          warningCount: validation.warningCount,
          validationStatus: validation.valid ? "valid" : "invalid",
          validationIssues: validation.issues
        });
      }
      return json({ error: { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` } });
    } catch (error) {
      return json({ error: { code: "tool_error", message: error?.message ?? "Tool failed." } });
    }
  });
  return server;
}
async function serveMcpStdio(options) {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export {
  extractHeadings,
  extractMarkdownLinks,
  inferType,
  inferTags,
  normalizeDocument,
  descriptionFromMarkdown,
  writeOkfBundle,
  crawlWebsite,
  importLocal,
  extractInternalLinks,
  buildGraph,
  readConceptFile,
  readBundle,
  BundleSearch,
  validateBundle,
  inspectBundle,
  createMcpServer,
  serveMcpStdio
};
