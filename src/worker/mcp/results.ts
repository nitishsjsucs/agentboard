// MCP tool results (SPEC section 8.4).

export type ErrorClass = "retryable" | "permanent" | "forbidden" | "in_progress";

export interface ToolSuccess {
  ok: true;
  replayed: boolean;
  logical?: boolean;
  data: Record<string, unknown>;
}

export interface ToolFailure {
  ok: false;
  errorClass: ErrorClass;
  code: string;
  message: string;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent: ToolSuccess | ToolFailure;
  isError?: boolean;
}

export function success(data: Record<string, unknown>, replayed = false, logical = false): McpToolResult {
  const structuredContent: ToolSuccess = { ok: true, replayed, ...(logical ? { logical: true } : {}), data };
  return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent };
}

export function failure(errorClass: ErrorClass, code: string, message: string): McpToolResult {
  const structuredContent: ToolFailure = { ok: false, errorClass, code, message };
  return { isError: true, content: [{ type: "text", text: `${code}: ${message}` }], structuredContent };
}
