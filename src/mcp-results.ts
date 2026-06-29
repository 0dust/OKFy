import { type z } from "zod";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function json(value: unknown, maxChars = 12000): ToolResult {
  return toolResult(value, structuredContentFor(value), maxChars);
}

export function toolResult(
  textPayload: unknown,
  structuredContent: Record<string, unknown> | undefined,
  maxChars: number,
  isError = false
): ToolResult {
  const serialized = JSON.stringify(textPayload, null, 2);
  const boundedStructuredContent = serialized.length <= maxChars ? structuredContent : undefined;
  let text = serialized;
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n...truncated`;
  return {
    content: [{ type: "text", text }],
    structuredContent: boundedStructuredContent,
    isError
  };
}

export function toolError(error: Record<string, unknown>, maxChars = 12000): ToolResult {
  return toolResult({ error }, { error }, maxChars, true);
}

function structuredContentFor(value: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(value)) return { results: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (value === undefined) return undefined;
  return { value };
}

export function argumentError(error: z.ZodError): Record<string, unknown> {
  return {
    code: "invalid_arguments",
    message: "Invalid tool arguments.",
    issues: error.issues
  };
}
