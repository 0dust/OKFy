import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  isHttpUrl,
  isPrivateNetworkUrl,
  sameOrigin
} from "../src/util/url.js";
import {
  ensureMarkdownPath,
  relativeMarkdownLink,
  safeSegment,
  urlToOutputPath
} from "../src/util/path.js";

describe("URL canonicalization", () => {
  it("normalizes docs URLs while preserving meaningful query params", () => {
    expect(
      canonicalizeUrl(
        "https://Docs.Example.com//guides///start?utm_source=x&keep=1&fbclid=bad#install"
      )
    ).toBe("https://docs.example.com/guides/start?keep=1");
  });

  it("resolves relative URLs and checks origin/private network safety", () => {
    expect(canonicalizeUrl("../api?gclid=x", "https://docs.example.com/guides/start")).toBe(
      "https://docs.example.com/api"
    );
    expect(sameOrigin("https://docs.example.com/a", "https://docs.example.com/b")).toBe(true);
    expect(sameOrigin("https://docs.example.com/a", "https://api.example.com/a")).toBe(false);
    expect(isHttpUrl("https://docs.example.com")).toBe(true);
    expect(isHttpUrl("file:///tmp/docs")).toBe(false);
    expect(isPrivateNetworkUrl("http://localhost:3000/docs")).toBe(true);
    expect(isPrivateNetworkUrl("http://192.168.1.5/docs")).toBe(true);
    expect(isPrivateNetworkUrl("https://docs.example.com")).toBe(false);
  });

  it("rejects private IPv4-mapped IPv6 literals without rejecting public mapped IPv4", () => {
    expect(isPrivateNetworkUrl("http://[::ffff:127.0.0.1]/")).toBe(true);
    expect(isPrivateNetworkUrl("http://[::ffff:10.0.0.1]/")).toBe(true);
    expect(isPrivateNetworkUrl("http://[::ffff:192.168.1.5]/")).toBe(true);
    expect(isPrivateNetworkUrl("http://[::ffff:172.16.0.1]/")).toBe(true);
    expect(isPrivateNetworkUrl("http://[::ffff:7f00:1]/")).toBe(true);
    expect(isPrivateNetworkUrl("http://[::ffff:a00:1]/")).toBe(true);
    expect(isPrivateNetworkUrl("http://[::ffff:808:808]/")).toBe(false);
  });
});

describe("path mapping", () => {
  it("creates stable safe Markdown paths from URLs and source paths", () => {
    expect(safeSegment("Hello, OKF Docs!")).toBe("hello-okf-docs");
    expect(ensureMarkdownPath("/Guides/Quick Start.html")).toBe("guides/quick-start.md");
    expect(ensureMarkdownPath("/")).toBe("index.md");
    expect(urlToOutputPath("https://docs.example.com/")).toBe("index.md");
    expect(urlToOutputPath("https://docs.example.com/guides/")).toBe("guides/index.md");
    expect(urlToOutputPath("https://docs.example.com/API Reference")).toBe("api-reference.md");
  });

  it("builds relative Markdown links between concept files", () => {
    expect(relativeMarkdownLink("guides/quickstart.md", "reference/api.md")).toBe("../reference/api.md");
    expect(relativeMarkdownLink("index.md", "guides/quickstart.md")).toBe("./guides/quickstart.md");
  });
});
