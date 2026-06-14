import dns from "node:dns/promises";
import net from "node:net";

const TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_/i];

export function canonicalizeUrl(input: string, base?: string): string {
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

export function sameOrigin(a: string, b: string): boolean {
  const left = new URL(a);
  const right = new URL(b);
  return left.origin === right.origin;
}

export function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPrivateIpv4Parts(parts: number[]): boolean {
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a >= 224
  );
}

function mappedIpv4PartsFromIpv6(host: string): number[] | undefined {
  const dotted = host.match(/^(?:::|0:0:0:0:0:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (dotted) {
    const parts = dotted.split(".").map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return parts;
  }

  const hex = host.match(/^(?:::|0:0:0:0:0:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1] ?? "", 16);
  const low = Number.parseInt(hex[2] ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return undefined;
  }
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

export function isPrivateNetworkUrl(input: string): boolean {
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

export async function resolvesToPrivateNetwork(input: string): Promise<boolean> {
  if (isPrivateNetworkUrl(input)) return true;
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host)) return false;
  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  return records.some((record) => {
    const host = record.address.includes(":") ? `[${record.address}]` : record.address;
    return isPrivateNetworkUrl(`${url.protocol}//${host}`);
  });
}

export async function assertPublicNetworkUrl(input: string): Promise<void> {
  if (await resolvesToPrivateNetwork(input)) {
    throw new Error("Private network crawl target rejected. Use --allow-private-network for trusted local fixtures.");
  }
}
