import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { crawlWebsite } from "../src/crawler.js";
import { importLocal } from "../src/importer.js";
import { matchesPattern } from "../src/util/match.js";

const tempDirs: string[] = [];

async function tempOut(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-import-crawl-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("pattern matching", () => {
  it("treats normal input as glob and only parses explicit regex safely", () => {
    expect(matchesPattern("guides/start.md", "**/*.md")).toBe(true);
    expect(matchesPattern("guides/start.md", "/guides\\/.*\\.md/")).toBe(true);
    expect(matchesPattern("guides/start.md", "/[/")).toBe(false);
    expect(matchesPattern("guides/start.md", "[")).toBe(false);
  });
});

describe("importLocal filters", () => {
  it("accepts common glob includes and invalid excludes without regex crashes", async () => {
    const outDir = await tempOut();
    const result = await importLocal({
      inputPath: "examples/local-markdown",
      outDir,
      include: ["**/*.md"],
      exclude: ["["],
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    expect(result.written).toContain("index.md");
    expect(result.written.length).toBeGreaterThan(1);
  });
});

describe("crawl dry run", () => {
  it("discovers linked pages without writing output", async () => {
    const server = http.createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      if (request.url === "/") {
        response.end("<main><h1>Home</h1><a href='/a'>A</a><a href='/b'>B</a></main>");
      } else if (request.url === "/a") {
        response.end("<main><h1>A</h1><a href='/b'>B</a></main>");
      } else {
        response.end("<main><h1>B</h1></main>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP test server.");
    const outDir = await tempOut();

    try {
      const progress: string[] = [];
      const result = await crawlWebsite({
        seedUrl: `http://127.0.0.1:${address.port}/`,
        outDir,
        maxPages: 3,
        maxDepth: 2,
        dryRun: true,
        allowPrivateNetwork: true,
        respectRobots: false,
        onProgress: (event) => progress.push(event.type)
      });

      expect(result.dryRunPages).toEqual([
        `http://127.0.0.1:${address.port}/`,
        `http://127.0.0.1:${address.port}/a`,
        `http://127.0.0.1:${address.port}/b`
      ]);
      expect(progress).toContain("start");
      expect(progress).toContain("fetch");
      expect(progress).toContain("fetched");
      await expect(fs.readdir(outDir)).resolves.toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
