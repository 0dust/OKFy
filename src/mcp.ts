import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BundleSearch } from "./search.js";
import { inspectBundle, validateBundle } from "./validate.js";

export type ServeOptions = {
  bundleDir: string;
  name?: string;
  maxResultChars?: number;
};

function json(value: unknown, maxChars = 12000): { content: Array<{ type: "text"; text: string }> } {
  let text = JSON.stringify(value, null, 2);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n...truncated`;
  return { content: [{ type: "text", text }] };
}

const searchSchema = z.object({
  query: z.string(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional()
});
const readSchema = z.object({ id: z.string(), max_chars: z.number().int().positive().optional() });
const neighborsSchema = z.object({ id: z.string(), depth: z.number().int().min(1).max(2).optional() });

export async function createMcpServer(options: ServeOptions): Promise<Server> {
  const search = await BundleSearch.fromBundle(options.bundleDir);
  const server = new Server(
    { name: options.name ?? "okfy", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  const maxResultChars = options.maxResultChars ?? 12000;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_concepts",
        description: "Search OKF concepts by query, type, and tags.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "number", default: 10 }
          },
          required: ["query"]
        }
      },
      {
        name: "read_concept",
        description: "Read one OKF concept by id or path.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, max_chars: { type: "number" } },
          required: ["id"]
        }
      },
      {
        name: "get_neighbors",
        description: "Return outbound links and backlinks for a concept.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, depth: { type: "number", default: 1 } },
          required: ["id"]
        }
      },
      { name: "list_types", description: "List concept types and counts.", inputSchema: { type: "object", properties: {} } },
      { name: "list_tags", description: "List concept tags and counts.", inputSchema: { type: "object", properties: {} } },
      { name: "bundle_summary", description: "Return bundle stats and validation status.", inputSchema: { type: "object", properties: {} } }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      if (request.params.name === "search_concepts") {
        const parsed = searchSchema.parse(args);
        return json(search.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === "read_concept") {
        const parsed = readSchema.parse(args);
        const concept = search.getConcept(parsed.id);
        if (!concept) return json({ error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` } });
        const max = parsed.max_chars ?? maxResultChars;
        return json(
          {
            frontmatter: concept.frontmatter,
            markdown_body: concept.body.slice(0, max),
            outbound_links: search.graph.outbound.get(concept.id) ?? [],
            backlinks: search.graph.backlinks.get(concept.id) ?? [],
            source_resource: concept.resource
          },
          maxResultChars
        );
      }
      if (request.params.name === "get_neighbors") {
        const parsed = neighborsSchema.parse(args);
        const root = search.getConcept(parsed.id);
        if (!root) return json({ error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` } });
        const depth = parsed.depth ?? 1;
        const seen = new Set([root.id]);
        let frontier = [root.id];
        const edges: Array<{ from: string; to: string; direction: "outbound" | "backlink"; relationship_text?: string }> = [];
        for (let level = 0; level < depth; level += 1) {
          const next: string[] = [];
          for (const id of frontier) {
            for (const to of search.graph.outbound.get(id) ?? []) {
              edges.push({ from: id, to, direction: "outbound", relationship_text: "Markdown link" });
              if (!seen.has(to)) next.push(to);
              seen.add(to);
            }
            for (const from of search.graph.backlinks.get(id) ?? []) {
              edges.push({ from, to: id, direction: "backlink", relationship_text: "Backlink" });
              if (!seen.has(from)) next.push(from);
              seen.add(from);
            }
          }
          frontier = next;
        }
        return json({
          root: root.id,
          concepts: [...seen].map((id) => {
            const concept = search.graph.concepts.get(id);
            return { id, title: concept?.title, type: concept?.type, resource: concept?.resource };
          }),
          edges
        });
      }
      if (request.params.name === "list_types") {
        const stats = await inspectBundle(options.bundleDir);
        return json(stats.typeDistribution);
      }
      if (request.params.name === "list_tags") {
        const stats = await inspectBundle(options.bundleDir);
        return json(stats.tagDistribution);
      }
      if (request.params.name === "bundle_summary") {
        const [stats, validation] = await Promise.all([inspectBundle(options.bundleDir), validateBundle(options.bundleDir)]);
        return json({ ...stats, validationStatus: validation.valid ? "valid" : "invalid", validationIssues: validation.issues });
      }
      return json({ error: { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` } });
    } catch (error: any) {
      return json({ error: { code: "tool_error", message: error?.message ?? "Tool failed." } });
    }
  });
  return server;
}

export async function serveMcpStdio(options: ServeOptions): Promise<void> {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
