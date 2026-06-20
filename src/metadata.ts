import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageMetadata {
  name: string;
  version: string;
  root: string;
}

const FALLBACK_NAME = "okfy-ai";
const FALLBACK_VERSION = "0.0.0";
let cachedMetadata: PackageMetadata | undefined;

export function runtimePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function packageMetadata(): PackageMetadata {
  cachedMetadata ??= readPackageMetadata();
  return cachedMetadata;
}

export function packageVersion(): string {
  return packageMetadata().version;
}

export function okfyUserAgent(): string {
  return `okfy/${packageVersion()} (+https://github.com/0dust/OKFy)`;
}

function readPackageMetadata(): PackageMetadata {
  const root = runtimePackageRoot();
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: string; version?: string };
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
