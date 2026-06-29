import robotsParser from "robots-parser";
import { fetchText, USER_AGENT } from "./fetch-policy.js";
import type { CrawlOptions } from "./types.js";
import { matchesAnyPattern } from "../util/match.js";
import { isHttpUrl, isPrivateNetworkUrl, sameOrigin } from "../util/url.js";

export type RobotsRules = ReturnType<typeof robotsParser>;

export async function loadRobots(
  seedUrl: string,
  enabled: boolean
): Promise<RobotsRules | undefined> {
  if (!enabled) return undefined;
  const origin = new URL(seedUrl).origin;
  try {
    const fetched = await fetchText(`${origin}/robots.txt`, { sameOriginSeed: seedUrl });
    const text = fetched.text;
    return robotsParser(`${origin}/robots.txt`, text);
  } catch {
    return robotsParser(`${origin}/robots.txt`, "");
  }
}

export function shouldVisit(
  url: string,
  seed: string,
  options: CrawlOptions,
  robots?: RobotsRules
): boolean {
  if (!isHttpUrl(url)) return false;
  if ((options.sameOrigin ?? true) && !sameOrigin(url, seed)) return false;
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(url)) return false;
  if (options.include?.length && !matchesAnyPattern(url, options.include)) return false;
  if (matchesAnyPattern(url, options.exclude)) return false;
  if (robots && !robots.isAllowed(url, USER_AGENT)) return false;
  return true;
}
