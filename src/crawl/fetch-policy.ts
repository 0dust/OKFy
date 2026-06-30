import { okfyUserAgent } from "../metadata.js";
import { assertPublicNetworkUrl, canonicalizeUrl, sameOrigin } from "../util/url.js";

export type FetchTextOptions = {
  allowPrivateNetwork?: boolean;
  sameOriginSeed?: string;
};

export const USER_AGENT = okfyUserAgent();

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

export function isSecurityRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Private network crawl target rejected") ||
    message.includes("Cross-origin redirect rejected")
  );
}

async function fetchWithRedirects(
  url: string,
  options: FetchTextOptions,
  signal: AbortSignal
): Promise<Response> {
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

export async function fetchText(
  url: string,
  options: FetchTextOptions = {}
): Promise<{ text: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let lastError: Error | undefined;
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
      } catch (error: any) {
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
