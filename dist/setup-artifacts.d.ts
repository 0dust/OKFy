type SetupClient = "claude-code" | "mcp-json" | "codex" | "generic";
interface ServeCommand {
    command: string;
    args: string[];
    env: Record<string, string>;
    display: string;
}
interface ServeCommandOptions {
    autoRefresh?: boolean;
}
interface SetupArtifact {
    client: SetupClient;
    label: string;
    format: "shell" | "json" | "toml";
    body: string;
}
interface McpClientArtifactInput {
    client: SetupClient;
    serverName: string;
    codexServerName: string;
    command: ServeCommand;
}
declare function parseSetupClient(value: string): SetupClient;
declare function expectedMcpTools(): string[];
declare function renderClientArtifacts(input: {
    client: SetupClient;
    sourceName?: string;
    sourceNames?: string[];
    workspaceAll?: boolean;
    okfyHome?: string;
    defaultOkfyHome?: string;
}): SetupArtifact[];
declare function renderMcpClientArtifacts(input: McpClientArtifactInput): SetupArtifact[];
declare function firstAgentPrompt(serverName: string, options?: {
    workspace?: boolean;
}): string;
type ServeCommandTarget = string | string[] | {
    all: true;
};
declare function serveCommand(sourceNameOrNames: ServeCommandTarget, okfyHome: string, defaultHome?: string, options?: ServeCommandOptions): ServeCommand;
declare function serveCommandArgs(sourceNameOrNames: ServeCommandTarget, options?: ServeCommandOptions): string[];
declare function mcpServerName(sourceNameOrNames: string | string[]): string;
declare function codexMcpServerName(sourceNameOrNames: string | string[]): string;

export { type McpClientArtifactInput, type ServeCommand, type ServeCommandOptions, type ServeCommandTarget, type SetupArtifact, type SetupClient, codexMcpServerName, expectedMcpTools, firstAgentPrompt, mcpServerName, parseSetupClient, renderClientArtifacts, renderMcpClientArtifacts, serveCommand, serveCommandArgs };
