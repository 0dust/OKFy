import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDurationSeconds } from "../src/duration.js";
import { hashBundleContents } from "../src/hash.js";

const tempDirs: string[] = [];

async function tempOut(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-duration-hash-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(root: string, relativePath: string, contents: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("duration parsing", () => {
  it("parses supported second, minute, hour, and day durations", () => {
    expect(parseDurationSeconds("30s")).toBe(30);
    expect(parseDurationSeconds("15m")).toBe(900);
    expect(parseDurationSeconds("24h")).toBe(86_400);
    expect(parseDurationSeconds("7d")).toBe(604_800);
  });

  it("rejects ambiguous or malformed duration strings", () => {
    for (const input of ["", "24", "1w", "-5m", "1.5h", "m", "5 h", "5ms"]) {
      expect(() => parseDurationSeconds(input)).toThrow(/duration/i);
    }
  });
});

describe("bundle content hashing", () => {
  it("is deterministic for sorted bundle file paths and contents", async () => {
    const first = await tempOut();
    const second = await tempOut();

    await writeFile(first, "guides/start.md", "# Start\n");
    await writeFile(first, "index.md", "# Index\n");
    await writeFile(second, "index.md", "# Index\n");
    await writeFile(second, "guides/start.md", "# Start\n");

    await expect(hashBundleContents(first)).resolves.toBe(await hashBundleContents(second));
  });

  it("changes when bundle file content or paths change", async () => {
    const baseline = await tempOut();
    const changedContent = await tempOut();
    const changedPath = await tempOut();

    await writeFile(baseline, "index.md", "# Index\n");
    await writeFile(changedContent, "index.md", "# Changed\n");
    await writeFile(changedPath, "home.md", "# Index\n");

    const hash = await hashBundleContents(baseline);

    await expect(hashBundleContents(changedContent)).resolves.not.toBe(hash);
    await expect(hashBundleContents(changedPath)).resolves.not.toBe(hash);
  });
});
