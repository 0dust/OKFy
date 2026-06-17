import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./util/path.js";

interface BundleFile {
  absolutePath: string;
  relativePath: string;
}

async function listBundleFiles(bundleDir: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];

  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: toPosixPath(path.relative(bundleDir, absolutePath))
        });
      }
    }
  }

  await walk(bundleDir);
  return files.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
}

export async function hashBundleContents(bundleDir: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const files = await listBundleFiles(bundleDir);

  for (const file of files) {
    const contents = await fs.readFile(file.absolutePath);
    hash.update(`${file.relativePath.length}:${file.relativePath}\0${contents.byteLength}:`);
    hash.update(contents);
    hash.update("\0");
  }

  return `sha256:${hash.digest("hex")}`;
}
