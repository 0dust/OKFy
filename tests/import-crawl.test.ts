import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  vi.restoreAllMocks();
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

  it("refuses unsafe force output directories before deleting anything", async () => {
    const root = await tempOut();
    const input = path.join(root, "docs");
    await fs.mkdir(input);
    await fs.writeFile(path.join(input, "guide.md"), "# Guide\n\nHello.", "utf8");

    await expect(
      importLocal({
        inputPath: input,
        outDir: root,
        force: true,
        timestamp: "2026-06-14T00:00:00.000Z"
      })
    ).rejects.toThrow(/unsafe output directory/i);
    await expect(fs.readFile(path.join(input, "guide.md"), "utf8")).resolves.toContain("Hello.");
  });
});

describe("crawl dry run", () => {
  it("sends the package version in the crawler user-agent", async () => {
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8")) as {
      version: string;
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<main><h1>Home</h1></main>", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    );
    const outDir = await tempOut();

    await crawlWebsite({
      seedUrl: "http://127.0.0.1:3000/",
      outDir,
      maxPages: 1,
      dryRun: true,
      allowPrivateNetwork: true,
      respectRobots: false
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": `okfy/${packageJson.version} (+https://github.com/0dust/OKFy)`
        })
      })
    );
  });

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

  it("rejects redirects to private network targets before following them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1/private" }
      })
    );
    const outDir = await tempOut();

    await expect(
      crawlWebsite({
        seedUrl: "http://93.184.216.34/",
        outDir,
        maxPages: 1,
        respectRobots: false,
        force: true
      })
    ).rejects.toThrow(/private network crawl target rejected/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects to IPv4-mapped loopback targets before following them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "http://[::ffff:127.0.0.1]/private" }
      })
    );
    const outDir = await tempOut();

    await expect(
      crawlWebsite({
        seedUrl: "http://93.184.216.34/",
        outDir,
        maxPages: 1,
        respectRobots: false,
        force: true
      })
    ).rejects.toThrow(/private network crawl target rejected/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
