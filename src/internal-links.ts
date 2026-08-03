import path from "node:path";
import { stripMdExtension } from "./util/path.js";
import type { SemanticLink } from "./types.js";

export function internalLinksFromSemantics(
  conceptPath: string,
  semanticLinks: SemanticLink[]
): string[] {
  const links = new Set<string>();
  for (const link of semanticLinks) {
    if (link.kind !== "markdown") continue;
    const noHash = link.target.split("#")[0] ?? link.target;
    if (!noHash) continue;
    if (/^(https?:)?\/\//i.test(noHash) || /^mailto:/i.test(noHash)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(noHash)) continue;
    const resolved = noHash.startsWith("/")
      ? path.posix.normalize(noHash.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(conceptPath), noHash));
    if (!resolved || resolved === ".") continue;
    links.add(stripMdExtension(resolved));
  }
  return [...links].sort();
}
