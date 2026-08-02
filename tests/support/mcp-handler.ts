export type McpTextResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type McpHandler = (request: unknown, extra?: unknown) => Promise<McpTextResult>;

export function mcpHandler(server: unknown, method: string): McpHandler {
  const handlers = (server as { _requestHandlers: Map<string, McpHandler> })._requestHandlers;
  const found = handlers.get(method);
  if (!found) throw new Error(`Missing MCP handler: ${method}`);
  return found;
}
