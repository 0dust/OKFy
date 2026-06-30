import { z } from "zod";

export const MCP_TOOL_NAMES = [
  "search_concepts",
  "read_concept",
  "get_neighbors",
  "list_types",
  "list_tags",
  "bundle_summary"
] as const;

export const [
  SEARCH_CONCEPTS_TOOL,
  READ_CONCEPT_TOOL,
  GET_NEIGHBORS_TOOL,
  LIST_TYPES_TOOL,
  LIST_TAGS_TOOL,
  BUNDLE_SUMMARY_TOOL
] = MCP_TOOL_NAMES;

const REFRESHABLE_TOOL_NAMES = new Set<string>(
  MCP_TOOL_NAMES.filter((tool) => tool !== BUNDLE_SUMMARY_TOOL)
);

export function refreshableTool(name: string): boolean {
  return REFRESHABLE_TOOL_NAMES.has(name);
}

export const searchSchema = z.object({
  query: z.string(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional()
});
export const readSchema = z.object({
  id: z.string(),
  max_chars: z.number().int().positive().optional()
});
export const neighborsSchema = z.object({
  id: z.string(),
  depth: z.number().int().min(1).max(2).optional()
});
export const sourceFilterSchema = z.object({ source: z.string().optional() });
export const workspaceSearchSchema = searchSchema.extend({ source: z.string().optional() });
export const workspaceReadSchema = readSchema.extend({ source: z.string().optional() });
export const workspaceNeighborsSchema = neighborsSchema.extend({ source: z.string().optional() });

type ToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

const stringInputProperty = { type: "string" };
const sourceInputProperty = { type: "string" };
const tagsInputProperty = { type: "array", items: { type: "string" } };
const limitInputProperty = { type: "integer", minimum: 1, maximum: 50, default: 10 };
const maxCharsInputProperty = { type: "integer", minimum: 1 };
const depthInputProperty = { type: "integer", minimum: 1, maximum: 2, default: 1 };

function withOptionalSourceInputSchema(
  schema: ToolInputSchema,
  sourcePosition: "first" | "afterQuery" = "first"
): ToolInputSchema {
  if (sourcePosition === "afterQuery" && "query" in schema.properties) {
    const { query, ...properties } = schema.properties;
    return { ...schema, properties: { query, source: sourceInputProperty, ...properties } };
  }
  return { ...schema, properties: { source: sourceInputProperty, ...schema.properties } };
}

const searchInputSchema = {
  type: "object",
  properties: {
    query: stringInputProperty,
    type: stringInputProperty,
    tags: tagsInputProperty,
    limit: limitInputProperty
  },
  required: ["query"]
} satisfies ToolInputSchema;

const readInputSchema = {
  type: "object",
  properties: { id: stringInputProperty, max_chars: maxCharsInputProperty },
  required: ["id"]
} satisfies ToolInputSchema;

const neighborsInputSchema = {
  type: "object",
  properties: {
    id: stringInputProperty,
    depth: depthInputProperty
  },
  required: ["id"]
} satisfies ToolInputSchema;

const sourceFilterInputSchema = {
  type: "object",
  properties: { source: sourceInputProperty }
} satisfies ToolInputSchema;

const workspaceSearchInputSchema = withOptionalSourceInputSchema(searchInputSchema, "afterQuery");
const workspaceReadInputSchema = withOptionalSourceInputSchema(readInputSchema);
const workspaceNeighborsInputSchema = withOptionalSourceInputSchema(neighborsInputSchema);

type ToolDefinition = {
  name: (typeof MCP_TOOL_NAMES)[number];
  description: string;
  inputSchema: ToolInputSchema;
};

export function mcpToolDefinitions(mode: "bundle" | "workspace"): ToolDefinition[] {
  if (mode === "bundle") {
    return [
      {
        name: SEARCH_CONCEPTS_TOOL,
        description: "Search OKF concepts by query, type, and tags.",
        inputSchema: searchInputSchema
      },
      {
        name: READ_CONCEPT_TOOL,
        description: "Read one OKF concept by id or path.",
        inputSchema: readInputSchema
      },
      {
        name: GET_NEIGHBORS_TOOL,
        description: "Return outbound links and backlinks for a concept.",
        inputSchema: neighborsInputSchema
      },
      {
        name: LIST_TYPES_TOOL,
        description: "List concept types and counts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: LIST_TAGS_TOOL,
        description: "List concept tags and counts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: BUNDLE_SUMMARY_TOOL,
        description: "Return bundle stats and validation status.",
        inputSchema: { type: "object", properties: {} }
      }
    ];
  }

  return [
    {
      name: SEARCH_CONCEPTS_TOOL,
      description: "Search workspace OKF concepts by query, source, type, and tags.",
      inputSchema: workspaceSearchInputSchema
    },
    {
      name: READ_CONCEPT_TOOL,
      description:
        "Read one workspace OKF concept by source and id. Id-only reads work when the id is unique.",
      inputSchema: workspaceReadInputSchema
    },
    {
      name: GET_NEIGHBORS_TOOL,
      description: "Return outbound links and backlinks for a workspace concept.",
      inputSchema: workspaceNeighborsInputSchema
    },
    {
      name: LIST_TYPES_TOOL,
      description: "List workspace concept types and counts.",
      inputSchema: sourceFilterInputSchema
    },
    {
      name: LIST_TAGS_TOOL,
      description: "List workspace concept tags and counts.",
      inputSchema: sourceFilterInputSchema
    },
    {
      name: BUNDLE_SUMMARY_TOOL,
      description: "Return workspace stats, per-source validation, and freshness status.",
      inputSchema: sourceFilterInputSchema
    }
  ];
}
