import * as cheerio from "cheerio";
import { normalizeDocument } from "../normalize.js";
import type { RawDocument } from "../types.js";

export function contentTypeFromHeader(header: string): "html" | "markdown" | "text" | undefined {
  const lower = header.toLowerCase();
  if (lower.includes("text/html")) return "html";
  if (lower.includes("markdown")) return "markdown";
  if (lower.includes("text/plain")) return "text";
  if (!lower) return "html";
  return undefined;
}

export function extractRawHtmlLinks(raw: string): Array<{ href: string; text: string }> {
  const $ = cheerio.load(raw);
  return $("a[href]")
    .map((_, element) => ({
      href: String($(element).attr("href") ?? ""),
      text: $(element).text().trim()
    }))
    .get()
    .filter((link) => link.href.length > 0);
}

export function normalizeFetchedDocument(options: {
  url: string;
  contentType: "html" | "markdown" | "text";
  text: string;
  discoveredAt: string;
}) {
  const raw: RawDocument = {
    sourceId: options.url,
    url: options.url,
    contentType: options.contentType,
    raw: options.text,
    discoveredAt: options.discoveredAt
  };
  return normalizeDocument(raw);
}
