import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBundleInspectorReport } from "../src/inspector.js";
import { IMPORT_DIAGNOSTICS_FILE } from "../src/import-diagnostics.js";
import { validateBundle } from "../src/validate.js";

const tempDirs: string[] = [];

async function tempBundle(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-validation-analysis-test-"));
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, "index.md"), "# Validation bundle\n", "utf8");
  return dir;
}

async function writeConcept(
  bundleDir: string,
  file: string,
  options: { body: string; resource?: string; title?: string }
): Promise<void> {
  const absolute = path.join(bundleDir, file);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(
    absolute,
    [
      "---",
      'type: "Note"',
      `title: ${JSON.stringify(options.title ?? path.basename(file, path.extname(file)))}`,
      `resource: ${JSON.stringify(options.resource ?? file)}`,
      "tags: []",
      'timestamp: "2026-06-14T00:00:00.000Z"',
      "---",
      "",
      options.body
    ].join("\n"),
    "utf8"
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("bundle validation analysis", () => {
  it("does not label ordinary Markdown custom fragments as Obsidian warnings", async () => {
    const bundleDir = await tempBundle();
    await writeConcept(bundleDir, "source.md", {
      body: "# Source\n\n[Custom section](./target.md#custom-anchor)"
    });
    await writeConcept(bundleDir, "target.md", {
      body: '# Target\n\n<section id="custom-anchor">Custom content</section>'
    });

    const report = await validateBundle(bundleDir);

    expect(report.issues.filter((item) => item.code === "missing_wikilink_fragment")).toEqual([]);
  });

  it("still reports missing fragments in actual Obsidian wikilinks", async () => {
    const bundleDir = await tempBundle();
    await writeConcept(bundleDir, "source.md", {
      body: "# Source\n\n[[Target#Missing]]"
    });
    await writeConcept(bundleDir, "target.md", { title: "Target", body: "# Target" });

    const report = await validateBundle(bundleDir);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "missing_wikilink_fragment",
          path: "source.md",
          rawTarget: "Target#Missing"
        })
      ])
    );
  });

  it.each([
    {
      name: "invalid JSON",
      manifest: "{",
      message: `${IMPORT_DIAGNOSTICS_FILE} is not valid JSON.`
    },
    {
      name: "an unsupported schema",
      manifest: JSON.stringify({ schemaVersion: 2, entries: [] }),
      message: `${IMPORT_DIAGNOSTICS_FILE} has an unsupported schema.`
    },
    {
      name: "an unsafe entry",
      manifest: JSON.stringify({
        schemaVersion: 1,
        entries: [
          {
            code: "missing_wikilink_fragment",
            sourceConceptPath: "../source.md",
            sourcePath: "source.md",
            rawTarget: "target#Missing",
            targetConceptPath: "target.md",
            targetPath: "target.md",
            fragmentKind: "heading",
            emittedFragment: "missing",
            targetFragmentPresent: false
          }
        ]
      }),
      message: `${IMPORT_DIAGNOSTICS_FILE} contains an invalid entry.`
    }
  ])("keeps $name import provenance non-fatal", async ({ manifest, message }) => {
    const bundleDir = await tempBundle();
    await writeConcept(bundleDir, "source.md", { body: "# Source" });
    await fs.writeFile(path.join(bundleDir, IMPORT_DIAGNOSTICS_FILE), manifest, "utf8");

    const report = await validateBundle(bundleDir);

    expect(report.valid).toBe(true);
    expect(report.issues.filter((item) => item.code === "invalid_import_diagnostics")).toEqual([
      {
        severity: "warning",
        code: "invalid_import_diagnostics",
        message,
        path: IMPORT_DIAGNOSTICS_FILE
      }
    ]);
    expect(report.issues.filter((item) => item.code === "missing_wikilink_fragment")).toEqual([]);
  });

  it("reports malformed MDX per concept without aborting validation or Inspector", async () => {
    const bundleDir = await tempBundle();
    await writeConcept(bundleDir, "broken.md", {
      resource: "vault/broken.mdx",
      body: "# Broken\n\n<Unclosed>"
    });
    await writeConcept(bundleDir, "healthy.md", {
      resource: "vault/healthy.mdx",
      body: "# Healthy\n\nUsable content."
    });

    const validation = await validateBundle(bundleDir);
    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "malformed_markdown",
          path: "broken.md"
        })
      ])
    );

    const inspector = await buildBundleInspectorReport(bundleDir);
    expect(inspector.readiness).toMatchObject({
      availabilityStatus: "available",
      validationStatus: "invalid",
      conceptCount: 2
    });
    expect(inspector.concepts.map((concept) => concept.id)).toEqual(["broken", "healthy"]);
    expect(inspector.sources[0]?.validationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "malformed_markdown", path: "broken.md" })
      ])
    );
  });
});
